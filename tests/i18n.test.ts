import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import ts from 'typescript';
import {I18n, LOCALES, dictionaries, resolveLocale, type Language} from '../src/i18n';

test('all ten dictionaries cover every message and preserve interpolation parameters', () => {
  const keys = Object.keys(dictionaries.en).sort();
  assert.equal(Object.keys(LOCALES).length, 10);
  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    assert.deepEqual(Object.keys(dictionary).sort(), keys, locale);
    for (const key of keys) {
      assert.ok(dictionary[key].trim(), `${locale}: ${key}`);
      assert.deepEqual([...dictionary[key].matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort(), [...key.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort(), `${locale}: ${key}`);
    }
  }
});

test('automatic locale uses Obsidian language, handles regions, and falls back to English', () => {
  for (const [input, expected] of [['zh','zh-CN'],['zh-Hant','zh-TW'],['zh-HK','zh-TW'],['zh_TW','zh-TW'],['ja-JP','ja'],['pt-BR','pt'],['de-DE','de'],['unsupported','en']]) assert.equal(resolveLocale(input), expected);
  let selected: Language = 'auto', host = 'ja';
  const i18n = new I18n(() => selected, () => host);
  assert.equal(i18n.t('界面语言'), '表示言語');
  selected = 'en'; host = 'zh'; assert.equal(i18n.t('界面语言'), 'Interface language');
  selected = 'auto'; assert.equal(i18n.t('界面语言'), '界面语言');
});

test('vaults have independent languages and translated parameters are inserted literally', () => {
  const en = new I18n(() => 'en'), ja = new I18n(() => 'ja');
  assert.equal(en.t('新对话'), 'New chat'); assert.equal(ja.t('新对话'), '新しいチャット'); assert.equal(en.t('新对话'), 'New chat');
  assert.equal(en.t('移除 {name}', {name: '$& <Note.md>'}), 'Remove $& <Note.md>');
  assert.equal(en.t('Unknown message'), 'Unknown message');
});

test('plugin-owned Chinese source messages all have English translations', () => {
  for (const name of readdirSync(new URL('../src/', import.meta.url)).filter(name => name.endsWith('.ts'))) {
    const source = ts.createSourceFile(name, readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isStringLiteral(node) && /\p{Script=Han}/u.test(node.text)) assert.ok(Object.hasOwn(dictionaries.en, node.text), `${name}: ${node.text}`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});
