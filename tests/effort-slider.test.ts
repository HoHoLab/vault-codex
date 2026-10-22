import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {EffortSlider} from '../src/effort-slider';

function setup({reduced = false, count = 5, disabled = false, ultra = 4} = {}) {
  const win = new Window({settings: {device: {prefersReducedMotion: reduced ? 'reduce' : 'no-preference'}}});
  const track = win.document.createElement('div'); win.document.body.append(track);
  Object.defineProperties(track, {clientWidth: {value: 232}, clientHeight: {value: 24}});
  track.getBoundingClientRect = () => new win.DOMRect(100, 40, 232, 24);
  let arcs: number[][] = [], clears = 0;
  const ctx = {globalAlpha: 1, fillStyle: '', setTransform() {},
    clearRect() {arcs = []; clears++;}, fillRect() {}, beginPath() {}, fill() {},
    arc(...args: number[]) {arcs.push(args);}, createLinearGradient() {return {addColorStop() {}};}, createRadialGradient() {return {addColorStop() {}};},
  };
  win.HTMLCanvasElement.prototype.getContext = (() => ctx) as any;
  let frameId = 0, now = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const browserWin = win as unknown as globalThis.Window;
  browserWin.requestAnimationFrame = callback => {frames.set(++frameId, callback); return frameId;};
  browserWin.cancelAnimationFrame = id => {frames.delete(id);};
  const media = win.matchMedia('(prefers-reduced-motion: reduce)');
  win.matchMedia = () => media;
  const changes: number[] = [];
  const control = new EffortSlider(track as unknown as HTMLElement, {
    labels: ['Low', 'Medium', 'High', 'Extra High', 'Ultra'].slice(0, count), index: count === 1 ? 0 : 1,
    ultraIndex: ultra, fast: false, disabled, onChange: index => {changes.push(index);},
  });
  const input = control.input as any;
  const capture = new Set<number>();
  input.setPointerCapture = (id: number) => capture.add(id);
  input.hasPointerCapture = (id: number) => capture.has(id);
  input.releasePointerCapture = (id: number) => capture.delete(id);
  const pointer = (type: string, position: number, extra = {}) => input.dispatchEvent(new win.PointerEvent(type, {pointerId: 1, isPrimary: true, button: 0, clientX: 113 + 206 * position, clientY: 52, bubbles: true, cancelable: true, ...extra}));
  const advance = (ms: number, fps = 60) => {
    for (let i = 0; i < Math.ceil(ms / (1000 / fps)); i++) {
      now += 1000 / fps;
      const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now));
    }
  };
  return {win, track, control, input, changes, frames, pointer, advance, capture,
    get position() {return Number(track.style.getPropertyValue('--effort-position'));},
    get arcs() {return arcs;}, get clears() {return clears;},
    reduce() {win.happyDOM.settings.device.prefersReducedMotion = 'reduce'; media.dispatchEvent(new win.Event('change'));},
    async close() {control.destroy(); await win.happyDOM.close();},
  };
}

test('clicking a dot commits once on release and smoothly moves to the selected tier', async () => {
  const e = setup();
  try {
    e.pointer('pointerdown', .5); assert.equal(e.position, .25); assert.deepEqual(e.changes, []);
    e.pointer('pointerup', .5);
    assert.equal(e.input.value, '2'); assert.equal(e.input.getAttribute('aria-valuetext'), 'High');
    assert.equal(e.position, .25, 'selection must animate from the previous position');
    e.advance(50); assert.ok(e.position > .25 && e.position < .5);
    e.advance(700); assert.equal(e.position, .5); assert.equal(e.capture.size, 0); assert.deepEqual(e.changes, [2]);
    e.pointer('pointerdown', .5); e.pointer('pointerup', .5); assert.deepEqual(e.changes, [2]);
  } finally {await e.close();}
});

test('empty track space cannot select a tier or start native dragging', async () => {
  const e = setup();
  try {
    for (const position of [0.125, .375, .625, .875, -1, 2]) {
      assert.equal(e.pointer('pointerdown', position), false, 'native range behavior must be prevented');
      e.pointer('pointerup', position);
    }
    e.pointer('pointerdown', .5, {clientY: 41}); e.pointer('pointerup', .5, {clientY: 41});
    e.pointer('pointerdown', .625); e.pointer('pointermove', .75); e.pointer('pointerup', .75);
    e.advance(700); assert.equal(e.position, .25); assert.equal(e.input.value, '1'); assert.deepEqual(e.changes, []);
  } finally {await e.close();}
});

test('dragging from a dot or thumb never selects, even if it returns to the starting dot', async () => {
  const e = setup();
  try {
    e.pointer('pointerdown', .25); e.pointer('pointermove', .75); e.pointer('pointerup', .75);
    e.pointer('pointerdown', .5); e.pointer('pointermove', 1); e.pointer('pointermove', .5); e.pointer('pointerup', .5);
    e.pointer('pointerdown', .75); e.pointer('pointerup', 1);
    e.advance(700); assert.equal(e.position, .25); assert.deepEqual(e.changes, []); assert.equal(e.capture.size, 0);
  } finally {await e.close();}
});

test('cancelled clicks, lost capture, secondary buttons and unrelated pointers do not select', async () => {
  const e = setup();
  try {
    for (const event of ['pointercancel', 'lostpointercapture']) {
      e.pointer('pointerdown', .5); e.pointer(event, .5); e.pointer('pointerup', .5);
    }
    for (const extra of [{button: 2}, {isPrimary: false}]) {
      e.pointer('pointerdown', .5, extra); e.pointer('pointerup', .5, extra);
    }
    e.pointer('pointerdown', .5); e.pointer('pointermove', 1, {pointerId: 2}); e.pointer('pointerup', 1, {pointerId: 2});
    assert.deepEqual(e.changes, []);
    e.pointer('pointerup', .5); e.advance(700); assert.equal(e.position, .5); assert.deepEqual(e.changes, [2]);
  } finally {await e.close();}
});

test('dot targets allow small tap imprecision and respect preview scaling', async () => {
  for (const scale of [1, 1.5]) {
    const e = setup();
    try {
      e.track.getBoundingClientRect = () => new e.win.DOMRect(100, 40, 232 * scale, 24 * scale);
      e.pointer('pointerdown', 0, {clientX: 100 + (13 + 103 + 6) * scale, clientY: 40 + 12 * scale, pointerType: 'touch'});
      e.pointer('pointerup', 0, {clientX: 100 + (13 + 103 + 8) * scale, clientY: 40 + 12 * scale, pointerType: 'touch'});
      e.advance(700); assert.equal(e.position, .5); assert.deepEqual(e.changes, [2]);
    } finally {await e.close();}
  }
});

test('native range input and reset settle monotonically at both 60 and 120 Hz', async () => {
  for (const fps of [60, 120]) {
    const e = setup();
    try {
      e.input.value = '4'; e.input.dispatchEvent(new e.win.Event('input'));
      let previous = e.position;
      for (let i = 0; i < fps; i++) {e.advance(1000 / fps, fps); assert.ok(e.position >= previous && e.position <= 1); previous = e.position;}
      assert.equal(e.position, 1); assert.deepEqual(e.changes, [4]);
      e.control.select(1); e.advance(700, fps); assert.equal(e.position, .25); assert.equal(e.input.getAttribute('aria-valuetext'), 'Medium');
    } finally {await e.close();}
  }
});

test('Fast animates ordinary tiers, disabling it settles to idle, and Ultra stays animated independently', async () => {
  const e = setup();
  try {
    e.advance(500); assert.equal(e.frames.size, 0); assert.equal(e.arcs.length, 0);
    e.control.setFast(true); e.advance(500);
    assert.equal(e.frames.size, 1); assert.ok(e.arcs.length > 0);
    const x = e.arcs[1][0]; e.advance(100); assert.ok(e.arcs[1][0] < x, 'Fast particles should flow left instead of reversing');
    e.control.setFast(false); e.advance(1500); assert.equal(e.frames.size, 0); assert.equal(e.arcs.length, 0);
    e.control.select(4); e.advance(700); assert.equal(e.frames.size, 1); assert.ok(e.arcs.length > 0);
    e.control.setFast(true); e.advance(500); e.control.setFast(false); e.advance(700);
    assert.equal(e.frames.size, 1); assert.ok(e.arcs.length > 0);
  } finally {await e.close();}
});

test('reduced motion renders static effects without a frame loop, including changing the preference mid-animation', async () => {
  for (const initiallyReduced of [true, false]) {
    const e = setup({reduced: initiallyReduced});
    try {
      e.control.setFast(true); e.control.select(4); e.advance(100);
      if (!initiallyReduced) e.reduce();
      assert.equal(e.position, 1); assert.equal(e.frames.size, 0); assert.ok(e.arcs.length > 0);
      const paints = e.clears; e.advance(1000); assert.equal(e.clears, paints);
      e.control.select(1); assert.equal(e.position, .25); assert.equal(e.frames.size, 0);
    } finally {await e.close();}
  }
});

test('single-option and disabled sliders ignore pointer interaction; disposal stops rendering and listeners', async () => {
  for (const options of [{count: 1, ultra: -1}, {disabled: true}]) {
    const e = setup(options);
    try {
      const initial = e.position; assert.equal(e.input.disabled, true);
      e.pointer('pointerdown', .9); e.pointer('pointermove', 1); assert.equal(e.position, initial); assert.deepEqual(e.changes, []);
    } finally {await e.close();}
  }
  const e = setup();
  try {
    e.control.setFast(true); e.advance(200); e.control.destroy();
    const paints = e.clears; e.advance(1000); assert.equal(e.frames.size, 0); assert.equal(e.clears, paints);
    e.pointer('pointerdown', .9); e.input.value = '4'; e.input.dispatchEvent(new e.win.Event('input'));
    assert.deepEqual(e.changes, []); assert.equal(e.frames.size, 0);
  } finally {await e.close();}
});
