import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as I from '../i18n.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANG_CODES = ['ko', 'en', 'ja', 'es', 'zh'];
const slots = (s) => [...s.matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)].map((m) => m[1]).sort().join();

test('지원 언어는 다섯 개이고 기본값은 ko', () => {
  assert.deepEqual(Object.keys(I.LANGS).sort(), [...LANG_CODES].sort());
  assert.equal(I.detectLang(null, []), 'ko');
  assert.equal(I.detectLang(null, ['de-DE', 'fr']), 'ko');
});

test('detectLang: 저장된 값 우선, 그다음 브라우저 언어(다섯 개 중 하나일 때만)', () => {
  assert.equal(I.detectLang('ja', ['ko-KR']), 'ja');
  assert.equal(I.detectLang('xx', ['ko-KR']), 'ko');
  assert.equal(I.detectLang(null, ['fr-FR', 'es-MX']), 'es');
  assert.equal(I.detectLang(null, ['zh-TW']), 'zh');
  assert.equal(I.detectLang(null, ['en-GB']), 'en');
});

test('모든 언어는 ko와 같은 키를 가진다 (누락 키가 있으면 실패)', () => {
  const ko = Object.keys(I.DICT.ko).sort();
  assert.ok(ko.length > 300, `key count ${ko.length}`);
  for (const l of LANG_CODES) {
    const missing = ko.filter((k) => I.DICT[l][k] === undefined);
    const extra = Object.keys(I.DICT[l]).filter((k) => I.DICT.ko[k] === undefined);
    assert.deepEqual(missing, [], `${l} missing keys`);
    assert.deepEqual(extra, [], `${l} has keys ko does not`);
  }
});

test('빈 번역이 없다 (힌트처럼 의도적으로 빈 값인 키만 예외)', () => {
  const allowedEmpty = new Set(['ck.deposit-check.hint']);
  for (const l of LANG_CODES) {
    for (const [k, v] of Object.entries(I.DICT[l])) {
      if (allowedEmpty.has(k)) continue;
      assert.ok(typeof v === 'string' && v.trim().length > 0, `${l}.${k} is empty`);
    }
  }
});

test('플레이스홀더 {x}는 모든 언어에서 보존된다', () => {
  for (const [k, v] of Object.entries(I.DICT.ko)) {
    for (const l of LANG_CODES) {
      assert.equal(slots(I.DICT[l][k]), slots(v), `${l}.${k}`);
    }
  }
});

test('번역되지 않은 키 이름이 값으로 새지 않는다', () => {
  for (const l of LANG_CODES) {
    for (const [k, v] of Object.entries(I.DICT[l])) {
      assert.notEqual(v, k, `${l}.${k} shows its own key`);
      assert.doesNotMatch(v, /missing:|\b(app|risk|reg|ex|ai|tl|ck|cl|cmp|dt|print|form|ph|faq|footer|common|err|v|f|csv|stage|band|basis|type|lease|src)\.[a-zA-Z]/, `${l}.${k}`);
    }
  }
});

test('앱 코드와 HTML이 쓰는 모든 키는 사전에 있다', () => {
  const sources = ['app.js', 'logic.js', 'ai.js', 'index.html'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const used = new Set();
  for (const s of sources) {
    for (const m of s.matchAll(/\bt\(\s*'([^'+]+)'\s*[,)]/g)) used.add(m[1]);
    for (const m of s.matchAll(/data-i18n(?:-ph|-aria|-html)?="([^"]+)"/g)) used.add(m[1]);
  }
  // 동적으로 만드는 키: basis.<kind>, ck.<id>.text/hint, cl.<id>.title/text
  for (const k of ['input', 'calc', 'assume', 'ref']) used.add(`basis.${k}`);
  const missing = [...used].filter((k) => I.DICT.ko[k] === undefined);
  assert.deepEqual(missing, []);
  assert.ok(used.size > 300, `scanned ${used.size} keys`);
});

test('t(): 보간과 대체(fallback), 존재하지 않는 키는 키 이름을 돌려준다', () => {
  I.setLang('ko');
  assert.match(I.t('risk.grade', { g: '안전' }), /안전/);
  I.setLang('en');
  assert.equal(I.t('risk.grade', { g: 'Safe' }), 'Band: Safe');
  assert.equal(I.t('no.such.key'), 'no.such.key');
  I.setLang('ko');
});

test('저장된 언어는 try/catch로 읽고 쓴다 (저장소가 막혀도 던지지 않는다)', () => {
  const store = new Map();
  const ok = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  I.writeSavedLang('zh', ok);
  assert.equal(I.readSavedLang(ok), 'zh');
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(I.readSavedLang(blocked), null);
  assert.doesNotThrow(() => I.writeSavedLang('en', blocked));
});

test('숫자와 날짜 표기는 선택한 로캘을 따른다 (ko 기본)', async () => {
  const logic = await import('../logic.js');
  I.setLang('ko');
  assert.equal(logic.formatKoreanWon(350_000_000), '3억 5,000만원');
  assert.equal(logic.formatKoreanDate('2026-11-07'), '2026년 11월 7일');
  I.setLang('en');
  assert.match(logic.formatKoreanWon(350_000_000), /^KRW\s350,000,000$/);
  assert.match(logic.formatKoreanDate('2026-11-07'), /November 7, 2026/);
  assert.equal(logic.formatPct(78.66), '78.7%');
  I.setLang('ko');
});
