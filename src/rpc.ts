import {defaultTranslate, type Translate} from './i18n';
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {access, readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {join, delimiter} from 'node:path';
import {CLIENT_INFO} from './plugin-info';

export interface RpcEvent { method: string; params: any; id?: string | number; }
interface Pending { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; }
export class CodexRpc {
  constructor(private readonly t: Translate = defaultTranslate) {}
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(event: RpcEvent) => void>();
  private sequence = 0;
  private connecting?: Promise<void>;
  ready = false;
  onEvent(listener: (event: RpcEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(event: RpcEvent) { for (const listener of this.listeners) listener(event); }
  async connect(command: string, cwd: string, args = ['app-server', '--listen', 'stdio://']) {
    if (this.ready) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.start(command, cwd, args).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private async start(command: string, cwd: string, args: string[]) {
    const child = spawn(command, args, {cwd, env: process.env, shell: false, windowsHide: true, stdio: 'pipe'});
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    // Drain stderr without copying potentially sensitive diagnostics into notes or logs.
    child.stderr.on('data', () => {});
    const fail = (error: Error) => {
      if (this.child !== child) return;
      this.ready = false; this.child = undefined;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
      this.pending.clear(); this.emit({method: 'connection/closed', params: {message: error.message}});
    };
    child.on('error', error => fail(new Error(this.t('无法启动 Codex：{error}', {error: error.message}))));
    child.stdin.on('error', error => fail(new Error(this.t('Codex 连接中断：{error}', {error: error.message}))));
    child.on('exit', (code, signal) => fail(new Error(this.t('Codex 已退出（{code}）。请重新连接。', {code: signal ?? code ?? this.t('未知')}))));
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return;
      buffer += chunk;
      if (buffer.length > 32 * 1024 * 1024) { fail(new Error(this.t('Codex 消息过大，连接已关闭。'))); child.kill(); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message: any;
        try { message = JSON.parse(line); } catch { fail(new Error(this.t('Codex 返回了无效的协议消息。'))); child.kill(); return; }
        if (message.method) this.emit(message);
        else if (typeof message.id === 'number') {
          const request = this.pending.get(message.id);
          if (!request) continue;
          this.pending.delete(message.id); clearTimeout(request.timer);
          if (message.error) request.reject(new Error(message.error.message ?? this.t('Codex 请求失败')));
          else request.resolve(message.result);
        }
      }
    });
    try {
      await this.request('initialize', {clientInfo: CLIENT_INFO}, 20000);
      this.notify('initialized', {}); this.ready = true;
    } catch (error) { if (this.child === child) this.close(); throw error; }
  }
  request<T = any>(method: string, params: unknown, timeout = 60000): Promise<T> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(this.t('{method} 请求超时。请检查连接后重试。', {method}))); }, timeout);
      this.pending.set(id, {resolve, reject, timer});
      try { this.write({id, method, params}); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  notify(method: string, params: unknown) { this.write({method, params}); }
  respond(id: string | number, result: unknown) { this.write({id, result}); }
  reject(id: string | number, message: string) { this.write({id, error: {code: -32601, message}}); }
  private write(message: unknown) {
    if (!this.child?.stdin.writable) throw new Error(this.t('尚未连接 Codex。'));
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  close() {
    const child = this.child; this.child = undefined; this.ready = false;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error(this.t('Codex 连接已关闭。'))); }
    this.pending.clear();
    if (child) {
      child.stdin.end(); child.kill('SIGTERM');
      const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000);
      timer.unref();
    }
  }
}
export async function findCodex(configured: string, t: Translate = defaultTranslate): Promise<string> {
  const candidates: string[] = [];
  if (configured.trim()) candidates.push(configured.trim().replace(/^~(?=[/\\])/, homedir()));
  else {
    const executable = process.platform === 'win32' ? 'codex.exe' : 'codex';
    for (const directory of (process.env.PATH ?? '').split(delimiter)) if (directory) candidates.push(join(directory, executable));
    candidates.push('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', '/Applications/Codex.app/Contents/Resources/codex', '/opt/homebrew/bin/codex', '/usr/local/bin/codex', join(homedir(), '.local/bin/codex'), join(homedir(), '.cargo/bin/codex'));
    try { for (const version of (await readdir(join(homedir(), '.nvm/versions/node'))).reverse()) candidates.push(join(homedir(), '.nvm/versions/node', version, 'bin/codex')); } catch { /* optional installation */ }
  }
  for (const candidate of candidates) { try { await access(candidate, constants.X_OK); return candidate; } catch { /* try next */ } }
  throw new Error(t('找不到 Codex。请安装 Codex CLI，或在插件设置中填写 Codex 可执行文件的完整路径。'));
}
