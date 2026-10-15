import test from 'node:test';
import assert from 'node:assert/strict';
import {answerText, conversationTurns, durationLabel, type ConversationTurn} from '../src/conversation';
import type {Session} from '../src/types';

test('legacy history remains readable and gets one group per user request', () => {
  const session: Session = {id: 'old', title: 'Old', updatedAt: 0, messages: [
    {id: 'u1', role: 'user', text: '111'}, {id: 'a1', role: 'assistant', text: '**111**'},
    {id: 'u2', role: 'user', text: '222'}, {id: 'tool', role: 'tool', text: 'output'}, {id: 'a2', role: 'assistant', text: '222'}
  ]};
  const turns = conversationTurns(session);
  assert.equal(turns.length, 2); assert.equal(turns[0].user?.text, '111');
  assert.equal(answerText(turns[0]), '**111**'); assert.equal(turns[1].progress.length, 1);
  assert.equal(answerText(turns[1]), '222'); assert.equal(turns[0].status, 'completed');
});
test('elapsed time advances during work and the final duration stays fixed', () => {
  const turn: ConversationTurn = {id: 'timed', progress: [], answers: [], notices: [], status: 'inProgress', startedAt: 1000};
  assert.equal(durationLabel(turn, 1000), '已处理 0秒');
  assert.equal(durationLabel(turn, 1281000), '已处理 21分钟 20秒');
  turn.status = 'completed'; turn.durationMs = 2414000;
  assert.equal(durationLabel(turn, 999999999), '用时 40分钟 14秒');
  turn.durationMs = 3601000; assert.equal(durationLabel(turn), '用时 1小时 1秒');
});
test('missing historic timing is not reconstructed from the session modification date', () => {
  const [turn] = conversationTurns({id:'old',title:'Old',updatedAt:999999,messages:[{id:'u',role:'user',text:'hello'},{id:'a',role:'assistant',text:'world'}]});
  assert.equal(durationLabel(turn), '用时未记录');
  turn.status='inProgress';assert.equal(durationLabel(turn), '正在处理…');
  turn.status='completed';turn.durationMs=NaN;assert.equal(durationLabel(turn), '用时未记录');
});
test('progress and final answers remain distinct, including phase-unknown replies', () => {
  const session: Session = {id: 'new', title: 'New', updatedAt: 0, turns: [{id: 't', status: 'failed', error: 'offline'}], messages: [
    {id: 'u', role: 'user', text: 'test', turnId: 't'},
    {id: 'c', role: 'assistant', text: 'Working', phase: 'commentary', turnId: 't'},
    {id: 'p', role: 'assistant', text: '- [x] Plan', phase: 'plan', turnId: 't'},
    {id: 'a', role: 'assistant', text: 'Answer', phase: 'final_answer', turnId: 't'},
    {id: 'unknown', role: 'assistant', text: 'Legacy answer', turnId: 't'}
  ]};
  const [turn] = conversationTurns(session);
  assert.equal(turn.progress.length, 2); assert.equal(answerText(turn), 'Answer\n\nLegacy answer');
  assert.equal(turn.status, 'failed'); assert.equal(turn.error, 'offline');
});
