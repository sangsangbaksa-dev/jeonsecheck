// AI 설명 패널 로직. 네트워크 호출은 requestAdvice 한 곳뿐이며 사용자가 버튼을 누를 때만 실행된다.
// 전송 데이터는 숫자와 주택 유형, 계약 형태뿐이다. 주소·이름·메모는 절대 보내지 않는다.
import { PROPERTY_TYPES, LEASE_TYPES, formatPct } from './logic.js';

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
 */
export function buildAdvicePayload(p, analysis) {
  if (!analysis || !analysis.ok) return null;
  const typeLabel = PROPERTY_TYPES.find((t) => t.value === p.type)?.label ?? '알 수 없음';
  const leaseLabel = LEASE_TYPES.find((t) => t.value === p.lease)?.label ?? '알 수 없음';
  const payload = {
    주택유형: typeLabel,
    계약형태: leaseLabel,
    예상매매시세_원: p.market,
    내보증금_원: p.deposit,
    선순위근저당합계_원: p.seniorMortgage,
    선순위임차보증금합계_원: p.seniorTenant,
    위험비율_퍼센트: Math.round(analysis.ratioPct * 10) / 10,
    등급: analysis.band.label,
    하락10퍼센트_등급: analysis.scenarios[0]?.band.label ?? null,
    하락20퍼센트_등급: analysis.scenarios[1]?.band.label ?? null,
    경매노출_원: analysis.auction.exposed,
  };
  const prompt = [
    '너는 한국 전세 계약의 보증금 위험을 설명하는 도우미다. 아래 숫자만 근거로 쉬운 한국어로 설명하라.',
    '법률·세무 자문이 아니라는 점을 summary 안에 한 번 밝혀라. 보장된 안전이라고 말하지 마라.',
    '임대인 또는 중개사에게 물어볼 질문을 정확히 3개 제시하라.',
    '응답은 아래 형식의 JSON 객체 하나만 출력하라. 다른 텍스트나 코드블록을 붙이지 마라.',
    '{"summary": "2~4문장 설명", "questions": ["질문1", "질문2", "질문3"]}',
    '',
    '데이터(JSON):',
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
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: '응답이 비어 있어요.' };
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, error: '응답에서 JSON을 찾지 못했어요.' };
  let obj;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return { ok: false, error: '응답 JSON을 해석하지 못했어요.' };
  }
  if (!obj || typeof obj !== 'object') return { ok: false, error: '응답 형식이 올바르지 않아요.' };
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  if (summary.length === 0) return { ok: false, error: '설명(summary)이 없어요.' };
  if (!Array.isArray(obj.questions) || obj.questions.length < 3) {
    return { ok: false, error: '질문 3개를 받지 못했어요.' };
  }
  const questions = obj.questions.slice(0, 3).map((q) => (typeof q === 'string' ? q.trim() : ''));
  if (questions.some((q) => q.length === 0)) return { ok: false, error: '비어 있는 질문이 있어요.' };
  return {
    ok: true,
    summary: summary.slice(0, MAX_SUMMARY),
    questions: questions.map((q) => q.slice(0, MAX_QUESTION)),
  };
}

/** 키 없이 쓰는 규칙 기반 설명. 같은 형태의 결과를 돌려준다. */
export function fallbackAdvice(p, analysis) {
  if (!analysis || !analysis.ok) {
    return {
      ok: false,
      summary: '시세를 입력하면 위험 설명을 볼 수 있어요.',
      questions: [],
    };
  }
  const pct = formatPct(analysis.ratioPct);
  const band = analysis.band.label;
  const sentences = [
    `위험비율은 ${pct}로 "${band}" 구간입니다. 내 보증금과 선순위 채권을 합친 금액이 예상 시세에서 차지하는 비율입니다.`,
  ];
  const s10 = analysis.scenarios[0];
  if (s10) sentences.push(`시세가 10% 떨어지면 "${s10.band.label}", 20% 떨어지면 "${analysis.scenarios[1].band.label}"로 올라갑니다.`);
  if (analysis.auction.exposed > 0) {
    sentences.push('가정한 낙찰가로 경매가 진행되면 내 보증금 일부를 돌려받지 못할 수 있습니다(단순 모델).');
  }
  sentences.push('이 설명은 입력 숫자에 대한 참고용 규칙 요약이며 법률·세무 자문이 아닙니다.');

  const questions = [];
  if (p.seniorMortgage > 0) questions.push('선순위 근저당의 실제 대출 잔액은 얼마이고, 상환 계획이 있나요?');
  if (p.seniorTenant > 0) questions.push('선순위 임차인의 보증금과 전입·확정일자 날짜를 확인할 수 있나요?');
  if (p.publicPrice === null || p.publicPrice === undefined) questions.push('이 집의 공시가격은 얼마인가요? 보증보험 가입 가능 여부를 함께 알아봐도 될까요?');
  questions.push('잔금 지급 전에 등기부를 다시 떼어 새 권리가 없는지 같이 확인해도 될까요?');
  questions.push('계약서에 권리 변동 금지와 세금 체납 없음 특약을 넣어 줄 수 있나요?');

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
  if (status === 401 || status === 403) return 'API 키가 거부되었어요. 키를 확인해 주세요.';
  if (status === 429) return '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.';
  if (status >= 500) return 'AI 서버가 응답하지 않아요. 잠시 후 다시 시도해 주세요.';
  return `요청에 실패했어요 (상태 ${status}).`;
}

/**
 * Anthropic API를 호출한다. fetchImpl 주입 가능 (테스트/호환용).
 * 반환 { ok:true, advice } 또는 { ok:false, error }.
 */
export async function requestAdvice({ key, prompt, fetchImpl = globalThis.fetch }) {
  if (!isPlausibleKey(key)) return { ok: false, error: 'API 키 형식이 맞지 않아요. (sk-ant-로 시작)' };
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
    return { ok: false, error: '네트워크 연결을 확인해 주세요.' };
  }
  if (!res.ok) return { ok: false, error: errorMessageFor(res.status) };
  let json;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: 'AI 응답을 읽지 못했어요.' };
  }
  const parsed = parseAdviceReply(extractText(json));
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, advice: parsed };
}
