import test from 'node:test';
import assert from 'node:assert/strict';
import {StreamRenderer} from '../src/stream-renderer';
const tick = () => new Promise(resolve => setTimeout(resolve, 8));

test('token bursts coalesce and completion does not wait for the streaming delay', async () => {
  const rendered: string[] = []; const committed: string[] = [];
  const renderer = new StreamRenderer(async text => {rendered.push(text); return text;}, text => committed.push(text), () => {}, 1000);
  try {
    renderer.update('# H', true); renderer.update('# Heading\n\n**Bold**', true);
    renderer.update('# Heading\n\n**Bold**', false); await tick();
    assert.deepEqual(rendered, ['# Heading\n\n**Bold**']); assert.deepEqual(committed, rendered);
    renderer.update('# Heading\n\n**Bold**', false); await tick(); assert.equal(rendered.length, 1);
  } finally {renderer.dispose();}
});
test('obsolete asynchronous Markdown cannot replace newer content or a closed view', async () => {
  const pending: {text: string; resolve: (text: string) => void}[] = [];
  const committed: string[] = [], discarded: string[] = [];
  const renderer = new StreamRenderer(text => new Promise<string>(resolve => pending.push({text, resolve})), text => committed.push(text), text => discarded.push(text), 0);
  renderer.update('old provisional text', true); await tick();
  renderer.update('correct final text', false); pending[0].resolve(pending[0].text); await tick();
  assert.deepEqual(committed, []); assert.deepEqual(discarded, ['old provisional text']);
  pending[1].resolve(pending[1].text); await tick(); assert.deepEqual(committed, ['correct final text']);
  renderer.update('another response', true); await tick(); renderer.dispose();
  pending[2].resolve(pending[2].text); await tick();
  assert.deepEqual(committed, ['correct final text']); assert.equal(discarded.at(-1), 'another response');
});
