-- Reproducible PostgreSQL/RLS expiry test for a dedicated Skal vi hjem? project.
-- Run the whole file as the database owner in the Supabase SQL editor.
-- This exercises PostgreSQL as authenticated with synthetic JWT claims. It does
-- NOT test anonymous Auth sign-in, issued JWTs, HTTP transport, or WebSockets.
-- All fixture users, rooms, memberships and invitations are rolled back.
-- The DO block has an exception handler, so a failure also rolls back every
-- fixture before it is reported; run ROLLBACK if the editor leaves an aborted
-- transaction open after an error.
begin;

do $expiry_test$
declare
 host_uid uuid := gen_random_uuid();
 guest_uid uuid := gen_random_uuid();
 actor_uid uuid;
 fixture_room_id uuid;
 created jsonb;
 snapshot jsonb;
 invite_token text;
 action_name text;
 request_payload jsonb;
 rejected_actions integer := 0;
 person jsonb := '{"name":"Expiry fixture","age":59,"tired":4,"dance":7,"retired":false,"gone_home":false}'::jsonb;
begin
 if exists (select 1 from auth.users
   where raw_app_meta_data->>'svh_expiry_test'='transactional_fixture')
   or exists (select 1 from public.svh_rooms
     where title='SVH transactional expiry fixture') then
   raise exception 'Existing expiry fixtures found; inspect before running this test.';
 end if;

 insert into auth.users(id,aud,role,is_anonymous,raw_app_meta_data,
   raw_user_meta_data,created_at,updated_at)
 values
   (host_uid,'authenticated','authenticated',true,
     '{"svh_expiry_test":"transactional_fixture"}'::jsonb,'{}'::jsonb,now(),now()),
   (guest_uid,'authenticated','authenticated',true,
     '{"svh_expiry_test":"transactional_fixture"}'::jsonb,'{}'::jsonb,now(),now());

 perform set_config('request.jwt.claim.sub',host_uid::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object(
   'sub',host_uid,'role','authenticated','is_anonymous',true)::text,true);
 execute 'set local role authenticated';
 created := public.svh_action('create',null,jsonb_build_object(
   'title','SVH transactional expiry fixture','person',person));
 fixture_room_id := (created->'room'->>'id')::uuid;
 invite_token := created->>'invite';
 execute 'reset role';

 perform set_config('request.jwt.claim.sub',guest_uid::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object(
   'sub',guest_uid,'role','authenticated','is_anonymous',true)::text,true);
 execute 'set local role authenticated';
 snapshot := public.svh_action('join',fixture_room_id,jsonb_build_object(
   'invite',invite_token,'person',person));
 if jsonb_array_length(snapshot->'members')<>2
   or (select count(*) from public.svh_rooms r where r.id=fixture_room_id)<>1
   or (select count(*) from public.svh_members m where m.room_id=fixture_room_id)<>2 then
   raise exception 'Valid, unexpired fixture must be visible to its participant.';
 end if;
 perform public.svh_action('state',fixture_room_id,'{}'::jsonb);
 execute 'reset role';

 -- Only the database owner can change expiry directly.
 update public.svh_rooms r
 set expires_at=clock_timestamp()-interval '1 minute'
 where r.id=fixture_room_id;

 foreach actor_uid in array array[host_uid,guest_uid] loop
   perform set_config('request.jwt.claim.sub',actor_uid::text,true);
   perform set_config('request.jwt.claims',jsonb_build_object(
     'sub',actor_uid,'role','authenticated','is_anonymous',true)::text,true);
   execute 'set local role authenticated';
   if exists (select 1 from public.svh_rooms r where r.id=fixture_room_id)
     or exists (select 1 from public.svh_members m where m.room_id=fixture_room_id) then
     raise exception 'RLS exposed expired room or members to %.',actor_uid;
   end if;

   foreach action_name in array array['state','me','join'] loop
     request_payload := case action_name
       when 'me' then '{"tired":8}'::jsonb
       when 'join' then jsonb_build_object('invite',invite_token,'person',person)
       else '{}'::jsonb end;
     begin
       perform public.svh_action(action_name,fixture_room_id,request_payload);
       raise exception 'Expired room unexpectedly accepted action % for %.',action_name,actor_uid;
     exception when sqlstate 'P0002' then
       rejected_actions := rejected_actions+1;
     end;
   end loop;
   execute 'reset role';
 end loop;

 if rejected_actions<>6 then
   raise exception 'Expected six expiry rejections; got %.',rejected_actions;
 end if;
exception when others then
 -- Entering this handler has already rolled back the entire DO block,
 -- including fixture inserts and local role/claim changes.
 execute 'reset role';
 raise exception 'Expiry test failed; fixtures rolled back: %',sqlerrm
   using errcode=sqlstate;
end;
$expiry_test$;

rollback;

-- Reached only after all assertions pass and the explicit rollback succeeds.
select
 'PASS: host and guest cannot read expired room/members; state/me/join each reject with P0002' as result,
 (select count(*) from auth.users
   where raw_app_meta_data->>'svh_expiry_test'='transactional_fixture') as remaining_fixture_users,
 (select count(*) from public.svh_rooms
   where title='SVH transactional expiry fixture') as remaining_fixture_rooms;
