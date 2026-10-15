import {setTimeout, clearTimeout} from 'node:timers';

// Render scheduling is process-local; dispose cancels it when the owning view closes.
interface RenderRequest {text: string; streaming: boolean; key: string;}

// Serialize async Markdown renders and coalesce token bursts. The visible body
// stays in place until its replacement is ready; late work cannot overwrite a
// newer revision or a closed view.
export class StreamRenderer<T> {
  private desired?: RenderRequest;
  private applied = '';
  private running = false;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private render: (text: string) => Promise<T>, private commit: (value: T) => void, private discard: (value: T) => void, private delay = 100) {}
  update(text: string, streaming: boolean) {
    const request = {text, streaming, key: `${text}\0${streaming}`};
    if (this.disposed || request.key === this.desired?.key) return;
    this.desired = request;
    if (!this.running) this.schedule(streaming ? this.delay : 0);
  }
  dispose() {this.disposed = true; clearTimeout(this.timer);}
  private schedule(delay: number) {
    if (this.timer && delay) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {this.timer = undefined; void this.flush();}, delay);
  }
  private async flush() {
    const request = this.desired;
    if (this.disposed || this.running || !request) return;
    this.running = true;
    try {
      const value = await this.render(request.text);
      if (!this.disposed && (this.desired?.key === request.key || this.desired?.text.startsWith(request.text))) this.commit(value);
      else this.discard(value);
      this.applied = request.key;
    } catch {
      // A failed renderer must not spin forever or clear a previously good body.
      // The Obsidian adapter itself provides a plain-text fallback.
      this.applied = request.key;
    } finally {
      this.running = false;
      if (!this.disposed && this.desired?.key !== this.applied) this.schedule(this.desired?.streaming ? this.delay : 0);
    }
  }
}
