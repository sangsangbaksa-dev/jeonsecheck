// AI 설명 패널 로직. 네트워크 호출은 requestAdvice 한 곳뿐이며 사용자가 버튼을 누를 때만 실행된다.
// 전송 데이터는 숫자와 주택 유형, 계약 형태뿐이다. 주소·이름·메모는 절대 보내지 않는다.
import { PROPERTY_TYPES, LEASE_TYPES, CONSTANTS, formatPct } from './logic.js';
import { t, getLang, LANGS } from './i18n.js';

export const AI_MODEL = 'claude-haiku-5-5';
export const AI_KEY_STORAGE = 'jeonsecheck-ai-key';
export const AI_MAX_TOKENS = 600;
export const AI_ENDPOINT = 'https://api.anthropic.com/v1/messages';

/** 키 형식만 대략 확인한다 (실제 유효성은 API가 판단). */
export function isPlausibleKey(key) {
  if (typeof key !== 'string') return false;
  const k = key.trim();
  return /^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(k);
}

/**
 * 전송할 데이터를 만든다. 입력은 analyzeProperty 결과와 물건의 숫자 필드뿐이다.
 * 반환 { payload, prompt, preview } — preview는 화면에 "이렇게 보냅니다"로 보여 준다.
 * 키 이름은 영문으로 두고, 값(주택 유형 등)만 현재 언어로 보낸다.
 */
export function buildAdvicePayload(p, analysis) {
  if (!analysis || !analysis.ok) return null;
  const typeLabel = PROPERTY_TYPES.find((x) => x.value === p.type)?.label ?? t('common.unknown');
  const leaseLabel = LEASE_TYPES.find((x) => x.value === p.lease)?.label ?? t('common.unknown');
  const payload = {
    housing_type: typeLabel,
    lease_type: leaseLabel,
    market_price_krw: p.market,
    deposit_krw: p.deposit,
    senior_mortgage_krw: p.seniorMortgage,
    senior_tenant_deposit_krw: p.seniorTenant,
    risk_ratio_pct: Math.round(analysis.ratioPct * 10) / 10,
    band: analysis.band.label,
    band_if_drop_first: analysis.scenarios[0]?.band.label ?? null,
    band_if_drop_second: analysis.scenarios[1]?.band.label ?? null,
    auction_exposed_krw: analysis.auction.exposed,
  };
  const language = LANGS[getLang()]?.name ?? 'English';
  const prompt = [
    t('ai.prompt.role', { language }),
    t('ai.prompt.disclaimer'),
    t('ai.prompt.questions'),
    t('ai.prompt.format'),
    '{"summary": "...", "questions": ["...", "...", "..."]}',
    '',
    t('ai.prompt.data'),
    JSON.stringify(payload),
  ].join('\n');
  return { payload, prompt, preview: JSON.stringify(payload, null, 2) };
}

/** Messages API 요청 본문. */
export function buildRequestBody(prompt) {
  return {
    model: AI_MODEL,
    max_tokens: AI_MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  };
}

const MAX_SUMMARY = 800;
const MAX_QUESTION = 200;

/**
 * 모델 응답 텍스트를 검증한다. 코드펜스나 앞뒤 잡담이 있어도 첫 번째 JSON 객체를 찾는다.
 * 성공: { ok:true, summary, questions[3] }, 실패: { ok:false, error }
 */
export function parseAdviceReply(text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: t('ai.empty') };
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, error: t('ai.noJson') };
  let obj;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return { ok: false, error: t('ai.badJson') };
  }
  if (!obj || typeof obj !== 'object') return { ok: false, error: t('ai.badShape') };
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  if (summary.length === 0) return { ok: false, error: t('ai.noSummary') };
  if (!Array.isArray(obj.questions) || obj.questions.length < 3) {
    return { ok: false, error: t('ai.noQuestions') };
  }
  const questions = obj.questions.slice(0, 3).map((q) => (typeof q === 'string' ? q.trim() : ''));
  if (questions.some((q) => q.length === 0)) return { ok: false, error: t('ai.emptyQuestion') };
  return {
    ok: true,
    summary: summary.slice(0, MAX_SUMMARY),
    questions: questions.map((q) => q.slice(0, MAX_QUESTION)),
  };
}

/** 키 없이 쓰는 규칙 기반 설명. 같은 형태의 결과를 돌려준다. */
export function fallbackAdvice(p, analysis) {
  if (!analysis || !analysis.ok) {
    return { ok: false, summary: t('ai.none'), questions: [] };
  }
  const pct = formatPct(analysis.ratioPct);
  const band = analysis.band.label;
  const sentences = [t('ai.fb.ratio', { p: pct, b: band })];
  const s10 = analysis.scenarios[0];
  if (s10) {
    sentences.push(t('ai.fb.drop', {
      d1: CONSTANTS.scenarioDropPcts[0],
      b1: s10.band.label,
      d2: CONSTANTS.scenarioDropPcts[1],
      b2: analysis.scenarios[1].band.label,
    }));
  }
  if (analysis.auction.exposed > 0) sentences.push(t('ai.fb.exposed'));
  sentences.push(t('ai.fb.disclaimer'));

  const questions = [];
  if (p.seniorMortgage > 0) questions.push(t('ai.q.mortgage'));
  if (p.seniorTenant > 0) questions.push(t('ai.q.tenant'));
  if (p.publicPrice === null || p.publicPrice === undefined) questions.push(t('ai.q.public'));
  questions.push(t('ai.q.recheck'));
  questions.push(t('ai.q.clause'));

  return {
    ok: true,
    summary: sentences.join(' '),
    questions: questions.slice(0, 3),
  };
}

/** 응답 본문(Messages API 형식)에서 텍스트 블록을 모은다. */
export function extractText(responseJson) {
  const blocks = Array.isArray(responseJson?.content) ? responseJson.content : [];
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/** HTTP 상태를 사용자 문구로 바꾼다. */
export function errorMessageFor(status) {
  if (status === 401 || status === 403) return t('ai.s401');
  if (status === 429) return t('ai.s429');
  if (status >= 500) return t('ai.s500');
  return t('ai.sOther', { s: status });
}

/**
 * Anthropic API를 호출한다. fetchImpl 주입 가능 (테스트/호환용).
 * 반환 { ok:true, advice } 또는 { ok:false, error }.
 */
export async function requestAdvice({ key, prompt, fetchImpl = globalThis.fetch }) {
  if (!isPlausibleKey(key)) return { ok: false, error: t('ai.keyFormat') };
  let res;
  try {
    res = await fetchImpl(AI_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(buildRequestBody(prompt)),
    });
  } catch {
    return { ok: false, error: t('ai.network') };
  }
  if (!res.ok) return { ok: false, error: errorMessageFor(res.status) };
  let json;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: t('ai.readFail') };
  }
  const parsed = parseAdviceReply(extractText(json));
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, advice: parsed };
}
