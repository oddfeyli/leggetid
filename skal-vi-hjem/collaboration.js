/* Collaboration is opt-in; the original local app and its storage are untouched.
   Depends on the original pure model functions in app-1.js, and Supabase JS. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const cfg = window.SVH_CLOUD || {};
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const tokenPattern = /^[0-9a-f]{48}$/;
  const params = new URLSearchParams(location.hash.slice(1));
  let roomId = params.get('room'), invite = params.get('invite') || '';
  let db, userId, channel, snapshotData, timer, poll, refreshing = null;
  let pendingMe = {}, pendingSettings = {}, saving = false, fatal = false, live = false;
  let serverTime = 0, receivedAt = 0, retryDelay = 1500, retryTimer, sdkPromise;
  const hasKeys = x => Object.keys(x).length > 0;
  const dirty = () => hasKeys(pendingMe) || hasKeys(pendingSettings) || saving;
  const status = (text, error=false) => {
    el('cloud-status').textContent = text;
    el('cloud-status').dataset.error = String(error);
  };
  const readStore = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const store = (k,v) => { try { localStorage.setItem(k,v); } catch (_) {} };
  const host = () => snapshotData && snapshotData.room.host_id === userId;
  function fail(error) {
    const code = error && error.code;
    if (code === 'P0002') {
      fatal = true; clearInterval(poll); clearTimeout(retryTimer);
      if (channel) { db.removeChannel(channel); channel = null; }
      el('cloud-room').hidden = true;
      status('Kvelden er slettet, utløpt, eller du har ikke tilgang. Ingen nye endringer blir sendt.',true);
    } else if (!navigator.onLine) {
      status('Frakoblet. Endringer venter her i fanen og er IKKE delt med de andre. Ikke lukk fanen.',true);
    } else if (code === '42501') {
      status('Du har ikke tilgang til denne handlingen. Ingen endringer er lagret.',true);
    } else {
      const message = String(error && error.message || 'Ukjent tilkoblingsfeil.');
      status('Ikke synkronisert: ' + message + ' Bruk «Prøv synkronisering på nytt».',true);
    }
  }
  function validConfig() {
    if (!cfg.enabled || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(cfg.url || '')) return false;
    const k = cfg.publishableKey || '';
    if (k.startsWith('sb_publishable_')) return true;
    try { return JSON.parse(atob(k.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role === 'anon'; }
    catch (_) { return false; }
  }
  function sdk() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.js';
      script.crossOrigin = 'anonymous';
      const timeout = setTimeout(() => reject(new Error('Klientbiblioteket svarte ikke. Last siden på nytt.')),15000);
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => { clearTimeout(timeout); sdkPromise = null; reject(new Error('Klientbiblioteket kunne ikke lastes.')); };
      document.head.append(script);
    });
    return sdkPromise;
  }
  async function connect(createIdentity) {
    if (!validConfig()) throw new Error('Supabase er ikke konfigurert.');
    await sdk();
    if (!db) db = window.supabase.createClient(cfg.url,cfg.publishableKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'svh-collaboration-auth'},
      global:{fetch:(url,options={}) => fetch(url,{...options,signal:options.signal || AbortSignal.timeout(15000)})}
    });
    let {data,error} = await db.auth.getSession();
    if (error) throw error;
    if (!data.session && createIdentity) {
      ({data,error} = await db.auth.signInAnonymously());
      if (error) throw error;
    }
    userId = data.session && data.session.user.id;
    // Attach the user's JWT before joining Realtime. With a publishable key,
    // an unauthenticated channel cannot inspect this table's filter columns.
    if (data.session) await db.realtime.setAuth(data.session.access_token);
    return Boolean(userId);
  }
  async function rpc(action,payload={},id=roomId) {
    const {data,error} = await db.rpc('svh_action',{p_action:action,p_room:id || null,p_payload:payload});
    if (error) throw error;
    return data;
  }
  function rememberedLink() {
    if (!invite) invite = readStore('svh-invite-' + roomId) || '';
    const link = new URL(location.href); link.hash = '';
    link.hash = new URLSearchParams({room:roomId,...(invite ? {invite} : {})}).toString();
    return link.href;
  }
  function accept(data) {
    if (!data || !data.room || !Array.isArray(data.members)) throw new Error('Ugyldig svar fra databasen.');
    if (snapshotData && Number(data.room.revision) < Number(snapshotData.room.revision)) return;
    snapshotData = data;
    serverTime = new Date(data.server_time).getTime(); receivedAt = performance.now();
    el('cloud-entry').hidden = true; el('cloud-room').hidden = false;
    render();
  }
  async function refresh() {
    if (!roomId || !userId || fatal) return;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        accept(await rpc('state'));
        if (!dirty()) status(live ? 'Synkronisert med kvelden. Endringer deles fortløpende.' : 'Kontakt med databasen. Sanntidskanalen kobler til; reservemodus oppdaterer hvert 15. sekund.');
      } catch (e) { fail(e); }
      finally { refreshing = null; }
    })();
    return refreshing;
  }
  async function enter(data) {
    roomId = data.room.id;
    if (data.invite) invite = data.invite;
    if (invite) store('svh-invite-' + roomId,invite);
    history.replaceState(null,'',rememberedLink());
    accept(data);
    channel = db.channel('svh-room-' + roomId)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'svh_rooms',filter:'id=eq.'+roomId},refresh)
      .subscribe(s => { live = s === 'SUBSCRIBED'; if (live) refresh(); else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') status('Sanntidskanalen er brutt. Reservemodus kontrollerer endringer hvert 15. sekund.',true); });
    clearInterval(poll);
    poll = setInterval(() => { if (document.visibilityState === 'visible') { flush(); refresh(); } },15000);
    await refresh();
  }
  function queue(kind,key,value) {
    (kind === 'me' ? pendingMe : pendingSettings)[key] = value;
    status('Endring venter på lagring. De andre ser den først når databasen har bekreftet.');
    clearTimeout(timer); timer = setTimeout(flush,350);
  }
  async function flush() {
    if (saving || fatal || !db || !dirty()) return;
    if (!navigator.onLine) { fail(new Error('Frakoblet')); return; }
    saving = true;
    // Field patches (not whole-room writes) prevent one guest overwriting another.
    const mine = pendingMe, settings = pendingSettings;
    pendingMe = {}; pendingSettings = {};
    let meSaved = false, settingsSaved = false;
    try {
      if (hasKeys(mine)) { await rpc('me',mine); meSaved = true; }
      if (hasKeys(settings)) { await rpc('settings',settings); settingsSaved = true; }
      retryDelay = 1500;
    } catch (e) {
      if (e.code === '22023' || e.code === '42501' || e.code === '23514') {
        fail(e);
        // A validation/permission error must not cause endless retries.
        return;
      }
      if (!meSaved) pendingMe = {...mine,...pendingMe};
      if (!settingsSaved) pendingSettings = {...settings,...pendingSettings};
      fail(e);
      if (!fatal) { clearTimeout(retryTimer); retryTimer = setTimeout(flush,retryDelay); retryDelay = Math.min(30000,retryDelay*2); }
      return;
    } finally { saving = false; }
    await refresh();
    if (dirty()) { clearTimeout(timer); timer = setTimeout(flush,50); }
  }
  function field(parent,label,key,value,type,options={}) {
    const wrap = document.createElement('label'); wrap.className = 'cloud-field';
    const span = document.createElement('span'); span.textContent = label; wrap.append(span);
    const input = document.createElement('input'); input.type = type; input.dataset.key = key;
    Object.entries(options).forEach(([k,v]) => input.setAttribute(k,String(v)));
    if (type === 'checkbox') input.checked = value; else input.value = value;
    wrap.append(input);
    if (type === 'range') { const out = document.createElement('output'); out.textContent = value; span.append(out); input.addEventListener('input',() => { out.textContent = input.value; }); }
    parent.append(wrap); return input;
  }
  function modelSettings() {
    const s = JSON.parse(JSON.stringify(snapshotData.room.settings));
    if (s.realClock) {
      const now = new Date(serverTime + performance.now() - receivedAt);
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Oslo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x => [x.type,x.value]));
      s.date = `${parts.year}-${parts.month}-${parts.day}`; s.time = `${parts.hour}:${parts.minute}`;
    }
    return s;
  }
  function summary() {
    const s = modelSettings();
    const active = snapshotData.members.filter(p => !p.gone_home);
    const group = calculateGroup(active,s), counter = calculateGroup(active,{...s,pensionRule:false});
    el('cloud-verdict').textContent = group.band ? TITLES[group.band] : 'ALLE HAR GÅTT HJEM.';
    el('cloud-score').textContent = group.score === null ? '—' : fmt(group.score);
    el('cloud-reason').textContent = groupReason(group,counter);
    el('cloud-counts').textContent = `${active.length} fortsatt her · ${group.homeCount} hjemklare · ${fmt(group.totalWeight,2)} stemmer · ${snapshotData.members.length-active.length} har gått hjem`;
    el('cloud-counter').textContent = s.pensionRule && counter.score !== null ? `Uten §67b: ${fmt(counter.score)} / 100 — ${TITLES[counter.band]}` : '';
    el('cloud-clock').textContent = `${s.date} kl. ${s.time} · ${s.realClock ? 'Felles serverklokke, Europe/Oslo' : 'Vertens simulerte klokke'} · Indeks er ikke prosent hjemklare.`;
    return {s,group};
  }
  function render() {
    const r = snapshotData.room;
    el('cloud-room-title').textContent = r.title;
    el('cloud-role').textContent = host() ? 'Du er vert. Begrenset enevelde.' : 'Du er deltaker. Eget kort, én vilje.';
    el('cloud-room-info').textContent = 'Invitasjonen utløper ' + new Date(r.expires_at).toLocaleString('nb-NO',{timeZone:'Europe/Oslo'}) + '. Å låse mobilen teller ikke som å gå hjem.';
    el('cloud-delete').hidden = !host(); el('cloud-rotate').hidden = !host();
    const {s} = summary();
    const grid = el('cloud-people');
    const currentIds = new Set(snapshotData.members.map(p => p.user_id));
    [...grid.children].forEach(card => { if (!currentIds.has(card.dataset.id)) card.remove(); });
    snapshotData.members.forEach(p => {
      let card = [...grid.children].find(c => c.dataset.id === p.user_id);
      const mine = p.user_id === userId;
      if (!card) {
        card = document.createElement('article'); card.className = 'cloud-person'; card.dataset.id = p.user_id; card.dataset.mine = String(mine);
        const title = document.createElement('h3'); title.className = 'card-title'; card.append(title);
        field(card,'Navn','name',p.name,'text',{maxlength:40,required:true});
        field(card,'Alder','age',p.age,'number',{min:0,max:120,step:1,required:true});
        field(card,'Trøtthet','tired',p.tired,'range',{min:0,max:10,step:1});
        field(card,'Dansevilje','dance',p.dance,'range',{min:0,max:10,step:1});
        field(card,'Pensjonist — selvdeklarert privilegium','retired',p.retired,'checkbox');
        const recommendation = document.createElement('p'); recommendation.className = 'card-recommendation'; card.append(recommendation);
        const reason = document.createElement('p'); reason.className = 'cloud-muted card-reason'; card.append(reason);
        if (mine) {
          const leave = document.createElement('button'); leave.className = 'btn card-leave'; leave.type = 'button'; card.append(leave);
          leave.addEventListener('click',() => { const stored = snapshotData.members.find(x => x.user_id === userId); queue('me','gone_home',!(pendingMe.gone_home ?? stored.gone_home)); flush(); });
          card.addEventListener('input',e => {
            const input = e.target, key = input.dataset.key;
            if (!key || !input.validity.valid || (key === 'name' && !input.value.trim())) return;
            queue('me',key,input.type === 'checkbox' ? input.checked : key === 'name' ? input.value.trim() : Number(input.value));
          });
        }
        grid.append(card);
      }
      card.dataset.home = String(p.gone_home);
      card.querySelector('.card-title').textContent = p.name + (mine ? ' · DEG' : '') + (p.user_id === r.host_id ? ' · VERT' : '');
      card.querySelectorAll('input').forEach(input => {
        const k = input.dataset.key;
        input.disabled = !mine;
        // Keep focus and unacknowledged edits while updating other people's cards.
        if (mine && (document.activeElement === input || saving || k in pendingMe)) return;
        if (input.type === 'checkbox') input.checked = p[k]; else input.value = p[k];
        const out = input.closest('label').querySelector('output'); if (out) out.textContent = p[k];
      });
      const result = calculatePerson(p,s);
      card.querySelector('.card-recommendation').textContent = p.gone_home ? 'HAR GÅTT HJEM. Ikke med i gruppedommen.' : `${LABELS[result.band]} · ${fmt(result.score)} / 100`;
      card.querySelector('.card-reason').textContent = p.gone_home ? 'Sofaen har bekreftet mottak. Stemmen er arkivert.' : individualReason(result,s);
      if (mine) card.querySelector('.card-leave').textContent = p.gone_home ? 'Jeg er tilbake' : 'Jeg har gått hjem';
    });
    renderSettings();
  }
  function renderSettings() {
    const area = el('cloud-settings');
    area.disabled = !host();
    el('cloud-permissions').textContent = host() ? 'Bare du kan endre fellesinnstillingene. De gjelder alle.' : 'Verten styrer dette. Databasen håndhever arbeidsdelingen.';
    const definitions = [['realClock','Bruk felles serverklokke','checkbox'],['date','Simulert dato','date'],['time','Simulert klokkeslett','time'],['tomorrow','Morgendagen eksisterer','checkbox'],['oneMore','«Bare én til» er troverdig','checkbox'],['banger','De spiller en banger','checkbox'],['pensionRule','Pensjonistparagraf §67b','checkbox']];
    const s = snapshotData.room.settings;
    if (!area.children.length) {
      definitions.forEach(([k,label,type]) => field(area,label,k,s[k],type,type === 'date' ? {min:'1900-01-01',max:'2199-12-31',required:true} : type === 'time' ? {required:true} : {}));
      [['tired','Trøtthetens tyngde'],['dance','Danseviljens lobbykraft'],['age','Aldersbyråkrati'],['sine','Kommunal sinusamplitude']].forEach(([k,label]) => { const [min,max,step] = LIMITS[k]; field(area,label,'weight_'+k,s.weights[k],'range',{min,max,step}); });
      area.addEventListener('input',e => {
        const input = e.target, key = input.dataset.key;
        if (!key || !host() || !input.validity.valid) return;
        if (key === 'realClock' && !input.checked) {
          const previous = modelSettings();
          queue('settings','date',previous.date); queue('settings','time',previous.time);
        }
        queue('settings',key,input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value);
      });
    }
    area.querySelectorAll('input').forEach(input => {
      const k = input.dataset.key;
      input.disabled = !host() || ((k === 'date' || k === 'time') && s.realClock);
      if (host() && (document.activeElement === input || saving || k in pendingSettings)) return;
      const v = k.startsWith('weight_') ? s.weights[k.slice(7)] : s[k];
      if (input.type === 'checkbox') input.checked = v; else input.value = v;
      const out = input.closest('label').querySelector('output'); if (out) out.textContent = v;
    });
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); status('Kopiert. Direktoratet fraskriver seg fortsatt all myndighet.'); }
    catch (_) { const input = el('cloud-link'); input.hidden = false; input.value = text; input.focus(); input.select(); status('Kopier den markerte teksten manuelt.'); }
  }
  el('cloud-entry').addEventListener('submit',async event => {
    event.preventDefault(); if (!event.currentTarget.reportValidity()) return;
    el('cloud-enter').disabled = true; status('Kobler til kvelden.');
    try {
      await connect(true);
      const person = {name:el('cloud-name').value.trim(),age:Number(el('cloud-age').value),tired:5,dance:5,retired:false,gone_home:false};
      const data = roomId ? await rpc('join',{invite,person}) : await rpc('create',{title:el('cloud-title').value.trim(),person});
      await enter(data);
    } catch (e) { fail(e); }
    finally { el('cloud-enter').disabled = false; }
  });
  el('cloud-share').addEventListener('click',() => { if (!invite) status('Invitasjonen finnes ikke i denne nettleseren. Verten kan lage en ny lenke.',true); else copy(rememberedLink()); });
  el('cloud-sync').addEventListener('click',async () => { await flush(); await refresh(); });
  el('cloud-rotate').addEventListener('click',async () => {
    if (!host() || !confirm('Lage ny invitasjonslenke? Gamle lenker slutter å virke for nye deltakere. De som allerede er med beholder tilgangen.')) return;
    try { const data = await rpc('rotate'); invite = data.invite; store('svh-invite-'+roomId,invite); history.replaceState(null,'',rememberedLink()); await copy(rememberedLink()); } catch (e) { fail(e); }
  });
  el('cloud-delete').addEventListener('click',async () => {
    if (!host() || !confirm('Slette hele kvelden og alle deltakeropplysningene fra appens database? Dette kan ikke angres.')) return;
    try {
      await rpc('delete'); fatal = true; pendingMe = {}; pendingSettings = {}; clearInterval(poll); clearTimeout(retryTimer);
      if (channel) await db.removeChannel(channel);
      el('cloud-room').hidden = true; status('Kvelden og deltakeropplysningene er slettet. Saksbehandlingen er avsluttet.');
      try { localStorage.removeItem('svh-invite-'+roomId); } catch (_) {}
      history.replaceState(null,'',location.pathname);
    } catch (e) { fail(e); }
  });
  el('cloud-ruling').addEventListener('click',() => {
    const {group,s} = summary();
    const text = ['SKAL VI HJEM? — '+snapshotData.room.title,'BARE HUMOR. Alle kan gå når de vil.',el('cloud-verdict').textContent,el('cloud-counts').textContent,`${s.date} kl. ${s.time}`,...group.results.map(r => `${r.person.name}: ${LABELS[r.band]} — ${fmt(r.score)}/100`)];
    copy(text.join('\n'));
  });
  window.addEventListener('online',() => { flush(); refresh(); });
  // A new invitation opened in this tab may change only the fragment.
  // Reload to read the new room; beforeunload still protects pending edits.
  window.addEventListener('hashchange',() => location.reload());
  window.addEventListener('offline',() => { if (snapshotData) fail(new Error('Frakoblet')); });
  window.addEventListener('beforeunload',event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('visibilitychange',() => { if (document.visibilityState === 'visible') { flush(); refresh(); } else flush(); });
  setInterval(() => { if (snapshotData && !fatal && document.visibilityState === 'visible') summary(); },1000);
  async function init() {
    if (!validConfig()) { el('cloud-setup').hidden = false; status('Samarbeidsmodus venter på Supabase-tilkobling. Lokalmodus er tilgjengelig.'); return; }
    if ((roomId && !uuid.test(roomId)) || (invite && !tokenPattern.test(invite))) { status('Invitasjonslenken er ugyldig. Be verten sende den på nytt.',true); return; }
    el('cloud-entry').hidden = false;
    if (roomId) {
      el('cloud-title-field').hidden = true; el('cloud-title').required = false;
      el('cloud-entry-title').textContent = 'Bli med i kveldens beslutningsapparat'; el('cloud-enter').textContent = 'Bli med';
      status('Du er invitert. Legg inn deg selv for å dele kortet med gjengen.');
      try { if (await connect(false)) { const data = await rpc('state'); await enter(data); } }
      catch (e) { if (e.code !== 'P0002' && e.code !== '42501') fail(e); }
    } else status('Opprett en kveld, og del invitasjonslenken med vennene dine.');
  }
  init();
})();
