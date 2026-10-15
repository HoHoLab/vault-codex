import {randomUUID} from 'node:crypto';
import {CodexRpc, findCodex, type RpcEvent} from './rpc';
import {errorText, permissions, fastTier, type Attachment, type Message, type ModelInfo, type SavedData, type Session, type TurnStatus} from './types';
import {I18n} from './i18n';
import {assistantPreferences} from './preferences';

export class Controller {
  rpc: CodexRpc;
  models: ModelInfo[] = [];
  private statusValue = '未连接';
  private accountValue = '';
  get status() {return this.i18n.t(this.statusValue);}
  set status(value: string) {this.statusValue = value;}
  get account() {return this.i18n.t(this.accountValue);}
  set account(value: string) {this.accountValue = value;}
  get usesChatGPT() {return this.accountValue === 'ChatGPT 账户';}
  private get t() {return this.i18n.t;}
  busy = false;
  connecting = false;
  turnId = '';
  lastError = '';
  approvals: RpcEvent[] = [];
  private resumed = new Set<string>();
  private completed = new Set<string>();
  private listeners = new Set<() => void>();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private connectionPromise?: Promise<void>;
  private disposed = false;
  private pendingTurnId = '';
  private appliedPreferences?: string;
  constructor(public data: SavedData, public cwd: string, private persist: () => Promise<void>, rpc?: CodexRpc, readonly i18n = new I18n()) {
    this.rpc = rpc ?? new CodexRpc(i18n.t);
    for (const session of data.sessions) {
      // Versions 0.1.6–0.1.7 could bind a pending request to a replayed usage
      // event from the previous turn. Repair only the unambiguous adjacent pair:
      // one stranded user input, then its completed answer created within 2s.
      const turns = session.turns ?? [];
      for (let i = 0; i < turns.length - 1; i++) {
        const first = turns[i], next = turns[i + 1];
        const inputs = session.messages.filter(message => message.turnId === first.id);
        const replies = session.messages.filter(message => message.turnId === next.id);
        const gap = typeof first.startedAt === 'number' && typeof next.startedAt === 'number' ? next.startedAt - first.startedAt : NaN;
        if (first.status === 'inProgress' && !first.id.startsWith('pending-') && next.status === 'completed' && gap >= 0 && gap < 2000 && inputs.length === 1 && inputs[0].role === 'user' && replies.some(message => message.role === 'assistant') && replies.every(message => message.role !== 'user')) {
          inputs[0].turnId = next.id; next.startedAt = first.startedAt;
          if (typeof next.durationMs === 'number') next.durationMs += gap;
          turns.splice(i--, 1);
        }
      }
      for (const turn of session.turns ?? []) if (turn.status === 'inProgress') {
        turn.status = turn.id.startsWith('pending-') ? 'unconfirmed' : 'interrupted';
        for (const message of session.messages) if (message.turnId === turn.id && message.status === 'inProgress') message.status = 'interrupted';
      }
    }
    this.rpc.onEvent(event => this.onEvent(event));
    if (!this.session) this.newSession();
  }
  get session() { return this.data.sessions.find(session => session.id === this.data.activeId); }
  get model() { return this.models.find(model => model.model === this.data.settings.model); }
  get fastEnabled() {const tier = fastTier(this.model); return !!tier && this.data.settings.serviceTier === tier;}
  get serviceTier() {return this.fastEnabled ? fastTier(this.model)! : 'default';}
  toggleFast() {
    const tier = fastTier(this.model); if (!tier || this.busy) return;
    this.data.settings.serviceTier = this.fastEnabled ? 'default' : tier; this.changed(true);
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  changed(save = false) {
    for (const listener of this.listeners) listener();
    if (save) { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => { void this.persist().catch(() => { this.status = '会话保存失败'; this.changed(); }); }, 250); }
  }
  newSession() {
    if (this.busy || this.connecting) return;
    const session: Session = {id: `draft-${randomUUID()}`, title: this.t('新对话'), updatedAt: Date.now(), messages: []};
    // Empty drafts need no permanent history entry.
    this.data.sessions = this.data.sessions.filter(item => !item.id.startsWith('draft-') || item.messages.length);
    this.data.sessions.unshift(session); this.data.activeId = session.id; this.approvals = []; this.turnId = ''; this.changed(true);
  }
  selectSession(id: string) {
    if (this.busy || this.connecting) return;
    if (this.data.sessions.some(session => session.id === id)) { this.data.activeId = id; this.approvals = []; this.changed(true); }
  }
  async connect() {
    if (this.rpc.ready) return;
    if (this.connectionPromise) return this.connectionPromise;
    this.connectionPromise = this.connectInternal().finally(() => { this.connectionPromise = undefined; });
    return this.connectionPromise;
  }
  private async connectInternal() {
    this.connecting = true; this.status = '正在连接…'; this.changed();
    try {
      const command = await findCodex(this.data.settings.executable, this.t);
      if (this.disposed) return;
      await this.rpc.connect(command, this.cwd);
      const [account, models] = await Promise.all([
        this.rpc.request('account/read', {refreshToken: false}), this.listModels()
      ]);
      this.models = models;
      this.account = account.account?.type === 'chatgpt' ? 'ChatGPT 账户' : account.account?.type === 'apiKey' ? 'API Key' : account.requiresOpenaiAuth === false ? '已配置服务' : '';
      const chosen = this.models.find(model => model.model === this.data.settings.model) ?? this.models.find(model => model.isDefault) ?? this.models[0];
      if (chosen) this.chooseModel(chosen.model);
      this.status = this.account ? '已连接' : '已连接 · 需要登录';
    } catch (error) { this.rpc.close(); this.status = this.lastError = errorText(error); throw error; }
    finally { this.connecting = false; this.changed(true); }
  }
  private async listModels() {
    const result: ModelInfo[] = []; let cursor: string | null = null;
    do {
      const page: {data: ModelInfo[]; nextCursor: string | null} = await this.rpc.request('model/list', {limit: 100, includeHidden: false, cursor});
      result.push(...page.data); cursor = page.nextCursor;
    } while (cursor);
    return result;
  }
  chooseModel(model: string) {
    const selected = this.models.find(item => item.model === model);
    if (!selected) return;
    this.data.settings.model = model;
    if (this.data.settings.serviceTier !== fastTier(selected)) this.data.settings.serviceTier = 'default';
    if (!selected.supportedReasoningEfforts.some(option => option.reasoningEffort === this.data.settings.effort)) this.data.settings.effort = selected.defaultReasoningEffort;
    this.changed(true);
  }
  async login() {
    await this.connect();
    const result = await this.rpc.request('account/login/start', {type: 'chatgpt'});
    if (!result.authUrl) throw new Error(this.t('Codex 没有返回登录地址。'));
    return result.authUrl as string;
  }
  async reconnect() {
    if (this.busy) throw new Error(this.t('请先停止当前回复。'));
    this.resetConnection(); await this.connect();
  }
  private resetConnection() {this.rpc.close(); this.resumed.clear(); this.account = ''; this.appliedPreferences = undefined;}
  async send(text: string, attachments: Attachment[]) {
    if (this.busy) return false;
    if (!text.trim() && !attachments.length) return false;
    const startedAt = Date.now();
    this.busy = true; this.status = '准备发送…'; this.changed();
    let sent = false;
    try {
      // Capture once: edits in Settings while a turn starts apply to the next turn.
      const preferences = assistantPreferences(this.data.settings);
      const signature = JSON.stringify(preferences);
      // A fresh runtime ensures changed/cleared thread config and developer
      // instructions are applied on resume; rejoining a loaded thread can ignore them.
      if (this.appliedPreferences !== undefined && this.appliedPreferences !== signature) this.resetConnection();
      await this.connect();
      if (attachments.some(item => item.image) && this.model?.inputModalities && !this.model.inputModalities.includes('image')) throw new Error(this.t('当前模型不支持图片，请切换模型后发送。'));
      const session = this.session!;
      const settings = this.data.settings;
      const policy = permissions(settings.access, this.cwd);
      const serviceTier = this.serviceTier;
      const config = {model: settings.model || undefined, serviceTier: serviceTier === 'default' ? null : serviceTier, cwd: this.cwd, approvalPolicy: policy.approvalPolicy, sandbox: policy.sandbox, approvalsReviewer: policy.approvalsReviewer, ...preferences};
      const firstMessage = !session.messages.some(message => message.role === 'user');
      if (session.id.startsWith('draft-')) {
        const response = await this.rpc.request('thread/start', config);
        session.id = response.thread.id; this.data.activeId = session.id; this.resumed.add(session.id);
      } else if (!this.resumed.has(session.id)) {
        await this.rpc.request('thread/resume', {threadId: session.id, excludeTurns: true, ...config}); this.resumed.add(session.id);
      }
      this.appliedPreferences = signature;
      const references = attachments.filter(item => !item.image).map(item => `\n\n<reference name=${JSON.stringify(item.name)}>\n${item.text ?? `File in vault: ${item.path}`}\n</reference>`).join('');
      const input: any[] = [{type: 'text', text: (text.trim() || this.t('请查看附件。')) + references}];
      for (const attachment of attachments) if (attachment.image && attachment.path) input.push({type: 'localImage', path: attachment.path});
      this.pendingTurnId = `pending-${randomUUID()}`;
      (session.turns ??= []).push({id: this.pendingTurnId, status: 'inProgress', startedAt});
      const message: Message = {id: `local-${randomUUID()}`, role: 'user', turnId: this.pendingTurnId, retryInput: {text, attachments: attachments.map(item => ({...item}))}, text: text.trim() + (attachments.length ? `\n\n${attachments.map(item => `📎 ${item.name}`).join('\n')}` : '')};
      session.messages.push(message); session.updatedAt = Date.now();
      if (firstMessage) session.title = (text.trim() || attachments[0]?.name || this.t('新对话')).slice(0, 36);
      this.status = 'Codex 正在工作…'; this.changed(true);
      try {
        const result = await this.rpc.request('turn/start', {threadId: session.id, input, model: settings.model || undefined, serviceTier: serviceTier === 'default' ? null : serviceTier, serviceTierForTurn: serviceTier, effort: settings.effort || undefined, cwd: this.cwd, approvalPolicy: policy.approvalPolicy, approvalsReviewer: policy.approvalsReviewer, sandboxPolicy: policy.sandboxPolicy});
        sent = true;
        this.bindTurn(result.turn.id);
        if (!this.completed.has(result.turn.id)) this.turnId = result.turn.id;
      } catch (error) {
        if (message.turnId && this.completed.has(message.turnId)) sent = true;
        else {message.status = '发送未确认'; if (!this.turnId) this.finishTurn(message.turnId!, 'unconfirmed', errorText(error)); throw error;}
      }
    } catch (error) { this.status = this.lastError = errorText(error); this.busy = !!this.turnId; this.changed(true); throw error; }
    return sent;
  }
  async stop() {
    if (this.turnId) { await this.rpc.request('turn/interrupt', {threadId: this.session!.id, turnId: this.turnId}); if (this.busy) this.status = '正在停止…'; this.changed(); }
  }
  async retry(turnId: string) {
    const latest = this.session?.turns?.at(-1);
    if (this.busy || !latest || latest.id !== turnId || !['failed', 'interrupted'].includes(latest.status)) return false;
    const request = this.session?.messages.find(message => message.turnId === turnId && message.role === 'user')?.retryInput;
    if (!request) return false;
    return this.send(request.text, request.attachments.map(item => ({...item})));
  }
  answer(event: RpcEvent, result: unknown) {
    if (event.id === undefined || !this.approvals.some(request => request.id === event.id)) return;
    this.rpc.respond(event.id, result); this.approvals = this.approvals.filter(request => request.id !== event.id); this.changed();
  }
  private upsert(message: Message) {
    const messages = this.session?.messages; if (!messages) return;
    const existing = messages.find(item => item.id === message.id);
    if (existing) Object.assign(existing, Object.fromEntries(Object.entries(message).filter(([, value]) => value !== undefined))); else messages.push(message);
  }
  private bindTurn(id: string) {
    const session = this.session; if (!session) return;
    if (this.pendingTurnId) {
      for (const message of session.messages) if (message.turnId === this.pendingTurnId) message.turnId = id;
      const pending = session.turns?.find(turn => turn.id === this.pendingTurnId);
      if (pending) pending.id = id;
      this.pendingTurnId = '';
    }
    if (!session.turns?.some(turn => turn.id === id)) (session.turns ??= []).push({id, status: 'inProgress', startedAt: Date.now()});
  }
  private finishTurn(id: string, status: TurnStatus, error?: string) {
    const turn = this.session?.turns?.find(turn => turn.id === id);
    if (turn) {
      turn.status = status; turn.error = error;
      if (turn.durationMs === undefined && typeof turn.startedAt === 'number' && Number.isFinite(turn.startedAt)) turn.durationMs = Math.max(0, Date.now() - turn.startedAt);
    }
    for (const message of this.session?.messages ?? []) {
      if (message.turnId === id && message.status === 'inProgress') message.status = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'interrupted';
    }
    if (this.pendingTurnId === id) this.pendingTurnId = '';
  }
  private onEvent(event: RpcEvent) {
    const p = event.params ?? {};
    if (event.method === 'connection/closed') {
      const active = this.turnId || this.pendingTurnId;
      if (active) this.finishTurn(active, this.turnId ? 'failed' : 'unconfirmed', p.message);
      this.busy = false; this.turnId = ''; this.approvals = []; this.resumed.clear(); this.appliedPreferences = undefined; this.status = this.lastError = p.message; this.changed(true); return;
    }
    if (event.method === 'account/login/completed') {
      this.status = p.success ? '登录成功' : (p.error ?? '登录失败');
      if (p.success) { this.account = 'ChatGPT 账户'; void this.listModels().then(models => {this.models = models; const model = this.model ?? models.find(item => item.isDefault) ?? models[0]; if (model) this.chooseModel(model.model); this.changed(true);}).catch(error => {this.status = errorText(error); this.changed();}); }
      this.changed(); return;
    }
    if (p.threadId && p.threadId !== this.session?.id) {
      if (event.id !== undefined) this.rpc.reject(event.id, 'Thread is not active in this client');
      return;
    }
    const eventTurnId: string | undefined = p.turnId ?? p.turn?.id;
    if (eventTurnId && this.completed.has(eventTurnId) && event.method !== 'turn/completed') return;
    const turnId = eventTurnId ?? (this.turnId || this.pendingTurnId || undefined);
    if (event.id !== undefined) {
      if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput', 'tool/requestUserInput'].includes(event.method)) this.approvals.push(event);
      else { this.rpc.reject(event.id, `Unsupported client request: ${event.method}`); this.upsert({id: `unsupported-${event.id}`, role: 'system', text: this.t('此版本尚不支持交互：{method}。本次请求未获批准。', {method: event.method})}); }
      this.changed(); return;
    }
    if (event.method === 'serverRequest/resolved') this.approvals = this.approvals.filter(request => request.id !== p.requestId);
    if (event.method === 'thread/tokenUsage/updated' && this.session) this.session.tokenUsage = p.tokenUsage;
    if (event.method === 'item/autoApprovalReview/started' || event.method === 'item/autoApprovalReview/completed') {
      const completed = event.method.endsWith('/completed');
      const labels: Record<string, string> = {approved: '已允许', denied: '已拒绝', timedOut: '超时', aborted: '已中止'};
      const reviewStatus = p.review?.status;
      this.upsert({id: `review-${p.reviewId}`, role: 'tool', turnId, toolKind: 'review', title: completed ? this.t('自动审批：{status}', {status: this.t(labels[reviewStatus] ?? '已结束')}) : this.t('Codex 正在审批'), text: p.review?.rationale ?? '', status: completed ? reviewStatus === 'approved' ? 'completed' : 'failed' : 'inProgress'});
    }
    if (event.method === 'turn/started') {this.bindTurn(p.turn.id); this.turnId = p.turn.id; this.busy = true;}
    if (event.method === 'turn/plan/updated') {
      const plan = (p.plan ?? []).map((step: any) => `- [${step.status === 'completed' ? 'x' : ' '}] ${step.step}${step.status === 'inProgress' ? this.t('（进行中）') : ''}`).join('\n');
      this.upsert({id: `plan-${turnId}`, role: 'assistant', phase: 'plan', title: this.t('计划'), turnId, status: 'inProgress', text: [p.explanation, plan].filter(Boolean).join('\n\n')});
    }
    if (event.method === 'item/agentMessage/delta' || event.method === 'item/plan/delta') {
      const message = this.session?.messages.find(item => item.id === p.itemId);
      if (message) message.text += p.delta;
      else this.upsert({id: p.itemId, role: 'assistant', turnId, phase: event.method === 'item/plan/delta' ? 'plan' : undefined, status: 'inProgress', text: p.delta});
    }
    if (event.method === 'item/started' || event.method === 'item/completed') {
      const item = p.item;
      const status = item.status ?? (event.method === 'item/completed' ? 'completed' : 'inProgress');
      if (item.type === 'agentMessage' || item.type === 'plan') this.upsert({id: item.id, role: 'assistant', turnId, phase: item.type === 'plan' ? 'plan' : ['commentary', 'partial_answer', 'final_answer'].includes(item.phase) ? item.phase : undefined, text: item.text ?? '', status});
      else if (item.type === 'commandExecution') this.upsert({id: item.id, role: 'tool', turnId, toolKind: 'command', title: item.command, text: item.aggregatedOutput ?? '', status});
      else if (item.type === 'fileChange') this.upsert({id: item.id, role: 'tool', turnId, toolKind: 'file', title: this.t('文件修改'), text: (item.changes ?? []).map((change: any) => `${change.path}\n${change.diff ?? ''}`).join('\n\n'), status});
      else if (item.type === 'mcpToolCall') this.upsert({id: item.id, role: 'tool', turnId, toolKind: 'mcp', title: `${item.server} / ${item.tool}`, text: item.error ? JSON.stringify(item.error) : item.result ? JSON.stringify(item.result, null, 2) : '', status});
      else if (item.type === 'webSearch') this.upsert({id: item.id, role: 'tool', turnId, toolKind: 'search', title: this.t('搜索网页'), text: item.query ?? item.action?.query ?? '', status});
    }
    if (event.method === 'item/commandExecution/outputDelta') {
      const message = this.session?.messages.find(item => item.id === p.itemId); if (message) message.text = (message.text + p.delta).slice(-100000);
    }
    if (event.method === 'turn/completed') {
      this.bindTurn(p.turn.id); this.finishTurn(p.turn.id, p.turn.status, p.turn.error?.message);
      this.completed.add(p.turn.id); this.busy = false; this.turnId = ''; this.approvals = [];
      this.status = p.turn.status === 'completed' ? '已连接' : p.turn.status === 'interrupted' ? '已停止' : this.t('回复失败：{error}', {error: p.turn.error?.message ?? this.t('未知错误')});
      if (p.turn.status === 'failed') {this.lastError = this.status; this.upsert({id: `error-${p.turn.id}`, role: 'system', turnId: p.turn.id, text: this.status});}
    }
    if (event.method === 'error' && !p.willRetry) this.status = this.lastError = p.error?.message ?? 'Codex 发生错误';
    this.changed(true);
  }
  async dispose() { this.disposed = true; clearTimeout(this.saveTimer); this.rpc.close(); this.listeners.clear(); await this.persist(); }
}
