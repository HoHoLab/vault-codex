import {FileSystemAdapter, Notice, Plugin, getLanguage, type Command, type WorkspaceLeaf} from 'obsidian';
import {Controller} from './controller';
import {errorText, normalizeSettings, type SavedData, type Settings, type PanelPlacement} from './types';
import {CodexView, VIEW_TYPE, setAccessibleName} from './view';
import {I18n} from './i18n';
import {CodexSettings} from './settings';
import {PLUGIN_NAME} from './plugin-info';

export default class CodexPlugin extends Plugin {
  controller!: Controller;
  private saveQueue: Promise<void> = Promise.resolve();
  private settingsTab?: CodexSettings;
  private localizeCommands: (() => void)[] = [];
  private movingPanel = false;
  async onload() {
    const saved = await this.loadData();
    const data: SavedData = {settings: normalizeSettings(saved?.settings), sessions: Array.isArray(saved?.sessions) ? saved.sessions : [], activeId: saved?.activeId};
    const i18n = new I18n(() => data.settings.language, () => getLanguage());
    const t = i18n.t;
    if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {new Notice(t('Codex 需要桌面版本的本地笔记库。')); return;}
    this.controller = new Controller(data, this.app.vault.adapter.getBasePath(), () => this.persist(), undefined, i18n);
    this.registerView(VIEW_TYPE, leaf => new CodexView(leaf, this));
    const ribbon = this.addRibbonIcon('bot', t('打开 Vault Codex'), () => {void this.openView();});
    this.localizeCommands.push(() => setAccessibleName(ribbon, t('打开 Vault Codex')));
    const addCommand = (key: string, definition: Omit<Command, 'name'>) => {
      const command = this.addCommand({...definition, name: t(key)});
      this.localizeCommands.push(() => {command.name = `${PLUGIN_NAME}: ${t(key)}`;});
    };
    addCommand('打开聊天面板', {id: 'open', callback: () => {void this.openView();}});
    addCommand('新建对话', {id: 'new-chat', callback: () => {this.controller.newSession(); void this.openView();}});
    addCommand('将选中内容发送到 Codex', {id: 'send-selection', editorCallback: (editor, view) => {
      const text = editor.getSelection();
      if (!text) {new Notice(t('请先在笔记中选中一些文字。')); return;}
      void this.openView().then(panel => panel?.attach({id: crypto.randomUUID(), name: `${view.file?.basename ?? t('笔记')} · ${t('选中内容')}`, text}));
    }});
    for (const localize of this.localizeCommands) localize();
    this.settingsTab = new CodexSettings(this.app, this);
    this.addSettingTab(this.settingsTab);
    if (data.settings.autoConnect) this.app.workspace.onLayoutReady(() => {void this.controller.connect().catch(error => new Notice(errorText(error)));});
  }
  persist() {
    const snapshot = JSON.parse(JSON.stringify(this.controller.data));
    this.saveQueue = this.saveQueue.catch(() => {}).then(() => this.saveData(snapshot));
    return this.saveQueue;
  }
  async setPreference<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (key === 'panelPlacement') await this.movePanel(value as PanelPlacement);
    this.controller.data.settings[key] = value;
    if (key === 'language') {
      for (const localize of this.localizeCommands) localize();
      this.settingsTab?.update();
    }
    this.controller.changed(true);
  }
  private createLeaf(placement: PanelPlacement): WorkspaceLeaf | null {
    if (placement === 'main-tab') return this.app.workspace.getLeaf('tab');
    return placement === 'left-sidebar' ? this.app.workspace.getLeftLeaf(true) : this.app.workspace.getRightLeaf(true);
  }
  async openView(): Promise<CodexView | undefined> {
    let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = this.createLeaf(this.controller.data.settings.panelPlacement);
      if (!leaf) return;
      await leaf.setViewState({type: VIEW_TYPE, active: true});
    }
    await this.app.workspace.revealLeaf(leaf);
    return leaf.view instanceof CodexView ? leaf.view : undefined;
  }
  private async movePanel(placement: PanelPlacement) {
    if (placement === this.controller.data.settings.panelPlacement) return;
    const oldLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!oldLeaf || !(oldLeaf.view instanceof CodexView)) return;
    const t = this.controller.i18n.t;
    if (this.movingPanel) throw new Error(t('面板正在移动，请稍后重试。'));
    if (oldLeaf.view.voiceActive) throw new Error(t('请先结束语音输入，再移动面板。'));
    this.movingPanel = true;
    let target: WorkspaceLeaf | null = null;
    try {
      target = this.createLeaf(placement);
      if (!target) throw new Error(t('无法在所选位置打开面板。'));
      await target.setViewState({type: VIEW_TYPE, active: true});
      if (!(target.view instanceof CodexView)) throw new Error(t('无法在所选位置打开面板。'));
      await this.app.workspace.revealLeaf(target);
      const state = oldLeaf.view.captureState();
      oldLeaf.detach();
      target.view.restoreState(state);
    } catch (error) {target?.detach(); throw error;}
    finally {this.movingPanel = false;}
  }
  onunload() {if (this.controller) void this.controller.dispose().catch(() => {});}
}
