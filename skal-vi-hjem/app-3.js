'use strict';
  function replaceState(next){state=next;renderPeople();renderControls();updateAll();saveNow();}
  function addPerson(){
    if(state.people.length>=MAX_PEOPLE){toast('Direktoratet har kapasitet til 40 deltakere. Deretter kreves et underutvalg.');return;}
    if(!guardValid())return;
    const person={id:newId(),name:'',age:59,tired:5,dance:5,retired:false};
    state.people.push(person);state.demo=false;renderPeople();updateAll();saveSoon();
    const name=$(person.id+'-name');name.focus({preventScroll:true});name.scrollIntoView({behavior:'smooth',block:'center'});
    toast('Ny deltaker opprettet. Alder og skyveknapper kan endres.');
  }
  function confirmWith(title,text,action,label='Gjør det'){
    $('tools').open=false;$('confirm-title').textContent=title;$('confirm-text').textContent=text;$('confirm-ok').textContent=label;confirmAction=action;$('confirm-dialog').showModal();$('confirm-cancel').focus();
  }
  function dismissConfirm(){confirmAction=null;$('confirm-dialog').close();}
  function snapshot(){return JSON.parse(JSON.stringify(current));}
  function rulingText(snap){
    const g=snap.group,s=snap.settings;
    const lines=['SKAL VI HJEM? — Kveldsdirektoratet','BARE HUMOR. Eget ønske trumfer alltid modellen.','',TITLES[g.band],groupReason(g,snap.counter),'',`Hjemindeks: ${fmt(g.score)} /100 · Hjemklare: ${g.homeCount}/${g.results.length} · Stemmer: ${fmt(g.totalWeight,2)}`,`Vurdering: ${prettyDate(s.date)} kl. ${s.time} (${s.realClock?'sanntid':'manuell tid'})`,''];
    g.results.forEach((r,i)=>lines.push(`${nameOf(r.person,i)}: ${LABELS[r.band]} — ${fmt(r.score)}/100${r.special?' · §67b, π stemmer':''}`));
    if(snap.counter)lines.push('',`Uten §67b: ${fmt(snap.counter.score)}/100 — ${TITLES[snap.counter.band]}`);
    lines.push('','Vedtaket kan ignoreres uten å oppgi saksnummer.');
    return lines.join('\n');
  }
  function showRuling(){
    if(!guardValid()||!state.people.length)return;
    updateAll();rulingSnapshot=snapshot();const g=rulingSnapshot.group,s=rulingSnapshot.settings;
    $('ruling-title').textContent=TITLES[g.band];$('ruling-title').className='ruling-title band-'+g.band;
    $('ruling-lead').textContent=groupReason(g,rulingSnapshot.counter);
    $('ruling-metadata').textContent=`${prettyDate(s.date)} kl. ${s.time} · ${s.realClock?'Sanntid':'Manuell tid'} · Hjemindeks ${fmt(g.score)}/100 · ${fmt(g.totalWeight,2)} stemmer · Et øyeblikksbilde, ikke en livsplan.`;
    $('ruling-people').replaceChildren();
    g.results.forEach((r,i)=>{const row=document.createElement('div');row.className='ruling-person';const a=document.createElement('span');a.textContent=nameOf(r.person,i);const b=document.createElement('small');b.textContent=`${LABELS[r.band]} · ${fmt(r.score)}${r.special?' · π stemmer':''}`;row.append(a,b);$('ruling-people').append(row);});
    $('copy-area').hidden=true;$('ruling-dialog').showModal();
  }
  async function copyRuling(){
    if(!rulingSnapshot)return;
    const text=rulingText(rulingSnapshot);
    try{if(navigator.clipboard && window.isSecureContext){await navigator.clipboard.writeText(text);toast('Dommen er kopiert. Den mangler fortsatt rettskraft.');return;}}catch(_){}
    const area=$('copy-text');area.value=text;$('copy-area').hidden=false;area.focus();area.select();
    try{if(document.execCommand('copy')){toast('Dommen er kopiert. Den mangler fortsatt rettskraft.');$('copy-area').hidden=true;return;}}catch(_){}
    toast('Bruk Ctrl+C for å kopiere den markerte teksten.');
  }
  function appendPrint(parent,tag,text,cls=''){const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;parent.append(el);return el;}
  function printReport(useSnapshot){
    if(!useSnapshot && !guardValid())return;
    if(!useSnapshot)updateAll();
    const snap=useSnapshot&&rulingSnapshot?rulingSnapshot:snapshot();
    const g=snap.group,s=snap.settings;
    const target=$('print-sheet');target.replaceChildren();
    appendPrint(target,'p','KVELDSDIREKTORATET / BESLUTNINGSGRUNNLAG 6.7b');
    appendPrint(target,'h1','Skal vi hjem?');
    appendPrint(target,'p','BARE HUMOR. Dette er oppdiktet beslutningsmatematikk, ikke vitenskap, helseråd eller et bindende vedtak. Alle kan gå når de vil.','print-note');
    appendPrint(target,'h2',g.score===null?'INGEN I SALEN.':TITLES[g.band]);
    appendPrint(target,'p',groupReason(g,snap.counter));
    appendPrint(target,'p',`Vurdert ${prettyDate(s.date)} kl. ${s.time} (${s.realClock?'sanntid':'manuell tid'}). Hjemindeks: ${g.score===null?'—':fmt(g.score)}/100. Hjemklare: ${g.homeCount}/${g.results.length}. Vektede stemmer: ${fmt(g.totalWeight,2)}.`);
    const table=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr');
    ['Navn','Alder','Trøtthet','Dans','Pensjonist','Indeks','Anbefaling'].forEach(t=>appendPrint(tr,'th',t));head.append(tr);table.append(head);const tbody=document.createElement('tbody');
    g.results.forEach((r,i)=>{const row=document.createElement('tr');[nameOf(r.person,i),r.person.age,r.person.tired+'/10',r.person.dance+'/10',r.person.retired?'Ja':'Nei',fmt(r.score),LABELS[r.band]].forEach(t=>appendPrint(row,'td',String(t)));tbody.append(row);});
    table.append(tbody);target.append(table);
    g.results.forEach((r,i)=>appendPrint(target,'p',`${nameOf(r.person,i)}: ${individualReason(r,s)}`));
    if(snap.counter)appendPrint(target,'p',`Uten §67b: ${fmt(snap.counter.score)}/100. ${TITLES[snap.counter.band]}`);
    appendPrint(target,'h2','De fullstendig urimelige premissene');
    appendPrint(target,'p',`Morgendagen: ${s.tomorrow?'på':'av'}. «Bare én til»: ${s.oneMore?'på':'av'}. Banger: ${s.banger?'på':'av'}. §67b: ${s.pensionRule?'på':'av'}. Vekter a/b/c/s: ${fmt(s.weights.tired)} / ${fmt(s.weights.dance)} / ${fmt(s.weights.age,2)} / ${fmt(s.weights.sine)}.`);
    appendPrint(target,'p','Hᵢ = clip₀…₁₀₀[45 + a(Tᵢ−5) − b(Dᵢ−5) + c(Aᵢ−45) + 2,5 max(0,h*−22) + s sin(2π(m+7Aᵢ)/180) + L(år) + 10M(1−QPᵢ) − 9E − 8B(Dᵢ/10)].');
    appendPrint(target,'p','T/D = trøtthet/dans, A = alder, m = minutter siden midnatt. h* = desimaltimer, pluss 24 før kl. 12. L = −4 i skuddår, ellers +1. M/E/B = de tre øverste bryterne. Q/P = særregel/pensjonist.');
    appendPrint(target,'p','Aktiv §67b: Pensjonister har π stemmer og fritak fra morgendagen. Trøtthet 0–8: indeks maks 24. Trøtthet 9–10: indeks 100. Andre har 1 stemme. Gruppeindeks = vektet gjennomsnitt. Indekser avrundes til én desimal før klassifisering: bli <35, avrund 35–59,9, hjem ≥60.');
    appendPrint(target,'p','Alle tall, vekter og terskler er oppdiktet for denne vitsen. Presisjon: overdreven. Myndighet: null.','print-foot');
    $('tools').open=false;window.print();
  }
  function exportData(){
    if(!guardValid())return;
    const data={...state,settings:{...effectiveSettings()}};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Skal_vi_hjem_gjeng_'+dateText(new Date())+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);$('tools').open=false;
    toast('Gjengen er lagret som fil. Den kan hentes inn igjen via Verktøy.');
  }
  async function importData(event){
    const file=event.target.files[0];event.target.value='';if(!file)return;
    try{
      if(file.size>250000)throw new Error('Filen er for stor. En gjengfil skal være mindre enn 250 kB.');
      const imported=validateState(JSON.parse(await file.text()));
      confirmWith('Hente inn denne gjengen?',`${imported.people.length} deltakere og deres modellinnstillinger vil erstatte det som står her.`,()=>{replaceState(imported);toast('Gjengen er hentet inn. Alle særavtaler er videreført.');},'Hent gjengen');
    }catch(error){toast(error instanceof SyntaxError?'Filen inneholder ikke gyldig JSON. Ingen opplysninger ble endret.':error.message);}
  }

'use strict';
  $('people-grid').addEventListener('input',event=>{
    const input=event.target;
    if(!input.dataset.field)return;
    const card=input.closest('[data-person-id]');const p=state.people.find(p=>p.id===card.dataset.personId);if(!p)return;
    const key=input.dataset.field;
    if(key==='retired')p[key]=input.checked;
    else if(key==='name')p[key]=input.value;
    else {if(!input.validity.valid){validateVisible();return;}p[key]=Number(input.value);}
    if(key==='name')state.demo=false;
    renderRosterDescription();updateAll();saveSoon();
  });
  $('people-grid').addEventListener('click',event=>{
    const button=event.target.closest('.remove-person');if(!button)return;
    const card=button.closest('[data-person-id]');const idx=state.people.findIndex(p=>p.id===card.dataset.personId);
    if(idx<0)return;const removed=nameOf(state.people[idx],idx);state.people.splice(idx,1);state.demo=false;renderPeople();updateAll();saveSoon();
    const next=$('people-grid').querySelector('.name-input');if(next)next.focus({preventScroll:true});else $('add-person').focus({preventScroll:true});
    toast(`${removed} er strøket fra manntallet. Utgangen krevde ikke flertall.`);
  });
  ['add-person','add-person-bottom'].forEach(id=>$(id).addEventListener('click',addPerson));
  for(const key of ['tomorrow','oneMore','banger','pensionRule'])$(key).addEventListener('change',event=>{state.settings[key]=event.target.checked;updateAll();saveSoon();});
  $('real-clock').addEventListener('change',event=>{
    // Capture actual time when returning to manual mode; do not revert to the old demo time.
    const previous=effectiveSettings();state.settings.date=previous.date;state.settings.time=previous.time;state.settings.realClock=event.target.checked;renderControls();updateAll();saveSoon();
  });
  for(const key of ['date','time'])$('model-'+key).addEventListener('input',event=>{
    const value=event.target.value;
    if(!event.target.validity.valid || !(key==='date'?validDate(value):validTime(value))){validateVisible();return;}
    state.settings[key]=value;updateAll();saveSoon();
  });
  for(const key of Object.keys(BASE_WEIGHTS))$('weight-'+key).addEventListener('input',event=>{state.settings.weights[key]=Number(event.target.value);updateAll();saveSoon();});
  $('reset-weights').addEventListener('click',()=>{state.settings.weights={...BASE_WEIGHTS};renderControls();updateAll();saveSoon();toast('Vektene er tilbakestilt. Synsingen er igjen fabrikkalibrert.');});
  $('announce').addEventListener('click',showRuling);
  document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.closeDialog).close()));
  $('copy-ruling').addEventListener('click',copyRuling);
  $('print-ruling').addEventListener('click',()=>printReport(true));
  $('print-button').addEventListener('click',()=>printReport(false));
  $('export-data').addEventListener('click',exportData);
  $('import-data').addEventListener('click',()=>{$('tools').open=false;$('import-file').click();});
  $('import-file').addEventListener('change',importData);
  $('confirm-cancel').addEventListener('click',dismissConfirm);
  $('confirm-dialog').addEventListener('cancel',()=>{confirmAction=null;});
  $('confirm-ok').addEventListener('click',()=>{const action=confirmAction;dismissConfirm();if(action)action();});
  $('new-group').addEventListener('click',()=>confirmWith('Starte med tom gjeng?','Deltakerne fjernes. Modellinnstillingene beholdes. Lagre gjengen som fil først dersom du vil beholde den.',()=>{state.people=[];state.demo=false;renderPeople();updateAll();saveNow();toast('Ny gjeng. Samme unødvendige byråkrati.');},'Tøm gjengen'));
  $('load-demo').addEventListener('click',()=>confirmWith('Åpne eksempelgjengen?','Nåværende deltakere og innstillinger erstattes av fire oppdiktede personer og en manuell kveld kl. 23:47.',()=>{replaceState(makeDemo());toast('Eksempelgjengen er på plass. Ingen av dem har eksistert på ordentlig.');},'Åpne eksemplet'));
  $('reset-all').addEventListener('click',()=>confirmWith('Tilbakestille alt?','Alle navn og modellinnstillinger i denne nettleseren erstattes av eksempeloppsettet. Lagre en gjengfil først dersom du vil beholde dem.',()=>{replaceState(makeDemo());$('method-section').open=false;toast('Alt er tilbakestilt. Kvelden har fått en ny saksbehandler.');},'Tilbakestill'));
  document.addEventListener('click',event=>{if(!$('tools').contains(event.target))$('tools').open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')$('tools').open=false;});
  window.addEventListener('pagehide',saveNow);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveNow();else if(state.settings.realClock)updateAll();});
  setInterval(()=>{if(state.settings.realClock && document.visibilityState==='visible')updateAll();},15000);

  loadState();renderPeople();renderControls();updateAll();saveNow();
  // Intentionally no fetch, telemetry, imports, remote fonts, frameworks or service worker.
