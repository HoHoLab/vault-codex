interface EffortSliderOptions {
  labels: string[];
  index: number;
  ultraIndex: number;
  fast: boolean;
  disabled: boolean;
  onChange: (index: number) => void;
}
interface Particle {x: number; y: number; radius: number; speed: number; phase: number;}
interface Press {pointerId: number; index: number; x: number; y: number; scale: number; moved: boolean;}
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** Dot clicks and keyboard choices share one smooth visual clock. */
export class EffortSlider {
  readonly input: HTMLInputElement;
  private readonly win: Window;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly dots: HTMLElement[];
  private readonly motion: MediaQueryList;
  private readonly resizeObserver?: ResizeObserver;
  private readonly particles: Particle[];
  private index: number;
  private position: number;
  private target: number;
  private velocity = 0;
  private fast: boolean;
  private press?: Press;
  private frame?: number;
  private lastTime = 0;
  private elapsed = 0;
  private width = 0;
  private height = 24;
  private particleAlpha: number;
  private auroraAlpha: number;
  private speed: number;
  private disposed = false;

  constructor(private track: HTMLElement, private options: EffortSliderOptions) {
    this.win = track.ownerDocument.defaultView!;
    this.motion = this.win.matchMedia('(prefers-reduced-motion: reduce)');
    this.index = clamp(options.index, 0, options.labels.length - 1);
    this.position = this.target = this.positionFor(this.index);
    this.fast = options.fast;
    this.particleAlpha = this.hasParticles ? 1 : 0;
    this.auroraAlpha = this.isUltra ? 1 : 0;
    this.speed = this.fast ? .48 : .004;
    const doc = track.ownerDocument;
    const fill = doc.createElement('div'); fill.className = 'codex-slider-fill'; fill.setAttribute('aria-hidden', 'true');
    this.canvas = doc.createElement('canvas'); this.canvas.className = 'codex-slider-effects'; fill.append(this.canvas);
    this.context = this.canvas.getContext('2d');
    const dots = doc.createElement('div'); dots.className = 'codex-slider-dots'; dots.setAttribute('aria-hidden', 'true');
    this.dots = options.labels.map(() => {const dot = doc.createElement('span'); dots.append(dot); return dot;});
    this.input = doc.createElement('input'); this.input.className = 'codex-effort-slider'; this.input.type = 'range';
    this.input.min = '0'; this.input.max = String(options.labels.length - 1); this.input.step = '1';
    this.input.disabled = options.disabled || options.labels.length === 1;
    const thumb = doc.createElement('span'); thumb.className = 'codex-slider-thumb'; thumb.setAttribute('aria-hidden', 'true');
    track.append(fill, dots, this.input, thumb);
    // Deterministic, irregular spacing; particles wrap outside the clipped track instead of reversing.
    this.particles = Array.from({length: 22}, (_, i) => ({
      x: (i * .61803398875) % 1, y: .16 + ((i * .41421356237) % 1) * .68,
      radius: i % 6 === 0 ? 1.2 : .5 + (i % 4) * .13, speed: .8 + (i % 7) * .065, phase: i * 2.39996,
    }));
    this.updateValue();
    this.input.addEventListener('pointerdown', this.pointerDown);
    this.input.addEventListener('pointermove', this.pointerMove);
    this.input.addEventListener('pointerleave', this.pointerLeave);
    this.input.addEventListener('pointerup', this.pointerUp);
    this.input.addEventListener('pointercancel', this.pointerCancel);
    this.input.addEventListener('lostpointercapture', this.captureLost);
    this.input.addEventListener('input', this.inputChanged);
    this.motion.addEventListener('change', this.motionChanged);
    doc.addEventListener('visibilitychange', this.visibilityChanged);
    const Resize = (this.win as Window & typeof globalThis).ResizeObserver;
    if (Resize) {this.resizeObserver = new Resize(this.resize); this.resizeObserver.observe(track);}
    this.resize();
  }

  private get isUltra() {return this.index === this.options.ultraIndex;}
  private get hasParticles() {return this.fast || this.isUltra;}
  private positionFor(index: number) {return this.options.labels.length === 1 ? 1 : index / (this.options.labels.length - 1);}

  select(index: number) {
    if (this.disposed) return;
    this.finishPress();
    this.changeIndex(clamp(Math.round(index), 0, this.options.labels.length - 1));
    this.target = this.positionFor(this.index);
    this.invalidate();
  }
  setFast(fast: boolean) {if (!this.disposed) {this.fast = fast; this.invalidate();}}

  private changeIndex(index: number) {
    const changed = index !== this.index;
    this.index = index; this.updateValue();
    if (changed) this.options.onChange(index);
  }
  private updateValue() {
    this.input.value = String(this.index);
    this.input.setAttribute('aria-valuetext', this.options.labels[this.index]);
    this.dots.forEach((dot, index) => dot.classList.toggle('is-passed', index <= this.index));
  }

  private hitIndex(clientX: number, clientY: number) {
    const rect = this.track.getBoundingClientRect();
    if (!rect.width || !rect.height || this.width <= 26) return;
    const x = (clientX - rect.left) * this.width / rect.width;
    const y = (clientY - rect.top) * this.height / rect.height;
    const index = clamp(Math.round((x - 13) / (this.width - 26) * (this.options.labels.length - 1)), 0, this.options.labels.length - 1);
    const center = 13 + (this.width - 26) * this.positionFor(index);
    // Give each 4 px dot a forgiving circular target, leaving the gaps inactive.
    if (Math.hypot(x - center, y - this.height / 2) <= 10) return index;
  }
  private pointerDown = (event: PointerEvent) => {
    if (this.disposed || this.input.disabled) return;
    // Suppress the native range's track clicks and drag behavior, including empty gaps.
    event.preventDefault();
    if (this.press || !event.isPrimary || event.button !== 0) return;
    const index = this.hitIndex(event.clientX, event.clientY);
    if (index === undefined) return;
    this.input.focus({preventScroll: true});
    this.press = {pointerId: event.pointerId, index, x: event.clientX, y: event.clientY,
      scale: this.track.getBoundingClientRect().width / this.width, moved: false};
    this.input.setPointerCapture(event.pointerId);
  };
  private pointerMove = (event: PointerEvent) => {
    if (this.disposed || this.input.disabled) return;
    this.track.classList.toggle('is-dot-hovered', this.hitIndex(event.clientX, event.clientY) !== undefined);
    if (event.pointerId === this.press?.pointerId) this.checkMovement(event);
  };
  private pointerLeave = () => {this.track.classList.remove('is-dot-hovered');};
  private checkMovement(event: PointerEvent) {
    if (this.press && Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > 5 * this.press.scale) this.press.moved = true;
  }
  private pointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.press?.pointerId) return;
    this.checkMovement(event);
    const press = this.press;
    const index = this.hitIndex(event.clientX, event.clientY);
    this.finishPress();
    if (!press.moved && index === press.index) this.select(index);
  };
  private pointerCancel = (event: PointerEvent) => {
    if (event.pointerId === this.press?.pointerId) this.finishPress();
  };
  private captureLost = (event: PointerEvent) => {
    if (event.pointerId === this.press?.pointerId) this.finishPress();
  };
  private finishPress() {
    const press = this.press; if (!press) return;
    this.press = undefined;
    if (this.input.hasPointerCapture(press.pointerId)) this.input.releasePointerCapture(press.pointerId);
  }
  private inputChanged = () => {if (!this.input.disabled && !this.press) this.select(Number(this.input.value));};

  private resize = () => {
    if (this.disposed) return;
    this.width = this.track.clientWidth; this.height = this.track.clientHeight || 24;
    const dpr = Math.min(this.win.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(this.width * dpr); this.canvas.height = Math.round(this.height * dpr);
    this.context?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.paintPosition(); this.draw(); this.invalidate();
  };
  private paintPosition() {
    this.track.style.setProperty('--effort-position', String(this.position));
    this.track.style.setProperty('--effort-offset', `${Math.max(0, this.width - 26) * this.position}px`);
  }
  private motionChanged = () => {this.stopFrame(); this.invalidate();};
  private visibilityChanged = () => {
    if (this.track.ownerDocument.hidden) this.stopFrame(); else this.invalidate();
  };
  private invalidate() {
    if (this.disposed) return;
    if (this.motion.matches) {
      this.position = this.target; this.velocity = 0;
      this.particleAlpha = this.hasParticles ? 1 : 0; this.auroraAlpha = this.isUltra ? 1 : 0;
      this.paintPosition(); this.draw(); return;
    }
    if (this.frame === undefined && !this.track.ownerDocument.hidden) this.frame = this.win.requestAnimationFrame(this.tick);
  }
  private stopFrame() {if (this.frame !== undefined) this.win.cancelAnimationFrame(this.frame); this.frame = undefined; this.lastTime = 0;}
  private tick = (time: number) => {
    this.frame = undefined;
    if (this.disposed) return;
    const dt = this.lastTime ? Math.min((time - this.lastTime) / 1000, .04) : 1 / 60;
    this.lastTime = time; this.elapsed += dt;
    // Analytic critically damped spring: stable at any refresh rate, with no endpoint overshoot.
    const omega = 30, offset = this.position - this.target, decay = Math.exp(-omega * dt);
    const step = (this.velocity + omega * offset) * dt;
    this.position = this.target + (offset + step) * decay;
    this.velocity = (this.velocity - omega * step) * decay;
    if (Math.abs(this.position - this.target) < .0001 && Math.abs(this.velocity) < .003) {this.position = this.target; this.velocity = 0;}
    this.paintPosition();
    const blend = 1 - Math.exp(-dt / .12);
    this.particleAlpha += ((this.hasParticles ? 1 : 0) - this.particleAlpha) * blend;
    this.auroraAlpha += ((this.isUltra ? 1 : 0) - this.auroraAlpha) * blend;
    this.speed += ((this.fast ? .48 : .004) - this.speed) * (1 - Math.exp(-dt / .18));
    for (const particle of this.particles) {
      particle.x -= this.speed * particle.speed * dt;
      if (particle.x < -.025) particle.x += 1.05;
    }
    this.draw();
    if (this.hasParticles || this.particleAlpha > .002 || this.auroraAlpha > .002 || this.position !== this.target || this.velocity !== 0) this.invalidate();
    else {this.particleAlpha = this.auroraAlpha = 0; this.lastTime = 0; this.draw();}
  };

  private draw() {
    const ctx = this.context, w = this.width, h = this.height; if (!ctx || !w) return;
    ctx.clearRect(0, 0, w, h);
    if (this.auroraAlpha > .001) {
      ctx.globalAlpha = this.auroraAlpha;
      const base = ctx.createLinearGradient(0, 0, w, 0);
      base.addColorStop(0, '#3549d5'); base.addColorStop(.46, '#8755f6'); base.addColorStop(1, '#8250f0');
      ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
      const t = this.elapsed;
      const glows: [number, number, number, string][] = [
        [.55 + Math.sin(t * .71) * .14, .3 + Math.cos(t * .57) * .7, .44, 'rgba(211,145,255,.67)'],
        [.78 + Math.cos(t * .53 + 1) * .12, .7 + Math.sin(t * .83) * .8, .38, 'rgba(169,98,255,.48)'],
        [.16 + Math.sin(t * .47 + 2) * .12, .5, .33, 'rgba(73,112,248,.36)'],
      ];
      for (const [x, y, radius, color] of glows) {
        const glow = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, radius * w);
        glow.addColorStop(0, color); glow.addColorStop(1, 'rgba(128,80,240,0)');
        ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
      }
    }
    if (this.particleAlpha > .001) for (const particle of this.particles) {
      const edge = clamp(Math.min(particle.x / .035, (1 - particle.x) / .035));
      const shimmer = .52 + .16 * Math.sin(this.elapsed * 1.3 + particle.phase);
      ctx.globalAlpha = this.particleAlpha * shimmer * edge;
      ctx.fillStyle = '#fff'; ctx.beginPath();
      ctx.arc(particle.x * w, particle.y * h + Math.sin(this.elapsed * .9 + particle.phase) * 1.5, particle.radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  destroy() {
    this.disposed = true; this.stopFrame(); this.finishPress(); this.pointerLeave();
    this.resizeObserver?.disconnect(); this.motion.removeEventListener('change', this.motionChanged);
    this.track.ownerDocument.removeEventListener('visibilitychange', this.visibilityChanged);
    this.input.removeEventListener('pointerdown', this.pointerDown); this.input.removeEventListener('pointermove', this.pointerMove);
    this.input.removeEventListener('pointerleave', this.pointerLeave);
    this.input.removeEventListener('pointerup', this.pointerUp); this.input.removeEventListener('pointercancel', this.pointerCancel);
    this.input.removeEventListener('lostpointercapture', this.captureLost); this.input.removeEventListener('input', this.inputChanged);
  }
}
