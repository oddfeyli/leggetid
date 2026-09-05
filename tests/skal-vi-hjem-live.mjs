/**
 * Live collaboration integration/security test. Node >= 22 required.
 * Uses three independent anonymous Auth users and the public browser key only.
 * Run: node tests/skal-vi-hjem-live.mjs
 * Optional: SVH_SDK_PATH=/path/to/supabase.js SVH_REPORT_PATH=/tmp/svh-live.json
 * Test rooms are deleted and sessions signed out, including on failure.
 * Anonymous Auth accounts remain for project-owner cleanup; their IDs appear
 * in the optional report. Never write access tokens or invitations to logs.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdkUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.js';
const sdkHash = '7e94b62086deecef8c0ba3b38f514e2a1944ff6c81d92fb3ff967828c406c38f';
const context = { window: {} };
vm.runInNewContext(await readFile(join(root, 'skal-vi-hjem/collaboration-config.js'), 'utf8'), context);
const config = context.window.SVH_CLOUD;
assert.match(config.url, /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/);
assert.match(config.publishableKey, /^sb_publishable_/,
  'The live test accepts a public publishable key only.');
assert.ok(globalThis.WebSocket, 'Use Node 22 or later with native WebSocket.');

const sdkPath = process.env.SVH_SDK_PATH || join(tmpdir(), 'svh-supabase-2.57.4.cjs');
let sdkBytes;
try { sdkBytes = await readFile(sdkPath); } catch {
  const response = await fetch(sdkUrl, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.ok, true, 'Unable to download the pinned Supabase SDK.');
  sdkBytes = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash('sha256').update(sdkBytes).digest('hex'), sdkHash);
  await writeFile(sdkPath, sdkBytes);
}
assert.equal(createHash('sha256').update(sdkBytes).digest('hex'), sdkHash,
  'The SDK checksum differs from the pinned 2.57.4 browser package.');
globalThis.self = globalThis;
const { createClient } = createRequire(import.meta.url)(resolve(sdkPath));
const runId = Date.now().toString(36);
const results = [], clients = [], cleanupRooms = new Map();
const report = { startedAt: new Date().toISOString(), project: new URL(config.url).hostname,
  sdk: '2.57.4', anonymousUserIds: [], roomIds: [], results };
let sequence = 0;

function client(label) {
  const db = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
      storageKey: `svh-live-${runId}-${label}` },
    realtime: { transport: globalThis.WebSocket },
    global: { fetch: (url, options) => fetch(url, {
      ...options, signal: options?.signal || AbortSignal.timeout(20000)
    }) }
  });
  clients.push(db);
  return db;
}
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) {
    // Error messages from assertions may contain test names/values, never sessions.
    results.push({ name, passed: false, error: String(error.message).slice(0, 600) });
    console.log(`FAIL ${name}: ${String(error.message).slice(0, 600)}`);
  }
}
function good(result, label = 'request') {
  assert.equal(result.error, null,
    `${label} rejected: ${result.error?.code || result.error?.status || ''} ${result.error?.message || ''}`);
  return result.data;
}
function rpc(db, action, room = null, payload = {}) {
  return db.rpc('svh_action', { p_action: action, p_room: room, p_payload: payload });
}
async function action(db, name, room = null, payload = {}) {
  return good(await rpc(db, name, room, payload), name);
}
async function rejected(promise, label) {
  const result = await promise;
  if (!result.error && result.data?.room?.id) {
    // An unexpectedly accepted create request still needs cleanup by its owner.
    const owner = clients.find(db => db.testUserId === result.data.room.host_id);
    if (owner) cleanupRooms.set(result.data.room.id, owner);
  }
  assert.ok(result.error, `${label} was unexpectedly accepted`);
  assert.notEqual(result.error.status, 429, `${label}: rate limiting is not authorization evidence`);
  assert.notEqual(result.status, 429, `${label}: rate limiting is not authorization evidence`);
  assert.ok(['42501', '22023', '23514', 'P0002', 'PGRST106'].includes(result.error.code),
    `${label}: unexpected rejection ${result.error.code || result.error.status || 'network error'}`);
  return result.error;
}
async function signIn(db) {
  const data = good(await db.auth.signInAnonymously(), 'anonymous sign-in');
  assert.equal(data.user.is_anonymous, true);
  db.testUserId = data.user.id;
  report.anonymousUserIds.push(data.user.id);
  return data.user.id;
}
const person = name => ({ name, age: 59, tired: 4, dance: 6, retired: false, gone_home: false });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(predicate, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await pause(100);
  }
  assert.fail(label);
}
async function subscribe(db, room, events) {
  const channel = db.channel(`svh-live-${runId}-${++sequence}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'svh_rooms',
      filter: `id=eq.${room}` }, payload => events.push(payload));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscription timed out')), 18000);
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer); reject(new Error(`Realtime subscription: ${status}`));
      }
    });
  });
  return channel;
}

const host = client('host'), guest = client('guest'), outsider = client('outsider');
const unauthenticated = client('signed-out');
try {
  const hostId = await signIn(host), guestId = await signIn(guest), outsiderId = await signIn(outsider);
  assert.equal(new Set([hostId, guestId, outsiderId]).size, 3);
  console.log('PASS three distinct real anonymous Auth identities');
  results.push({ name: 'three distinct real anonymous Auth identities', passed: true });

  const created = await action(host, 'create', null,
    { title: `Live test ${runId}`, person: person('Test vert') });
  const room = created.room.id;
  cleanupRooms.set(room, host); report.roomIds.push(room);
  const invite = created.invite;
  assert.match(invite, /^[0-9a-f]{48}$/);
  assert.equal(created.room.host_id, hostId);
  assert.equal(created.members.length, 1);
  await check('signed-out API cannot read, call RPC or write tables', async () => {
    for (const table of ['svh_rooms', 'svh_members']) {
      await rejected(unauthenticated.from(table).select('*'), `${table} read`);
      await rejected(unauthenticated.from(table).delete().eq(table === 'svh_rooms' ? 'id' : 'room_id', room),
        `${table} delete`);
    }
    await rejected(rpc(unauthenticated, 'state', room), 'signed-out state');
    await rejected(unauthenticated.from('svh_rooms').insert({ title: 'unauthorized' }), 'signed-out insert');
  });
  await check('outsider cannot discover room, roster or private invitations', async () => {
    assert.deepEqual(good(await outsider.from('svh_rooms').select('*').eq('id', room)), []);
    assert.deepEqual(good(await outsider.from('svh_members').select('*').eq('room_id', room)), []);
    await rejected(rpc(outsider, 'state', room), 'outsider state');
    await rejected(outsider.schema('svh_private').from('invites').select('*'), 'private schema');
    await rejected(rpc(outsider, 'join', room, { invite: '0'.repeat(48), person: person('Feil lenke') }),
      'wrong invitation');
  });
  await check('valid invitation joins; repeated join is idempotent', async () => {
    const joined = await action(guest, 'join', room, { invite, person: person('Test gjest') });
    assert.equal(joined.members.length, 2);
    const again = await action(guest, 'join', room, { invite, person: person('Ignored duplicate') });
    assert.equal(again.members.length, 2);
    assert.equal(again.members.find(m => m.user_id === guestId).name, 'Test gjest');
  });

  const hostEvents = [], guestEvents = [], outsiderEvents = [];
  let guestChannel;
  await check('real WebSocket subscriptions for members and outsider', async () => {
    const channels = await Promise.all([subscribe(host, room, hostEvents),
      subscribe(guest, room, guestEvents), subscribe(outsider, room, outsiderEvents)]);
    guestChannel = channels[1];
  });
  await check('concurrent users and field edits preserve all four changes', async () => {
    const before = await action(host, 'state', room);
    await Promise.all([
      action(host, 'me', room, { tired: 7 }), action(guest, 'me', room, { dance: 9 }),
      action(host, 'me', room, { age: 61 }), action(guest, 'me', room, { name: 'Test gjest oppdatert' })
    ]);
    const [a, b] = await Promise.all([action(host, 'state', room), action(guest, 'state', room)]);
    assert.deepEqual(a.room, b.room); assert.deepEqual(a.members, b.members);
    assert.equal(a.room.revision, before.room.revision + 4);
    assert.equal(a.members.find(m => m.user_id === hostId).tired, 7);
    assert.equal(a.members.find(m => m.user_id === hostId).age, 61);
    assert.equal(a.members.find(m => m.user_id === guestId).dance, 9);
    assert.equal(a.members.find(m => m.user_id === guestId).name, 'Test gjest oppdatert');
    assert.ok(Number.isFinite(Date.parse(a.server_time)));
    await eventually(() => hostEvents.some(e => e.new.revision >= a.room.revision)
      && guestEvents.some(e => e.new.revision >= a.room.revision),
    'Both users must receive the committed revision through real Realtime WebSockets');
  });
  await check('only host changes shared settings; real/simulated clock settings agree', async () => {
    await rejected(rpc(guest, 'settings', room, { banger: true }), 'guest settings');
    await rejected(rpc(guest, 'rotate', room), 'guest rotation');
    await rejected(rpc(guest, 'delete', room), 'guest deletion');
    const shared = { realClock: false, date: '2028-02-29', time: '23:58', banger: true,
      weight_tired: 7.5, weight_age: 0.21 };
    await action(host, 'settings', room, shared);
    const state = await action(guest, 'state', room);
    assert.equal(state.room.settings.date, shared.date);
    assert.equal(state.room.settings.time, shared.time);
    assert.equal(state.room.settings.realClock, false);
    assert.equal(state.room.settings.weights.tired, 7.5);
    assert.equal(state.room.settings.weights.age, 0.21);
    await action(host, 'settings', room, { realClock: true });
    assert.equal((await action(guest, 'state', room)).room.settings.realClock, true);
  });
  await check('authenticated direct inserts, updates and deletes are denied', async () => {
    const state = await action(host, 'state', room);
    for (const db of [host, guest]) {
      await rejected(db.from('svh_members').update({ tired: 0 }).eq('room_id', room).eq('user_id', hostId),
        'direct member update');
      await rejected(db.from('svh_members').insert({ room_id: room, user_id: outsiderId,
        ...person('Forged member') }), 'direct member insert');
      await rejected(db.from('svh_members').delete().eq('room_id', room), 'direct member delete');
      await rejected(db.from('svh_rooms').update({ host_id: guestId }).eq('id', room), 'direct host update');
      await rejected(db.from('svh_rooms').insert({ title: 'Forged room', host_id: guestId,
        settings: state.room.settings }), 'direct room insert');
      await rejected(db.from('svh_rooms').delete().eq('id', room), 'direct room delete');
    }
    assert.equal((await action(host, 'state', room)).room.host_id, hostId);
  });
  await check('own-card API cannot target another user or privileged fields', async () => {
    for (const payload of [{ user_id: hostId, tired: 0 }, { room_id: room }, { host_id: guestId },
      { settings: {} }, { expires_at: '2199-01-01' }, { revision: 0 }]) {
      await rejected(rpc(guest, 'me', room, payload), 'forbidden participant field');
    }
    const state = await action(host, 'state', room);
    assert.equal(state.members.find(m => m.user_id === hostId).tired, 7);
  });
  await check('invalid values, types and calendar dates are rejected', async () => {
    for (const payload of [{ age: -1 }, { age: 121 }, { age: 59.5 }, { tired: 11 }, { dance: -1 },
      { tired: '5' }, { retired: 'false' }, { gone_home: null }, { name: '' }, { name: ' '.repeat(3) },
      { name: 'x'.repeat(41) }, { age: null }]) {
      await rejected(rpc(guest, 'me', room, payload), 'invalid person value');
    }
    for (const payload of [{ date: '2027-02-29' }, { date: '2026-04-31' }, { date: '1899-12-31' },
      { date: '2200-01-01' }, { date: '2026-1-01' }, { time: '24:00' }, { time: '19:60' },
      { realClock: 'true' }, { weight_tired: 7.1 }, { weight_age: 0.205 }, { weight_sine: 13 },
      { weight_dance: null }, { arbitrary: true }, { weights: {} }]) {
      await rejected(rpc(host, 'settings', room, payload), 'invalid settings value');
    }
    await rejected(rpc(host, 'me', room, { name: 'x'.repeat(8100) }), 'oversized payload');
    await rejected(rpc(host, 'me', room, []), 'non-object payload');
    await rejected(rpc(host, 'me', room, null), 'null payload');
    await rejected(rpc(host, 'unknown', room), 'unknown action');
    await rejected(rpc(host, null, room), 'null action');
  });
  await check('extra fields are rejected throughout RPC envelopes and person objects', async () => {
    await rejected(rpc(host, 'create', null,
      { title: 'Invalid envelope', person: person('Test'), host_id: guestId }), 'extra create field');
    await rejected(rpc(host, 'create', null,
      { title: 'Invalid person', person: { ...person('Test'), admin: true } }), 'extra person field');
    await rejected(rpc(outsider, 'join', room,
      { invite, person: person('Test'), host_id: outsiderId }), 'extra join field');
    await rejected(rpc(outsider, 'join', room,
      { invite, person: { ...person('Test'), user_id: hostId } }), 'extra join person field');
    await rejected(rpc(guest, 'join', room,
      { invite, person: { ...person('Test'), user_id: hostId } }), 'extra repeated-join person field');
    await rejected(rpc(guest, 'join', room,
      { invite, person: { ...person('Test'), age: '59' } }), 'invalid repeated-join person type');
    await rejected(rpc(guest, 'join', room,
      { invite, person: person('Test'), ignored: true }), 'extra repeated-join envelope field');
    for (const name of ['state', 'rotate', 'delete']) {
      await rejected(rpc(host, name, room, { ignored: true }), `extra ${name} field`);
    }
  });
  await check('explicit leave and return persist independently of connections', async () => {
    await action(guest, 'me', room, { gone_home: true });
    assert.equal((await action(host, 'state', room)).members.find(m => m.user_id === guestId).gone_home, true);
    if (guestChannel) await guest.removeChannel(guestChannel);
    assert.equal((await action(host, 'state', room)).members.length, 2);
    await action(guest, 'me', room, { gone_home: false });
    assert.equal((await action(host, 'state', room)).members.find(m => m.user_id === guestId).gone_home, false);
    guestChannel = await subscribe(guest, room, guestEvents);
    const state = await action(host, 'me', room, { tired: 8 });
    await eventually(() => guestEvents.some(e => e.new.revision >= state.room.revision),
      'Guest must receive changes after WebSocket reconnection');
  });
  await check('Realtime RLS sends room changes to members only', async () => {
    const state = await action(host, 'me', room, { tired: 7 });
    await eventually(() => hostEvents.some(e => e.new.revision >= state.room.revision)
      && guestEvents.some(e => e.new.revision >= state.room.revision), 'Member Realtime event missing');
    await pause(1500);
    assert.equal(outsiderEvents.length, 0, 'Nonmember received protected room UPDATE data');
  });
  await check('separate rooms are isolated for reads and writes', async () => {
    const other = await action(outsider, 'create', null,
      { title: `Isolated test ${runId}`, person: person('Isolated host') });
    cleanupRooms.set(other.room.id, outsider); report.roomIds.push(other.room.id);
    assert.deepEqual(good(await guest.from('svh_rooms').select('*').eq('id', other.room.id)), []);
    assert.deepEqual(good(await host.from('svh_members').select('*').eq('room_id', other.room.id)), []);
    await rejected(rpc(guest, 'state', other.room.id), 'cross-room state');
    await rejected(rpc(guest, 'me', other.room.id, { tired: 1 }), 'cross-room update');
    await rejected(rpc(outsider, 'me', room, { tired: 1 }), 'outsider room update');
    await action(outsider, 'delete', other.room.id);
    cleanupRooms.delete(other.room.id);
  });
  await check('rotated invitation rejects old link and admits fresh link', async () => {
    const rotated = await action(host, 'rotate', room);
    assert.notEqual(rotated.invite, invite);
    await rejected(rpc(outsider, 'join', room, { invite, person: person('Old invite') }), 'rotated old invite');
    const fresh = await action(outsider, 'join', room,
      { invite: rotated.invite, person: person('Fresh invite') });
    assert.equal(fresh.members.length, 3);
    await action(guest, 'join', room, { invite, person: person('Existing identity') });
    assert.equal((await action(host, 'state', room)).members.length, 3);
  });
  await check('host deletion removes access and public room/member rows', async () => {
    assert.equal((await action(host, 'delete', room)).deleted, true);
    cleanupRooms.delete(room);
    for (const db of [host, guest, outsider]) {
      await rejected(rpc(db, 'state', room), 'deleted room state');
      assert.deepEqual(good(await db.from('svh_rooms').select('*').eq('id', room)), []);
      assert.deepEqual(good(await db.from('svh_members').select('*').eq('room_id', room)), []);
    }
  });
} catch (error) {
  results.push({ name: 'test setup or required dependency', passed: false,
    error: String(error.message).slice(0, 600) });
  console.log(`FAIL setup: ${String(error.message).slice(0, 600)}`);
} finally {
  for (const [room, owner] of cleanupRooms) {
    const result = await rpc(owner, 'delete', room);
    if (result.error) results.push({ name: 'test room cleanup', passed: false,
      roomId: room, error: result.error.code || 'failed' });
  }
  await Promise.allSettled(clients.map(db => db.removeAllChannels()));
  await Promise.allSettled(clients.filter(db => db.testUserId).map(db => db.auth.signOut()));
  for (const db of clients) db.realtime.disconnect();
  report.finishedAt = new Date().toISOString();
  report.passed = results.filter(item => item.passed).length;
  report.failed = results.filter(item => !item.passed).length;
  if (process.env.SVH_REPORT_PATH) {
    await mkdir(dirname(resolve(process.env.SVH_REPORT_PATH)), { recursive: true });
    await writeFile(process.env.SVH_REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`RESULT ${report.passed} passed, ${report.failed} failed`);
  process.exitCode = report.failed ? 1 : 0;
}
