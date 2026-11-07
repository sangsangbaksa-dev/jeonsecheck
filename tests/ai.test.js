import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProperty } from '../logic.js';
import {
  isPlausibleKey, buildAdvicePayload, buildRequestBody, parseAdviceReply,
  fallbackAdvice, extractText, errorMessageFor, requestAdvice, AI_MODEL, AI_ENDPOINT,
} from '../ai.js';

const prop = {
  id: 'p1', name: '비밀이름 주식회사 집', address: '서울시 강남구 테헤란로 123', memo: '개인 메모 번호 010-1234-5678',
  type: 'villa', lease: 'jeonse', market: 300000000, deposit: 200000000,
  seniorMortgage: 60000000, seniorTenant: 0, publicPrice: null, monthlyRent: null,
};
const analysis = analyzeProperty(prop, { auctionRatioPct: 80, publicRatioPct: 140 });

describe('AI 키 형식 확인', () => {
  test('sk-ant- 형식 허용', () => {
    assert.equal(isPlausibleKey('sk-ant-api03-abcdefghijklmnopqrstu'), true);
    assert.equal(isPlausibleKey('  sk-ant-api03-abcdefghijklmnopqrstu  '), true);
  });
  test('형식이 틀린 키는 거부', () => {
    assert.equal(isPlausibleKey(''), false);
    assert.equal(isPlausibleKey('sk-proj-abcdefghijklmnopqrstuvwxyz'), false);
    assert.equal(isPlausibleKey('sk-ant-short'), false);
    assert.equal(isPlausibleKey('sk-ant-abc def ghi jkl mno pqr stu'), false);
    assert.equal(isPlausibleKey(null), false);
  });
});

describe('AI 전송 데이터 최소화', () => {
  test('주소·이름·메모·전화번호는 전송 본문에 없다', () => {
    const payload = buildAdvicePayload(prop, analysis);
    for (const bad of ['서울시', '테헤란로', '비밀이름', '주식회사', '개인 메모', '010-1234']) {
      assert.ok(!payload.prompt.includes(bad), `leaked: ${bad}`);
      assert.ok(!payload.preview.includes(bad), `leaked in preview: ${bad}`);
    }
  });
  test('숫자, 주택 유형, 계약 형태, 등급은 포함', () => {
    const payload = buildAdvicePayload(prop, analysis);
    assert.equal(payload.payload.housing_type, '빌라·다세대');
    assert.equal(payload.payload.lease_type, '전세');
    assert.equal(payload.payload.market_price_krw, 300000000);
    assert.equal(payload.payload.risk_ratio_pct, 86.7);
    assert.equal(payload.payload.band, '위험');
  });
  test('계산 불가 물건은 payload를 만들지 않는다', () => {
    const bad = analyzeProperty({ ...prop, market: 0 });
    assert.equal(buildAdvicePayload(prop, bad), null);
  });
  test('프롬프트는 JSON 한 객체만 요구한다', () => {
    const payload = buildAdvicePayload(prop, analysis);
    assert.ok(payload.prompt.includes('"questions"'));
    assert.ok(payload.prompt.includes('질문을 정확히 3개'));
  });
});

describe('요청 본문 · 모델', () => {
  test('모델·토큰 상한·메시지 형식', () => {
    const body = buildRequestBody('안녕');
    assert.equal(body.model, AI_MODEL);
    assert.equal(AI_MODEL, 'claude-haiku-5-5');
    assert.ok(body.max_tokens <= 700);
    assert.equal(body.messages[0].role, 'user');
    assert.equal(body.messages[0].content, '안녕');
  });
  test('엔드포인트는 Messages API', () => {
    assert.equal(AI_ENDPOINT, 'https://api.anthropic.com/v1/messages');
  });
});

describe('응답 파싱 (방어적)', () => {
  const good = '{"summary":"위험비율이 86.7%입니다. 참고용입니다.","questions":["질문 하나","질문 둘","질문 셋"]}';
  test('정상 JSON', () => {
    const r = parseAdviceReply(good);
    assert.equal(r.ok, true);
    assert.equal(r.questions.length, 3);
  });
  test('코드펜스와 앞뒤 잡담이 있어도 객체를 찾는다', () => {
    const r = parseAdviceReply('여기 결과입니다.\n```json\n' + good + '\n```\n끝');
    assert.equal(r.ok, true);
  });
  test('질문이 4개면 앞 3개만 사용', () => {
    const r = parseAdviceReply('{"summary":"s","questions":["a","b","c","d"]}');
    assert.deepEqual(r.questions, ['a', 'b', 'c']);
  });
  test('질문 부족, 빈 질문, 빈 요약, 잘못된 JSON은 실패', () => {
    assert.equal(parseAdviceReply('{"summary":"s","questions":["a","b"]}').ok, false);
    assert.equal(parseAdviceReply('{"summary":"s","questions":["a","","c"]}').ok, false);
    assert.equal(parseAdviceReply('{"summary":"  ","questions":["a","b","c"]}').ok, false);
    assert.equal(parseAdviceReply('{"summary": 5, "questions": ["a","b","c"]}').ok, false);
    assert.equal(parseAdviceReply('{broken').ok, false);
    assert.equal(parseAdviceReply('').ok, false);
    assert.equal(parseAdviceReply(null).ok, false);
    assert.equal(parseAdviceReply('그냥 문장만 있음').ok, false);
  });
  test('길이 상한으로 잘린다', () => {
    const long = 'a'.repeat(5000);
    const r = parseAdviceReply(`{"summary":"${long}","questions":["${long}","b","c"]}`);
    assert.ok(r.summary.length <= 800);
    assert.ok(r.questions[0].length <= 200);
  });
  test('extractText는 text 블록만 모은다', () => {
    const t = extractText({ content: [{ type: 'thinking', text: 'x' }, { type: 'text', text: 'A' }, { type: 'text', text: 'B' }] });
    assert.equal(t, 'A\nB');
    assert.equal(extractText({}), '');
  });
});

describe('규칙 기반 설명 (키 없음)', () => {
  test('같은 형태(summary, 질문 3개)를 돌려준다', () => {
    const fb = fallbackAdvice(prop, analysis);
    assert.equal(fb.ok, true);
    assert.ok(fb.summary.includes('86.7%'));
    assert.ok(fb.summary.includes('위험'));
    assert.equal(fb.questions.length, 3);
  });
  test('계산 불가면 안내만', () => {
    const fb = fallbackAdvice(prop, analyzeProperty({ ...prop, market: 0 }));
    assert.equal(fb.ok, false);
    assert.equal(fb.questions.length, 0);
  });
  test('선순위가 없고 공시가격이 있으면 해당 질문을 넣지 않는다', () => {
    const clean = { ...prop, seniorMortgage: 0, publicPrice: 1 };
    const fb = fallbackAdvice(clean, analyzeProperty(clean));
    assert.ok(!fb.questions.some((q) => q.includes('근저당')));
    assert.ok(!fb.questions.some((q) => q.includes('공시가격')));
  });
});

describe('API 호출 (fetch 주입, 네트워크 없음)', () => {
  const okJson = (text) => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) });

  test('헤더와 본문이 명세대로 나간다', async () => {
    let seen;
    const fetchImpl = async (url, init) => { seen = { url, init }; return okJson(good()); };
    const r = await requestAdvice({ key: 'sk-ant-api03-abcdefghijklmnopqrstu', prompt: 'p', fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(seen.url, AI_ENDPOINT);
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers['x-api-key'], 'sk-ant-api03-abcdefghijklmnopqrstu');
    assert.equal(seen.init.headers['anthropic-version'], '2023-06-01');
    assert.equal(seen.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
    assert.equal(JSON.parse(seen.init.body).model, 'claude-haiku-5-5');
  });
  test('키 형식이 틀리면 네트워크를 쓰지 않는다', async () => {
    let called = false;
    const r = await requestAdvice({ key: 'nope', prompt: 'p', fetchImpl: async () => { called = true; } });
    assert.equal(r.ok, false);
    assert.equal(called, false);
  });
  test('HTTP 오류 상태를 사용자 문구로 바꾼다', async () => {
    const r = await requestAdvice({ key: 'sk-ant-api03-abcdefghijklmnopqrstu', prompt: 'p', fetchImpl: async () => ({ ok: false, status: 401 }) });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('키'));
    assert.ok(errorMessageFor(429).includes('잠시'));
  });
  test('네트워크 예외와 잘못된 응답을 처리', async () => {
    const net = await requestAdvice({ key: 'sk-ant-api03-abcdefghijklmnopqrstu', prompt: 'p', fetchImpl: async () => { throw new TypeError('x'); } });
    assert.equal(net.ok, false);
    const bad = await requestAdvice({ key: 'sk-ant-api03-abcdefghijklmnopqrstu', prompt: 'p', fetchImpl: async () => okJson('no json here') });
    assert.equal(bad.ok, false);
  });
});

function good() {
  return '{"summary":"s","questions":["a","b","c"]}';
}
