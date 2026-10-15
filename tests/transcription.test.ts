import test from 'node:test';
import assert from 'node:assert/strict';
import {CodexTranscriber, MAX_AUDIO_BYTES, type VoiceRequest, type VoiceRpc, type VoiceResponse} from '../src/transcription';

const token = `header.${Buffer.from(JSON.stringify({'https://api.openai.com/auth': {chatgpt_account_id: 'test-account'}})).toString('base64url')}.signature`;
function setup(transport: (request: VoiceRequest) => Promise<VoiceResponse>, authMethod = 'chatgpt', timeout = 5000) {
  const calls: {method: string; params: any}[] = [];
  const rpc: VoiceRpc = {async request<T>(method: string, params: unknown): Promise<T> {calls.push({method, params}); return {authMethod, authToken: token} as T;}};
  return {calls, client: new CodexTranscriber(rpc, transport, timeout)};
}
test('dictation uses Codex authentication only on the fixed first-party endpoint and preserves audio bytes', async () => {
  let request!: VoiceRequest;
  const {client, calls} = setup(async data => {request = data; return {status: 200, text: JSON.stringify({text: ' 测试语音。 ', asset_pointer: 'ignored'})};});
  assert.equal(await client.transcribe(new Uint8Array([0, 1, 255]).buffer, 'audio/webm;codecs=opus'), '测试语音。');
  assert.equal(request.url, 'https://chatgpt.com/backend-api/transcribe');
  assert.equal(request.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.headers['ChatGPT-Account-Id'], 'test-account');
  assert.equal(request.headers.originator, 'codex_obsidian');
  const bytes = Buffer.from(request.body);
  assert.notEqual(bytes.indexOf(Buffer.from([0, 1, 255])), -1);
  assert.match(bytes.toString(), /name="file"; filename="dictation.webm"/);
  assert.match(bytes.toString(), /Content-Type: audio\/webm\r\n/);
  assert.equal(bytes.includes(Buffer.from(token)), false);
  assert.deepEqual(calls, [{method: 'getAuthStatus', params: {includeToken: true, refreshToken: false}}]);
});
test('expired authentication refreshes once; denied requests are not retried or downgraded', async () => {
  let requests = 0;
  const {client, calls} = setup(async () => ++requests === 1 ? {status: 401, text: ''} : {status: 200, text: '{"text":"renewed"}'});
  assert.equal(await client.transcribe(new ArrayBuffer(1), 'audio/wav'), 'renewed');
  assert.deepEqual(calls.map(call => call.params.refreshToken), [false, true]);
  let denied = 0;
  const {client: blocked} = setup(async () => {denied++; return {status: 403, text: `secret ${token}`};});
  await assert.rejects(blocked.transcribe(new ArrayBuffer(1), 'audio/wav'), error => error instanceof Error && /拒绝/.test(error.message) && !error.message.includes(token));
  assert.equal(denied, 1);
});
test('API key accounts never send their credentials to the dictation endpoint', async () => {
  let sent = false; const {client} = setup(async () => {sent = true; return {status: 200, text: ''};}, 'apikey');
  await assert.rejects(client.transcribe(new ArrayBuffer(1), 'audio/wav'), /ChatGPT/); assert.equal(sent, false);
});
test('errors never echo transport diagnostics containing credentials; empty and malformed transcripts are rejected', async () => {
  const {client} = setup(async () => {throw new Error(`Authorization Bearer ${token}`);});
  await assert.rejects(client.transcribe(new ArrayBuffer(1), 'audio/wav'), error => error instanceof Error && !error.message.includes(token));
  for (const text of ['not json', '{}', '{"text":"  "}']) {
    const {client} = setup(async () => ({status: 200, text}));
    await assert.rejects(client.transcribe(new ArrayBuffer(1), 'audio/wav'));
  }
});
test('cancellation and timeout release callers without accepting a late result', async () => {
  let finish!: (value: VoiceResponse) => void;
  let started!: () => void; const active = new Promise<void>(resolve => {started = resolve;});
  const {client} = setup(() => {started(); return new Promise(resolve => {finish = resolve;});});
  const cancel = new AbortController(); const pending = client.transcribe(new ArrayBuffer(1), 'audio/wav', cancel.signal);
  await active; cancel.abort(); await assert.rejects(pending, {name: 'AbortError'});
  finish({status: 200, text: '{"text":"late"}'});
  const {client: timed} = setup(() => new Promise(() => {}), 'chatgpt', 10);
  await assert.rejects(timed.transcribe(new ArrayBuffer(1), 'audio/wav'), /超时/);
});
test('invalid recordings are rejected before authentication or upload', async () => {
  const {client, calls} = setup(async () => {throw new Error('must not upload');});
  await assert.rejects(client.transcribe(new ArrayBuffer(0), 'audio/wav'), /没有录到/);
  await assert.rejects(client.transcribe(new ArrayBuffer(MAX_AUDIO_BYTES + 1), 'audio/wav'), /25 MB/);
  await assert.rejects(client.transcribe(new ArrayBuffer(1), 'text/plain'), /格式/);
  assert.equal(calls.length, 0);
});

test('a non-Error cancellation reason is reported as cancellation without leaking the reason', async () => {
  const cancel = new AbortController(); cancel.abort('private cancellation detail');
  const {client, calls} = setup(async () => {throw new Error('must not upload');});
  await assert.rejects(client.transcribe(new ArrayBuffer(1), 'audio/wav', cancel.signal), error => error instanceof Error && error.name === 'AbortError' && !error.message.includes('private'));
  assert.equal(calls.length, 0);
});
