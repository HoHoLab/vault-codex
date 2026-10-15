import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantPreferences, shouldSend, shouldAutoScroll, VAULT_INSTRUCTIONS} from '../src/preferences';
import {DEFAULT_SETTINGS, normalizeSettings} from '../src/types';

test('old settings retain their account and permissions while new preferences receive safe defaults', () => {
  const legacy = normalizeSettings({executable: '/custom/codex', model: 'custom-model', access: 'read-only', autoConnect: true});
  assert.equal(legacy.executable, '/custom/codex'); assert.equal(legacy.model, 'custom-model'); assert.equal(legacy.access, 'read-only');
  assert.equal(legacy.language, 'auto'); assert.equal(legacy.sendMode, 'enter'); assert.equal(legacy.panelPlacement, 'right-sidebar');
  assert.equal(legacy.autoScroll, true); assert.equal(legacy.customInstructions, ''); assert.equal(legacy.responseVerbosity, 'default');
  assert.deepEqual(normalizeSettings({language: 'unknown', sendMode: 'wrong', panelPlacement: null, autoScroll: 'false', customInstructions: {}, responseVerbosity: 'ultra'}), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
});

test('send shortcuts respect platform modifiers, newlines, and IME composition', () => {
  const enter = {key: 'Enter', keyCode: 13, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false};
  assert.equal(shouldSend(enter, 'enter', true), true);
  assert.equal(shouldSend(enter, 'mod-enter', true), false);
  assert.equal(shouldSend({...enter, metaKey: true}, 'mod-enter', true), true);
  assert.equal(shouldSend({...enter, ctrlKey: true}, 'mod-enter', false), true);
  assert.equal(shouldSend({...enter, ctrlKey: true}, 'mod-enter', true), false);
  assert.equal(shouldSend({...enter, metaKey: true}, 'mod-enter', false), false);
  for (const extra of [{shiftKey: true}, {altKey: true}, {isComposing: true}, {keyCode: 229}, {key: 'Escape'}]) {
    assert.equal(shouldSend({...enter, ...extra}, 'enter', false), false);
    assert.equal(shouldSend({...enter, metaKey: true, ...extra}, 'mod-enter', true), false);
  }
});

test('auto-scroll follows the bottom only when enabled and leaves readers alone', () => {
  assert.equal(shouldAutoScroll(true, true), true);
  assert.equal(shouldAutoScroll(false, true), false);
  assert.equal(shouldAutoScroll(true, false), false);
});

test('assistant preferences preserve vault instructions and use the native verbosity override', () => {
  const settings = {...DEFAULT_SETTINGS, customInstructions: '  Write concise notes and preserve my YAML fields.  '};
  const preferences = assistantPreferences(settings);
  assert.ok(preferences.developerInstructions.startsWith(VAULT_INSTRUCTIONS));
  assert.ok(preferences.developerInstructions.endsWith('Write concise notes and preserve my YAML fields.'));
  assert.equal('config' in preferences, false);
  for (const responseVerbosity of ['low', 'medium', 'high'] as const) assert.deepEqual(assistantPreferences({...settings, responseVerbosity}).config, {model_verbosity: responseVerbosity});
  assert.deepEqual(assistantPreferences({...settings, customInstructions: '  ', responseVerbosity: 'default'}), {developerInstructions: VAULT_INSTRUCTIONS});
});
