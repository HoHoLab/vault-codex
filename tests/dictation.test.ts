import test from 'node:test';
import assert from 'node:assert/strict';
import {Dictation, appendTranscript, type DictationState} from '../src/dictation';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function setup(options: {getMedia?: () => Promise<any>; transcribe?: () => Promise<string>} = {}) {
  let stops = 0; const stream = {getTracks: () => [{stop: () => stops++}]};
  class Recorder {
    static isTypeSupported(type: string) {return type === 'audio/webm';}
    state = 'inactive'; mimeType = 'audio/webm';
    ondataavailable?: (event: {data: Blob}) => void; onstop?: () => void; onerror?: () => void;
    start() {this.state = 'recording';}
    stop() {this.state = 'inactive'; queueMicrotask(() => {this.ondataavailable?.({data: new Blob(['audio'])}); this.onstop?.();});}
  }
  const states: DictationState[] = []; const text: string[] = []; const errors: string[] = []; let uploads = 0;
  const browser = {navigator: {mediaDevices: {getUserMedia: options.getMedia ?? (async () => stream)}}, MediaRecorder: Recorder, Blob} as unknown as Window & typeof globalThis;
  const dictation = new Dictation(browser, {prepare: async () => {}, transcribe: async () => {uploads++; return options.transcribe ? options.transcribe() : '识别结果';}, state: state => states.push(state), text: result => text.push(result), error: error => errors.push(error)});
  return {dictation, stream, states, text, errors, get stops() {return stops;}, get uploads() {return uploads;}};
}
test('finishing a recording releases media before uploading and returns one transcript', async () => {
  const env = setup();
  try {
    await env.dictation.start(); assert.equal(env.dictation.phase, 'recording');
    env.dictation.stop(); await tick();
    assert.equal(env.stops, 1); assert.equal(env.uploads, 1); assert.deepEqual(env.text, ['识别结果']);
    assert.equal(env.dictation.phase, 'idle'); assert.deepEqual(env.errors, []);
  } finally {env.dictation.dispose();}
});
test('cancel while recording releases microphone without uploading', async () => {
  const env = setup(); await env.dictation.start(); env.dictation.cancel(); await tick();
  assert.equal(env.stops, 1); assert.equal(env.uploads, 0); assert.deepEqual(env.text, []); env.dictation.dispose();
});
test('permission resolving after cancellation still releases the acquired microphone', async () => {
  let resolve!: (stream: unknown) => void;
  const env = setup({getMedia: () => new Promise(done => {resolve = done;})});
  const start = env.dictation.start(); await tick(); env.dictation.cancel(); resolve(env.stream); await start;
  assert.equal(env.stops, 1); assert.equal(env.uploads, 0); assert.equal(env.dictation.phase, 'idle'); env.dictation.dispose();
});
test('closing or cancelling during transcription never inserts a late result', async () => {
  let complete!: (text: string) => void;
  const env = setup({transcribe: () => new Promise(done => {complete = done;})});
  await env.dictation.start(); env.dictation.stop(); await tick();
  assert.equal(env.dictation.phase, 'transcribing'); env.dictation.dispose(); complete('late'); await tick();
  assert.deepEqual(env.text, []); assert.deepEqual(env.errors, []); assert.equal(env.stops, 1);
});
test('permission errors surface without starting an upload; appending preserves the existing draft', async () => {
  const env = setup({getMedia: async () => {throw new DOMException('denied', 'NotAllowedError');}});
  await env.dictation.start(); assert.match(env.errors[0], /授权/); assert.equal(env.uploads, 0);
  assert.equal(appendTranscript('已有草稿', '新的听写'), '已有草稿\n新的听写');
  assert.equal(appendTranscript('已有草稿\n', '新的听写'), '已有草稿\n新的听写'); env.dictation.dispose();
});
