"""Frontend integration tests against a deterministic, in-memory MOCK backend.
HTML and scripts are injected directly: these tests need no network or navigation.
These do NOT validate Supabase Auth, Realtime transport or PostgreSQL RLS.
Run after copying the existing model/CSS files alongside sammen.html.
"""
import copy, json, uuid, re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1] / 'skal-vi-hjem'
rooms = {}
DEFAULTS = dict(date='2026-09-05', time='23:47', realClock=False, tomorrow=True,
                oneMore=False, banger=False, pensionRule=True,
                weights=dict(tired=6,dance=4.5,age=.12,sine=6))

def api(uid, action, rid, p):
    if action == 'create':
        rid = str(uuid.uuid4())
        rooms[rid] = {'room':dict(id=rid,host_id=uid,title=p['title'],settings=copy.deepcopy(DEFAULTS),revision=1,
                     expires_at=(datetime.now(timezone.utc)+timedelta(hours=48)).isoformat()),
                     'members':{uid:dict(p['person'],user_id=uid)},'invite':'a'*48}
    if rid not in rooms:
        return {'data':None,'error':dict(code='P0002',message='Kvelden finnes ikke')}
    r = rooms[rid]
    if action == 'join' and uid not in r['members']:
        if p.get('invite') != r['invite']:
            return {'data':None,'error':dict(code='42501',message='Feil invitasjon')}
        r['members'][uid] = dict(p['person'],user_id=uid)
    if uid not in r['members']:
        return {'data':None,'error':dict(code='P0002',message='Ikke medlem')}
    if action in ('settings','delete','rotate') and uid != r['room']['host_id']:
        return {'data':None,'error':dict(code='42501',message='Bare verten')}
    if action == 'me': r['members'][uid].update(p)
    if action == 'settings':
        for k,v in p.items():
            if k.startswith('weight_'): r['room']['settings']['weights'][k[7:]]=v
            else: r['room']['settings'][k]=v
    if action == 'rotate': r['invite']='b'*48
    if action == 'delete':
        del rooms[rid]
        return {'data':{'deleted':True},'error':None}
    if action != 'state': r['room']['revision'] += 1
    d = dict(room=r['room'],members=list(r['members'].values()),server_time=datetime.now(timezone.utc).isoformat())
    if action in ('create','rotate'): d['invite']=r['invite']
    return {'data':d,'error':None}

MOCK="""
window.supabase={createClient:()=>({
 realtime:{setAuth:async()=>{}},
 auth:{getSession:async()=>({data:{session:{user:{id:USER}}},error:null}),signInAnonymously:async()=>({data:{session:{user:{id:USER}}},error:null})},
 rpc:async(_,a)=>{if(window.mockFail) return {data:null,error:{message:'Simulert nettverksbrudd'}}; return await window.testRPC(USER,a.p_action,a.p_room,a.p_payload)},
 channel:()=>{const c={on:(_,__,callback)=>{c.cb=callback;return c},subscribe:cb=>{setTimeout(()=>cb('SUBSCRIBED'),10);c.t=setInterval(()=>c.cb(),180);return c}};return c},
 removeChannel:async c=>clearInterval(c.t)
})};
"""
def fixture(page, invitation='', disabled=False):
    html=(ROOT/'sammen.html').read_text()
    html=re.sub(r'<script[^>]*>[\s\S]*?</script>','',html)
    html=re.sub(r'<link[^>]*rel="stylesheet"[^>]*>','',html)
    page.set_content(html)
    for css in ['style-1.css','style-2.css','style-3.css']:
        page.add_style_tag(content=(ROOT/css).read_text())
    if invitation: page.evaluate('(h)=>{location.hash=h}',invitation.split('#',1)[1])
    page.add_script_tag(content="window.SVH_CLOUD={enabled:false}" if disabled else (ROOT/'collaboration-config.js').read_text())
    page.add_script_tag(content=(ROOT/'app-1.js').read_text())
    page.add_script_tag(content=(ROOT/'collaboration.js').read_text())

results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844}); requests=[];page.on('request',lambda r:requests.append(r.url))
    fixture(page,disabled=True);page.wait_for_selector('#cloud-setup',state='visible')
    assert not any('supabase.co' in r or 'jsdelivr' in r for r in requests)
    assert page.locator('#cloud-entry').is_hidden()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(ROOT.parent/'setup-mobile.png'),full_page=True)
    results.append('Disabled configuration: no cloud/CDN requests; mobile page fits.')
    def ctx(user):
        context=browser.new_context(viewport={'width':390,'height':844})
        context.add_init_script("Object.defineProperty(window,'SVH_CLOUD',{value:{enabled:true,url:'https://mock.supabase.co',publishableKey:'sb_publishable_mock'},writable:false});")
        context.expose_function('testRPC',api)
        context.add_init_script('const USER='+json.dumps(user)+';'+MOCK)
        return context
    h=ctx('11111111-1111-4111-8111-111111111111');g=ctx('22222222-2222-4222-8222-222222222222')
    hp=h.new_page();gp=g.new_page();errors=[]
    for pg in (hp,gp): pg.on('pageerror',lambda e:errors.append(str(e)))
    fixture(hp);hp.fill('#cloud-name','Verten');hp.click('#cloud-enter');hp.wait_for_selector('#cloud-room',state='visible')
    invitation=hp.url
    fixture(gp,invitation);gp.fill('#cloud-name','Gjest');gp.click('#cloud-enter');gp.wait_for_selector('#cloud-room',state='visible')
    hp.wait_for_function('document.querySelectorAll(".cloud-person").length===2')
    gp.wait_for_function('document.querySelectorAll(".cloud-person").length===2')
    assert gp.locator('#cloud-settings').evaluate('(x)=>x.disabled')
    assert not hp.locator('#cloud-settings').evaluate('(x)=>x.disabled')
    assert gp.locator('.cloud-person[data-mine=false] input').first.is_disabled()
    assert not gp.locator('.cloud-person[data-mine=true] input').first.is_disabled()
    results.append('Two browser contexts: same roster; own card editable; only host settings editable.')
    hp.locator('.cloud-person[data-mine=true] input[data-key=tired]').evaluate('(x)=>{x.value=8;x.dispatchEvent(new Event("input",{bubbles:true}))}')
    gp.locator('.cloud-person[data-mine=true] input[data-key=dance]').evaluate('(x)=>{x.value=9;x.dispatchEvent(new Event("input",{bubbles:true}))}')
    hp.wait_for_function('document.querySelector(".cloud-person[data-mine=false] input[data-key=dance]").value==="9"')
    gp.wait_for_function('document.querySelector(".cloud-person[data-mine=false] input[data-key=tired]").value==="8"')
    hp.wait_for_timeout(500)
    assert hp.locator('#cloud-score').inner_text()==gp.locator('#cloud-score').inner_text()
    results.append('Concurrent edits on different cards do not overwrite each other; group score agrees.')
    gp.click('.card-leave');hp.wait_for_function('document.querySelector("#cloud-counts").textContent.includes("1 har gått hjem")')
    assert gp.locator('.card-leave').inner_text()=='Jeg er tilbake'
    gp.click('.card-leave');hp.wait_for_function('document.querySelector("#cloud-counts").textContent.includes("0 har gått hjem")')
    results.append('Explicit departure and return update both clients and the active group.')
    gp.evaluate('window.mockFail=true')
    gp.fill('.cloud-person[data-mine=true] input[data-key=name]','Etter brudd')
    gp.wait_for_timeout(600)
    assert 'Ikke synkronisert' in gp.locator('#cloud-status').inner_text()
    gp.evaluate('window.mockFail=false');gp.click('#cloud-sync')
    hp.wait_for_function('Array.from(document.querySelectorAll(".card-title")).some(x=>x.textContent.includes("Etter brudd"))')
    results.append('Failed save is labelled unsynced and pending edits are retried without reload.')
    gp.close();gp=g.new_page();fixture(gp,invitation);gp.wait_for_selector('#cloud-room',state='visible')
    assert gp.locator('.cloud-person').count()==2
    results.append('Re-entry with the same mock identity resumes membership without adding a duplicate person.')
    assert hp.evaluate('document.documentElement.scrollWidth<=innerWidth')
    hp.screenshot(path=str(ROOT.parent/'room-mobile.png'),full_page=True)
    assert not errors,errors
    results.append('No JavaScript page errors in exercised flows; mobile room fits.')
    browser.close()
print('\n'.join('PASS '+x for x in results))
print('NOT TESTED: real Supabase Auth, WebSocket transport, SQL migration/RLS, Edge and iOS Safari.')
