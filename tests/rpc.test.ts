import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {CodexRpc} from '../src/rpc';
const fixture = resolve('tests/fixtures/server.mjs');
const connect = async () => {const rpc = new CodexRpc(); await rpc.connect(process.execPath, process.cwd(), [fixture]); return rpc;};
test('JSONL handshake, concurrent responses and split UTF-8 chunks', async () => {
  const rpc = await connect();
  try {
    assert.equal(rpc.ready, true);
    const values = await Promise.all([rpc.request('echo', {number: 1}), rpc.request('echo', {number: 2})]);
    assert.deepEqual(values, [{number: 1}, {number: 2}]);
    assert.equal(await rpc.request('fragment', {}), '连接成功 🧪');
  } finally {rpc.close();}
});
test('server approval round trip preserves string IDs', async () => {
  const rpc = await connect();
  try {
    const approval = new Promise(resolve => rpc.onEvent(event => {
      if (event.id === 'approval-1') rpc.respond(event.id, {decision: 'decline'});
      if (event.method === 'approval/resolved') resolve(event.params);
    }));
    await rpc.request('approval', {});
    assert.deepEqual(await approval, {decision: 'decline'});
  } finally {rpc.close();}
});
test('timeout does not poison the connection; crash rejects pending requests; reconnect works', async () => {
  const rpc = await connect();
  try {
    await assert.rejects(rpc.request('never', {}, 20), /超时/);
    assert.deepEqual(await rpc.request('echo', {ok: true}), {ok: true});
    await assert.rejects(rpc.request('crash', {}), /已退出/);
    assert.equal(rpc.ready, false);
    await rpc.connect(process.execPath, process.cwd(), [fixture]);
    assert.equal(await rpc.request('echo', 'reconnected'), 'reconnected');
  } finally {rpc.close();}
});
test('invalid protocol fails pending requests instead of silently hanging', async () => {
  const rpc = await connect();
  try {await assert.rejects(rpc.request('invalid', {}), /无效的协议/); assert.equal(rpc.ready, false);}
  finally {rpc.close();}
});
test('non-object protocol messages fail cleanly; unknown notification envelopes remain compatible', async () => {
  const rpc = await connect(); const events: string[] = [];
  rpc.onEvent(event => events.push(event.method));
  try {
    assert.equal(await rpc.request('unknown-event', {}), true);
    assert.ok(events.includes('future/notification'));
    await assert.rejects(rpc.request('invalid-shape', {}), /无效的协议/);
    assert.equal(rpc.ready, false);
  } finally {rpc.close();}
});
