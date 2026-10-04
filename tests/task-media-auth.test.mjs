import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneReminders } from '../push-client.js';

function setup() {
  const storage = new Map();
  const session = owner => ({ user: { id: owner }, access_token: owner + '-token',
    refresh_token: owner + '-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  storage.set('mydo.push.auth', JSON.stringify(session('owner-a')));
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  globalThis.window = { addEventListener() {} };
  globalThis.document = { addEventListener() {} };
  const phone = new PhoneReminders({ getTasks: () => [], getLanguage: () => 'en' });
  const switchOwner = () => {
    phone.session = session('owner-b');
    storage.set('mydo.push.auth', JSON.stringify(phone.session));
  };
  return { phone, switchOwner };
}

test('a cloud RPC rejects an explicitly different owner before token acquisition', async () => {
  const { phone } = setup();
  let tokens = 0, calls = 0;
  phone.token = async () => { tokens++; return 'owner-a-token'; };
  globalThis.fetch = async () => { calls++; throw Error('should not send'); };
  await assert.rejects(phone.rpc('mydo_cloud_write', { p_tasks: [] }, 'owner-b'), /account|login/);
  assert.equal(tokens, 0);
  assert.equal(calls, 0);
});

test('switching owners while a token is awaited never sends old-owner photo data', async () => {
  const { phone, switchOwner } = setup();
  let finishToken, calls = 0;
  phone.token = () => new Promise(resolve => { finishToken = resolve; });
  globalThis.fetch = async () => { calls++; throw Error('should not send'); };
  const pending = phone.rpc('mydo_cloud_write', { p_tasks: [{ image: 'owner-a-photo' }] }, 'owner-a');
  switchOwner();
  finishToken('owner-b-token');
  await assert.rejects(pending, /account|login/);
  assert.equal(calls, 0);
});

test('an old-owner response is not returned after the active account switches', async () => {
  const { phone, switchOwner } = setup();
  let finishResponse, sentToken;
  phone.token = async () => 'owner-a-token';
  globalThis.fetch = async (_url, options) => {
    sentToken = options.headers.Authorization;
    return { ok: true, status: 200, text: () => new Promise(resolve => { finishResponse = resolve; }) };
  };
  const pending = phone.rpc('mydo_cloud_read', {}, 'owner-a');
  while (!finishResponse) await new Promise(resolve => setImmediate(resolve));
  switchOwner();
  finishResponse(JSON.stringify({ tasks: [{ image: 'owner-a-photo' }] }));
  await assert.rejects(pending, /account|login/);
  assert.equal(sentToken, 'Bearer owner-a-token');
});

test('a matching-owner cloud RPC retains the normal response', async () => {
  const { phone } = setup();
  const body = { p_tasks: [{ icon: 'work', image: 'photo-fixture' }] };
  phone.token = async () => 'owner-a-token';
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer owner-a-token');
    assert.deepEqual(JSON.parse(options.body), body);
    return new Response(JSON.stringify({ ok: true, revision: 2 }));
  };
  assert.deepEqual(await phone.rpc('mydo_cloud_write', body, 'owner-a'), { ok: true, revision: 2 });
});
