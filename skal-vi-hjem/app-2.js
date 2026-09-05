'use strict';
  const ICON_MOON='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M16.4 12.4A7 7 0 0 1 7.6 3.6a7 7 0 1 0 8.8 8.8Z"/></svg>';
  const ICON_MUSIC='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 14V4l8-2v10M8 7l8-2"/><ellipse cx="5.5" cy="14.5" rx="2.5" ry="2"/><ellipse cx="13.5" cy="12.5" rx="2.5" ry="2"/></svg>';
  function personElement(p,index){
    const card=document.createElement('article');
    card.className='person-card';card.dataset.personId=p.id;
    const nameId=p.id+'-name',ageId=p.id+'-age',tiredId=p.id+'-tired',danceId=p.id+'-dance',retiredId=p.id+'-retired';
    card.innerHTML=`<div class="person-main"><div class="person-head"><div class="avatar" aria-hidden="true"></div><div class="name-wrap"><label class="sr-only" for="${nameId}">Navn på deltaker ${index+1}</label><input class="name-input" id="${nameId}" data-field="name" type="text" maxlength="40" autocomplete="off" spellcheck="false" placeholder="Navn"><div class="person-number">Deltaker ${pad(index+1)}</div></div><button type="button" class="icon-btn remove-person" aria-label="Fjern deltaker"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8"/></svg></button></div><div class="profile-line"><label class="age-control" for="${ageId}">Alder <input type="number" id="${ageId}" data-field="age" min="0" max="120" step="1" required inputmode="numeric"> år</label><label class="pension-toggle" for="${retiredId}"><span class="switch"><input type="checkbox" id="${retiredId}" data-field="retired"><span class="switch-track"></span></span>Pensjonist</label></div><p class="validation-note">Alder må være et heltall fra 0 til 120. Siste gyldige verdi brukes foreløpig.</p><div class="slider-block"><div class="slider-label"><label for="${tiredId}">${ICON_MOON}Trøtthet</label><output class="slider-value tired-value" for="${tiredId}"></output></div><input class="range range-tired" type="range" id="${tiredId}" data-field="tired" min="0" max="10" step="1"><div class="range-captions"><span>0 · Klar for alt</span><span>10 · Allerede i pysj</span></div></div><div class="slider-block"><div class="slider-label"><label for="${danceId}">${ICON_MUSIC}Dansevilje</label><output class="slider-value dance-value" for="${danceId}"></output></div><input class="range" type="range" id="${danceId}" data-field="dance" min="0" max="10" step="1"><div class="range-captions"><span>0 · Sitter bra her</span><span>10 · Egen røykmaskin</span></div></div></div><div class="person-result"><div class="result-head"><span class="decision-label"></span><span class="person-score"></span></div><div class="score-track" aria-hidden="true"><div class="score-fill"></div></div><p class="person-reason"></p><div class="person-bottom"><span class="weight-chip"></span></div><details class="calc-detail"><summary>Se mellomregningen</summary><div class="calc-table"></div></details></div>`;
    for(const field of ['name','age','tired','dance'])card.querySelector(`[data-field="${field}"]`).value=p[field];
    card.querySelector('[data-field="retired"]').checked=p.retired;
    return card;
  }
  function renderPeople(){
    const grid=$('people-grid');grid.replaceChildren();
    if(!state.people.length){
      const empty=document.createElement('div');empty.className='empty-state';
      empty.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M3 11 12 3l9 8M5 10v11h14V10M10 21v-7h4v7"/></svg><h3>Alle har visst gått.</h3><p>Legg til en deltaker. Ingen skal måtte være sitt eget beslutningsgrunnlag.</p>';
      grid.append(empty);
    } else state.people.forEach((p,i)=>grid.append(personElement(p,i)));
    $('add-person').disabled=state.people.length>=MAX_PEOPLE;
    $('add-person-bottom').disabled=state.people.length>=MAX_PEOPLE;
    renderRosterDescription();
  }
  function renderRosterDescription(){
    $('roster-description').textContent=state.demo ? 'Eksempelgjeng. Bytt til deres navn og innstillinger.' : `${state.people.length} ${state.people.length===1?'deltaker':'deltakere'}. Ingen habilitetsvurdering gjennomført.`;
  }
  function fillRange(input){const n=Number(input.value),lo=Number(input.min),hi=Number(input.max);input.style.setProperty('--fill',`${100*(n-lo)/(hi-lo)}%`);}
  function renderControls(){
    const s=effectiveSettings();
    $('model-date').value=s.date;$('model-time').value=s.time;
    $('real-clock').checked=s.realClock;
    $('model-date').disabled=s.realClock;$('model-time').disabled=s.realClock;
    for(const k of ['tomorrow','oneMore','banger','pensionRule'])$(k).checked=s[k];
    for(const k of Object.keys(BASE_WEIGHTS)){$('weight-'+k).value=s.weights[k];fillRange($('weight-'+k));}
  }
  function makeCalcRow(label,value,extra=''){
    const row=document.createElement('div');row.className='calc-row '+extra;
    const a=document.createElement('span');a.textContent=label;const b=document.createElement('span');b.textContent=value;
    row.append(a,b);return row;
  }
  function updatePersonCard(r,index,s){
    const card=$('people-grid').querySelector(`[data-person-id="${r.person.id}"]`);
    if(!card)return;
    const p=r.person;
    const name=nameOf(p,index);
    card.setAttribute('aria-label',`Deltaker ${index+1}: ${name}`);
    card.querySelector('.avatar').textContent=name.slice(0,1).toLocaleUpperCase('nb-NO');
    card.querySelector('.remove-person').setAttribute('aria-label',`Fjern ${name}`);
    card.querySelector('.remove-person').title=`Fjern ${name}`;
    card.classList.toggle('retired-active',r.special);
    for(const k of ['tired','dance']){
      const output=card.querySelector('.'+k+'-value');output.replaceChildren(document.createTextNode(String(p[k])));
      const small=document.createElement('small');small.textContent='/ 10';output.append(small);
      const input=card.querySelector(`[data-field="${k}"]`);fillRange(input);input.setAttribute('aria-valuetext',`${p[k]} av 10`);
    }
    card.querySelector('.person-result').className='person-result band-'+r.band;
    card.querySelector('.decision-label').textContent=LABELS[r.band];
    const score=card.querySelector('.person-score');score.replaceChildren(document.createTextNode(fmt(r.score)));
    const small=document.createElement('small');small.textContent=' /100';score.append(small);
    card.querySelector('.score-fill').style.width=r.score+'%';
    card.querySelector('.person-reason').textContent=individualReason(r,s);
    const chip=card.querySelector('.weight-chip');chip.className='weight-chip'+(r.special?' special':'');chip.textContent=r.special?'§67b · π ≈ 3,14 stemmer':'1 stemme · ordinær borger';
    const table=card.querySelector('.calc-table');table.replaceChildren();
    const names={baseline:'Grunnsynsing',tired:'Trøtthet',dance:'Dansevilje',age:'Aldersbyråkrati',night:'Nattkorreksjon',sine:'Kommunal sinus',leap:'Skuddår / gebyr',tomorrow:'Morgendagen',oneMore:'«Bare én til»',banger:'Banger-fradrag'};
    for(const [key,value] of Object.entries(r.terms))table.append(makeCalcRow(names[key],signed(value)));
    table.append(makeCalcRow('Sum før grenser',fmt(r.raw,2),'total'));
    table.append(makeCalcRow('Begrenset til 0–100',fmt(r.base,2)));
    if(r.special)table.append(makeCalcRow(p.tired>=9?'§67b: ekspresshjemmel':'§67b: tak på 24',fmt(r.score),'special-row'));
    table.append(makeCalcRow('Endelig hjemindeks',fmt(r.score),'total'));
  }
  function validateVisible(){
    const bad=[...document.querySelectorAll('#app-main input[required]')].filter(el=>!el.disabled&&!el.validity.valid);
    $('input-alert').hidden=!bad.length;
    $('input-alert').textContent=bad.length ? `${bad.length} ${bad.length===1?'felt må rettes':'felt må rettes'}. Forhåndsvisningen bruker siste gyldige verdi. Dommen kan ikke avsies før feltene er gyldige.` : '';
    bad.forEach(el=>el.setAttribute('aria-invalid','true'));
    document.querySelectorAll('#app-main input[required]').forEach(el=>{if(el.disabled||el.validity.valid)el.removeAttribute('aria-invalid');});
    return bad;
  }
  function guardValid(){
    const bad=validateVisible();
    if(bad.length){bad[0].focus();bad[0].reportValidity();toast('Rett det markerte feltet først. Selv synsing trenger gyldige inndata.');return false;}
    return true;
  }
  function updateAll(){
    const s=effectiveSettings();
    const group=calculateGroup(state.people,s);
    const counter=state.people.some(p=>p.retired)&&s.pensionRule ? calculateGroup(state.people,{...s,pensionRule:false}):null;
    current={settings:s,group,counter};
    group.results.forEach((r,i)=>updatePersonCard(r,i,s));
    const empty=group.score===null;
    $('verdict-panel').className='panel verdict-panel'+(empty?'':' band-'+group.band);
    const title=empty?'INGEN I SALEN.':TITLES[group.band];
    if($('verdict-title').textContent!==title)$('verdict-title').textContent=title;
    $('verdict-kicker').textContent=empty?'Oppmøte er en forutsetning.':KICKERS[group.band];
    $('group-score').textContent=empty?'—':fmt(group.score);
    $('gauge-value').style.strokeDashoffset=String(301.593*(1-(empty?0:group.score)/100));
    $('group-gauge').setAttribute('aria-label',empty?'Ingen hjemindeks uten deltakere':`Gruppens hjemindeks: ${fmt(group.score)} av 100. ${TITLES[group.band]}`);
    $('group-reason').textContent=groupReason(group,counter);
    $('home-count').textContent=`${group.homeCount} / ${state.people.length}`;
    $('vote-count').textContent=fmt(group.totalWeight,2);
    $('pension-power').textContent=empty?'—':fmt(group.pensionPower,0)+' %';
    const voteWords={stay:'Bli',middle:'Avrund',home:'Hjem'};
    for(const b of Object.keys(voteWords)){
      $('votes-'+b).style.width=group.totalWeight?`${100*group.votes[b]/group.totalWeight}%`:'0%';
      $('votes-'+b).hidden=group.votes[b]===0;
      $('legend-'+b).textContent=voteWords[b]+' '+fmt(group.votes[b],2);
    }
    $('vote-bar').setAttribute('aria-label',`Vektede stemmer: bli ${fmt(group.votes.stay,2)}, avrund ${fmt(group.votes.middle,2)}, hjem ${fmt(group.votes.home,2)}.`);
    const cf=$('counterfactual');cf.replaceChildren();
    if(empty)cf.textContent='Det er ingen å vekte. π venter tålmodig.';
    else if(counter){
      const strong=document.createElement('strong');strong.textContent=`Uten §67b: ${fmt(counter.score)} /100. `;cf.append(strong,document.createTextNode(`${TITLES[counter.band]} Særavtalen endrer indeksen med ${signed(group.score-counter.score)} poeng.`));
    }else if(!s.pensionRule)cf.textContent='§67b er av. Alle stemmer teller likt. For en gangs skyld.';
    else cf.textContent='§67b står klar, men ingen har erklært seg som pensjonist. Vanlig demokrati gjelder.';
    $('announce').disabled=empty;
    $('clock-note').textContent=s.realClock?'Sanntid · '+s.time:'Manuell kveld · '+s.time;
    if(s.realClock){$('model-date').value=s.date;$('model-time').value=s.time;}
    $('rule-box').className='rule-box'+(s.pensionRule?'':' disabled');
    if(s.pensionRule){
      $('rule-box').replaceChildren();const strong=document.createElement('strong');strong.textContent='Særavtale: ';$('rule-box').append(strong,document.createTextNode('π stemmer. Fritak fra morgendagen. Trøtthet 0–8: hjemindeks maks 24. Trøtthet 9–10: ekspresshjemmel, indeks 100. Dette er ikke rimelig.'));
    }else $('rule-box').textContent='Særavtalen er avslått. Pensjoniststatus påvirker verken hjemindeks, morgendagstillegg eller stemmevekt.';
    for(const k of Object.keys(BASE_WEIGHTS)){
      $('weight-'+k+'-value').textContent=fmt(s.weights[k],k==='age'?2:1);fillRange($('weight-'+k));
    }
    const year=Number(s.date.slice(0,4));
    const leap=$('leap-readout');leap.replaceChildren();const strong=document.createElement('strong');strong.textContent=isLeap(year)?`${year} er skuddår: −4 poeng.`:`${year} er ikke skuddår: +1 poeng.`;
    leap.append(strong,document.createTextNode(isLeap(year)?' Fire års oppspart overskudd er tatt inn i regnskapet.':' Administrasjonsgebyret påløper, uavhengig av saksbehandlingstid.'));
    validateVisible();
  }
