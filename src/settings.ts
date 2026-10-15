import {Notice, PluginSettingTab, type App, type SettingDefinitionItem} from 'obsidian';
import type CodexPlugin from './main';
import {LOCALES, type Language} from './i18n';
import {errorText, type Settings, type PanelPlacement} from './types';

export class CodexSettings extends PluginSettingTab {
  constructor(app: App, private plugin: CodexPlugin) {super(app, plugin);}
  getSettingDefinitions(): SettingDefinitionItem[] {
    const c = this.plugin.controller, settings = c.data.settings, t = c.i18n.t;
    const save = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
      try {await this.plugin.setPreference(key, value);}
      catch (error) {new Notice(errorText(error)); this.update();}
    };
    return [
      {type: 'group', heading: t('通用'), cls: 'codex-settings-group', items: [
        {name: t('界面语言'), desc: t('默认跟随 Obsidian；只改变插件界面，不翻译已有对话。'), aliases: ['language', 'locale'], render: setting => {setting.addDropdown(dropdown => {
          dropdown.addOption('auto', t('跟随 Obsidian'));
          for (const [locale, name] of Object.entries(LOCALES)) dropdown.addOption(locale, name);
          dropdown.setValue(settings.language).onChange(value => {void save('language', value as Language);});
        });}},
        {name: t('发送方式'), desc: t('选择发送快捷键；Shift+Enter 始终换行。'), render: setting => {setting.addDropdown(dropdown => dropdown.addOption('enter', t('Enter 发送')).addOption('mod-enter', t('Ctrl / ⌘ + Enter 发送')).setValue(settings.sendMode).onChange(value => {void save('sendMode', value as Settings['sendMode']);}));}},
        {name: t('面板位置'), desc: t('选择聊天面板的位置；已打开的面板会移动并保留草稿。'), render: setting => {setting.addDropdown(dropdown => dropdown.addOption('right-sidebar', t('右侧栏')).addOption('left-sidebar', t('左侧栏')).addOption('main-tab', t('主编辑区')).setValue(settings.panelPlacement).onChange(value => {void save('panelPlacement', value as PanelPlacement);}));}},
        {name: t('自动滚动'), desc: t('回复时跟随到底部；向上阅读时暂停跟随。'), render: setting => {setting.addToggle(toggle => toggle.setValue(settings.autoScroll).onChange(value => {void save('autoScroll', value);}));}},
      ]},
      {type: 'group', heading: t('助手'), cls: 'codex-settings-group', items: [
        {name: t('自定义助手偏好'), desc: t('本笔记库的长期要求，例如回复语言、写作风格和笔记格式。修改后从下一次发送起生效。'), render: setting => {
          setting.setClass('codex-settings-preferences').addTextArea(input => input.setPlaceholder(t('例如：默认用中文回答，先给结论，保留笔记中的双向链接。')).setValue(settings.customInstructions).onChange(value => {void save('customInstructions', value);}));
        }},
        {name: t('回复详略'), desc: t('默认沿用本机 Codex 配置。修改后从下一次发送起生效，实际效果取决于模型支持。'), render: setting => {setting.addDropdown(dropdown => {
          for (const [value, label] of [['default', '默认'], ['low', '简洁'], ['medium', '适中'], ['high', '详细']]) dropdown.addOption(value, t(label));
          dropdown.setValue(settings.responseVerbosity).onChange(value => {void save('responseVerbosity', value as Settings['responseVerbosity']);});
        });}},
      ]},
      {type: 'group', heading: t('连接与账户'), cls: 'codex-settings-group', items: [
        {name: t('启动时连接'), desc: t('启用插件后自动启动本地 Codex 连接。'), render: setting => {setting.addToggle(toggle => toggle.setValue(settings.autoConnect).onChange(value => {void save('autoConnect', value);}));}},
        {name: t('连接状态'), desc: c.status, render: setting => {
          let button: import('obsidian').ButtonComponent;
          setting.addButton(component => {button = component.setButtonText(t('重新连接')).onClick(async () => {try {await c.reconnect();} catch (error) {new Notice(errorText(error));}});});
          // Obsidian can reuse cached definitions when reopening this tab.
          // Read live state before waiting for the next controller event.
          const refresh = () => {setting.setDesc(c.status); button.setDisabled(c.busy || c.connecting);};
          refresh();
          return c.subscribe(refresh);
        }},
        {name: t('登录 ChatGPT'), desc: t('如果本机 Codex 已经登录，无需重复登录。'), render: setting => {setting.addButton(button => button.setButtonText(t('在浏览器登录')).onClick(async () => {try {window.open(await c.login());} catch (error) {new Notice(errorText(error));}}));}},
        {name: t('当前工作目录'), desc: c.cwd},
      ]},
      {type: 'group', heading: t('高级'), cls: 'codex-settings-group', items: [
        {name: t('Codex 可执行文件'), desc: t('留空自动查找；也可以填写完整路径。修改后点击重新连接。'), render: setting => {setting.addText(input => input.setPlaceholder(t('自动检测')).setValue(settings.executable).onChange(value => {void save('executable', value);}));}},
        {name: t('插件版本'), desc: this.plugin.manifest.version},
        {name: t('本地存储'), desc: t('对话与偏好保存在本笔记库的插件数据中；Codex 也保存会话记录。麦克风录音完成后上传转写，插件不保存令牌或录音文件。')},
      ]},
    ];
  }
}
