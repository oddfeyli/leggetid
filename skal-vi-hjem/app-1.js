  'use strict';
  const STORAGE_KEY = 'skal-vi-hjem-v1';
  const MAX_PEOPLE = 40;
  const BASE_WEIGHTS = Object.freeze({ tired: 6, dance: 4.5, age: 0.12, sine: 6 });
  const LIMITS = Object.freeze({tired:[2,10,0.5], dance:[1,8,0.5], age:[0,0.3,0.01], sine:[0,12,1]});
  const LABELS = Object.freeze({ stay:'Bli litt til', middle:'Avrund pent', home:'Gå hjem med stil' });
  const TITLES = Object.freeze({ stay:'VI BLIR.', middle:'VI TAR EN SISTE.', home:'VI GÅR HJEM.' });
  const KICKERS = Object.freeze({stay:'Avslutning er foreløpig ikke prioritert.',middle:'Avrunding er nå et eget prosjekt.',home:'Sofaen har vunnet anbudet.'});
  const $ = (id) => document.getElementById(id);
  const round1 = (n) => Math.round((n + Number.EPSILON) * 10) / 10;
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  const fmt = (n, digits=1) => Number(n).toLocaleString('nb-NO', {minimumFractionDigits:digits, maximumFractionDigits:digits});
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n), 2);
  const pad = (n) => String(n).padStart(2, '0');
  const dateText = (date) => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  const timeText = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const isLeap = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const band = (score) => score < 35 ? 'stay' : score < 60 ? 'middle' : 'home';
  const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2,9);
  const nameOf = (p, index=0) => p.name.trim() || `Gjest ${index+1}`;
  const prettyDate = (value) => value.split('-').reverse().join('.');
  let state;
  let storageWorks = true;
  let hasSaved = false;
  let saveTimer;
  let toastTimer;
  let confirmAction = null;
  let current = null;
  let rulingSnapshot = null;

  function makeDemo() {
    return {version:1, demo:true, people:[
      {id:newId(),name:'Anne',age:52,tired:5,dance:8,retired:false},
      {id:newId(),name:'Morten',age:59,tired:8,dance:3,retired:false},
      {id:newId(),name:'Jonas',age:48,tired:3,dance:9,retired:false},
      {id:newId(),name:'Bjørn',age:67,tired:6,dance:4,retired:true}
    ], settings:{date:dateText(new Date()),time:'23:47',realClock:false,tomorrow:true,oneMore:false,banger:false,pensionRule:true,weights:{...BASE_WEIGHTS}}};
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y,m,d]=value.split('-').map(Number);
    if (y<1900 || y>2199 || m<1 || m>12 || d<1) return false;
    const dt=new Date(y,m-1,d,12);
    return dt.getFullYear()===y && dt.getMonth()===m-1 && dt.getDate()===d;
  }
  const validTime = (value) => typeof value==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  function validateState(input) {
    // Copy only known properties. Imported names are always rendered with textContent/value.
    if (!input || input.version!==1 || !Array.isArray(input.people) || input.people.length>MAX_PEOPLE || !input.settings) throw new Error('Filen er ikke en gyldig Skal vi hjem?-gjeng (versjon 1).');
    const s=input.settings;
    if (!validDate(s.date) || !validTime(s.time)) throw new Error('Filen har ugyldig dato eller klokkeslett.');
    const cleanSettings={date:s.date,time:s.time};
    for (const key of ['realClock','tomorrow','oneMore','banger','pensionRule']) {
      if (typeof s[key]!=='boolean') throw new Error('Filen har ugyldige bryterinnstillinger.');
      cleanSettings[key]=s[key];
    }
    if (!s.weights || typeof s.weights!=='object') throw new Error('Modellvektene mangler.');
    cleanSettings.weights={};
    for (const key of Object.keys(BASE_WEIGHTS)) {
      const val=s.weights[key];
      const [min,max,step]=LIMITS[key];
      if (typeof val!=='number' || !Number.isFinite(val) || val<min || val>max || Math.abs((val-min)/step-Math.round((val-min)/step))>1e-6) throw new Error('Filen har ugyldige modellvekter.');
      cleanSettings.weights[key]=val;
    }
    const people=input.people.map(p=>{
      if (!p || typeof p.name!=='string' || p.name.length>40 || typeof p.retired!=='boolean') throw new Error('Filen har ugyldige deltakeropplysninger.');
      for(const [key,max] of [['age',120],['tired',10],['dance',10]]) {
        if(typeof p[key]!=='number' || !Number.isInteger(p[key]) || p[key]<0 || p[key]>max) throw new Error('Alder må være 0–120; trøtthet og dansevilje må være 0–10.');
      }
      return {id:newId(),name:p.name,age:p.age,tired:p.tired,dance:p.dance,retired:p.retired};
    });
    return {version:1,demo:input.demo===true,people,settings:cleanSettings};
  }

'use strict';
  function loadState() {
    try {
      const raw=localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state=validateState(JSON.parse(raw));
        hasSaved=true;
        return;
      }
    } catch (error) {
      if (error.name==='SecurityError' || error.name==='QuotaExceededError') storageWorks=false;
      else setTimeout(()=>toast('Lagrede data kunne ikke leses. Eksempelgjengen er åpnet i stedet.'),150);
    }
    state=makeDemo();
  }
  function saveNow() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
      storageWorks=true; hasSaved=true;
    } catch (_) { storageWorks=false; }
    updateStorageLabel();
  }
  function saveSoon(){clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,220);}
  function updateStorageLabel(){
    $('storage-label').textContent=storageWorks ? (hasSaved ? 'Lagret lokalt' : '100 % lokalt') : 'Kun denne økten';
    $('storage-status').title=storageWorks ? 'Opplysningene lagres bare i denne nettleseren. Ingen data sendes. Bruk Verktøy for sikkerhetskopi.' : 'Nettleseren tillater ikke lokal lagring her. Bruk Verktøy → Lagre gjengen som fil for å beholde opplysningene.';
    if (!storageWorks) $('privacy-note').textContent='Alt beregnes lokalt. Denne nettleseren tillater ikke automatisk lagring her. Bruk Verktøy → Lagre gjengen som fil for å beholde opplysningene. Ingen data sendes.';
  }
  function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4500);}

  function effectiveSettings() {
    const s={...state.settings,weights:{...state.settings.weights}};
    if(s.realClock){const now=new Date();s.date=dateText(now);s.time=timeText(now);}
    return s;
  }
  function calculatePerson(p,s) {
    const [hour,minute]=s.time.split(':').map(Number);
    const m=hour*60+minute;
    const h=hour+minute/60+(hour<12?24:0);
    const year=Number(s.date.slice(0,4));
    const special=p.retired && s.pensionRule;
    const terms={
      baseline:45,
      tired:s.weights.tired*(p.tired-5),
      dance:-s.weights.dance*(p.dance-5),
      age:s.weights.age*(p.age-45),
      night:2.5*Math.max(0,h-22),
      sine:s.weights.sine*Math.sin(2*Math.PI*(m+7*p.age)/180),
      leap:isLeap(year)?-4:1,
      tomorrow:s.tomorrow && !special ? 10:0,
      oneMore:s.oneMore ? -9:0,
      banger:s.banger ? -8*(p.dance/10):0
    };
    const raw=Object.values(terms).reduce((a,b)=>a+b,0);
    const base=clamp(raw,0,100);
    const final=special ? (p.tired>=9 ? 100 : Math.min(base,24)) : base;
    const score=round1(final);
    return {person:p,terms,raw,base,score,weight:special?Math.PI:1,special,band:band(score)};
  }
  function calculateGroup(people,s) {
    const results=people.map(p=>calculatePerson(p,s));
    if(!results.length)return {results,score:null,band:null,totalWeight:0,homeCount:0,pensionPower:0,votes:{stay:0,middle:0,home:0},retiredCount:0};
    const totalWeight=results.reduce((v,r)=>v+r.weight,0);
    const score=round1(results.reduce((v,r)=>v+r.score*r.weight,0)/totalWeight);
    const votes={stay:0,middle:0,home:0};
    results.forEach(r=>votes[r.band]+=r.weight);
    return {results,score,band:band(score),totalWeight,votes,homeCount:results.filter(r=>r.band==='home').length,pensionPower:100*results.filter(r=>r.person.retired).reduce((v,r)=>v+r.weight,0)/totalWeight,retiredCount:results.filter(r=>r.person.retired).length};
  }
  function individualReason(r,s){
    const p=r.person;
    if(r.special && p.tired>=9)return '§67b, nødutgang: Trøtthet 9–10 gir ekspresshjemmel. Indeks 100, fortsatt π stemmer.';
    if(r.special)return '§67b: Morgendagen er valgfri. Hjemindeksen får ikke overstige 24. Du har π stemmer.';
    if(r.band==='home'){
      if(p.tired>=8)return 'Trøttheten har sagt opp. Oppsigelsen er vurdert som saklig.';
      if(p.dance<=2)return 'Dansegulvet har ikke mottatt en eneste søknad fra deg.';
      if(r.terms.night>=10)return 'Klokken har overtatt saksbehandlingen. Den er lite løsningsorientert.';
      return 'Summen av små tegn er nå et omfattende saksdokument. Sofa anbefales.';
    }
    if(r.band==='middle'){
      if(p.tired>=7 && p.dance>=7)return 'Kroppen vil hjem. Beina har ikke lest referatet. Avrund mens partene forhandler.';
      if(p.dance>=7)return 'Én siste sang kan forsvares. En helt ny kveld kan ikke.';
      return 'Du er ikke ferdig. Du er bare administrativt på vei ut.';
    }
    if(p.dance>=8)return 'Danseviljen er høyere enn evnen til å avslutte møtet.';
    if(p.tired<=3)return 'Det finnes energi igjen. Den må visst brukes opp før budsjettåret er omme.';
    if(s.oneMore)return 'Løftet om «bare én til» er tatt til følge. Dokumentasjonen er svak.';
    return 'Ingen tungtveiende argumenter for sofa er dokumentert. Saken holdes åpen.';
  }
  function groupReason(group,counter){
    if(group.score===null)return 'Ingen deltakere, ingen dom. Selv dette direktoratet har enkelte minstekrav.';
    const isSplit=group.results.some(r=>r.band!==group.band);
    if(group.band==='stay'){
      if(counter && counter.band!==group.band)return 'Pensjonistparagrafen har snudd vedtaket. Flertallet kan sende et høflig brev til π.';
      if(group.homeCount)return 'Modellen vil bli. Noen vil hjem. Gjengen kan faktisk dele seg uten konsekvensutredning.';
      return 'Det finnes fortsatt overskudd. Direktoratet finner det uforsvarlig å la det stå ubrukt.';
    }
    if(group.band==='home'){
      if(group.results.some(r=>r.special && r.person.tired>=9))return 'Pensjonistens nødutgang har fått betydelig stemmevekt. Avslutning er nå strategisk forankret.';
      if(isSplit)return 'Hjemsiden vinner på vektet indeks, ikke nødvendigvis på antall. De ivrige kan bli.';
      return 'Samtlige personindekser peker hjemover. Det blir neppe behov for en ekstern utredning.';
    }
    if(counter && counter.band!==group.band)return 'Uten særavtalen hadde dommen vært en annen. π har bedt om en siste replikk.';
    if(isSplit)return 'Gjengen spriker. Kompromisset er en tydelig siste runde — samtale, sang eller dans. Ikke et nytt møte.';
    return 'Alle ligger i avrundingssonen. Enighet om å slutte snart er nesten det samme som å slutte.';
  }
