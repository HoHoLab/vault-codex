import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {CodexRpc, findCodex} from '../src/rpc';
import {permissions} from '../src/types';
const rpc = new CodexRpc();
const cwd = resolve('artifacts/smoke-vault');
await mkdir(cwd, {recursive: true});
await writeFile(resolve(cwd, 'Welcome.md'), '# Connection test\n\nVerification word: moonstone\n');
let answer = ''; let approvalCount = 0;
let complete!: (value: any) => void;
const completion = new Promise<any>(resolve => {complete = resolve;});
const timer = setTimeout(() => {complete({status: 'timeout'});}, 120000);
rpc.onEvent(event => {
  if (event.id !== undefined) {approvalCount++; rpc.reject(event.id, 'Smoke test does not grant elevated access');}
  if (event.method === 'item/agentMessage/delta') answer += event.params.delta;
  if (event.method === 'turn/completed') complete(event.params.turn);
});
try {
  const executable = await findCodex('');
  await rpc.connect(executable, cwd);
  const account = await rpc.request('account/read', {refreshToken: false});
  const {data: models} = await rpc.request('model/list', {limit: 100, includeHidden: false});
  console.log(JSON.stringify({connection: 'initialized', accountType: account.account?.type ?? null, requiresAuth: account.requiresOpenaiAuth, models: models.map((model: any) => ({id: model.model, efforts: model.supportedReasoningEfforts.map((option: any) => option.reasoningEffort)}))}, null, 2));
  const model = models.find((item: any) => item.isDefault) ?? models[0];
  const policy = permissions('request', cwd);
  const {thread} = await rpc.request('thread/start', {cwd, model: model.model, sandbox: policy.sandbox, approvalPolicy: 'never', ephemeral: true});
  await rpc.request('turn/start', {threadId: thread.id, cwd, model: model.model, effort: model.supportedReasoningEfforts[0]?.reasoningEffort, approvalPolicy: 'never', sandboxPolicy: policy.sandboxPolicy, input: [{type: 'text', text: 'This is an integration test in an isolated temporary vault. Read Welcome.md in the current directory. Create Result.md containing exactly the verification word from that note. Do not access other directories, use the network, or run other tasks. Reply with only the verification word after writing the file.'}]});
  const turn = await completion;
  const result = await readFile(resolve(cwd, 'Result.md'), 'utf8').catch(() => '');
  const passed = turn.status === 'completed' && result.trim() === 'moonstone' && answer.includes('moonstone');
  console.log(JSON.stringify({turnStatus: turn.status, error: turn.error?.message, streamedReply: answer, fileVerified: result.trim() === 'moonstone', approvalCount, passed}, null, 2));
  if (!passed) process.exitCode = 1;
} finally {clearTimeout(timer); rpc.close();}
