-- Skal vi hjem? Collaboration migration 001.
-- Run once as the project database owner in a dedicated Supabase project.
-- No existing application objects or global/default privileges are modified.
-- Anonymous Auth must be enabled separately. Keep the frontend disabled until tested.
begin;
create schema if not exists svh_private;
revoke all on schema svh_private from public, anon;
grant usage on schema svh_private to authenticated;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.svh_rooms (
 id uuid primary key default gen_random_uuid(),
 host_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (length(btrim(title)) between 1 and 60),
 settings jsonb not null,
 revision bigint not null default 0,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '48 hours')
);
create index svh_rooms_host on public.svh_rooms(host_id);
create table public.svh_members (
 room_id uuid not null references public.svh_rooms(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (length(btrim(name)) between 1 and 40),
 age smallint not null check (age between 0 and 120),
 tired smallint not null check (tired between 0 and 10),
 dance smallint not null check (dance between 0 and 10),
 retired boolean not null,
 gone_home boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(room_id,user_id)
);
create index svh_members_user on public.svh_members(user_id,room_id);
create table svh_private.invites (
 room_id uuid primary key references public.svh_rooms(id) on delete cascade,
 token_hash bytea not null
);
alter table public.svh_rooms enable row level security;
alter table public.svh_members enable row level security;
alter table svh_private.invites enable row level security;
revoke all on public.svh_rooms,public.svh_members,svh_private.invites from public,anon,authenticated;
grant select on public.svh_rooms,public.svh_members to authenticated;

-- A non-exposed helper avoids recursive room/member RLS policies.
create function svh_private.my_rooms() returns setof uuid
language sql stable security definer set search_path = '' as $$
 select r.id from public.svh_rooms r join public.svh_members m on m.room_id=r.id
 where m.user_id=(select auth.uid()) and r.expires_at > now();
$$;
revoke all on function svh_private.my_rooms() from public,anon;
grant execute on function svh_private.my_rooms() to authenticated;
create policy svh_room_read on public.svh_rooms for select to authenticated
 using (id in (select svh_private.my_rooms()));
create policy svh_member_read on public.svh_members for select to authenticated
 using (room_id in (select svh_private.my_rooms()));

create function svh_private.valid_person(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object'
   or jsonb_typeof(p->'name') is distinct from 'string'
   or length(btrim(p->>'name')) not between 1 and 40
   or jsonb_typeof(p->'retired') is distinct from 'boolean'
   or jsonb_typeof(p->'gone_home') is distinct from 'boolean' then return false; end if;
 for item in select jsonb_build_object('v',p->k,'max',mx) from (values('age',120),('tired',10),('dance',10)) x(k,mx)
 loop
   if jsonb_typeof(item->'v') is distinct from 'number' or (item->>'v')::numeric <> trunc((item->>'v')::numeric)
     or (item->>'v')::numeric < 0 or (item->>'v')::numeric > (item->>'max')::int then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;

create function svh_private.valid_settings(s jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; v numeric; lo numeric; hi numeric; step numeric;
begin
 if jsonb_typeof(s) is distinct from 'object' then return false; end if;
 foreach k in array array['realClock','tomorrow','oneMore','banger','pensionRule'] loop
   if jsonb_typeof(s->k) is distinct from 'boolean' then return false; end if;
 end loop;
 if jsonb_typeof(s->'date') is distinct from 'string'
   or not (s->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
   or to_char((s->>'date')::date,'YYYY-MM-DD') <> s->>'date'
   or (s->>'date')::date not between date '1900-01-01' and date '2199-12-31'
   or jsonb_typeof(s->'time') is distinct from 'string'
   or not (s->>'time' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
   or jsonb_typeof(s->'weights') is distinct from 'object' then return false; end if;
 for k,lo,hi,step in select * from (values
   ('tired',2::numeric,10::numeric,0.5::numeric),('dance',1,8,0.5),('age',0,0.3,0.01),('sine',0,12,1)) x(k,lo,hi,step)
 loop
   if jsonb_typeof(s->'weights'->k) is distinct from 'number' then return false; end if;
   v=(s->'weights'->>k)::numeric;
   if v<lo or v>hi or mod(v-lo,step)<>0 then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;
revoke all on function svh_private.valid_person(jsonb),svh_private.valid_settings(jsonb) from public,anon,authenticated;
alter table public.svh_rooms add constraint svh_valid_settings check(svh_private.valid_settings(settings));

-- All mutations are bounded, authorized, field-level and serialized per room.
-- The caller cannot supply another person's user_id, host_id, role or expiry.
create function svh_private.perform(p_action text,p_room uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 who uuid := auth.uid(); r public.svh_rooms%rowtype; m public.svh_members%rowtype;
 person jsonb; new_settings jsonb; key text; token text; result jsonb;
begin
 if who is null then raise exception 'Logg inn anonymt først.' using errcode='42501'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>8000 then
   raise exception 'Ugyldig forespørsel.' using errcode='22023'; end if;
 if p_action='create' then
   perform pg_advisory_xact_lock(hashtextextended(who::text,0));
   if (select count(*) from public.svh_rooms where host_id=who and expires_at>now())>=3 then
     raise exception 'Du har allerede tre aktive kvelder. Slett en først.' using errcode='22023'; end if;
   if jsonb_typeof(p_payload->'title') is distinct from 'string' then raise exception 'Kvelden mangler navn.' using errcode='22023'; end if;
   person=p_payload->'person';
   if not svh_private.valid_person(person) then raise exception 'Ugyldige deltakeropplysninger.' using errcode='22023'; end if;
   new_settings=jsonb_build_object('date',to_char(now() at time zone 'Europe/Oslo','YYYY-MM-DD'),
    'time',to_char(now() at time zone 'Europe/Oslo','HH24:MI'),'realClock',true,'tomorrow',true,'oneMore',false,
    'banger',false,'pensionRule',true,'weights',jsonb_build_object('tired',6,'dance',4.5,'age',0.12,'sine',6));
   insert into public.svh_rooms(host_id,title,settings) values(who,btrim(p_payload->>'title'),new_settings) returning * into r;
   insert into public.svh_members(room_id,user_id,name,age,tired,dance,retired,gone_home)
   values(r.id,who,btrim(person->>'name'),(person->>'age')::smallint,(person->>'tired')::smallint,
    (person->>'dance')::smallint,(person->>'retired')::boolean,(person->>'gone_home')::boolean);
   token=encode(extensions.gen_random_bytes(24),'hex');
   insert into svh_private.invites values(r.id,extensions.digest(token,'sha256'));
 else
   -- Every write locks this row first; snapshots also lock it for a consistent roster.
   select * into r from public.svh_rooms where id=p_room and expires_at>now() for update;
   if not found then raise exception 'Kvelden finnes ikke, er utløpt eller er utilgjengelig.' using errcode='P0002'; end if;
   select * into m from public.svh_members where room_id=r.id and user_id=who;
   if p_action='join' and m.user_id is null then
     if jsonb_typeof(p_payload->'invite') is distinct from 'string'
        or not (p_payload->>'invite' ~ '^[0-9a-f]{48}$')
        or not exists(select 1 from svh_private.invites where room_id=r.id
           and token_hash=extensions.digest(p_payload->>'invite','sha256')) then
       raise exception 'Invitasjonen er ugyldig eller erstattet av en ny lenke.' using errcode='42501'; end if;
     if (select count(*) from public.svh_members where room_id=r.id)>=40 then
       raise exception 'Kvelden har nådd grensen på 40 deltakere.' using errcode='22023'; end if;
     person=p_payload->'person';
     if not svh_private.valid_person(person) then raise exception 'Ugyldige deltakeropplysninger.' using errcode='22023'; end if;
     insert into public.svh_members(room_id,user_id,name,age,tired,dance,retired,gone_home)
     values(r.id,who,btrim(person->>'name'),(person->>'age')::smallint,(person->>'tired')::smallint,
       (person->>'dance')::smallint,(person->>'retired')::boolean,(person->>'gone_home')::boolean);
   elsif m.user_id is null then raise exception 'Du er ikke deltaker i denne kvelden.' using errcode='P0002';
   elsif p_action='me' then
     if exists(select 1 from jsonb_object_keys(p_payload) k where k not in('name','age','tired','dance','retired','gone_home')) then
       raise exception 'Bare egne deltakerfelter kan endres.' using errcode='42501'; end if;
     person=to_jsonb(m)||p_payload;
     if not svh_private.valid_person(person) then raise exception 'Ugyldige deltakeropplysninger.' using errcode='22023'; end if;
     update public.svh_members set name=btrim(person->>'name'),age=(person->>'age')::smallint,
       tired=(person->>'tired')::smallint,dance=(person->>'dance')::smallint,retired=(person->>'retired')::boolean,
       gone_home=(person->>'gone_home')::boolean,updated_at=now() where room_id=r.id and user_id=who;
   elsif p_action in('settings','rotate','delete') then
     if r.host_id<>who then raise exception 'Bare verten kan gjøre dette.' using errcode='42501'; end if;
     if p_action='settings' then
       new_settings=r.settings;
       for key in select jsonb_object_keys(p_payload) loop
         if key in('date','time','realClock','tomorrow','oneMore','banger','pensionRule') then
           new_settings=jsonb_set(new_settings,array[key],p_payload->key);
         elsif key in('weight_tired','weight_dance','weight_age','weight_sine') then
           new_settings=jsonb_set(new_settings,array['weights',substr(key,8)],p_payload->key);
         else raise exception 'Ugyldig innstillingsfelt.' using errcode='22023'; end if;
       end loop;
       if not svh_private.valid_settings(new_settings) then raise exception 'Ugyldige modellinnstillinger.' using errcode='22023'; end if;
       update public.svh_rooms set settings=new_settings where id=r.id;
     elsif p_action='rotate' then
       token=encode(extensions.gen_random_bytes(24),'hex');
       update svh_private.invites set token_hash=extensions.digest(token,'sha256') where room_id=r.id;
     else
       delete from public.svh_rooms where id=r.id;
       return jsonb_build_object('deleted',true);
     end if;
   elsif p_action not in('state','join') then raise exception 'Ukjent handling.' using errcode='22023';
   end if;
   if p_action<>'state' then update public.svh_rooms set revision=revision+1 where id=r.id; end if;
 end if;
 select to_jsonb(x) into result from public.svh_rooms x where x.id=r.id;
 result=jsonb_build_object('room',result,'server_time',clock_timestamp(),'members',
   coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.user_id) from public.svh_members x where x.room_id=r.id),'[]'::jsonb));
 if token is not null then result=result||jsonb_build_object('invite',token); end if;
 return result;
end; $$;
revoke all on function svh_private.perform(text,uuid,jsonb) from public,anon;
grant execute on function svh_private.perform(text,uuid,jsonb) to authenticated;

-- Exposed API wrapper does not itself run with elevated privileges.
create function public.svh_action(p_action text,p_room uuid default null,p_payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
 select svh_private.perform(p_action,p_room,p_payload);
$$;
revoke all on function public.svh_action(text,uuid,jsonb) from public,anon;
grant execute on function public.svh_action(text,uuid,jsonb) to authenticated;

-- Only room UPDATE notifications are subscribed to. Secret invitations never replicate.
-- All participant and setting writes increment the room revision in the same transaction.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
   alter publication supabase_realtime add table public.svh_rooms;
 end if;
end $$;
commit;

-- Optional maintenance, executed by the project owner (not exposed to the client):
-- delete from public.svh_rooms where expires_at < now();
-- For scheduled physical deletion, enable pg_cron and schedule that exact statement.
-- Expiry alone denies reads/updates but does NOT delete database records or Auth users.
