import {I18n} from './i18n';
import {Modal, type App} from 'obsidian';
import type {Controller} from './controller';
import {ACCESS_DESCRIPTIONS, ACCESS_LABELS, EFFORT_LABELS} from './types';
import {PLUGIN_NAME} from './plugin-info';

export class InfoModal extends Modal {
  private get t() {return this.controller.i18n.t;}
  private unsubscribe?: () => void;
  private timer?: number;
  constructor(app: App, private controller: Controller, private version: string) {super(app);}
  onOpen() {
    this.titleEl.setText(`${PLUGIN_NAME} ${this.t('信息')}`); this.contentEl.addClass('codex-info'); this.draw();
    this.unsubscribe = this.controller.subscribe(() => {if (!this.timer) this.timer = this.contentEl.ownerDocument.defaultView!.setTimeout(() => {this.timer = undefined; this.draw();}, 150);});
  }
  onClose() {this.unsubscribe?.(); this.contentEl.ownerDocument.defaultView!.clearTimeout(this.timer); this.contentEl.empty();}
  private draw() {
    const c = this.controller; const settings = c.data.settings;
    this.contentEl.empty();
    const list = this.contentEl.createEl('dl', {cls: 'codex-info-grid'});
    const row = (label: string, value: string) => {list.createEl('dt', {text: label}); list.createEl('dd', {text: value});};
    row(this.t('状态'), c.status); row(this.t('账户'), c.account || this.t('未登录 / 未读取'));
    row(this.t('模型'), (c.model?.displayName ?? settings.model) || this.t('尚未选择'));
    row(this.t('推理强度'), this.t(EFFORT_LABELS[settings.effort] ?? settings.effort) || this.t('默认'));
    row('Fast', c.fastEnabled ? this.t('已开启') : this.t('已关闭'));
    row(this.t('权限模式'), `${this.t(ACCESS_LABELS[settings.access])} · ${this.t(ACCESS_DESCRIPTIONS[settings.access])}`);
    row(this.t('笔记库'), c.cwd); row(this.t('会话'), c.session?.id.startsWith('draft-') ? this.t('尚未发送') : c.session?.id ?? this.t('无'));
    row(this.t('待处理审批'), String(c.approvals.length)); row(this.t('插件版本'), this.version);
    const usage = c.session?.tokenUsage;
    this.contentEl.createEl('h3', {text: this.t('Token 用量')});
    if (!usage) this.contentEl.createEl('p', {cls: 'codex-info-muted', text: this.t('当前会话尚未收到 Codex 的用量数据。完成一次请求后会自动更新。')});
    else {
      const table = this.contentEl.createEl('table');
      const header = table.createEl('thead').createEl('tr'); for (const text of [this.t('用量'), this.t('最近一次报告'), this.t('会话累计')]) header.createEl('th', {text});
      const body = table.createEl('tbody');
      for (const [key, label] of [['totalTokens', this.t('总计')], ['inputTokens', this.t('输入')], ['cachedInputTokens', this.t('缓存输入')], ['outputTokens', this.t('输出')], ['reasoningOutputTokens', this.t('推理输出')]] as const) {
        const tr = body.createEl('tr'); tr.createEl('td', {text: label});
        for (const counts of [usage.last, usage.total]) tr.createEl('td', {text: typeof counts[key] === 'number' ? counts[key].toLocaleString(c.i18n.locale) : this.t('未报告')});
      }
      this.contentEl.createEl('p', {cls: 'codex-info-muted', text: this.t('模型上下文容量：{capacity}。会话累计用量不等于当前上下文占用；推理输出是输出的组成部分。', {capacity: usage.modelContextWindow?.toLocaleString(c.i18n.locale) ?? this.t('未报告')})});
    }
    if (c.lastError) {this.contentEl.createEl('h3', {text: this.t('最近一次错误')}); this.contentEl.createEl('pre', {cls: 'codex-info-error', text: this.t(c.lastError)});}
    this.contentEl.createEl('p', {cls: 'codex-info-muted', text: this.t('显示本插件连接获得的信息；这不是 ChatGPT 账户的剩余额度或账单。')});
  }
}

export class VoiceHelpModal extends Modal {
  private get t() {return this.i18n.t;}
  constructor(app: App, private reason: string, private i18n = new I18n()) {super(app);}
  onOpen() {
    this.titleEl.setText(this.t('语音输入'));
    this.contentEl.createEl('p', {text: this.reason});
    this.contentEl.createEl('p', {text: this.t('语音输入使用本机 Codex 的 ChatGPT 登录。完成录音后，音频会发送到 Codex 桌面端使用的转写服务，返回的文字先填入输入框。')});
    const win = this.contentEl.ownerDocument.defaultView!;
    const canCapture = typeof win.navigator.mediaDevices?.getUserMedia === 'function';
    this.contentEl.createEl('p', {text: this.t('当前录音接口：{status}。首次使用需要允许 Obsidian 访问麦克风。', {status: canCapture ? this.t('已提供，实际访问取决于系统权限') : this.t('未提供')})});
    const list = this.contentEl.createEl('ul');
    list.createEl('li', {text: this.t('macOS：在「系统设置 → 键盘 → 听写」开启听写，回到输入框，按你设置的听写快捷键。')});
    list.createEl('li', {text: this.t('Windows：先聚焦输入框，再按 Win + H。')});
    this.contentEl.createEl('p', {text: this.t('如果转写服务暂时不可用，可以先使用系统听写。插件不会自动切换到额外付费的 API。')});
  }
}
