import {defaultTranslate, type Translate} from './i18n';
import {isRecord} from './protocol';
import {MAX_AUDIO_BYTES} from './transcription';

export type DictationPhase = 'idle' | 'starting' | 'recording' | 'transcribing';
export interface DictationState {phase: DictationPhase; seconds: number; level: number;}
interface DictationCallbacks {
  prepare: () => Promise<void>;
  transcribe: (audio: ArrayBuffer, mime: string, signal: AbortSignal) => Promise<string>;
  state: (state: DictationState) => void;
  text: (text: string) => void;
  error: (message: string) => void;
}

export class Dictation {
  phase: DictationPhase = 'idle';
  private generation = 0;
  private disposed = false;
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private context?: AudioContext;
  private meter?: AnalyserNode;
  private samples?: Uint8Array<ArrayBuffer>;
  private timer?: number;
  private cancelRequest?: AbortController;
  private seconds = 0;
  private level = 0;
  constructor(private browser: Window & Pick<typeof window, 'MediaRecorder' | 'AudioContext' | 'Blob'>, private callbacks: DictationCallbacks, private readonly t: Translate = defaultTranslate) {}
  private changed(phase = this.phase) {this.phase = phase; if (!this.disposed) this.callbacks.state({phase, seconds: this.seconds, level: this.level});}
  async start() {
    if (this.phase !== 'idle' || this.disposed) return;
    const generation = ++this.generation;
    const current = () => generation === this.generation && !this.disposed;
    this.seconds = 0; this.level = 0; this.changed('starting');
    try {
      if (!this.browser.navigator.mediaDevices?.getUserMedia || !this.browser.MediaRecorder) throw new Error(this.t('当前 Obsidian 环境没有提供录音接口，请使用桌面版或系统听写。'));
      await this.callbacks.prepare(); if (!current()) return;
      const stream = await this.browser.navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
      if (!current()) {for (const track of stream.getTracks()) track.stop(); return;}
      this.stream = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => this.browser.MediaRecorder.isTypeSupported(type));
      const recorder = new this.browser.MediaRecorder(stream, mimeType ? {mimeType} : undefined); this.recorder = recorder;
      const chunks: Blob[] = []; let bytes = 0;
      recorder.ondataavailable = event => {
        if (!current() || !event.data.size) return;
        chunks.push(event.data); bytes += event.data.size;
        if (bytes > MAX_AUDIO_BYTES) {this.cancel(); this.callbacks.error(this.t('录音超过 25 MB，请缩短后重试。'));}
      };
      recorder.onerror = () => {if (current()) {this.cancel(); this.callbacks.error(this.t('录音中断，请检查麦克风设备后重试。'));}};
      recorder.onstop = () => {
        if (!current()) return;
        const mime = recorder.mimeType || mimeType || chunks[0]?.type || 'audio/webm';
        this.recorder = undefined; this.releaseMedia(); this.level = 0; this.changed('transcribing');
        const cancellation = new AbortController(); this.cancelRequest = cancellation;
        const blob = new this.browser.Blob(chunks, {type: mime});
        void blob.arrayBuffer().then(audio => {
          if (!current()) throw new DOMException(this.t('已取消'), 'AbortError');
          return this.callbacks.transcribe(audio, mime, cancellation.signal);
        }).then(text => {
          if (!current()) return; this.cancelRequest = undefined; this.changed('idle'); this.callbacks.text(text);
        }).catch((error: unknown) => {
          if (!current()) return; this.cancelRequest = undefined; this.changed('idle');
          if (!(isRecord(error) && error.name === 'AbortError')) this.callbacks.error(error instanceof Error ? error.message : this.t('语音转写失败，请重试。'));
        });
      };
      // Audio metering is optional; failure must not prevent recording.
      try {
        this.context = new this.browser.AudioContext();
        this.meter = this.context.createAnalyser(); this.meter.fftSize = 256;
        this.context.createMediaStreamSource(stream).connect(this.meter);
        this.samples = new Uint8Array(new ArrayBuffer(this.meter.fftSize));
        void this.context.resume().catch(() => {});
      } catch {this.meter = undefined; this.samples = undefined;}
      recorder.start(500); const startedAt = Date.now(); this.changed('recording');
      this.timer = this.browser.setInterval(() => {
        if (!current()) return;
        this.seconds = Math.floor((Date.now() - startedAt) / 1000);
        if (this.meter && this.samples) {
          this.meter.getByteTimeDomainData(this.samples); let sum = 0;
          for (const value of this.samples) sum += ((value - 128) / 128) ** 2;
          this.level = Math.min(1, Math.sqrt(sum / this.samples.length) * 6);
        }
        this.changed(); if (this.seconds >= 120) this.stop();
      }, 100);
    } catch (error) {
      if (!current()) return; this.cancel();
      const name = error instanceof Error ? error.name : '';
      const reasons: Record<string, string> = {NotAllowedError: this.t('麦克风访问未获授权。请在系统设置中允许 Obsidian 使用麦克风。'), NotFoundError: this.t('没有找到麦克风，请连接设备后重试。'), NotReadableError: this.t('无法读取麦克风，设备可能正被其他应用占用。')};
      this.callbacks.error(reasons[name] ?? (error instanceof Error ? error.message : this.t('无法开始录音。')));
    }
  }
  stop() {if (this.phase === 'recording' && this.recorder?.state === 'recording') this.recorder.stop();}
  cancel() {
    ++this.generation; this.cancelRequest?.abort(); this.cancelRequest = undefined;
    const recorder = this.recorder; this.recorder = undefined;
    if (recorder && recorder.state !== 'inactive') {try {recorder.stop();} catch {/* The recorder may already be stopped after a device error. */}}
    this.releaseMedia(); this.seconds = 0; this.level = 0; this.changed('idle');
  }
  private releaseMedia() {
    this.browser.clearInterval(this.timer); this.timer = undefined;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    const context = this.context; this.context = undefined; this.meter = undefined; this.samples = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
  dispose() {this.disposed = true; this.cancel();}
}

export function appendTranscript(draft: string, transcript: string) {
  return draft + (draft.length && !/\s$/.test(draft) ? '\n' : '') + transcript;
}
