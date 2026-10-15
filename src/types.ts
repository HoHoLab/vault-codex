import {LOCALES, type Language} from './i18n';
export type AccessMode = 'request' | 'auto-review' | 'full' | 'read-only';
export type PanelPlacement = 'right-sidebar' | 'left-sidebar' | 'main-tab';
export interface Settings {
  executable: string; model: string; effort: string; serviceTier: string; access: AccessMode; autoConnect: boolean;
  language: Language; sendMode: 'enter' | 'mod-enter'; panelPlacement: PanelPlacement;
  autoScroll: boolean; customInstructions: string; responseVerbosity: 'default' | 'low' | 'medium' | 'high';
}
export interface ModelInfo { id: string; model: string; displayName: string; description?: string; isDefault: boolean; defaultReasoningEffort: string; supportedReasoningEfforts: {reasoningEffort: string; description: string}[]; inputModalities?: string[]; serviceTiers?: {id: string; name: string; description: string}[]; additionalSpeedTiers?: string[]; }
export type TurnStatus = 'inProgress' | 'completed' | 'failed' | 'interrupted' | 'unconfirmed';
export interface Message { id: string; role: 'user' | 'assistant' | 'tool' | 'system'; text: string; title?: string; status?: string; turnId?: string; phase?: 'commentary' | 'partial_answer' | 'final_answer' | 'plan'; toolKind?: 'command' | 'file' | 'search' | 'mcp' | 'review'; retryInput?: {text: string; attachments: Attachment[]}; }
export interface TurnRecord {id: string; status: TurnStatus; error?: string; startedAt?: number; durationMs?: number;}
export interface TokenCounts {totalTokens: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningOutputTokens: number;}
export interface TokenUsage {total: TokenCounts; last: TokenCounts; modelContextWindow: number | null;}
export interface Session { id: string; title: string; updatedAt: number; messages: Message[]; tokenUsage?: TokenUsage; turns?: TurnRecord[]; }
export interface SavedData { settings: Settings; sessions: Session[]; activeId?: string; }
export interface Attachment { id: string; name: string; path?: string; text?: string; image?: boolean; }
export const DEFAULT_SETTINGS: Settings = { executable: '', model: '', effort: '', serviceTier: 'default', access: 'request', autoConnect: false, language: 'auto', sendMode: 'enter', panelPlacement: 'right-sidebar', autoScroll: true, customInstructions: '', responseVerbosity: 'default' };
export function normalizeSettings(saved: unknown): Settings {
  const value = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
  const settings = {...DEFAULT_SETTINGS};
  for (const key of ['executable', 'model', 'effort', 'serviceTier', 'customInstructions'] as const) if (typeof value[key] === 'string') settings[key] = value[key];
  for (const key of ['autoConnect', 'autoScroll'] as const) if (typeof value[key] === 'boolean') settings[key] = value[key];
  settings.access = migrateAccess(value.access);
  if (typeof value.language === 'string' && (value.language === 'auto' || Object.hasOwn(LOCALES, value.language))) settings.language = value.language as Language;
  if (value.sendMode === 'mod-enter') settings.sendMode = value.sendMode;
  if (value.panelPlacement === 'left-sidebar' || value.panelPlacement === 'main-tab') settings.panelPlacement = value.panelPlacement;
  if (value.responseVerbosity === 'low' || value.responseVerbosity === 'medium' || value.responseVerbosity === 'high') settings.responseVerbosity = value.responseVerbosity;
  return settings;
}
export const EFFORT_LABELS: Record<string, string> = { none: '无', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', ultra: 'Ultra' };
export function fastTier(model?: ModelInfo) {
  return model?.serviceTiers?.find(tier => ['fast', 'priority'].includes(tier.id))?.id ?? (model?.additionalSpeedTiers?.includes('fast') ? 'priority' : undefined);
}
export const ACCESS_LABELS: Record<AccessMode, string> = { 'read-only': '请求批准 · 只读', request: '请求批准', 'auto-review': '帮我批准', full: '完全访问权限' };
export const ACCESS_ICONS: Record<AccessMode, string> = { 'read-only': 'hand', request: 'hand', 'auto-review': 'shield-check', full: 'shield-alert' };
export const ACCESS_DESCRIPTIONS: Record<AccessMode, string> = {
  request: '在笔记库内工作；需要额外权限时，向你请求批准。',
  'auto-review': '需要额外权限时，由 Codex 检查风险并决定是否批准。',
  full: '无需逐次批准，可访问笔记库外文件、使用网络并执行命令。',
  'read-only': '保留旧版本的只读设置；修改文件时需要额外授权。'
};
export function migrateAccess(access: unknown): AccessMode {
  return access === 'auto-review' || access === 'full' || access === 'read-only' ? access : 'request';
}
export function contextUsage(usage?: TokenUsage) {
  const capacity = usage?.modelContextWindow;
  const tokens = usage?.last?.totalTokens;
  if (typeof capacity !== 'number' || !Number.isFinite(capacity) || capacity <= 0 || typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0) return null;
  const used = Math.min(tokens, capacity);
  const percent = Math.round(used / capacity * 100);
  return {used, capacity, percent, remaining: 100 - percent};
}
export function formatTokens(tokens: number) {return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);}
export function permissions(access: AccessMode, cwd: string) {
  if (access === 'full') return { approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'danger-full-access', sandboxPolicy: {type: 'dangerFullAccess'} };
  if (access === 'read-only') return { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only', sandboxPolicy: {type: 'readOnly', networkAccess: false} };
  return { approvalPolicy: 'on-request', approvalsReviewer: access === 'auto-review' ? 'auto_review' : 'user', sandbox: 'workspace-write', sandboxPolicy: {type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false} };
}
export function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
