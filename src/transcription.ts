import {defaultTranslate, type Translate} from './i18n';
import {randomUUID} from 'node:crypto';
import {PLUGIN_VERSION} from './plugin-info';

const TRANSCRIBE_URL = 'https://chatgpt.com/backend-api/transcribe';
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
interface AuthStatus {authMethod: string | null; authToken: string | null;}
export interface VoiceRpc {request<T = any>(method: string, params: unknown): Promise<T>;}
export interface VoiceRequest {url: string; method: string; headers: Record<string, string>; body: ArrayBuffer; throw: boolean;}
export interface VoiceResponse {status: number; text: string;}
export type VoiceTransport = (request: VoiceRequest) => Promise<VoiceResponse>;

export class TranscriptionError extends Error {
  constructor(message: string, public status?: number) {super(message); this.name = 'TranscriptionError';}
}

function abortError() {return new DOMException(defaultTranslate('已取消语音输入。'), 'AbortError');}
function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? abortError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? abortError());
    signal.addEventListener('abort', abort, {once: true});
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function accountId(token: string): string | undefined {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    const id = claims['https://api.openai.com/auth']?.chatgpt_account_id;
    return typeof id === 'string' && id.length < 512 ? id : undefined;
  } catch {return undefined;}
}

export class CodexTranscriber {
  constructor(private rpc: VoiceRpc, private transport: VoiceTransport, private timeoutMs = 60000, private readonly t: Translate = defaultTranslate) {}
  async transcribe(audio: ArrayBuffer, mimeType: string, cancel?: AbortSignal): Promise<string> {
    if (audio.byteLength === 0) throw new TranscriptionError(this.t('没有录到音频，请重试。'));
    if (audio.byteLength > MAX_AUDIO_BYTES) throw new TranscriptionError(this.t('录音超过 25 MB，请缩短录音。'));
    const type = mimeType.split(';')[0].trim().toLowerCase();
    const extensions: Record<string, string> = {'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3'};
    if (!extensions[type]) throw new TranscriptionError(this.t('当前录音格式不受支持。'));
    const timeout = new AbortController();
    const signal = cancel ? AbortSignal.any([cancel, timeout.signal]) : timeout.signal;
    const timer = setTimeout(() => timeout.abort(new TranscriptionError(this.t('语音转写超时，请重试。'))), this.timeoutMs);
    try {
      signal.throwIfAborted();
      const boundary = `----vault-codex-${randomUUID()}`;
      const bytes = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="dictation.${extensions[type]}"\r\nContent-Type: ${type}\r\n\r\n`),
        Buffer.from(audio), Buffer.from(`\r\n--${boundary}--\r\n`)
      ]);
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      for (let attempt = 0; attempt < 2; attempt++) {
        const auth = await waitWithSignal(this.rpc.request<AuthStatus>('getAuthStatus', {includeToken: true, refreshToken: attempt > 0}), signal);
        if (auth.authMethod !== 'chatgpt' || !auth.authToken) throw new TranscriptionError(this.t('语音输入需要本机 Codex 登录 ChatGPT；API Key 登录不能复用这项听写服务。'));
        // Keep the credential in this request only. Never put it in settings,
        // logs, notes, arbitrary URLs, or a response shown to the user.
        const headers: Record<string, string> = {
          Authorization: `Bearer ${auth.authToken}`, originator: 'codex_obsidian',
          'User-Agent': `VaultCodex/${PLUGIN_VERSION}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`
        };
        const id = accountId(auth.authToken); if (id) headers['ChatGPT-Account-Id'] = id;
        signal.throwIfAborted();
        const response = await waitWithSignal(this.transport({url: TRANSCRIBE_URL, method: 'POST', headers, body, throw: false}), signal);
        if (response.status === 401 && attempt === 0) continue;
        if (response.status < 200 || response.status >= 300) {
          const errors: Record<number, string> = {401: this.t('Codex 登录已失效，请重新登录 ChatGPT。'), 403: this.t('转写服务拒绝了请求，请确认当前账户可以使用桌面端听写。'), 413: this.t('录音过大，请缩短后重试。'), 429: this.t('语音转写暂时达到使用限制，请稍后重试。')};
          throw new TranscriptionError(errors[response.status] ?? this.t('语音转写服务暂时不可用（{status}）。', {status: response.status}), response.status);
        }
        let result: unknown;
        try {result = JSON.parse(response.text);} catch {throw new TranscriptionError(this.t('转写服务返回了无法识别的结果。'));}
        const text = (result as {text?: unknown} | null)?.text;
        if (typeof text !== 'string') throw new TranscriptionError(this.t('转写服务没有返回文字。'));
        if (!text.trim()) throw new TranscriptionError(this.t('没有识别到语音，请靠近麦克风后重试。'));
        signal.throwIfAborted(); return text.trim();
      }
      throw new TranscriptionError(this.t('Codex 登录已失效，请重新登录 ChatGPT。'));
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? abortError();
      if (error instanceof TranscriptionError) throw error;
      // Transport errors may contain headers or server diagnostics.
      throw new TranscriptionError(this.t('无法连接语音转写服务，请检查网络和 Codex 登录状态。'));
    } finally {clearTimeout(timer);}
  }
}
