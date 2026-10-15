import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {Script} from 'node:vm';
import {Window} from 'happy-dom';

// Exercise the production view/settings code against the public Obsidian UI
// contract, with an isolated DOM and no native app, accounts, or model calls.
const require = createRequire(import.meta.url);
const bundle = build({entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['obsidian'], write: false, logLevel: 'silent'});
const tick = () => new Promise(resolve => setTimeout(resolve, 65));
async function environment() {
  const win = new Window({url: 'http://localhost'}), document = win.document;
  const element = win.HTMLElement.prototype as any;
  element.empty = function () {this.replaceChildren();};
  element.addClass = function (...classes: string[]) {this.classList.add(...classes);};
  element.toggleClass = function (name: string, enabled: boolean) {this.classList.toggle(name, enabled);};
  element.setText = function (text: string) {this.textContent = text;};
  element.createEl = function (tag: string, options: any = {}) {
    const el = document.createElement(tag);
    if (options.cls) el.className = options.cls;
    if (options.text !== undefined) el.textContent = options.text;
    if (options.type) (el as any).type = options.type;
    if (options.value !== undefined) (el as any).value = options.value;
    for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, String(value));
    this.appendChild(el); return el;
  };
  element.createDiv = function (options: any = {}) {return this.createEl('div', options);};
  element.createSpan = function (options: any = {}) {return this.createEl('span', options);};
  (win as any).createSpan = () => document.createElement('span');
  (win as any).createDiv = () => document.createElement('div');
  const leaves = new Set<any>(), saved: any[] = [], commands: any[] = [];
  class Component {addChild(child: any) {return child;} removeChild() {} registerDomEvent(el: any, name: string, listener: any) {el.addEventListener(name, listener);}}
  class FileSystemAdapter {getBasePath() {return '/isolated-test-vault';}}
  const app: any = {vault: {configDir: '.custom-config', adapter: new FileSystemAdapter(), getFiles: () => []}, workspace: {
    factory: null,
    getLeavesOfType: () => [...leaves].filter(leaf => leaf.view),
    getRightLeaf: () => leaf('right-sidebar'), getLeftLeaf: () => leaf('left-sidebar'), getLeaf: () => leaf('main-tab'),
    revealLeaf: async () => {}, onLayoutReady: (callback: any) => callback(),
  }};
  function leaf(where: string) {
    const result: any = {where, view: null,
      async setViewState() {this.view = app.workspace.factory(this); await this.view.onOpen();},
      detach() {void this.view?.onClose(); this.view?.contentEl.remove(); leaves.delete(this);},
    }; leaves.add(result); return result;
  }
  class Plugin extends Component {
    manifest = {id: 'vault-codex', name: 'Vault Codex', version: 'test'};
    app = app; settingsTab: any;
    async loadData() {return {settings: {}, activeId: 'saved-thread', sessions: [{id: 'saved-thread', title: '原始标题', updatedAt: 0, messages: [{id: 'u', role: 'user', text: '原始问题'}, {id: 'a', role: 'assistant', text: '原始回答', status: 'completed'}]}]};}
    async saveData(data: any) {saved.push(data);}
    registerView(_type: string, factory: any) {app.workspace.factory = factory;}
    addRibbonIcon() {const button = document.createElement('button'); document.body.append(button); return button;}
    addCommand(command: any) {command.name = `Vault Codex: ${command.name}`; commands.push(command); return command;}
    addSettingTab(tab: any) {this.settingsTab = tab; tab.update();}
  }
  class ItemView extends Component {
    app = app; contentEl: any;
    constructor(public leaf: any) {super(); this.contentEl = document.createElement('section'); document.body.append(this.contentEl);}
  }
  class Control {
    constructor(public el: any) {}
    setValue(value: any) {if (this.el.type === 'checkbox') this.el.checked = value; else this.el.value = value; return this;}
    setPlaceholder(value: string) {this.el.placeholder = value; return this;}
    addOption(value: string, label: string) {const option = document.createElement('option'); option.value = value; option.textContent = label; this.el.append(option); return this;}
    setButtonText(value: string) {this.el.textContent = value; return this;}
    setDisabled(value: boolean) {this.el.disabled = value; return this;}
    onClick(callback: any) {this.el.addEventListener('click', callback); return this;}
    onChange(callback: any) {this.el.addEventListener(this.el.tagName === 'SELECT' || this.el.type === 'checkbox' ? 'change' : 'input', () => callback(this.el.type === 'checkbox' ? this.el.checked : this.el.value)); return this;}
  }
  class Setting {
    settingEl: any; nameEl: any; descEl: any; controlEl: any;
    constructor(container: any) {
      this.settingEl = container.createDiv({cls: 'setting-item'}); const info = this.settingEl.createDiv({cls: 'setting-item-info'});
      this.nameEl = info.createDiv({cls: 'setting-item-name'}); this.descEl = info.createDiv({cls: 'setting-item-description'});
      this.controlEl = this.settingEl.createDiv({cls: 'setting-item-control'});
    }
    setName(value: string) {this.nameEl.textContent = value; return this;}
    setDesc(value: string) {this.descEl.textContent = value; return this;}
    setClass(value: string) {this.settingEl.classList.add(value); return this;}
    addDropdown(callback: any) {callback(new Control(this.controlEl.createEl('select'))); return this;}
    addText(callback: any) {callback(new Control(this.controlEl.createEl('input'))); return this;}
    addTextArea(callback: any) {callback(new Control(this.controlEl.createEl('textarea'))); return this;}
    addToggle(callback: any) {callback(new Control(this.controlEl.createEl('input', {type: 'checkbox'}))); return this;}
    addButton(callback: any) {callback(new Control(this.controlEl.createEl('button'))); return this;}
  }
  class PluginSettingTab {
    containerEl: any = (document.body as any).createDiv({cls: 'settings'}); cleanups: (() => void)[] = [];
    constructor(public app: any, public plugin: any) {}
    getSettingDefinitions(): any[] {return [];}
    update() {
      for (const cleanup of this.cleanups) cleanup(); this.cleanups = []; this.containerEl.empty();
      for (const group of this.getSettingDefinitions()) {
        const container = this.containerEl.createDiv({cls: group.cls}); container.createEl('h2', {text: group.heading});
        for (const item of group.items ?? []) {
          const setting = new Setting(container).setName(item.name).setDesc(item.desc ?? ''); const cleanup = item.render?.(setting);
          if (typeof cleanup === 'function') this.cleanups.push(cleanup);
        }
      }
    }
  }
  class Modal {contentEl: any = document.createElement('div'); titleEl: any = document.createElement('h2'); constructor(public app: any) {} open() {} setPlaceholder() {}}
  const mock = {Plugin, ItemView, Component, FileSystemAdapter, PluginSettingTab, Setting, Modal, FuzzySuggestModal: Modal,
    Platform: {isMacOS: true}, getLanguage: () => 'zh', Notice: class {constructor(public text: string) {}},
    setIcon: () => {}, requestUrl: () => {throw new Error('Unexpected network request');},
    Menu: class {addItem() {return this;} showAtMouseEvent() {}},
    MarkdownRenderer: {async render(_app: any, text: string, target: any) {target.createEl('p', {text});}},
  };
  const compiled = (await bundle).outputFiles[0].text;
  const module: any = {exports: {}};
  new Script(`(function(require, module, exports) {${compiled}\n})`, {filename: 'vault-codex-ui-test.cjs'}).runInThisContext()((name: string) => name === 'obsidian' ? mock : require(name), module, module.exports);
  const plugin: any = new module.exports.default(); await plugin.onload(); let view = await plugin.openView(); await tick();
  const change = async (index: number, value: string) => {
    const select: any = plugin.settingsTab.containerEl.querySelectorAll('select')[index]; select.value = value; select.dispatchEvent(new win.Event('change')); await tick();
  };
  return {plugin, view, document, win, leaves, saved, commands, change, async close() {for (const item of [...leaves]) item.detach(); for (const cleanup of plugin.settingsTab.cleanups) cleanup(); await plugin.controller.dispose(); await win.happyDOM.close();}};
}

test('all interface languages update the live view and native settings without changing draft, attachments, or history', async () => {
  const env = await environment();
  try {
    const input: any = env.document.querySelector('.codex-input'); input.value = '保留草稿\nsecond line';
    env.view.attach({id: 'note-1', name: 'My note.md', text: 'Never translate this note'});
    for (const locale of ['en', 'ja', 'ko', 'de', 'fr', 'es', 'ru', 'pt', 'zh-TW', 'zh-CN']) {
      await env.change(0, locale);
      const t = env.plugin.controller.i18n.t;
      assert.equal(input.value, '保留草稿\nsecond line', locale);
      assert.equal(env.document.querySelector('.codex-welcome h2')?.textContent, t('想在笔记里做些什么？'), locale);
      assert.ok(env.plugin.settingsTab.containerEl.textContent.includes(t('自定义助手偏好')), locale);
      assert.ok(env.document.querySelector('.codex-chip')?.textContent.includes('My note.md'), locale);
      assert.equal(env.plugin.controller.session.messages[1].text, '原始回答', locale);
      assert.ok(env.commands[0].name.endsWith(t('打开聊天面板')), locale);
    }
  } finally {await env.close();}
});

test('panel placement moves the actual view and preserves current and inactive conversation drafts', async () => {
  const env = await environment();
  try {
    const input: any = env.document.querySelector('.codex-input'); input.value = 'first draft';
    env.view.attach({id: 'file', name: 'A.md', text: 'reference'});
    env.plugin.controller.newSession(); await tick();
    const draftInput: any = env.document.querySelector('.codex-input'); draftInput.value = 'second draft';
    for (const placement of ['left-sidebar', 'main-tab', 'right-sidebar']) {
      await env.change(2, placement);
      assert.equal(env.leaves.size, 1);
      const current: any = [...env.leaves][0]; assert.equal(current.where, placement);
      assert.equal((env.document.querySelector('.codex-input') as any).value, 'second draft');
    }
    env.plugin.controller.selectSession('saved-thread'); await tick();
    assert.equal((env.document.querySelector('.codex-input') as any).value, 'first draft');
    assert.ok(env.document.querySelector('.codex-chip')?.textContent.includes('A.md'));
    assert.equal(env.plugin.controller.session.messages[1].text, '原始回答');
  } finally {await env.close();}
});

test('changing send mode affects the production input handler, including composition and Shift+Enter', async () => {
  const env = await environment();
  try {
    const calls: string[] = []; env.plugin.controller.send = async (text: string) => {calls.push(text); return false;};
    const input: any = env.document.querySelector('.codex-input'); input.value = 'test message';
    input.dispatchEvent(new env.win.KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true})); await tick(); assert.equal(calls.length, 1);
    await env.change(1, 'mod-enter');
    for (const options of [{}, {shiftKey: true, metaKey: true}, {isComposing: true, metaKey: true}]) input.dispatchEvent(new env.win.KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true, ...options}));
    await tick(); assert.equal(calls.length, 1);
    input.dispatchEvent(new env.win.KeyboardEvent('keydown', {key: 'Enter', metaKey: true, bubbles: true, cancelable: true})); await tick(); assert.equal(calls.length, 2);
  } finally {await env.close();}
});

test('assistant controls save preference text and response detail into plugin data', async () => {
  const env = await environment();
  try {
    const preferences: any = env.plugin.settingsTab.containerEl.querySelector('textarea'); preferences.value = 'Answer in English, preserve [[links]].'; preferences.dispatchEvent(new env.win.Event('input'));
    await env.change(3, 'high'); await env.plugin.persist();
    assert.equal(env.plugin.controller.data.settings.customInstructions, preferences.value);
    assert.equal(env.saved.at(-1).settings.customInstructions, preferences.value);
    assert.equal(env.saved.at(-1).settings.responseVerbosity, 'high');
  } finally {await env.close();}
});

test('reopening cached settings shows current connection status before another controller event', async () => {
  const env = await environment();
  try {
    const tab = env.plugin.settingsTab, c = env.plugin.controller;
    const cachedDefinitions = tab.getSettingDefinitions();
    tab.getSettingDefinitions = () => cachedDefinitions;
    c.status = '已连接'; c.connecting = true;
    tab.update();
    const row = [...tab.containerEl.querySelectorAll('.setting-item')].find((item: any) => item.querySelector('.setting-item-name')?.textContent === '连接状态') as any;
    assert.equal(row.querySelector('.setting-item-description').textContent, '已连接');
    assert.equal(row.querySelector('button').disabled, true);
    c.connecting = false; c.changed();
    assert.equal(row.querySelector('button').disabled, false);
  } finally {await env.close();}
});

test('the production message view honors the auto-scroll toggle and pauses while reading above the bottom', async () => {
  const env = await environment();
  try {
    const messages: any = env.document.querySelector('.codex-messages');
    Object.defineProperty(messages, 'scrollHeight', {get: () => 1400, configurable: true});
    Object.defineProperty(messages, 'clientHeight', {get: () => 500, configurable: true});
    const toggle: any = env.plugin.settingsTab.containerEl.querySelector('input[type=checkbox]');
    toggle.checked = false; toggle.dispatchEvent(new env.win.Event('change'));
    messages.scrollTop = 900; env.plugin.controller.changed(); await tick(); assert.equal(messages.scrollTop, 900);
    toggle.checked = true; toggle.dispatchEvent(new env.win.Event('change'));
    messages.scrollTop = 900; env.plugin.controller.changed(); await tick(); assert.equal(messages.scrollTop, 1400);
    messages.scrollTop = 100; env.plugin.controller.changed(); await tick(); assert.equal(messages.scrollTop, 100);
  } finally {await env.close();}
});

test('accessible input labels stay outside inputs and Markdown replacement renders in the owning document', async () => {
  const env = await environment();
  try {
    const input = env.document.querySelector('.codex-input')!;
    const name = env.document.getElementById(input.getAttribute('aria-labelledby')!);
    assert.equal(name?.parentElement, input.parentElement);
    assert.equal(name?.textContent, '消息输入框');
    const reply = env.document.querySelector('.codex-message-assistant .codex-message-body')!;
    assert.equal(reply.querySelector('p')?.textContent, '原始回答');
    env.plugin.controller.session.messages[1].text = '更新后的回答';
    env.plugin.controller.changed(); await tick(); await tick();
    assert.equal(reply.querySelector('p')?.textContent, '更新后的回答');
    assert.equal(reply.children.length, 1);
    assert.equal(reply.ownerDocument, env.document);
  } finally {await env.close();}
});

test('approval cards preserve question choices, secret answers, and explicit permission decisions', async () => {
  const env = await environment();
  try {
    const c = env.plugin.controller; const responses: any[] = [];
    c.rpc.respond = (id: string, result: unknown) => responses.push({id, result});
    c.approvals = [{id: 'question', method: 'item/tool/requestUserInput', params: {questions: [{id: 'answer', question: 'Choose', options: [{label: 'Option A', description: 'First'}]}, {id: 'secret', question: 'Private', isSecret: true}]}}];
    c.changed(); await tick();
    const card = env.document.querySelector('.codex-approval')!;
    const select = card.querySelector('select')!; select.value = 'Option A';
    const secret = card.querySelector('input[type=password]')!; (secret as any).value = 'my answer';
    (card.querySelector('button') as any).click();
    assert.deepEqual(responses[0], {id:'question', result:{answers:{answer:{answers:['Option A']}, secret:{answers:['my answer']}}}});
    c.approvals = [{id: 'permission', method: 'item/permissions/requestApproval', params: {permissions: {network: {enabled:true}}}}];
    c.changed(); await tick();
    const buttons = env.document.querySelectorAll('.codex-approval-buttons button');
    (buttons[0] as any).click();
    assert.deepEqual(responses[1], {id:'permission', result:{permissions:{}, scope:'turn'}});
    c.approvals = [{id:'command',method:'item/commandExecution/requestApproval',params:{command:'echo test',availableDecisions:['decline']}}];
    c.changed(); await tick();
    assert.equal((env.document.querySelector('.codex-approval-buttons .mod-cta') as any).disabled, true);
  } finally {await env.close();}
});
