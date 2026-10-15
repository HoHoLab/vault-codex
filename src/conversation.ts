import {defaultTranslate, type Translate} from './i18n';
import type {Message, Session, TurnStatus} from './types';

export interface ConversationTurn {
  id: string;
  user?: Message;
  progress: Message[];
  answers: Message[];
  notices: Message[];
  status: TurnStatus;
  error?: string;
  startedAt?: number;
  durationMs?: number;
}

// Older saved conversations have neither turn IDs nor phases. Keep their
// replies visible and group them by the preceding user message.
export function conversationTurns(session?: Session): ConversationTurn[] {
  if (!session) return [];
  const groups = new Map<string, ConversationTurn>();
  let previous = 'legacy-start';
  for (const message of session.messages) {
    if (message.role === 'user') previous = message.turnId ?? `legacy-${message.id}`;
    const id = message.turnId ?? previous;
    let group = groups.get(id);
    if (!group) {
      const record = session.turns?.find(turn => turn.id === id);
      group = {id, progress: [], answers: [], notices: [], status: record?.status ?? (message.status === '发送未确认' ? 'unconfirmed' : 'completed'), error: record?.error, startedAt: record?.startedAt, durationMs: record?.durationMs};
      groups.set(id, group);
    }
    if (message.role === 'user') group.user = message;
    else if (message.role === 'tool' || message.phase === 'commentary' || message.phase === 'plan') group.progress.push(message);
    else if (message.role === 'assistant') group.answers.push(message);
    else group.notices.push(message);
  }
  return [...groups.values()];
}

export function answerText(turn: ConversationTurn) {return turn.answers.map(message => message.text).filter(Boolean).join('\n\n');}

export function durationLabel(turn: ConversationTurn, now = Date.now(), t: Translate = defaultTranslate) {
  const active = turn.status === 'inProgress';
  const duration = active && typeof turn.startedAt === 'number' && Number.isFinite(turn.startedAt) ? Math.max(0, now - turn.startedAt) : turn.durationMs;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) return active ? t('正在处理…') : t('用时未记录');
  const seconds = Math.floor(duration / 1000), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  const text = [hours ? t('{n}小时', {n: hours}) : '', minutes ? t('{n}分钟', {n: minutes}) : '', t('{n}秒', {n: seconds % 60})].filter(Boolean).join(' ');
  return t(active ? '已处理 {time}' : '用时 {time}', {time: text});
}
