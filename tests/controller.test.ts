import test from 'node:test';
import assert from 'node:assert/strict';
import {Controller} from '../src/controller';
import {CodexRpc, type RpcEvent} from '../src/rpc';
import {DEFAULT_SETTINGS, permissions, migrateAccess, contextUsage, type TokenUsage} from '../src/types';
class FakeRpc extends CodexRpc {
  override ready = true;
  calls: {method: string; params: any}[] = [];
  responses: unknown[] = [];
  events: ((event: RpcEvent) => void)[] = [];
  handler: (method: string, params: any) => any = method => method === 'thread/start' ? {thread: {id: 'thread-1'}} : {turn: {id: 'turn-1'}};
  override onEvent(listener: (event: RpcEvent) => void) {this.events.push(listener); return () => {};}
  push(event: RpcEvent) {for (const listener of this.events) listener(event);}
  override async request<T = any>(method: string, params: unknown): Promise<T> {this.calls.push({method, params}); return this.handler(method, params);}
  override respond(id: number | string, result: unknown) {this.responses.push({id, result});}
  override reject(id: number | string, message: string) {this.responses.push({id, error: message});}
  override close() {this.ready = false;}
}
function setup() {const rpc = new FakeRpc(); const c = new Controller({settings: {...DEFAULT_SETTINGS}, sessions: []}, '/vault', async () => {}, rpc); return {rpc, c};}
test('assistant preferences reach new and resumed threads, including changing and clearing an existing chat', async () => {
  class ReconnectRpc extends FakeRpc {
    starts = 0;
    override async connect(command: string) {assert.equal(command, process.execPath); this.ready = true; this.starts++;}
  }
  const rpc = new ReconnectRpc(); let turns = 0;
  rpc.handler = method => {
    if (method === 'account/read') return {account: {type: 'chatgpt'}};
    if (method === 'model/list') return {data: [], nextCursor: null};
    if (method === 'thread/start' || method === 'thread/resume') return {thread: {id: 'thread-1'}};
    return {turn: {id: `turn-${++turns}`}};
  };
  // Use a known executable for path validation; the fake transport never launches it.
  const settings = {...DEFAULT_SETTINGS, executable: process.execPath, customInstructions: 'Use concise Chinese replies.', responseVerbosity: 'low' as const};
  const c = new Controller({settings, sessions: []}, '/vault', async () => {}, rpc);
  const complete = () => rpc.push({method: 'turn/completed', params: {threadId: 'thread-1', turn: {id: `turn-${turns}`, status: 'completed'}}});
  try {
    await c.send('first', []); complete();
    const initial = rpc.calls.find(call => call.method === 'thread/start')!.params;
    assert.ok(initial.developerInstructions.includes('Use concise Chinese replies.')); assert.deepEqual(initial.config, {model_verbosity: 'low'});
    c.data.settings.customInstructions = 'Use detailed English replies.'; c.data.settings.responseVerbosity = 'high';
    await c.send('second', []); complete();
    const changed = rpc.calls.filter(call => call.method === 'thread/resume').at(-1)!.params;
    assert.ok(changed.developerInstructions.includes('Use detailed English replies.')); assert.ok(!changed.developerInstructions.includes('Use concise Chinese replies.'));
    assert.deepEqual(changed.config, {model_verbosity: 'high'}); assert.equal(rpc.starts, 1);
    c.data.settings.customInstructions = ''; c.data.settings.responseVerbosity = 'default';
    await c.send('third', []); complete();
    const cleared = rpc.calls.filter(call => call.method === 'thread/resume').at(-1)!.params;
    assert.ok(!cleared.developerInstructions.includes('User preferences for this vault')); assert.equal('config' in cleared, false); assert.equal(rpc.starts, 2);
    assert.equal(c.session!.messages.filter(message => message.role === 'user').length, 3);
  } finally {await c.dispose();}
});
test('rapid sends produce one turn and streaming final item does not duplicate text', async () => {
  const {rpc, c} = setup();
  try {
    const first = c.send('hello', []);
    assert.equal(await c.send('duplicate', []), false); await first;
    rpc.push({method: 'item/agentMessage/delta', params: {threadId: 'thread-1', itemId: 'answer', delta: 'Hi'}});
    rpc.push({method: 'item/completed', params: {threadId: 'thread-1', item: {id: 'answer', type: 'agentMessage', text: 'Hi there'}}});
    rpc.push({method: 'turn/completed', params: {threadId: 'thread-1', turn: {id: 'turn-1', status: 'completed'}}});
    assert.equal(c.busy, false); assert.equal(c.session!.messages.filter(item => item.role === 'assistant').length, 1);
    assert.equal(c.session!.messages.at(-1)!.text, 'Hi there');
    assert.equal(rpc.calls.filter(call => call.method === 'turn/start').length, 1);
    assert.equal(rpc.calls[0].params.sandbox, 'workspace-write');
    assert.equal(rpc.calls[1].params.sandboxPolicy.type, 'workspaceWrite');
  } finally {await c.dispose();}
});
test('completion arriving before turn/start response does not resurrect the active turn', async () => {
  const {rpc, c} = setup();
  rpc.handler = method => {
    if (method === 'thread/start') return {thread: {id: 'thread-1'}};
    rpc.push({method: 'turn/completed', params: {threadId: 'thread-1', turn: {id: 'turn-1', status: 'completed'}}});
    return {turn: {id: 'turn-1'}};
  };
  try {await c.send('hello', []); assert.equal(c.busy, false); assert.equal(c.turnId, '');}
  finally {await c.dispose();}
});
test('each item keeps its lifecycle and turn identity while a subsequent reply streams', async () => {
  const {c, rpc} = setup(); let n = 0;
  rpc.handler = method => method === 'thread/start' ? {thread: {id: 'thread-1'}} : {turn: {id: `turn-${++n}`}};
  try {
    await c.send('first', []);
    rpc.push({method: 'item/started', params: {threadId: 'thread-1', turnId: 'turn-1', item: {id: 'progress', type: 'agentMessage', phase: 'commentary', text: 'Checking'}}});
    rpc.push({method: 'item/completed', params: {threadId: 'thread-1', turnId: 'turn-1', item: {id: 'progress', type: 'agentMessage', phase: 'commentary', text: 'Checked'}}});
    rpc.push({method: 'item/started', params: {threadId: 'thread-1', turnId: 'turn-1', item: {id: 'answer', type: 'agentMessage', phase: 'final_answer', text: '# Heading'}}});
    rpc.push({method: 'item/completed', params: {threadId: 'thread-1', turnId: 'turn-1', item: {id: 'answer', type: 'agentMessage', phase: 'final_answer', text: '# Heading\n\n**Bold**'}}});
    rpc.push({method: 'turn/completed', params: {threadId: 'thread-1', turn: {id: 'turn-1', status: 'completed'}}});
    await c.send('second', []);
    rpc.push({method: 'item/agentMessage/delta', params: {threadId: 'thread-1', turnId: 'turn-2', itemId: 'new', delta: 'Generating'}});
    const old = c.session!.messages.find(message => message.id === 'answer')!;
    assert.equal(old.status, 'completed'); assert.equal(old.turnId, 'turn-1'); assert.equal(old.phase, 'final_answer');
    assert.equal(c.session!.messages.find(message => message.id === 'new')!.status, 'inProgress');
    assert.deepEqual(c.session!.turns?.map(turn => turn.status), ['completed', 'inProgress']);
    rpc.push({method: 'connection/closed', params: {message: 'offline'}});
    assert.equal(old.status, 'completed'); assert.equal(c.session!.messages.find(message => message.id === 'new')!.status, 'failed');
  } finally {await c.dispose();}
});
test('retry only replays the latest failed or interrupted request and retains its attachments', async () => {
  const {c, rpc} = setup(); let n = 0;
  rpc.handler = method => method === 'thread/start' ? {thread: {id: 'thread-1'}} : {turn: {id: `turn-${++n}`}};
  const attachments = [{id: 'note', name: 'Note.md', text: 'Reference text', path: '/vault/Note.md'}];
  try {
    await c.send('original request', attachments); assert.equal(await c.retry('turn-1'), false);
    rpc.push({method: 'turn/completed', params: {threadId: 'thread-1', turn: {id: 'turn-1', status: 'failed', error: {message: 'offline'}}}});
    assert.equal(await c.retry('other'), false); assert.equal(await c.retry('turn-1'), true);
    assert.equal(rpc.calls.at(-1)!.params.input[0].text, rpc.calls[1].params.input[0].text);
    assert.equal(c.session!.turns?.length, 2); assert.equal(await c.retry('turn-1'), false);
    rpc.push({method: 'turn/completed', params: {threadId: 'thread-1', turn: {id: 'turn-2', status: 'interrupted'}}});
    assert.equal(await c.retry('turn-2'), true);
  } finally {await c.dispose();}
});
test('a request with unconfirmed acceptance is never silently retried', async () => {
  const {c, rpc} = setup();
  rpc.handler = method => {if (method === 'thread/start') return {thread: {id: 'thread-1'}}; throw new Error('timeout');};
  try {
    await assert.rejects(c.send('test', []), /timeout/);
    const turn = c.session!.turns!.at(-1)!; assert.equal(turn.status, 'unconfirmed');
    assert.equal(await c.retry(turn.id), false); assert.equal(rpc.calls.length, 2);
  } finally {await c.dispose();}
});
test('reopening the plugin does not leave disconnected saved turns looking active', async () => {
  const rpc = new FakeRpc();
  const c = new Controller({settings: {...DEFAULT_SETTINGS}, activeId: 'saved', sessions: [{id: 'saved', title: 'Saved', updatedAt: 0, turns: [{id: 'turn-old', status: 'inProgress'}, {id: 'pending-old', status: 'inProgress'}], messages: [{id: 'a', role: 'assistant', text: 'Partial', turnId: 'turn-old', status: 'inProgress'}]}]}, '/vault', async () => {}, rpc);
  try {assert.deepEqual(c.session!.turns!.map(turn => turn.status), ['interrupted', 'unconfirmed']); assert.equal(c.session!.messages[0].status, 'interrupted');}
  finally {await c.dispose();}
});
test('a turn keeps its start timestamp when bound and saves a fixed duration at completion', async () => {
  const {c, rpc} = setup();
  try {
    await c.send('timed request', []);
    const turn = c.session!.turns!.at(-1)!;
    assert.equal(turn.id, 'turn-1'); assert.ok(typeof turn.startedAt === 'number');
    turn.startedAt = Date.now() - 2414000;
    rpc.push({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});
    assert.ok(turn.durationMs! >= 2414000 && turn.durationMs! < 2415000);
    const duration=turn.durationMs;
    rpc.push({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});
    assert.equal(turn.durationMs,duration);
  } finally {await c.dispose();}
});
test('replayed usage from resume cannot bind the new request to a previous turn', async () => {
  const {c, rpc} = setup(); c.session!.id = 'thread-1'; c.data.activeId = 'thread-1';
  rpc.handler = method => {
    if (method === 'thread/resume') return {};
    rpc.push({method:'thread/tokenUsage/updated',params:{threadId:'thread-1',turnId:'previous-turn',tokenUsage:{}}});
    rpc.push({method:'turn/started',params:{threadId:'thread-1',turn:{id:'new-turn',status:'inProgress'}}});
    rpc.push({method:'item/completed',params:{threadId:'thread-1',turnId:'new-turn',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'hello'}}});
    rpc.push({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'new-turn',status:'completed'}}});
    return {turn:{id:'new-turn'}};
  };
  try {
    await c.send('hello',[]); assert.equal(c.session!.turns!.length,1);
    assert.equal(c.session!.turns![0].id,'new-turn'); assert.equal(c.session!.turns![0].status,'completed');
    assert.ok(c.session!.messages.every(message=>message.turnId==='new-turn')); assert.equal(c.busy,false);
  } finally {await c.dispose();}
});
test('the known stranded-input history pair is repaired without merging normal turns', async () => {
  const rpc = new FakeRpc();
  const c = new Controller({settings:{...DEFAULT_SETTINGS},activeId:'saved',sessions:[{id:'saved',title:'Saved',updatedAt:0,turns:[{id:'wrong',status:'inProgress',startedAt:1000},{id:'actual',status:'completed',startedAt:1300,durationMs:500}],messages:[{id:'user',role:'user',text:'hello',turnId:'wrong'},{id:'answer',role:'assistant',text:'world',turnId:'actual',status:'completed'}]}]},'/vault',async()=>{},rpc);
  try {
    assert.deepEqual(c.session!.turns,[{id:'actual',status:'completed',startedAt:1000,durationMs:800}]);
    assert.equal(c.session!.messages[0].turnId,'actual');
  } finally {await c.dispose();}
});
test('approval is never automatically accepted, foreign thread events are ignored, stale answers cannot be sent', async () => {
  const {rpc, c} = setup();
  try {
    await c.send('hello', []);
    const approval: RpcEvent = {id: 42, method: 'item/commandExecution/requestApproval', params: {threadId: 'thread-1', command: 'test'}};
    rpc.push(approval); assert.equal(rpc.responses.length, 0); assert.equal(c.approvals.length, 1);
    rpc.push({method: 'item/agentMessage/delta', params: {threadId: 'other', itemId: 'other', delta: 'foreign'}});
    assert.equal(c.session!.messages.some(item => item.text === 'foreign'), false);
    rpc.push({method: 'serverRequest/resolved', params: {threadId: 'thread-1', requestId: 42}});
    c.answer(approval, {decision: 'accept'}); assert.equal(rpc.responses.length, 0);
    rpc.push({...approval, id: 43}); c.answer({...approval, id: 43}, {decision: 'decline'});
    assert.deepEqual(rpc.responses, [{id: 43, result: {decision: 'decline'}}]);
  } finally {await c.dispose();}
});
test('failed turns and disconnections clear running state and surface errors', async () => {
  const {rpc, c} = setup();
  try {
    await c.send('hello', []);
    rpc.push({method: 'turn/completed', params: {threadId: 'thread-1', turn: {id: 'turn-1', status: 'failed', error: {message: 'Quota exceeded'}}}});
    assert.match(c.status, /Quota exceeded/); assert.equal(c.busy, false);
    rpc.push({method: 'connection/closed', params: {message: 'disconnected'}});
    assert.equal(c.turnId, ''); assert.equal(c.status, 'disconnected');
  } finally {await c.dispose();}
});
test('changing models drops an unsupported reasoning effort', async () => {
  const {c} = setup();
  try {
    c.data.settings.effort = 'ultra'; c.models = [{id: 'm', model: 'm', displayName: 'M', isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{reasoningEffort: 'low', description: ''}]}];
    c.chooseModel('m'); assert.equal(c.data.settings.effort, 'low');
    assert.equal(permissions('full', '/vault').approvalPolicy, 'never');
    assert.equal(permissions('read-only', '/vault').sandboxPolicy.type, 'readOnly');
  } finally {await c.dispose();}
});
test('manual and automatic review use the same sandbox but different reviewers, including subsequent turns', async () => {
  const {c, rpc} = setup();
  try {
    await c.send('first', []);
    assert.equal(rpc.calls[0].params.approvalsReviewer, 'user');
    rpc.push({method: 'turn/completed', params: {threadId: 'thread-1', turn: {id: 'turn-1', status: 'completed'}}});
    c.data.settings.access = 'auto-review'; await c.send('second', []);
    const turn = rpc.calls.at(-1)!;
    assert.equal(turn.params.approvalPolicy, 'on-request');
    assert.equal(turn.params.approvalsReviewer, 'auto_review');
    assert.deepEqual(turn.params.sandboxPolicy, permissions('request', '/vault').sandboxPolicy);
    assert.equal(permissions('full', '/vault').sandbox, 'danger-full-access');
  } finally {await c.dispose();}
});
test('old permission settings migrate without silently increasing access', () => {
  assert.equal(migrateAccess('workspace'), 'request');
  assert.equal(migrateAccess('read-only'), 'read-only');
  assert.equal(migrateAccess('full'), 'full');
  assert.equal(migrateAccess(undefined), 'request');
});
test('context usage follows last request rather than cumulative billed usage and handles missing capacity', async () => {
  const {c, rpc} = setup();
  const counts = {totalTokens: 88000, inputTokens: 87000, cachedInputTokens: 1000, outputTokens: 1000, reasoningOutputTokens: 200};
  const usage: TokenUsage = {last: counts, total: {...counts, totalTokens: 990000}, modelContextWindow: 258000};
  try {
    await c.send('hello', []);
    rpc.push({method: 'thread/tokenUsage/updated', params: {threadId: 'thread-1', tokenUsage: usage}});
    assert.deepEqual(contextUsage(c.session!.tokenUsage), {used: 88000, capacity: 258000, percent: 34, remaining: 66});
    rpc.push({method: 'thread/tokenUsage/updated', params: {threadId: 'other', tokenUsage: {...usage, modelContextWindow: 10}}});
    assert.equal(c.session!.tokenUsage!.modelContextWindow, 258000);
    assert.equal(contextUsage({...usage, modelContextWindow: null}), null);
    assert.equal(contextUsage({...usage, modelContextWindow: 0}), null);
    assert.equal(contextUsage({...usage, modelContextWindow: NaN}), null);
    assert.equal(contextUsage({...usage, last: {...counts, totalTokens: 999999}})!.percent, 100);
    c.newSession(); // A running turn cannot be replaced.
    assert.equal(c.session!.tokenUsage, usage);
    rpc.push({method: 'turn/completed', params: {threadId: 'thread-1', turn: {id: 'turn-1', status: 'completed'}}});
    c.newSession(); assert.equal(contextUsage(c.session!.tokenUsage), null);
  } finally {await c.dispose();}
});
test('Fast toggles the backend service tier and explicitly clears it on the following turn', async () => {
  const {c, rpc} = setup();
  c.models = [{id: 'm', model: 'm', displayName: 'M', isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{reasoningEffort: 'low', description: ''}], serviceTiers: [{id: 'priority', name: 'Fast', description: ''}]}];
  c.chooseModel('m');
  try {
    assert.equal(c.fastEnabled, false); c.toggleFast(); assert.equal(c.fastEnabled, true);
    await c.send('fast', []);
    assert.equal(rpc.calls[0].params.serviceTier, 'priority');
    assert.equal(rpc.calls[1].params.serviceTierForTurn, 'priority');
    c.toggleFast(); assert.equal(c.fastEnabled, true); // Cannot alter a running turn.
    rpc.push({method: 'turn/completed', params: {threadId: 'thread-1', turn: {id: 'turn-1', status: 'completed'}}});
    c.toggleFast(); assert.equal(c.fastEnabled, false); await c.send('standard', []);
    assert.equal(rpc.calls.at(-1)!.params.serviceTier, null);
    assert.equal(rpc.calls.at(-1)!.params.serviceTierForTurn, 'default');
  } finally {await c.dispose();}
});
test('switching to a model without Fast removes the enabled state and cannot fabricate a tier', async () => {
  const {c} = setup();
  const base = {displayName: 'M', isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{reasoningEffort: 'low', description: ''}]};
  c.models = [{...base, id: 'fast', model: 'fast', serviceTiers: [{id: 'priority', name: 'Fast', description: ''}]}, {...base, id: 'standard', model: 'standard'}];
  try {
    c.chooseModel('fast'); c.toggleFast(); assert.equal(c.fastEnabled, true);
    c.chooseModel('standard'); c.toggleFast(); assert.equal(c.fastEnabled, false); assert.equal(c.serviceTier, 'default');
  } finally {await c.dispose();}
});
