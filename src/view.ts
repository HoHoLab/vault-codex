import {defaultTranslate, type Translate, I18n, bindStaticTranslations} from './i18n';
import {Component, FuzzySuggestModal, ItemView, MarkdownRenderer, Menu, Notice, TFile, requestUrl, setIcon, type WorkspaceLeaf} from 'obsidian';
import {join} from 'node:path';
import type CodexPlugin from './main';
import type {Controller} from './controller';
import {ACCESS_DESCRIPTIONS, ACCESS_ICONS, ACCESS_LABELS, EFFORT_LABELS, contextUsage, formatTokens, fastTier, errorText, type Attachment, type Message, type Session} from './types';
import {eventParams} from './protocol';
import type {RpcEvent} from './rpc';
import {InfoModal, VoiceHelpModal} from './info';
import {PLUGIN_NAME} from './plugin-info';
import {CodexTranscriber} from './transcription';
import {Dictation, appendTranscript, type DictationState} from './dictation';
import {answerText, conversationTurns, durationLabel, type ConversationTurn} from './conversation';
import {StreamRenderer} from './stream-renderer';
import {EffortSlider} from './effort-slider';
import {Platform} from 'obsidian';
import {shouldSend, shouldAutoScroll} from './preferences';

export interface ChatViewState {drafts: Map<string, {text: string; attachments: Attachment[]}>; sessionId: string; text: string; attachments: Attachment[]; scrollTop: number; selectionStart: number; selectionEnd: number; focused: boolean;}

interface MessageEntry {el: HTMLElement; body: HTMLElement; text: string; component?: Component; renderer?: StreamRenderer<{stage: HTMLElement; component: Component}>;}
interface TurnEntry {el: HTMLElement; user: HTMLElement; response: HTMLElement; process: HTMLDetailsElement; processLabel: HTMLElement; processBody: HTMLElement; answers: HTMLElement; notices: HTMLElement; status: HTMLElement; actions: HTMLElement; turn: ConversationTurn; wasActive: boolean;}

export const VIEW_TYPE = 'codex-chat';
const accessibleNames = new WeakMap<HTMLElement, HTMLSpanElement>();
export function setAccessibleName(element: HTMLElement, label: string) {
  // Obsidian turns aria-label into a tooltip. Reference hidden text instead.
  element.removeAttribute('aria-label');
  element.removeAttribute('title');
  let name = accessibleNames.get(element);
  if (!name) {
    name = element.ownerDocument.defaultView!.createSpan();
    name.id = `codex-name-${crypto.randomUUID()}`;
    name.className = 'codex-sr-only';
    name.hidden = true;
    accessibleNames.set(element, name);
  }
  name.textContent = label;
  // Inputs cannot contain labels; other labels stay with their element.
  if (!name.parentElement) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) element.after(name);
    else element.prepend(name);
  }
  element.setAttribute('aria-labelledby', name.id);
}
function setButtonIcon(button: HTMLButtonElement, icon: string) {
  const glyph = button.querySelector<HTMLElement>('.codex-button-icon') ?? button.createSpan({cls: 'codex-button-icon', attr: {'aria-hidden': 'true'}});
  setIcon(glyph, icon);
}
function iconButton(parent: HTMLElement, icon: string, label: string, action: (event: MouseEvent) => void, cls = '') {
  const button = parent.createEl('button', {cls: `codex-icon-button ${cls}`, attr: {type: 'button'}});
  setButtonIcon(button, icon); setAccessibleName(button, label); button.addEventListener('click', action); return button;
}
export class CodexView extends ItemView {
  private get t() {return this.controller.i18n.t;}
  private locale = '';
  private localizeShell?: () => void;
  private controller: Controller;
  private input!: HTMLTextAreaElement;
  private messageList!: HTMLElement;
  private statusEl!: HTMLElement;
  private connectButton!: HTMLButtonElement;
  private sendButton!: HTMLButtonElement;
  private accessButton!: HTMLButtonElement;
  private effortButton!: HTMLButtonElement;
  private fastButton!: HTMLButtonElement;
  private activityEl!: HTMLElement;
  private contextTooltip!: HTMLElement;
  private contextText!: HTMLElement;
  private contextTokens!: HTMLElement;
  private contextLabel!: HTMLElement;
  private chips!: HTMLElement;
  private approvalEl!: HTMLElement;
  private welcome!: HTMLElement;
  private popup?: HTMLElement;
  private popupAnchor?: HTMLButtonElement;
  private effortSlider?: EffortSlider;
  private attachments: Attachment[] = [];
  private rendered = new Map<string, MessageEntry>();
  private renderedTurns = new Map<string, TurnEntry>();
  private unsubscribe?: () => void;
  private refreshTimer?: number;
  private elapsedTimer?: number;
  private dictation?: Dictation;
  private voiceBar!: HTMLElement;
  private voiceStatus!: HTMLElement;
  private voiceMeter!: HTMLElement;
  private voiceDone!: HTMLButtonElement;
  private voiceSessionId = '';
  private micButton!: HTMLButtonElement;
  private approvalKey = '';
  private sessionId = '';
  private drafts = new Map<string, {text: string; attachments: Attachment[]}>();
  constructor(leaf: WorkspaceLeaf, private plugin: CodexPlugin) {super(leaf); this.controller = plugin.controller;}
  get voiceActive() {return this.dictation !== undefined && this.dictation.phase !== 'idle';}
  captureState(): ChatViewState {
    return {drafts: new Map(this.drafts), sessionId: this.sessionId, text: this.input.value, attachments: [...this.attachments], scrollTop: this.messageList.scrollTop, selectionStart: this.input.selectionStart, selectionEnd: this.input.selectionEnd, focused: this.input === this.input.ownerDocument.activeElement};
  }
  restoreState(state: ChatViewState) {
    this.drafts = new Map(state.drafts);
    if (state.sessionId === this.sessionId) {
      this.input.value = state.text; this.attachments = [...state.attachments]; this.renderAttachments(); this.resizeInput();
      this.input.setSelectionRange(state.selectionStart, state.selectionEnd);
      this.messageList.scrollTop = state.scrollTop;
      if (state.focused) this.input.focus();
    }
  }
  getViewType() {return VIEW_TYPE;}
  getDisplayText() {return PLUGIN_NAME;}
  getIcon() {return 'bot';}
  async onOpen() {
    const root = this.contentEl; root.empty(); root.addClass('codex-view');
    this.messageList = root.createDiv({cls: 'codex-messages', attr: {role: 'log'}});
    setAccessibleName(this.messageList, '对话记录');
    this.welcome = this.messageList.createDiv({cls: 'codex-welcome'});
    this.welcome.createEl('h2', {text: '想在笔记里做些什么？'});
    this.welcome.createEl('p', {text: '从一个想法、一篇笔记，或一个问题开始。'});
    const suggestions = this.welcome.createDiv({cls: 'codex-suggestions'});
    for (const [icon, label, prompt] of [['file-text', '梳理当前笔记', '请梳理这篇笔记的结构，提炼核心观点。'], ['network', '寻找知识关联', '帮我在笔记库中寻找相关笔记，整理它们之间的联系。'], ['pencil-line', '一起写点什么', '我想写一篇新笔记，请先帮我构思大纲。']]) {
      const button = suggestions.createEl('button', {cls: 'codex-suggestion'}); const glyph = button.createSpan(); setIcon(glyph, icon); button.createSpan({text: label});
      button.onclick = () => {this.input.value = this.t(prompt); this.resizeInput(); this.input.focus(); if (icon === 'file-text') void this.attachCurrent();};
    }
    const bottom = root.createDiv({cls: 'codex-bottom'});
    this.approvalEl = bottom.createDiv({cls: 'codex-approvals'});
    const actions = bottom.createDiv({cls: 'codex-composer-actions', attr: {role: 'group'}});
    setAccessibleName(actions, '对话操作');
    iconButton(actions, 'history', '历史对话', () => this.openHistory());
    iconButton(actions, 'square-pen', '新建对话', () => this.controller.newSession());
    iconButton(actions, 'ellipsis', '更多选项', event => this.openMenu(event));
    const composer = bottom.createDiv({cls: 'codex-composer'});
    this.chips = composer.createDiv({cls: 'codex-attachments'});
    this.voiceBar = composer.createDiv({cls: 'codex-voice-bar', attr: {role: 'region'}}); this.voiceBar.hidden = true;
    setAccessibleName(this.voiceBar, '语音输入');
    this.voiceMeter = this.voiceBar.createDiv({cls: 'codex-voice-meter', attr: {'aria-hidden': 'true'}});
    for (let i = 0; i < 5; i++) this.voiceMeter.createSpan();
    this.voiceStatus = this.voiceBar.createSpan({cls: 'codex-voice-status', attr: {role: 'status', 'aria-live': 'polite'}});
    this.voiceDone = iconButton(this.voiceBar, 'check', '结束录音并转写', () => this.dictation?.stop());
    iconButton(this.voiceBar, 'x', '取消语音输入', () => this.dictation?.cancel());
    this.input = composer.createEl('textarea', {cls: 'codex-input', attr: {placeholder: '使用 Codex', rows: '1'}});
    setAccessibleName(this.input, '消息输入框');
    this.input.addEventListener('input', () => this.resizeInput());
    this.input.addEventListener('keydown', event => {if (shouldSend(event, this.controller.data.settings.sendMode, Platform.isMacOS)) {event.preventDefault(); if (!this.controller.busy) void this.send();}});
    const toolbar = composer.createDiv({cls: 'codex-toolbar'});
    const left = toolbar.createDiv({cls: 'codex-toolbar-left'});
    iconButton(left, 'plus', '添加笔记或图片', event => this.attachmentMenu(event));
    this.accessButton = left.createEl('button', {cls: 'codex-access', attr: {type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false'}}); this.accessButton.onclick = () => this.accessMenu();
    const right = toolbar.createDiv({cls: 'codex-toolbar-right'});
    const context = right.createDiv({cls: 'codex-context'});
    this.activityEl = context.createSpan({cls: 'codex-activity-button', attr: {role: 'img', tabindex: '0'}});
    // Obsidian generates its own tooltip for aria-label; use labelledby so
    // assistive technology still gets a name without a duplicate tooltip.
    const tooltipId = `codex-context-${crypto.randomUUID()}`;
    this.contextLabel = this.activityEl.createSpan({cls: 'codex-sr-only', attr: {id: `${tooltipId}-label`}});
    this.activityEl.setAttribute('aria-labelledby', `${tooltipId}-label`);
    this.activityEl.setAttribute('aria-describedby', tooltipId);
    this.contextTooltip = context.createDiv({cls: 'codex-context-tooltip', attr: {role: 'tooltip', id: tooltipId}});
    this.contextTooltip.createDiv({cls: 'codex-context-heading', text: '背景信息窗口：'});
    this.contextText = this.contextTooltip.createDiv();
    this.contextTokens = this.contextTooltip.createDiv();
    this.activityEl.addEventListener('mouseenter', () => this.positionContextTooltip());
    this.activityEl.addEventListener('focus', () => this.positionContextTooltip());
    const modelControl = right.createDiv({cls: 'codex-model-control'});
    this.fastButton = iconButton(modelControl, 'zap', '关闭 Fast', () => this.controller.toggleFast(), 'codex-model-icon codex-fast-button');
    this.fastButton.hidden = true;
    this.effortButton = modelControl.createEl('button', {cls: 'codex-effort-button', attr: {type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false'}}); this.effortButton.onclick = () => this.toggleEffort();
    this.micButton = iconButton(right, 'mic', '语音输入', () => this.dictate());
    this.sendButton = iconButton(right, 'arrow-up', '发送消息', () => {if (this.controller.busy) void this.controller.stop().catch(error => this.notice(error)); else void this.send();}, 'codex-send');
    const transcriber = new CodexTranscriber(this.controller.rpc, request => requestUrl(request), 60000, this.t);
    this.dictation = new Dictation(root.ownerDocument.defaultView!, {
      prepare: async () => {
        await this.controller.connect();
        if (!this.controller.usesChatGPT) throw new Error(this.t('请先在本机 Codex 登录 ChatGPT，再使用语音输入。'));
      },
      transcribe: (audio, mime, signal) => transcriber.transcribe(audio, mime, signal),
      state: state => this.updateVoice(state),
      text: text => {
        if (this.voiceSessionId !== this.sessionId || this.voiceSessionId !== this.controller.session?.id) return;
        this.input.value = appendTranscript(this.input.value, text); this.resizeInput(); this.input.focus();
      },
      error: message => new VoiceHelpModal(this.app, message, this.controller.i18n).open()
    }, this.t);
    const footer = bottom.createDiv({cls: 'codex-footer'});
    const status = footer.createEl('button', {cls: 'codex-status', attr: {type: 'button'}}); status.onclick = () => this.openInfo(); status.createSpan({cls: 'codex-status-dot'}); this.statusEl = status.createSpan();
    setAccessibleName(status, '查看连接和用量信息');
    this.connectButton = footer.createEl('button', {cls: 'codex-connect', text: '连接 Codex'});
    this.connectButton.onclick = () => {void (this.controller.rpc.ready && !this.controller.account ? this.controller.login().then(url => {window.open(url);}) : this.controller.connect()).catch(error => this.notice(error));};
    this.registerDomEvent(root.ownerDocument, 'pointerdown', event => {if (this.popup && !this.popup.contains(event.target as Node) && !this.popupAnchor?.contains(event.target as Node)) this.closePopup();});
    this.registerDomEvent(root.ownerDocument, 'keydown', event => {if (event.key === 'Escape' && this.popup) {event.preventDefault(); const anchor = this.popupAnchor; this.closePopup(); anchor?.focus();}});
    this.registerDomEvent(root.ownerDocument.defaultView!, 'resize', () => this.closePopup());
    this.unsubscribe = this.controller.subscribe(() => {if (this.refreshTimer) return; this.refreshTimer = this.contentEl.ownerDocument.defaultView!.setTimeout(() => {this.refreshTimer = undefined; this.refresh();}, 40);});
    this.localizeShell = bindStaticTranslations(root, this.t); this.localizeShell(); this.locale = this.controller.i18n.locale;
    this.refresh();
  }
  async onClose() {this.unsubscribe?.(); this.contentEl.ownerDocument.defaultView!.clearTimeout(this.refreshTimer); this.contentEl.ownerDocument.defaultView!.clearInterval(this.elapsedTimer); this.dictation?.dispose(); this.clearMessages(); this.closePopup();}
  private notice(error: unknown) {new Notice(errorText(error));}
  private resizeInput() {this.input.style.removeProperty('height'); this.input.style.height = `${Math.min(220, Math.max(46, this.input.scrollHeight))}px`; this.updateSend();}
  private updateSend() {
    const c = this.controller;
    setButtonIcon(this.sendButton, c.busy ? 'square' : 'arrow-up');
    setAccessibleName(this.sendButton, c.busy ? this.t('停止生成') : this.t('发送消息'));
    this.sendButton.disabled = c.busy ? !c.turnId : (!this.input.value.trim() && !this.attachments.length) || c.connecting || (this.dictation?.phase ?? 'idle') !== 'idle';
  }
  private async send() {
    if (this.dictation && this.dictation.phase !== 'idle') return;
    const text = this.input.value; const attachments = [...this.attachments];
    try { if (await this.controller.send(text, attachments)) {if (this.input.value === text) this.input.value = ''; this.attachments = this.attachments.filter(item => !attachments.includes(item)); this.renderAttachments(); this.resizeInput();} }
    catch (error) {this.notice(error);}
  }
  attach(attachment: Attachment) {if (this.attachments.some(item => item.id === attachment.id)) return; this.attachments.push(attachment); this.renderAttachments(); this.input.focus();}
  private renderAttachments() {
    this.chips.empty();
    for (const attachment of this.attachments) {const chip = this.chips.createDiv({cls: 'codex-chip'}); chip.createSpan({text: attachment.name}); iconButton(chip, 'x', this.t('移除 {name}', {name: attachment.name}), () => {this.attachments = this.attachments.filter(item => item !== attachment); this.renderAttachments();});}
    this.updateSend();
  }
  private async attachFile(file: TFile) {
    try {
      const image = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(file.extension.toLowerCase());
      if (!image && file.stat.size > 250000) throw new Error(this.t('笔记超过 250 KB，请选择部分内容，或直接让 Codex 按文件路径读取。'));
      this.attach({id: file.path, name: file.name, path: join(this.controller.cwd, file.path), image, text: image ? undefined : await this.app.vault.cachedRead(file)});
    } catch (error) {this.notice(error);}
  }
  private async attachCurrent() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {new Notice(this.t('请先打开一篇笔记。')); return;}
    await this.attachFile(file);
  }
  private attachmentMenu(event: MouseEvent) {
    const menu = new Menu();
    menu.addItem(item => item.setTitle(this.t('引用当前笔记')).setIcon('file-text').onClick(() => {void this.attachCurrent();}));
    menu.addItem(item => item.setTitle(this.t('选择笔记或图片…')).setIcon('paperclip').onClick(() => {new FilePicker(this.app, file => {void this.attachFile(file);}, this.t).open();}));
    menu.showAtMouseEvent(event);
  }
  private accessMenu() {
    if (this.popupAnchor === this.accessButton) {this.closePopup(); return;}
    const popup = this.createPopup(this.accessButton, this.t('权限模式'), 'codex-access-popover');
    popup.setAttribute('role', 'menu');
    for (const mode of ['request', 'auto-review', 'full'] as const) {
      const selected = this.controller.data.settings.access === mode;
      const row = popup.createEl('button', {cls: 'codex-choice-row', attr: {type: 'button', role: 'menuitemradio', 'aria-checked': String(selected)}});
      row.toggleClass('is-full', mode === 'full');
      setIcon(row.createSpan({cls: 'codex-choice-icon'}), ACCESS_ICONS[mode]);
      const copy = row.createSpan({cls: 'codex-choice-copy'}); copy.createSpan({cls: 'codex-choice-title', text: this.t(ACCESS_LABELS[mode])}); copy.createSpan({cls: 'codex-choice-description', text: this.t(ACCESS_DESCRIPTIONS[mode])});
      if (selected) setIcon(row.createSpan({cls: 'codex-choice-check'}), 'check');
      row.onclick = () => {if (this.controller.busy) return; this.controller.data.settings.access = mode; this.controller.changed(true); this.closePopup(); this.accessButton.focus();};
    }
    if (this.controller.data.settings.access === 'read-only') popup.createDiv({cls: 'codex-popover-hint', text: this.t('当前保留旧版只读设置。选择以上模式后才会变更。')});
    this.menuKeyboard(popup);
    (popup.querySelector('[aria-checked="true"]') as HTMLElement ?? popup.querySelector('button'))?.focus();
  }
  private toggleEffort() {if (this.popupAnchor === this.effortButton) {this.closePopup(); return;} this.drawEffort(true);}
  private closePopup() {this.effortSlider?.destroy(); this.effortSlider = undefined; this.popup?.remove(); this.popup = undefined; this.popupAnchor?.setAttribute('aria-expanded', 'false'); this.popupAnchor = undefined;}
  private createPopup(anchor: HTMLButtonElement, label: string, cls = '') {
    this.closePopup();
    const labelId = `codex-popup-${crypto.randomUUID()}`;
    const popup = this.contentEl.createDiv({cls: `codex-effort-popover ${cls}`, attr: {role: 'dialog', 'aria-labelledby': labelId}});
    popup.createSpan({cls: 'codex-sr-only', text: label, attr: {id: labelId}});
    this.popup = popup; this.popupAnchor = anchor; anchor.setAttribute('aria-expanded', 'true');
    const root = this.contentEl.getBoundingClientRect(); const rect = anchor.getBoundingClientRect();
    popup.style.bottom = `${root.bottom - rect.top + 8}px`;
    popup.style.maxHeight = `${Math.max(100, rect.top - root.top - 16)}px`;
    if (anchor !== this.accessButton) popup.style.right = `${Math.max(12, root.right - rect.right - 44)}px`;
    return popup;
  }
  private menuKeyboard(element: HTMLElement) {
    element.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      if (!buttons.length) return; event.preventDefault();
      const index = buttons.indexOf(element.ownerDocument.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    });
  }
  private modelName(name: string) {return name.replace(/^(GPT-\d+(?:\.\d+)?)-/i, '$1 ');}
  private drawEffort(focus = false) {
    const popup = this.createPopup(this.effortButton, this.t('模型与推理强度'), 'codex-effort-selector');
    const top = popup.createDiv({cls: 'codex-effort-top'});
    const c = this.controller;
    const fast = iconButton(top, 'zap', c.fastEnabled ? this.t('关闭 Fast') : this.t('开启 Fast'), () => {
      c.toggleFast(); fast.setAttribute('aria-pressed', String(c.fastEnabled)); fast.toggleClass('is-on', c.fastEnabled);
      popup.toggleClass('is-fast', c.fastEnabled);
      this.effortSlider?.setFast(c.fastEnabled);
      setAccessibleName(fast, c.fastEnabled ? this.t('关闭 Fast') : this.t('开启 Fast'));
    }, 'codex-effort-bolt codex-fast-toggle');
    fast.disabled = !fastTier(c.model) || c.busy;
    fast.setAttribute('aria-pressed', String(c.fastEnabled)); fast.toggleClass('is-on', c.fastEnabled);
    popup.toggleClass('is-fast', c.fastEnabled);
    const center = top.createEl('button', {cls: 'codex-effort-summary', attr: {type: 'button', 'aria-haspopup': 'menu'}});
    setAccessibleName(center, this.t('选择模型'));
    const effortLabel = center.createDiv({cls: 'codex-effort-value', text: this.t(EFFORT_LABELS[c.data.settings.effort] ?? '默认')});
    const modelLabel = center.createSpan({cls: 'codex-model-trigger'}); modelLabel.createSpan({text: this.modelName(c.model?.displayName ?? this.t('连接后选择模型'))}); setIcon(modelLabel.createSpan(), 'chevron-right');
    center.disabled = !c.models.length || c.busy; center.onclick = () => this.drawModels();
    let resetEffort = () => {};
    const reset = iconButton(top, 'rotate-ccw', this.t('恢复模型默认强度'), () => resetEffort());
    const options = c.model?.supportedReasoningEfforts ?? [];
    reset.disabled = c.busy || !options.length;
    if (options.length) {
      const track = popup.createDiv({cls: 'codex-slider-wrap'});
      const labels = options.map(option => this.t(EFFORT_LABELS[option.reasoningEffort] ?? option.reasoningEffort));
      const initial = Math.max(0, options.findIndex(option => option.reasoningEffort === c.data.settings.effort));
      let labelAnimation: Animation | undefined;
      const update = (index: number, animate = false) => {
        c.data.settings.effort = options[index].reasoningEffort;
        effortLabel.textContent = labels[index]; popup.toggleClass('is-ultra', options[index].reasoningEffort === 'ultra');
        if (animate && effortLabel.animate && !popup.ownerDocument.defaultView!.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          labelAnimation?.cancel();
          labelAnimation = effortLabel.animate([{opacity: .35, transform: 'translateY(2px)'}, {opacity: 1, transform: 'translateY(0)'}], {duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)'});
        }
      };
      update(initial);
      const control = this.effortSlider = new EffortSlider(track, {
        labels, index: initial, ultraIndex: options.findIndex(option => option.reasoningEffort === 'ultra'), fast: c.fastEnabled, disabled: c.busy,
        onChange: index => {if (!c.busy) {update(index, true); c.changed(true);}},
      });
      setAccessibleName(control.input, this.t('推理强度'));
      resetEffort = () => {
        if (c.busy) return;
        control.select(Math.max(0, options.findIndex(option => option.reasoningEffort === c.model?.defaultReasoningEffort))); control.input.focus();
      };
      if (focus) control.input.focus();
    } else popup.createDiv({cls: 'codex-popover-hint', text: this.t('连接 Codex 后加载可用模型与强度。')});
  }
  private drawModels() {
    const popup = this.createPopup(this.effortButton, this.t('选择模型'), 'codex-model-popover');
    const list = popup.createDiv({cls: 'codex-model-list', attr: {role: 'menu'}});
    for (const model of this.controller.models) {
      const selected = model.model === this.controller.data.settings.model;
      const row = list.createEl('button', {cls: 'codex-choice-row', attr: {type: 'button', role: 'menuitemradio', 'aria-checked': String(selected)}});
      const copy = row.createSpan({cls: 'codex-choice-copy'}); copy.createSpan({cls: 'codex-choice-title', text: this.modelName(model.displayName)});
      if (selected) setIcon(row.createSpan({cls: 'codex-choice-check'}), 'check');
      row.onclick = () => {if (this.controller.busy) return; this.controller.chooseModel(model.model); this.drawEffort(true);};
    }
    this.menuKeyboard(popup);
    (list.querySelector('[aria-checked="true"]') as HTMLElement)?.focus();
  }
  private openInfo() {this.closePopup(); new InfoModal(this.app, this.controller, this.plugin.manifest.version).open();}
  private positionContextTooltip() {
    const root = this.contentEl.getBoundingClientRect(); const button = this.activityEl.getBoundingClientRect();
    const width = this.contextTooltip.getBoundingClientRect().width;
    const left = Math.max(root.left + 8, Math.min(root.right - width - 8, button.left + button.width / 2 - width / 2));
    this.contextTooltip.style.left = `${left - button.left}px`;
  }
  private openHistory() {if (this.controller.busy) {new Notice(this.t('请先停止当前回复，再切换对话。')); return;} new SessionPicker(this.app, this.controller.data.sessions, session => this.controller.selectSession(session.id), this.controller.i18n).open();}
  private openMenu(event: MouseEvent) {
    const menu = new Menu();
    menu.addItem(item => item.setTitle(this.t('信息窗口')).setIcon('info').onClick(() => this.openInfo()));
    menu.addItem(item => item.setTitle(this.t('重新连接')).setIcon('refresh-cw').onClick(() => {void this.controller.reconnect().catch(error => this.notice(error));}));
    menu.addItem(item => item.setTitle(this.t('登录 ChatGPT')).setIcon('log-in').onClick(() => {void this.controller.login().then(url => window.open(url)).catch(error => this.notice(error));}));
    menu.addItem(item => item.setTitle(this.t('将对话保存为笔记')).setIcon('download').onClick(() => {void this.exportChat();}));
    menu.showAtMouseEvent(event);
  }
  private async exportChat() {
    const session = this.controller.session; if (!session?.messages.length) {new Notice(this.t('当前没有可保存的对话。')); return;}
    try {
      const body = `# ${session.title}\n\n` + session.messages.map(item => `## ${item.role === 'user' ? this.t('你') : item.role === 'assistant' ? 'Codex' : item.title ?? this.t('状态')}\n\n${item.text}`).join('\n\n');
      const file = await this.app.vault.create(`${this.t('Codex 对话')} ${new Date().toISOString().replace(/[:.]/g, '-')} ${crypto.randomUUID().slice(0, 4)}.md`, body);
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (error) {this.notice(error);}
  }
  private dictate() {
    if (!this.dictation) return;
    if (this.dictation.phase === 'recording') {this.dictation.stop(); return;}
    if (this.dictation.phase === 'starting') {this.dictation.cancel(); return;}
    if (this.dictation.phase !== 'idle') return;
    this.closePopup(); this.voiceSessionId = this.sessionId; void this.dictation.start();
  }
  private updateVoice(state: DictationState) {
    const labels = {idle: this.t('语音输入'), starting: this.t('正在准备录音…'), recording: this.t('正在录音 {time}', {time: `${String(Math.floor(state.seconds / 60)).padStart(2, '0')}:${String(state.seconds % 60).padStart(2, '0')}`}), transcribing: this.t('正在转写…')};
    this.voiceBar.hidden = state.phase === 'idle';
    if (this.voiceStatus.textContent !== labels[state.phase]) this.voiceStatus.textContent = labels[state.phase];
    this.voiceDone.hidden = state.phase !== 'recording';
    this.voiceBar.toggleClass('is-transcribing', state.phase === 'transcribing' || state.phase === 'starting');
    Array.from(this.voiceMeter.children).forEach((bar, i) => {(bar as HTMLElement).style.height = `${4 + state.level * [9, 16, 22, 16, 9][i]}px`;});
    this.micButton.toggleClass('is-recording', state.phase === 'recording');
    this.micButton.disabled = state.phase === 'transcribing';
    setButtonIcon(this.micButton, state.phase === 'recording' ? 'square' : 'mic');
    const label = state.phase === 'recording' ? this.t('结束录音并转写') : state.phase === 'starting' ? this.t('取消录音准备') : labels[state.phase];
    setAccessibleName(this.micButton, label); this.updateSend();
  }
  private clearMessages() {
    for (const entry of this.rendered.values()) {entry.renderer?.dispose(); if (entry.component) this.removeChild(entry.component); entry.el.remove();}
    this.rendered.clear(); for (const entry of this.renderedTurns.values()) entry.el.remove(); this.renderedTurns.clear();
  }
  private refresh() {
    const c = this.controller; const session = c.session;
    if (this.locale !== c.i18n.locale) {
      this.locale = c.i18n.locale; this.localizeShell?.(); this.closePopup();
      for (const entry of this.rendered.values()) entry.text = '';
      if (this.dictation) this.updateVoice({phase: this.dictation.phase, seconds: 0, level: 0});
    }
    if (this.sessionId !== session?.id) {
      this.dictation?.cancel();
      if (this.sessionId) this.drafts.set(this.sessionId, {text: this.input.value, attachments: this.attachments});
      const sameDraft = this.sessionId.startsWith('draft-') && c.busy;
      this.sessionId = session?.id ?? ''; this.clearMessages(); this.closePopup();
      if (!sameDraft) {const draft = this.drafts.get(this.sessionId); this.input.value = draft?.text ?? ''; this.attachments = draft?.attachments ?? []; this.renderAttachments(); this.resizeInput();}
    }
    this.statusEl.textContent = c.status;
    this.contentEl.toggleClass('is-connected', c.rpc.ready); this.contentEl.toggleClass('is-busy', c.busy);
    this.connectButton.hidden = c.rpc.ready && !!c.account; this.connectButton.disabled = c.connecting;
    this.connectButton.textContent = c.connecting ? this.t('连接中…') : c.rpc.ready ? this.t('登录') : this.t('连接 Codex');
    this.accessButton.empty(); const accessIcon = this.accessButton.createSpan(); setIcon(accessIcon, ACCESS_ICONS[c.data.settings.access]); this.accessButton.createSpan({text: this.t(ACCESS_LABELS[c.data.settings.access])});
    this.accessButton.toggleClass('is-full', c.data.settings.access === 'full'); this.accessButton.disabled = c.busy;
    setAccessibleName(this.accessButton, this.t(ACCESS_LABELS[c.data.settings.access]));
    const modelName = (c.model?.displayName ?? c.data.settings.model).replace(/^(GPT-\d+(?:\.\d+)?)-/i, '$1 ') || this.t('选择模型');
    const effortName = this.t(EFFORT_LABELS[c.data.settings.effort] ?? '默认');
    this.effortButton.empty();
    this.effortButton.createSpan({cls: 'codex-current-model', text: modelName});
    this.effortButton.createSpan({cls: 'codex-current-effort', text: effortName});
    this.effortButton.toggleClass('is-ultra', c.data.settings.effort === 'ultra');
    this.fastButton.hidden = !c.fastEnabled; this.fastButton.disabled = c.busy;
    this.fastButton.setAttribute('aria-pressed', String(c.fastEnabled));
    const chevron = this.effortButton.createSpan({cls: 'codex-model-chevron', attr: {'aria-hidden': 'true'}}); setIcon(chevron, 'chevron-down');
    setAccessibleName(this.effortButton, this.t('模型：{model}，思考强度：{effort}', {model: modelName, effort: effortName}));
    this.effortButton.disabled = c.busy;
    if (c.busy && this.popup) this.closePopup();
    const usage = contextUsage(c.session?.tokenUsage);
    this.activityEl.style.setProperty('--context-progress', `${usage?.percent ?? 0}%`);
    this.contextLabel.textContent = usage ? this.t('背景信息窗口：{used}% 已用，剩余 {remaining}%', {used: usage.percent, remaining: usage.remaining}) : this.t('背景信息窗口：尚无数据');
    this.contextText.textContent = usage ? this.t('{used}% 已用（剩余 {remaining}%）', {used: usage.percent, remaining: usage.remaining}) : this.t('尚无用量数据');
    this.contextTokens.textContent = usage ? this.t('已用 {used} 标记，共 {capacity}', {used: formatTokens(usage.used), capacity: formatTokens(usage.capacity)}) : this.t('收到 Codex 报告后更新');
    this.positionContextTooltip();
    this.messageList.setAttribute('aria-busy', String(c.busy));
    const nearBottom = this.messageList.scrollHeight - this.messageList.scrollTop - this.messageList.clientHeight < 100;
    this.welcome.hidden = !!session?.messages.length;
    const turns = conversationTurns(session);
    const ids = new Set(turns.map(turn => turn.id));
    for (const [id, entry] of this.renderedTurns) if (!ids.has(id)) {entry.el.remove(); this.renderedTurns.delete(id);}
    for (const turn of turns) this.renderTurn(turn);
    if (turns.some(turn => turn.status === 'inProgress')) {
      this.elapsedTimer ??= this.contentEl.ownerDocument.defaultView!.setInterval(() => {for (const entry of this.renderedTurns.values()) if (entry.turn.status === 'inProgress') entry.processLabel.textContent = durationLabel(entry.turn, Date.now(), this.t);}, 1000);
    } else {this.contentEl.ownerDocument.defaultView!.clearInterval(this.elapsedTimer); this.elapsedTimer = undefined;}
    if (shouldAutoScroll(c.data.settings.autoScroll, nearBottom)) this.messageList.scrollTop = this.messageList.scrollHeight;
    this.renderApprovals(); this.updateSend();
  }
  private renderTurn(turn: ConversationTurn) {
    let entry = this.renderedTurns.get(turn.id);
    if (!entry) {
      const el = this.messageList.createEl('section', {cls: 'codex-turn', attr: {'data-turn-id': turn.id}});
      setAccessibleName(el, this.t('一轮对话'));
      const user = el.createDiv({cls: 'codex-turn-user'});
      const response = el.createDiv({cls: 'codex-response'});
      const process = response.createEl('details', {cls: 'codex-process'});
      const summary = process.createEl('summary');
      const processLabel = summary.createSpan({cls: 'codex-duration'});
      const glyph = summary.createSpan({cls: 'codex-process-chevron', attr: {'aria-hidden': 'true'}}); setIcon(glyph, 'chevron-right');
      const processBody = process.createDiv({cls: 'codex-process-body'});
      const answers = response.createDiv({cls: 'codex-answers'});
      const notices = response.createDiv({cls: 'codex-turn-notices'});
      const status = response.createDiv({cls: 'codex-turn-status', attr: {role: 'status'}});
      const actions = response.createDiv({cls: 'codex-reply-actions', attr: {role: 'group'}});
      setAccessibleName(actions, this.t('回复操作'));
      iconButton(actions, 'copy', this.t('复制回复'), () => {void navigator.clipboard.writeText(answerText(entry!.turn)).then(() => new Notice(this.t('已复制'))).catch(error => this.notice(error));});
      entry = {el, user, response, process, processLabel, processBody, answers, notices, status, actions, turn, wasActive: false};
      summary.addEventListener('click', event => {if (entry!.turn.status === 'inProgress' || !entry!.turn.progress.length) event.preventDefault();});
      this.renderedTurns.set(turn.id, entry);
    }
    entry.turn = turn;
    setAccessibleName(entry.el, this.t('一轮对话')); setAccessibleName(entry.actions, this.t('回复操作'));
    setAccessibleName(entry.actions.querySelector('button')!, this.t('复制回复'));
    const active = turn.status === 'inProgress';
    entry.el.toggleClass('is-working', active);
    entry.el.toggleClass('is-failed', turn.status === 'failed' || turn.status === 'unconfirmed');
    entry.user.hidden = !turn.user; if (turn.user) this.renderMessage(turn.user, entry.user);
    entry.processLabel.textContent = durationLabel(turn, Date.now(), this.t);
    entry.process.toggleClass('has-progress', !!turn.progress.length);
    const summary = entry.process.querySelector('summary')!;
    summary.setAttribute('aria-disabled', String(active || !turn.progress.length));
    summary.tabIndex = active || !turn.progress.length ? -1 : 0;
    if (active) entry.process.open = true;
    else if (entry.wasActive || !turn.progress.length) entry.process.open = false;
    entry.wasActive = active;
    this.renderMessages(turn.progress, entry.processBody);
    this.renderMessages(turn.answers, entry.answers);
    this.renderMessages(turn.notices, entry.notices);
    const text = answerText(turn);
    const statuses = {inProgress: '', completed: '', failed: turn.notices.length ? '' : turn.error ? this.t('生成失败：{error}', {error: turn.error}) : this.t('生成失败'), interrupted: this.t('已停止生成'), unconfirmed: this.t('发送状态尚未确认，请先检查连接。')};
    entry.status.textContent = statuses[turn.status]; entry.status.hidden = !entry.status.textContent;
    entry.response.hidden = !active && !text && !turn.progress.length && !turn.notices.length && !entry.status.textContent;
    entry.actions.hidden = active || !text;
  }
  private renderMessages(messages: Message[], parent: HTMLElement) {
    messages.forEach((message, index) => {
      this.renderMessage(message, parent);
      const el = this.rendered.get(message.id)!.el;
      if (parent.children[index] !== el) parent.insertBefore(el, parent.children[index] ?? null);
    });
  }
  private renderMessage(message: Message, parent: HTMLElement) {
    let entry = this.rendered.get(message.id);
    if (!entry) {
      const el = parent.createDiv({cls: `codex-message codex-message-${message.role}`, attr: {'data-message-id': message.id}});
      let body: HTMLElement;
      if (message.role === 'tool') {
        el.createSpan({cls: 'codex-tool-icon', attr: {'aria-hidden': 'true'}});
        body = el.createSpan({cls: 'codex-tool-title'});
      } else body = el.createDiv({cls: 'codex-message-body'});
      entry = {el, body, text: ''}; this.rendered.set(message.id, entry);
      if (message.role === 'assistant') {
        const target = entry;
        body.addClass('markdown-rendered');
        entry.renderer = new StreamRenderer<{stage: HTMLElement; component: Component}>(async text => {
          const component = new Component(); this.addChild(component);
          const stage = target.body.ownerDocument.defaultView!.createDiv();
          try {await MarkdownRenderer.render(this.app, text, stage, '', component);}
          catch {stage.textContent = text; stage.addClass('is-plain');}
          return {stage, component};
        }, value => {
          const nearBottom = this.messageList.scrollHeight - this.messageList.scrollTop - this.messageList.clientHeight < 100;
          target.body.replaceChildren(...Array.from(value.stage.childNodes));
          target.body.toggleClass('is-plain', value.stage.hasClass('is-plain'));
          if (target.component) this.removeChild(target.component); target.component = value.component;
          if (shouldAutoScroll(this.controller.data.settings.autoScroll, nearBottom)) this.messageList.scrollTop = this.messageList.scrollHeight;
        }, value => {this.removeChild(value.component);});
      }
    }
    if (entry.el.parentElement !== parent) parent.appendChild(entry.el);
    const streaming = message.role === 'assistant' && message.status === 'inProgress';
    const key = `${message.text}\0${message.status ?? ''}\0${message.phase ?? ''}\0${message.title ?? ''}`;
    if (entry.text === key) return; entry.text = key;
    if (message.role === 'tool') {
      const icons = {command: 'terminal', file: 'file-pen-line', search: 'search', mcp: 'plug', review: 'shield-check'};
      setIcon(entry.el.querySelector('.codex-tool-icon') as HTMLElement, icons[message.toolKind ?? 'command']);
      const labels = {command: [this.t('正在运行命令'), this.t('已运行命令')], file: [this.t('正在修改文件'), this.t('已修改文件')], search: [this.t('正在搜索网页'), this.t('已搜索网页')], mcp: [this.t('正在调用工具'), this.t('已调用工具')], review: [this.t('正在审批操作'), message.title ?? this.t('已完成审批')]};
      entry.body.textContent = message.status === 'failed' ? this.t('操作失败') : message.status === 'declined' ? this.t('已拒绝操作') : message.status === 'interrupted' ? this.t('操作已中断') : labels[message.toolKind ?? 'command'][message.status === 'inProgress' ? 0 : 1];
      entry.el.toggleClass('is-running', message.status === 'inProgress');
      entry.el.toggleClass('has-error', ['failed', 'declined', 'interrupted'].includes(message.status ?? ''));
    }
    if (entry.renderer) entry.renderer.update(message.text, streaming);
    else if (message.role !== 'tool') {entry.body.textContent = message.text; entry.body.addClass('is-plain');}
    entry.el.toggleClass('is-streaming', streaming);
    entry.el.toggleClass('is-progress', message.phase === 'commentary' || message.phase === 'plan');
    entry.el.toggleClass('is-unconfirmed', message.status === '发送未确认');
  }
  private renderApprovals() {
    const requests = this.controller.approvals;
    const key = this.locale + requests.map(request => String(request.id)).join('|'); if (key === this.approvalKey) return; this.approvalKey = key;
    const answers = new Map(Array.from(this.approvalEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-question-id]')).map(input => [input.dataset.questionId!, input.value]));
    this.approvalEl.empty();
    for (const request of requests) this.renderApproval(request);
    for (const input of Array.from(this.approvalEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-question-id]'))) if (answers.has(input.dataset.questionId!)) input.value = answers.get(input.dataset.questionId!)!;
  }
  private renderApproval(request: RpcEvent) {
    const card = this.approvalEl.createDiv({cls: 'codex-approval', attr: {role: 'region'}}); const p = eventParams(request.params);
    setAccessibleName(card, this.t('Codex 需要你的回复'));
    const isQuestion = request.method.endsWith('requestUserInput');
    card.createEl('h4', {text: isQuestion ? this.t('Codex 需要你的回复') : this.t('允许这次操作？')});
    const answer = (value: unknown) => {try {this.controller.answer(request, value);} catch (error) {this.notice(error);}};
    if (isQuestion) {
      const fields: {id: string; input: HTMLInputElement; select?: HTMLSelectElement}[] = [];
      for (const question of p.questions ?? []) {
        const label = card.createEl('label', {text: question.question});
        let select: HTMLSelectElement | undefined;
        if (question.options?.length) {select = label.createEl('select'); select.createEl('option', {value: '', text: this.t('选择回答…')}); for (const option of question.options) select.createEl('option', {value: option.label, text: `${option.label}${option.description ? ` — ${option.description}` : ''}`});}
        if (select) select.dataset.questionId = `${request.id}:${question.id}:select`;
        const input = label.createEl('input', {type: question.isSecret ? 'password' : 'text', attr: {placeholder: this.t('也可以输入回答…')}}); fields.push({id: question.id, input, select});
        input.dataset.questionId = `${request.id}:${question.id}:input`;
      }
      const submit = card.createEl('button', {text: this.t('提交回复'), cls: 'mod-cta'}); submit.onclick = () => {const answers: Record<string, {answers: string[]}> = {}; for (const field of fields) {const value = field.input.value.trim() || field.select?.value; if (!value) {new Notice(this.t('请回答所有问题后提交。')); return;} answers[field.id] = {answers: [value]};} answer({answers});};
    } else {
      card.createEl('p', {text: p.reason ?? this.t('Codex 请求执行以下操作。')});
      card.createEl('pre', {text: p.command ?? (p.permissions ? JSON.stringify(p.permissions, null, 2) : this.t('修改文件{path}', {path: p.grantRoot ? `: ${p.grantRoot}` : ''}))});
      const buttons = card.createDiv({cls: 'codex-approval-buttons'});
      const permission = request.method === 'item/permissions/requestApproval';
      const deny = buttons.createEl('button', {text: this.t('拒绝')}); deny.onclick = () => answer(permission ? {permissions: {}, scope: 'turn'} : {decision: 'decline'});
      const allow = buttons.createEl('button', {text: this.t('允许这一次'), cls: 'mod-cta'});
      allow.disabled = !permission && Array.isArray(p.availableDecisions) && !p.availableDecisions.includes('accept');
      allow.onclick = () => answer(permission ? {permissions: p.permissions, scope: 'turn'} : {decision: 'accept'});
    }
  }
}
class FilePicker extends FuzzySuggestModal<TFile> {
  constructor(app: CodexView['app'], private choose: (file: TFile) => void, private readonly t: Translate = defaultTranslate) {super(app); this.setPlaceholder(this.t('搜索笔记、文本文件或图片…'));}
  getItems() {return this.app.vault.getFiles().filter(file => ['md', 'txt', 'json', 'csv', 'png', 'jpg', 'jpeg', 'webp', 'gif'].includes(file.extension.toLowerCase()));}
  getItemText(file: TFile) {return file.path;}
  onChooseItem(file: TFile) {this.choose(file);}
}
class SessionPicker extends FuzzySuggestModal<Session> {
  private get t() {return this.i18n.t;}
  constructor(app: CodexView['app'], private sessions: Session[], private choose: (session: Session) => void, private i18n = new I18n()) {super(app); this.setPlaceholder(this.t('搜索历史对话…'));}
  getItems() {return [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt);}
  getItemText(session: Session) {return `${session.id.startsWith('draft-') ? this.t('新对话') : session.title} · ${new Date(session.updatedAt).toLocaleDateString(this.i18n.locale)}`;}
  onChooseItem(session: Session) {this.choose(session);}
}
