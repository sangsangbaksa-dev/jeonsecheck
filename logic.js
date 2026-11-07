// jeonsecheck 순수 로직 모듈 (DOM 없음). 모든 계산·검증·날짜·ICS·CSV·저장 로직이 여기 있다.
// 이 앱의 결과는 참고용 추정치이며 법률·세무·재무 자문이 아니다. 보장된 안전을 의미하지 않는다.

/**
 * 모든 기준값은 이 객체에 모은다. 법령·수수료·시장 관행은 바뀔 수 있다.
 * 각 항목의 `기준` 문구는 화면에 그대로 노출된다. 값을 바꾸기 전에 반드시 최신 출처를 확인할 것.
 */
export const CONSTANTS = Object.freeze({
  // 작성 시점 표기. 실제 배포 전 모든 '확인 필요' 항목을 다시 검토해야 한다.
  기준일: '2026-11',
  riskBands: Object.freeze([
    // maxPct 이하(경계값 포함)면 해당 구간. 70% 정확히는 '안전'.
    Object.freeze({ maxPct: 70, label: '안전', tone: 'safe' }),
    Object.freeze({ maxPct: 80, label: '주의', tone: 'caution' }),
    Object.freeze({ maxPct: 90, label: '위험', tone: 'danger' }),
    Object.freeze({ maxPct: Infinity, label: '매우 위험', tone: 'severe' }),
  ]),
  riskBandsSource: '구간 값(70·80·90%)은 이 앱의 자체 기준이다. 법정 기준이 아니며 · 확인 필요 · 기준일 2026-11',
  scenarioDropPcts: Object.freeze([10, 20]),
  scenarioSource: '시세 하락 시나리오(10%·20%)는 가정값이다 · 확인 필요 · 기준일 2026-11',
  // 경매 낙찰가율(시세 대비 %) 가정. 사용자가 설정에서 바꿀 수 있다.
  auctionRatioPct: 80,
  auctionRatioSource: '경매 낙찰가율 80%는 가정값이다. 지역·물건별로 크게 다르다 · 확인 필요 · 기준일 2026-11',
  // 공시가격 대비 참고 비율(%). 보증보험 가입 가능성을 대략 가늠하는 용도일 뿐이다.
  publicRatioPct: 140,
  publicRatioSource: '공시가격 140%는 참고용 기준이다. 실제 보증보험(HUG·SGI) 가입 기준은 가입 기관에 확인 필요 · 기준일 2026-11',
  // 계약갱신요구권 행사 기간: 임대차 기간 만료 6개월 전 ~ 2개월 전 (주택임대차보호법 제6조의3 기준, 확인 필요).
  renewalWindow: Object.freeze({ fromMonthsBefore: 6, toMonthsBefore: 2 }),
  renewalSource: '계약갱신요구권 행사 기간(만기 6~2개월 전)은 주택임대차보호법 제6조의3 기준 · 확인 필요 · 기준일 2026-11',
  // 대항력: 전입신고(주민등록) 다음 날 0시부터 (주택임대차보호법 제3조 제1항) · 확인 필요
  opposingPowerDelayDays: 1,
  opposingPowerSource: '대항력은 전입신고를 마친 다음 날 0시부터 생긴다(주택임대차보호법 제3조 제1항) · 확인 필요 · 기준일 2026-11',
  // 표준 임대차 기간(만기 추정용). 실제 만기는 계약서를 따른다.
  defaultTermMonths: 24,
  defaultTermSource: '만기 미입력 시 계약일 + 24개월로 추정한다(추정치) · 기준일 2026-11',
  // 입력 상한 (원). 이보다 큰 값은 오타로 보고 거부한다.
  maxWon: 1_000_000_000_000, // 1조 원
  maxMemoLength: 500,
  maxNameLength: 40,
  maxAddressLength: 120,
});

export const PROPERTY_TYPES = Object.freeze([
  { value: 'apt', label: '아파트' },
  { value: 'villa', label: '빌라·다세대' },
  { value: 'officetel', label: '오피스텔' },
  { value: 'house', label: '단독·다가구' },
]);

export const LEASE_TYPES = Object.freeze([
  { value: 'jeonse', label: '전세' },
  { value: 'banjeonse', label: '반전세' },
]);

const TYPE_VALUES = PROPERTY_TYPES.map((t) => t.value);
const LEASE_VALUES = LEASE_TYPES.map((t) => t.value);

// ---------------------------------------------------------------------------
// 금액 파싱/포맷
// ---------------------------------------------------------------------------

/**
 * 사용자 입력 금액을 원 단위 정수로 바꾼다.
 * 빈 값은 { ok: true, value: null } (미입력). 음수·소수·문자·상한 초과는 오류.
 */
export function parseWon(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const s = String(raw).trim().replace(/[,\s]/g, '');
  if (s === '') return { ok: true, value: null };
  if (s.startsWith('-')) return { ok: false, error: '음수는 입력할 수 없어요.' };
  if (s.includes('.')) return { ok: false, error: '원 단위 정수로 입력해주세요. (소수점 불가)' };
  if (!/^\d+$/.test(s)) return { ok: false, error: '숫자만 입력해주세요. (예: 350000000)' };
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return { ok: false, error: '값이 너무 큽니다.' };
  if (n > CONSTANTS.maxWon) return { ok: false, error: '입력 가능한 최대 금액은 1조 원입니다.' };
  return { ok: true, value: n };
}

/** 정수 원 금액을 '3억 5,000만원' 형태로 표시한다. */
export function formatKoreanWon(n) {
  if (!Number.isSafeInteger(n) || n < 0) return '-';
  if (n === 0) return '0원';
  const eok = Math.floor(n / 1e8);
  const man = Math.floor((n % 1e8) / 1e4);
  const rest = n % 1e4;
  const parts = [];
  if (eok) parts.push(`${eok.toLocaleString('ko-KR')}억`);
  if (man) parts.push(`${man.toLocaleString('ko-KR')}만`);
  if (rest) parts.push(rest.toLocaleString('ko-KR'));
  return `${parts.join(' ')}원`;
}

/** 정수 원 금액을 '350,000,000원' 형태로 표시한다. */
export function formatWon(n) {
  if (!Number.isSafeInteger(n)) return '-';
  return `${n.toLocaleString('ko-KR')}원`;
}

/** 비율(%)을 소수 한 자리 문자열로 표시한다. 계산은 정수 연산, 표시만 소수. */
export function formatPct(pct) {
  if (!Number.isFinite(pct)) return '-';
  return `${(Math.round(pct * 10) / 10).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// 위험 분석
// ---------------------------------------------------------------------------

/**
 * 구간 판정. 정수 비교를 위해 BigInt를 쓴다.
 * 판정식: total / market <= maxPct / 100 ⇔ total*100 <= maxPct*market
 * 시나리오(하락율 d)는 가상 시세 market*(100-d)/100 로 같은 식을 쓴다.
 */
export function bandFor(total, market, dropPct = 0) {
  const T = BigInt(total);
  const M = BigInt(market);
  const D = BigInt(100 - dropPct);
  for (const band of CONSTANTS.riskBands) {
    if (band.maxPct === Infinity) return band;
    // T*100*100 <= maxPct * M * (100-d)   (양변에 100을 한 번 더 곱해 분모 제거)
    if (T * 10000n <= BigInt(band.maxPct) * M * D) return band;
  }
  return CONSTANTS.riskBands[CONSTANTS.riskBands.length - 1];
}

function isWholeNonNeg(v) {
  return Number.isSafeInteger(v) && v >= 0;
}

/**
 * 한 물건을 분석한다.
 * 입력 p: { market, deposit, seniorMortgage, seniorTenant, publicPrice? }  (원 단위 정수, publicPrice는 null 가능)
 * settings: { auctionRatioPct, publicRatioPct } (미지정 시 CONSTANTS 기본값)
 * 반환 ok=false 이면 reason으로 원인을 알 수 있다: MISSING | INVALID | NO_MARKET
 */
export function analyzeProperty(p, settings = {}) {
  const auctionPct = settings.auctionRatioPct ?? CONSTANTS.auctionRatioPct;
  const publicPct = settings.publicRatioPct ?? CONSTANTS.publicRatioPct;
  const base = { ok: false, reason: null, totalClaims: null, ratioPct: null, band: null,
    scenarios: [], auction: null, protection: null };

  const required = [p.market, p.deposit, p.seniorMortgage, p.seniorTenant];
  if (required.some((v) => v === null || v === undefined)) return { ...base, reason: 'MISSING' };
  if (!required.every(isWholeNonNeg)) return { ...base, reason: 'INVALID' };
  if (p.publicPrice !== null && p.publicPrice !== undefined && !isWholeNonNeg(p.publicPrice)) {
    return { ...base, reason: 'INVALID' };
  }

  const { market, deposit, seniorMortgage, seniorTenant } = p;
  const totalClaims = seniorMortgage + seniorTenant + deposit; // 위험비율 분자
  const out = { ...base, totalClaims };

  if (market === 0) return { ...out, reason: 'NO_MARKET' };

  out.ratioPct = (totalClaims * 100) / market;
  out.band = bandFor(totalClaims, market, 0);
  out.ok = true;

  out.scenarios = CONSTANTS.scenarioDropPcts.map((dropPct) => {
    const marketAfter = Math.floor((market * (100 - dropPct)) / 100);
    return {
      dropPct,
      marketAfter,
      ratioPct: marketAfter > 0 ? (totalClaims * 100) / marketAfter : null,
      band: bandFor(totalClaims, market, dropPct),
    };
  });

  // 경매 노출: 낙찰가 - 선순위 채권 = 배당 가능액, 내 보증금 중 배당받지 못하는 금액 = 노출액.
  // 근저당 채권최고액은 실제 대출잔액의 상한이며, 경매비용·최우선변제 등은 반영하지 않는 단순 모델이다.
  const auctionPrice = Math.floor((market * auctionPct) / 100);
  const distributable = Math.max(0, auctionPrice - seniorMortgage - seniorTenant);
  const covered = Math.min(deposit, distributable);
  out.auction = {
    auctionPct,
    auctionPrice,
    distributable,
    covered,
    exposed: deposit - covered,
  };

  // 공시가격 참고 판정 (보증보험 가입 가능성 가늠용, 실제 기준 아님)
  if (p.publicPrice === null || p.publicPrice === undefined) {
    out.protection = { status: 'unknown', publicPct, limit: null };
  } else {
    const limit = Math.floor((p.publicPrice * publicPct) / 100);
    out.protection = {
      status: totalClaims <= limit ? 'within' : 'over',
      publicPct,
      limit,
      totalClaims,
    };
  }
  return out;
}

/** 위험비율 막대 위치(0~100). 100%를 넘으면 100으로 자른다. */
export function barPosition(ratioPct) {
  if (!Number.isFinite(ratioPct)) return 0;
  return Math.max(0, Math.min(100, ratioPct));
}

// ---------------------------------------------------------------------------
// 날짜 계산 (모든 날짜는 'YYYY-MM-DD' 문자열, UTC 기준 산술로 시간대 영향 없음)
// ---------------------------------------------------------------------------

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' → {y,m,d}. 존재하지 않는 날짜(2월 30일 등)는 null. */
export function parseYmd(s) {
  if (typeof s !== 'string') return null;
  const match = YMD_RE.exec(s);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1) return null;
  if (d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function toYmd({ y, m, d }) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y, m) {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** 월 단위 이동. 목표 달에 날짜가 없으면 말일로 맞춘다 (1/31 + 1개월 = 2/28 또는 2/29). */
export function addMonths(ymd, n) {
  const p = typeof ymd === 'string' ? parseYmd(ymd) : ymd;
  if (!p) throw new RangeError('잘못된 날짜');
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const d = Math.min(p.d, daysInMonth(y, m));
  return toYmd({ y, m, d });
}

/** 일 단위 이동 (UTC 기준). */
export function addDays(ymd, n) {
  const p = typeof ymd === 'string' ? parseYmd(ymd) : ymd;
  if (!p) throw new RangeError('잘못된 날짜');
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return toYmd({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
}

/** 두 날짜 사이 일수 (b - a). */
export function diffDays(a, b) {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  if (!pa || !pb) throw new RangeError('잘못된 날짜');
  const ms = Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d);
  return Math.round(ms / 86400000);
}

export function formatKoreanDate(ymd) {
  const p = parseYmd(ymd);
  if (!p) return '-';
  return `${p.y}년 ${p.m}월 ${p.d}일`;
}

/** 계약갱신요구권 행사 가능 기간 (만기 기준). */
export function renewalWindow(expiryYmd) {
  const { fromMonthsBefore, toMonthsBefore } = CONSTANTS.renewalWindow;
  return {
    start: addMonths(expiryYmd, -fromMonthsBefore),
    end: addMonths(expiryYmd, -toMonthsBefore),
  };
}

/**
 * 물건의 날짜 타임라인. 만기가 없고 계약일이 있으면 계약일 + 24개월을 추정 만기로 쓴다.
 * 반환: 날짜 오름차순 이벤트 배열 { key, title, date, note, estimated }
 */
export function buildTimeline(p) {
  const events = [];
  const contract = parseYmd(p.contractDate) ? p.contractDate : null;
  const moveIn = parseYmd(p.moveInDate) ? p.moveInDate : null;
  let expiry = parseYmd(p.expiryDate) ? p.expiryDate : null;
  let estimated = false;
  if (!expiry && contract) {
    expiry = addMonths(contract, CONSTANTS.defaultTermMonths);
    estimated = true;
  }

  if (contract) {
    events.push({ key: 'contract', title: '계약일', date: contract, note: '계약서 작성 및 특약 확인', estimated: false });
  }
  if (moveIn) {
    events.push({ key: 'moveIn', title: '잔금·입주일', date: moveIn, note: '입주와 같은 날 전입신고 + 확정일자', estimated: false });
    events.push({
      key: 'opposingPower',
      title: '대항력 발생일 (참고)',
      date: addDays(moveIn, CONSTANTS.opposingPowerDelayDays),
      note: '전입신고 다음 날 0시부터 효력. 확인 필요',
      estimated: false,
    });
  }
  if (expiry) {
    const window = renewalWindow(expiry);
    events.push({
      key: 'renewalStart',
      title: '계약갱신요구 가능 기간 시작',
      date: window.start,
      note: '만기 6개월 전. 확인 필요',
      estimated,
    });
    events.push({
      key: 'renewalEnd',
      title: '계약갱신요구 가능 기간 종료',
      date: window.end,
      note: '만기 2개월 전. 이 날까지 행사 의사 전달 필요 (확인 필요)',
      estimated,
    });
    events.push({
      key: 'expiry',
      title: '임대차 만기일',
      date: expiry,
      note: estimated ? '추정 만기(계약일 + 24개월). 계약서로 확인' : '보증금 반환 요구 시점은 만기 이후',
      estimated,
    });
    events.push({
      key: 'deposit',
      title: '보증금 반환 요구 시점',
      date: expiry,
      note: '만기 이후 반환 요구. 집 비우기와 동시 이행을 요구',
      estimated,
    });
    events.push({
      key: 'registrar',
      title: '임차권등기명령 검토 시점',
      date: expiry,
      note: '만기 후에도 보증금이 돌려받지 않으면 검토 (확인 필요)',
      estimated,
    });
  }
  // 같은 날짜 이벤트는 입력 순서를 유지하며 날짜 오름차순 정렬
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : a.i - b.i))
    .map((x) => x.e);
}

// ---------------------------------------------------------------------------
// 일정 상태 · 알림 (오늘 기준은 호출 측이 넘긴다. 테스트에서 고정 가능)
// ---------------------------------------------------------------------------

/** 일정 파일에 넣을 알림 선행 일수. 기본 1일. */
export const REMINDER_LEAD_DAYS = Object.freeze([1, 7, 30]);

/** 날짜 기준 상태: 'past'(지남) | 'today' | 'upcoming'(예정). */
export function timelineStatus(date, today) {
  const diff = diffDays(today, date);
  if (diff === 0) return 'today';
  return diff > 0 ? 'upcoming' : 'past';
}

/** 'D-3', '오늘', '2일 지남' 같은 표시 문구. */
export function dDayLabel(date, today) {
  const diff = diffDays(today, date);
  if (diff === 0) return '오늘';
  if (diff > 0) return `D-${diff}`;
  return `${Math.abs(diff)}일 지남`;
}

/** 오늘 이후(오늘 포함) 가장 가까운 일정. 없으면 null. events는 날짜 오름차순이어야 한다. */
export function nextEvent(events, today) {
  return events.find((e) => e.date >= today) ?? null;
}

/**
 * 알림 예정일과 상태. 알림일이 오늘보다 앞이면 'passed'(이미 지나 알림이 울리지 않음).
 * leadDays가 목록에 없으면 1일로 본다.
 */
export function reminderFor(date, today, leadDays = 1) {
  const lead = REMINDER_LEAD_DAYS.includes(leadDays) ? leadDays : 1;
  const when = addDays(date, -lead);
  const diff = diffDays(today, when); // 알림일 - 오늘
  let status;
  if (diff < 0) status = 'passed';
  else if (diff === 0) status = 'today';
  else status = 'upcoming';
  return { leadDays: lead, date: when, status };
}

// ---------------------------------------------------------------------------
// ICS (all-day 이벤트, RFC 5545)
// ---------------------------------------------------------------------------

export function escapeIcsText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** 75 옥텟 기준 줄 접기 (UTF-8 문자 경계를 지킨다). */
export function foldIcsLine(line) {
  const enc = new TextEncoder();
  const out = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    if (bytes + size > limit) {
      out.push(current);
      current = ' ' + ch;
      bytes = 1 + size;
      limit = 75;
      continue;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n');
}

function icsDate(ymd) {
  return ymd.replace(/-/g, '');
}

/**
 * 이벤트 배열 → .ics 문자열.
 * events: { uid, title, date, description } (date는 'YYYY-MM-DD')
 * stamp: 'YYYYMMDDTHHMMSSZ' (테스트를 위해 주입 가능)
 */
export function buildIcs(events, stamp, leadDays = 1) {
  const lead = REMINDER_LEAD_DAYS.includes(leadDays) ? leadDays : 1;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//jeonsecheck//KO//NONSGML v1//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const ev of events) {
    const next = addDays(ev.date, 1);
    const alarmText = lead === 1 ? `내일: ${ev.title}` : `${lead}일 뒤: ${ev.title}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(ev.uid)}@jeonsecheck`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(ev.date)}`,
      `DTEND;VALUE=DATE:${icsDate(next)}`,
      `SUMMARY:${escapeIcsText(ev.title)}`,
      `DESCRIPTION:${escapeIcsText(ev.description || '')}`,
      'BEGIN:VALARM',
      `TRIGGER:-P${lead}D`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(alarmText)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** 스프레드시트 수식 주입 방지: = + - @ 로 시작하는 문자열 앞에 ' 를 붙인다. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'number' ? String(value) : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers, rows) {
  const head = headers.map(csvCell).join(',');
  const body = rows.map((r) => r.map(csvCell).join(','));
  return [head, ...body].join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// 입력 검증 (물건 폼)
// ---------------------------------------------------------------------------

function trimmedString(raw) {
  return raw === null || raw === undefined ? '' : String(raw).trim();
}

/**
 * 폼 입력(문자열 위주)을 검증해 저장용 객체를 만든다.
 * 반환 { ok, value, errors } — errors 는 필드명 → 메시지.
 * prev: 기존 물건(수정 시) — 체크 상태 등을 유지하기 위해 사용.
 */
export function validateProperty(input, prev = null) {
  const errors = {};
  const name = trimmedString(input.name);
  if (name.length === 0) errors.name = '물건 이름을 입력해주세요.';
  else if (name.length > CONSTANTS.maxNameLength) errors.name = `이름은 ${CONSTANTS.maxNameLength}자 이하로 입력해주세요.`;

  const address = trimmedString(input.address);
  if (address.length > CONSTANTS.maxAddressLength) errors.address = `주소 메모는 ${CONSTANTS.maxAddressLength}자 이하로 입력해주세요.`;

  const memo = trimmedString(input.memo);
  if (memo.length > CONSTANTS.maxMemoLength) errors.memo = `메모는 ${CONSTANTS.maxMemoLength}자 이하로 입력해주세요.`;

  const type = TYPE_VALUES.includes(input.type) ? input.type : null;
  if (!type) errors.type = '주택 유형을 선택해주세요.';
  const lease = LEASE_VALUES.includes(input.lease) ? input.lease : null;
  if (!lease) errors.lease = '계약 형태를 선택해주세요.';

  const money = {};
  // 등기부 입력(registry)이 함께 오면 근저당 합계는 행 목록에서 계산하므로 seniorMortgage 칸은 따로 받지 않는다.
  const useRegistry = input.registry !== undefined;
  const moneyFields = [
    ['market', '예상 매매 시세', true],
    ['deposit', '내 보증금', true],
    ...(useRegistry ? [] : [['seniorMortgage', '선순위 근저당 채권최고액 합계', true]]),
    ['seniorTenant', '선순위 임차보증금 합계', true],
    ['publicPrice', '공시가격', false],
    ['monthlyRent', '월세', false],
  ];
  for (const [key, label, required] of moneyFields) {
    const parsed = parseWon(input[key]);
    if (!parsed.ok) {
      errors[key] = `${label}: ${parsed.error}`;
      money[key] = null;
    } else if (parsed.value === null) {
      if (required) errors[key] = `${label}을(를) 입력해주세요. 없으면 0을 입력하세요.`;
      money[key] = null;
    } else {
      money[key] = parsed.value;
    }
  }

  let registry = prev?.registry ? normalizeRegistry(prev.registry) : defaultRegistry();
  if (useRegistry) {
    const reg = validateRegistry(input.registry);
    if (reg.ok) {
      registry = reg.value;
      money.seniorMortgage = mortgageTotal(reg.value);
    } else {
      Object.assign(errors, reg.errors);
      money.seniorMortgage = null;
    }
  }

  const dates = {};
  for (const key of ['contractDate', 'moveInDate', 'expiryDate']) {
    const raw = trimmedString(input[key]);
    if (raw === '') {
      dates[key] = null;
    } else if (parseYmd(raw)) {
      dates[key] = raw;
    } else {
      dates[key] = null;
      errors[key] = '날짜 형식이 올바르지 않아요.';
    }
  }
  if (dates.contractDate && dates.expiryDate && dates.expiryDate <= dates.contractDate) {
    errors.expiryDate = '만기일은 계약일보다 뒤여야 해요.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, value: null, errors };

  const value = {
    id: prev?.id ?? null,
    name,
    address,
    memo,
    type,
    lease,
    market: money.market,
    deposit: money.deposit,
    seniorMortgage: money.seniorMortgage,
    seniorTenant: money.seniorTenant,
    publicPrice: money.publicPrice,
    monthlyRent: money.monthlyRent,
    contractDate: dates.contractDate,
    moveInDate: dates.moveInDate,
    expiryDate: dates.expiryDate,
    registry,
    checks: prev?.checks ? { ...prev.checks } : {},
    updatedAt: prev?.updatedAt ?? null,
  };
  return { ok: true, value, errors: {} };
}

// ---------------------------------------------------------------------------
// 등기부 요약 입력 (을구 근저당 행, 갑구 가압류 건수, 임차권등기 여부)
// 근저당 행의 합계가 위험비율의 '선순위 근저당 합계'가 된다. 가압류·임차권등기는 계산에 넣지 않고 경고로만 표시한다.
// ---------------------------------------------------------------------------

export const REGISTRY_LIMITS = Object.freeze({ maxMortgages: 10, maxSeizures: 20 });

export function defaultRegistry() {
  return { mortgages: [], seizureCount: 0, leaseRegistration: false };
}

/** 폼 입력을 검증한다. 빈 근저당 행은 오류(지우거나 금액을 넣으라는 뜻). 오류 키: mortgage-<행번호>, mortgages, seizureCount. */
export function validateRegistry(input) {
  const errors = {};
  const rows = Array.isArray(input?.mortgages) ? input.mortgages : [];
  if (rows.length > REGISTRY_LIMITS.maxMortgages) {
    errors.mortgages = `근저당은 ${REGISTRY_LIMITS.maxMortgages}건까지 입력할 수 있어요.`;
  }
  const mortgages = [];
  rows.slice(0, REGISTRY_LIMITS.maxMortgages).forEach((raw, i) => {
    const label = `근저당 ${i + 1}`;
    const parsed = parseWon(raw);
    if (!parsed.ok) errors[`mortgage-${i}`] = `${label}: ${parsed.error}`;
    else if (parsed.value === null || parsed.value === 0) errors[`mortgage-${i}`] = `${label}: 채권최고액을 입력하거나 이 행을 지워 주세요.`;
    else mortgages.push(parsed.value);
  });

  const seizureRaw = trimmedString(input?.seizureCount);
  let seizureCount = 0;
  if (seizureRaw !== '') {
    if (!/^\d+$/.test(seizureRaw)) errors.seizureCount = '압류·가압류 건수는 0 이상의 정수로 입력해주세요.';
    else if (Number(seizureRaw) > REGISTRY_LIMITS.maxSeizures) errors.seizureCount = `${REGISTRY_LIMITS.maxSeizures}건 이하로 입력해주세요.`;
    else seizureCount = Number(seizureRaw);
  }

  if (Object.keys(errors).length) return { ok: false, value: null, errors };
  return {
    ok: true,
    value: { mortgages, seizureCount, leaseRegistration: input?.leaseRegistration === true },
    errors: {},
  };
}

/** 저장된 등기부 요약을 정규화한다. 깨진 값은 버린다. */
export function normalizeRegistry(raw) {
  if (!raw || typeof raw !== 'object') return defaultRegistry();
  const mortgages = Array.isArray(raw.mortgages)
    ? raw.mortgages
      .slice(0, REGISTRY_LIMITS.maxMortgages)
      .filter((v) => Number.isSafeInteger(v) && v > 0 && v <= CONSTANTS.maxWon)
    : [];
  const seizureCount = Number.isSafeInteger(raw.seizureCount) && raw.seizureCount >= 0 && raw.seizureCount <= REGISTRY_LIMITS.maxSeizures
    ? raw.seizureCount
    : 0;
  return { mortgages, seizureCount, leaseRegistration: raw.leaseRegistration === true };
}

export function mortgageTotal(reg) {
  return normalizeRegistry(reg).mortgages.reduce((sum, v) => sum + v, 0);
}

/** 화면 표시용 요약과 경고 목록. 경고 문구에는 모두 '확인 필요'를 붙인다. */
export function summarizeRegistry(reg) {
  const r = normalizeRegistry(reg);
  const warnings = [];
  if (r.seizureCount > 0) {
    warnings.push({
      key: 'seizure',
      tone: 'danger',
      text: `등기부에 압류·가압류 ${r.seizureCount}건이 있다고 입력됐어요. 계약 전에 원인과 해제 여부를 확인하세요. (확인 필요)`,
    });
  }
  if (r.leaseRegistration) {
    warnings.push({
      key: 'leaseRegistration',
      tone: 'caution',
      text: '임차권등기가 있어요. 이미 나간 임차인이 보증금을 받지 못해 등기하는 경우가 많다는 일반 설명입니다. 등기 순위와 반환 상황을 확인하세요. (확인 필요)',
    });
  }
  return {
    mortgageTotal: r.mortgages.reduce((sum, v) => sum + v, 0),
    mortgageCount: r.mortgages.length,
    seizureCount: r.seizureCount,
    leaseRegistration: r.leaseRegistration,
    warnings,
  };
}

/** 설정 값 검증. 낙찰가율 1~100%, 공시가격 비율 50~300%. */
export function validateSettings(input) {
  const errors = {};
  const auction = Number(input.auctionRatioPct);
  const pub = Number(input.publicRatioPct);
  if (!Number.isInteger(auction) || auction < 1 || auction > 100) errors.auctionRatioPct = '낙찰가율은 1~100 사이 정수(%)로 입력해주세요.';
  if (!Number.isInteger(pub) || pub < 50 || pub > 300) errors.publicRatioPct = '공시가격 비율은 50~300 사이 정수(%)로 입력해주세요.';
  if (Object.keys(errors).length) return { ok: false, value: null, errors };
  return { ok: true, value: { auctionRatioPct: auction, publicRatioPct: pub }, errors: {} };
}

// ---------------------------------------------------------------------------
// 점검표 (단계별 체크, 물건마다 저장)
// ---------------------------------------------------------------------------

export const CHECKLIST = Object.freeze([
  Object.freeze({
    key: 'before',
    title: '계약 전',
    items: Object.freeze([
      { id: 'reg-owner', text: '등기부등본의 소유자와 임대인이 일치하는지 확인', hint: '대리인 계약이면 위임장과 인감증명서도 확인' },
      { id: 'reg-mortgage', text: '을구의 근저당권 설정액(채권최고액) 확인', hint: '채권최고액 합계가 위험비율의 선순위 근저당 칸에 들어갑니다' },
      { id: 'reg-seizure', text: '압류·가압류·가처분 등기가 없는지 확인', hint: '있으면 계약 전에 해결 방법을 협의' },
      { id: 'reg-trust', text: '신탁등기 여부 확인', hint: '신탁이면 임대인이 아닌 수탁자 동의가 필요할 수 있음 (확인 필요)' },
      { id: 'bldg-violation', text: '건축물대장에 위반건축물 표시가 없는지 확인', hint: '위반건축물이면 보증보험 가입이 어려울 수 있음 (확인 필요)' },
      { id: 'tax-arrears', text: '임대인의 국세·지방세 체납 여부 확인', hint: '임대인에게 납세증명서 제출을 요청' },
      { id: 'id-agent', text: '임대인 신분증 확인 (대리인이면 위임장·인감증명 포함)', hint: '실제 소유자와 대면 확인이 가장 확실' },
      { id: 'broker-guarantee', text: '중개사 등록 여부와 중개사고 보장(공제·보증) 가입 여부 확인', hint: '공인중개사 자격과 사무소 등록 번호 확인' },
      { id: 'insurance-check', text: '전세보증보험(HUG·SGI) 가입 가능 여부 확인', hint: '가입 기준은 기관과 시기에 따라 다름 (확인 필요)' },
    ]),
  }),
  Object.freeze({
    key: 'contract',
    title: '계약 시',
    items: Object.freeze([
      { id: 'special-clause', text: '특약 문구를 계약서에 넣기', hint: '특약 문구 탭의 예시를 참고 (법률 자문 아님)' },
      { id: 'deposit-account', text: '보증금은 임대인 본인 명의 계좌로 이체하고 영수증 보관', hint: '현금 지급이나 제3자 계좌 이체는 피하기' },
    ]),
  }),
  Object.freeze({
    key: 'move',
    title: '잔금·입주',
    items: Object.freeze([
      { id: 'same-day-move', text: '잔금일 같은 날 전입신고 + 확정일자 받기', hint: '전입과 확정일자를 같은 날 처리하면 순위 관리가 쉬움' },
      { id: 'opposing-power', text: '대항력은 전입신고 다음 날 0시부터 생긴다는 점 확인', hint: '일정 탭의 대항력 발생일 참고 (확인 필요)' },
      { id: 'reg-recheck', text: '잔금 지급 전에 등기부를 다시 떼어 새 근저당·압류가 없는지 확인', hint: '계약 후 새 권리가 설정되면 계약 해제 등을 검토' },
    ]),
  }),
  Object.freeze({
    key: 'living',
    title: '거주 중',
    items: Object.freeze([
      { id: 'renewal-window', text: '계약갱신요구권 행사 기간(만기 6~2개월 전)을 캘린더에 등록', hint: '일정 탭에서 .ics 파일로 내보내기' },
      { id: 'keep-address', text: '이사하지 않는 동안 주민등록(전입)을 유지', hint: '전입이 빠지면 대항력이 끊길 수 있음' },
    ]),
  }),
  Object.freeze({
    key: 'move-out',
    title: '퇴거',
    items: Object.freeze([
      { id: 'return-order', text: '보증금 반환과 집 비우기·열쇠 전달을 동시에 하기', hint: '반환 전에 먼저 집을 비우지 않기' },
      { id: 'registrar', text: '보증금이 돌아오지 않으면 임차권등기명령 신청을 검토', hint: '등기 후에는 이사해도 대항력·우선변제권 유지 (확인 필요)' },
      { id: 'deposit-check', text: '퇴거 후 등기부에서 내 전입 말소와 새 권리 여부 확인', hint: '' },
    ]),
  }),
]);

const ALL_ITEM_IDS = new Set(CHECKLIST.flatMap((s) => s.items.map((i) => i.id)));

/** 체크 상태를 토글한 새 객체를 돌려준다 (원본 불변). 알 수 없는 id는 무시. */
export function toggleCheck(checks, id) {
  if (!ALL_ITEM_IDS.has(id)) return { ...checks };
  const next = { ...checks };
  if (next[id]) delete next[id];
  else next[id] = true;
  return next;
}

export function stageProgress(checks, stageKey) {
  const stage = CHECKLIST.find((s) => s.key === stageKey);
  if (!stage) return { done: 0, total: 0 };
  const done = stage.items.filter((i) => checks && checks[i.id]).length;
  return { done, total: stage.items.length };
}

export function overallProgress(checks) {
  let done = 0;
  let total = 0;
  for (const s of CHECKLIST) {
    const p = stageProgress(checks, s.key);
    done += p.done;
    total += p.total;
  }
  return { done, total };
}

// ---------------------------------------------------------------------------
// 특약 문구 라이브러리 (참고 예시. 법률 자문이 아니며 실제 계약 전 전문가 확인 권장)
// ---------------------------------------------------------------------------

export const CLAUSES = Object.freeze([
  {
    id: 'no-new-rights',
    title: '잔금일까지 권리변동 없음',
    text: '임대인은 잔금 지급일까지 본 주택에 근저당권, 전세권, 가압류, 압류 등 새로운 권리가 설정되지 않도록 한다.',
  },
  {
    id: 'mortgage-cancel',
    title: '근저당 설정 시 계약 해제 및 즉시 반환',
    text: '잔금 지급 전후를 불문하고 본 주택에 근저당권 등 새로운 권리가 설정된 경우 임차인은 본 계약을 해제할 수 있으며, 임대인은 지급받은 보증금 전액을 즉시 반환한다.',
  },
  {
    id: 'tax-clear',
    title: '국세·지방세 체납 없음 확인',
    text: '임대인은 계약 체결 시점에 국세 및 지방세 체납이 없음을 증명하는 자료를 제시하며, 사실과 다를 경우 임차인은 본 계약을 해제할 수 있다.',
  },
  {
    id: 'prior-disclosure',
    title: '선순위 권리 현황 고지',
    text: '임대인은 본 주택의 선순위 근저당권 및 선순위 임차보증금 현황을 확인서로 고지하며, 고지 내용이 사실과 다를 경우 임차인은 본 계약을 해제할 수 있다.',
  },
  {
    id: 'guarantee-cooperation',
    title: '전세보증보험 가입 협조',
    text: '임대인은 임차인이 전세보증금반환보증에 가입하는 데 필요한 서류 제출과 절차에 협조한다.',
  },
  {
    id: 'repair-scope',
    title: '입주 전 시설 점검·수리 범위',
    text: '임대인은 입주 전 누수, 보일러, 창호 등 주요 시설을 점검하여 수리하며, 수리 범위와 기한은 별지에 따른다.',
  },
  {
    id: 'renewal-terms',
    title: '계약갱신 조건 명시',
    text: '임차인이 주택임대차보호법상 계약갱신요구권을 행사하는 경우 임대인은 정당한 사유 없이 이를 거절하지 않으며, 갱신 시 보증금 증액 한도는 법령을 따른다.',
  },
  {
    id: 'simultaneous-return',
    title: '보증금 반환과 집 비우기 동시 이행',
    text: '임대인이 보증금을 반환하는 것과 임차인이 주택을 비우고 열쇠를 넘기는 것은 동시에 이행한다. 어느 한쪽을 먼저 요구하지 않는다.',
  },
  {
    id: 'deposit-account-owner',
    title: '보증금 이체 계좌는 임대인 명의',
    text: '임차인은 보증금을 임대인 본인 명의의 계좌로만 이체하며, 이체 내역과 영수증을 보관한다. 제3자 명의 계좌로는 이체하지 않는다.',
  },
  {
    id: 'confirm-date-cooperation',
    title: '전입·확정일자 절차 협조',
    text: '임대인은 잔금 지급일에 임차인이 전입신고와 확정일자 부여를 받을 수 있도록 필요한 서류와 절차에 협조한다.',
  },
  {
    id: 'broker-disclosure',
    title: '중개대상물 확인·설명 교부 확인',
    text: '중개사는 계약 전에 등기사항증명서와 건축물대장 등 중개대상물 확인·설명 내용을 임차인에게 교부하고 설명했음을 확인한다.',
  },
]);

/**
 * 선택한 특약 문구를 번호 붙여 한 덩어리로 만든다. 라이브러리 순서를 따르고, 없는 id는 무시한다.
 * 선택이 없으면 빈 문자열.
 */
export function composeClauses(ids) {
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  const picked = CLAUSES.filter((c) => wanted.has(c.id));
  return picked.map((c, i) => `${i + 1}. ${c.title}\n${c.text}`).join('\n\n');
}

export const CLAUSE_NOTICE = '참고 예시입니다. 법률 자문이 아니며, 실제 계약에는 상황에 맞게 전문가(공인중개사·법무사·변호사)와 함께 검토하세요.';

// ---------------------------------------------------------------------------
// 저장 · 백업
// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'jeonsecheck-v1';
export const BACKUP_APP = 'jeonsecheck';
export const BACKUP_VERSION = 1;

export function defaultData() {
  return {
    version: BACKUP_VERSION,
    settings: { auctionRatioPct: CONSTANTS.auctionRatioPct, publicRatioPct: CONSTANTS.publicRatioPct },
    properties: [],
  };
}

const MAX_PROPERTIES = 200;

/** 저장된 객체를 검증·정규화한다. 망가진 항목은 버린다. */
export function normalizeData(raw) {
  const base = defaultData();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const settingsCheck = validateSettings({
    auctionRatioPct: s.auctionRatioPct ?? CONSTANTS.auctionRatioPct,
    publicRatioPct: s.publicRatioPct ?? CONSTANTS.publicRatioPct,
  });
  if (settingsCheck.ok) base.settings = settingsCheck.value;

  if (Array.isArray(raw.properties)) {
    const seen = new Set();
    for (const item of raw.properties.slice(0, MAX_PROPERTIES)) {
      const p = normalizeProperty(item);
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        base.properties.push(p);
      }
    }
  }
  return base;
}

/** 물건 한 건을 정규화. 필드가 깨졌으면 null. */
export function normalizeProperty(item) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.id !== 'string' || item.id.length === 0 || item.id.length > 64) return null;
  const toStr = (v) => (typeof v === 'string' ? v : '');
  const toMoney = (v) => (v === null || v === undefined ? null : Number.isSafeInteger(v) && v >= 0 && v <= CONSTANTS.maxWon ? v : undefined);
  const checked = validateProperty(
    {
      name: toStr(item.name),
      address: toStr(item.address),
      memo: toStr(item.memo),
      type: item.type,
      lease: item.lease,
      market: toMoney(item.market) ?? '',
      deposit: toMoney(item.deposit) ?? '',
      seniorMortgage: toMoney(item.seniorMortgage) ?? '',
      seniorTenant: toMoney(item.seniorTenant) ?? '',
      publicPrice: toMoney(item.publicPrice),
      monthlyRent: toMoney(item.monthlyRent),
      contractDate: item.contractDate ?? '',
      moveInDate: item.moveInDate ?? '',
      expiryDate: item.expiryDate ?? '',
    },
    {
      id: item.id,
      checks: sanitizeChecks(item.checks),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
      registry: normalizeRegistry(item.registry),
    },
  );
  if (!checked.ok) return null;
  return { ...checked.value, id: item.id };
}

function sanitizeChecks(checks) {
  const out = {};
  if (!checks || typeof checks !== 'object') return out;
  for (const id of Object.keys(checks)) {
    if (ALL_ITEM_IDS.has(id) && checks[id] === true) out[id] = true;
  }
  return out;
}

/**
 * localStorage 같은 저장소 인터페이스({getItem,setItem})에서 읽는다.
 * 실패하면 기본값. 호출 측은 storage 접근 자체가 throw할 수 있으므로 try/catch로 감싼다.
 */
export function loadData(storage) {
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text) return defaultData();
    return normalizeData(JSON.parse(text));
  } catch {
    return defaultData();
  }
}

/** 저장 성공 여부를 boolean으로 돌려준다. 용량 초과 등은 false. */
export function saveData(storage, data) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** 백업 JSON 문자열 생성. 민감 정보(AI 키)는 포함하지 않는다. */
export function buildBackup(data, exportedAt) {
  return JSON.stringify(
    { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt, data: normalizeData(data) },
    null,
    2,
  );
}

/** 백업 파일을 검증한다. 형식이 틀리면 ok=false. */
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON 형식이 아니에요.' };
  }
  if (!obj || obj.app !== BACKUP_APP || obj.version !== BACKUP_VERSION || !obj.data) {
    return { ok: false, error: 'jeonsecheck 백업 파일이 아니거나 버전이 맞지 않아요.' };
  }
  const data = normalizeData(obj.data);
  return { ok: true, data };
}

/** 물건 ID 생성기. crypto가 있으면 UUID, 없으면 시간+난수 (테스트에서 주입 가능). */
export function makeId(random = Math.random, now = Date.now()) {
  return `p${now.toString(36)}${Math.floor(random() * 1e9).toString(36)}`;
}

// ---------------------------------------------------------------------------
// 물건 요약 CSV 행
// ---------------------------------------------------------------------------

export function summaryRows(properties, settings) {
  return properties.map((p) => {
    const a = analyzeProperty(p, settings);
    return [
      p.name,
      PROPERTY_TYPES.find((t) => t.value === p.type)?.label ?? '',
      LEASE_TYPES.find((t) => t.value === p.lease)?.label ?? '',
      p.market ?? '',
      p.deposit ?? '',
      p.seniorMortgage ?? '',
      p.seniorTenant ?? '',
      a.ok ? Math.round(a.ratioPct * 10) / 10 : '',
      a.ok ? a.band.label : '',
      p.expiryDate ?? '',
    ];
  });
}

export const SUMMARY_HEADERS = ['이름', '주택 유형', '계약 형태', '예상 매매 시세(원)', '내 보증금(원)', '선순위 근저당 합계(원)', '선순위 임차보증금 합계(원)', '위험비율(%)', '등급(참고)', '만기일'];

// ---------------------------------------------------------------------------
// 비교 순위 (참고). "가장 안전하다"는 판단이 아니라 입력값 기준 위험비율의 순서일 뿐이다.
// ---------------------------------------------------------------------------

/**
 * 위험비율 두 개를 정수 교차곱으로 비교한다. a < b 이면 -1, 같으면 0, 크면 1.
 * 입력: { totalClaims, market } (원 단위 정수, market > 0).
 */
export function compareRatio(a, b) {
  const left = BigInt(a.totalClaims) * BigInt(b.market);
  const right = BigInt(b.totalClaims) * BigInt(a.market);
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * 비교 대상에서 위험비율이 가장 낮은 물건을 찾는다.
 * items: [{ id, totalClaims, market, exposed }]. 계산할 수 없는 항목(시세 0, 값 누락)은 순위에서 뺀다.
 * 동률 기준: 위험비율이 같으면 경매 노출액이 작은 쪽이 앞선다.
 * 반환 { order: 순위대로 id 배열, bestIds: 1위와 위험비율·노출액이 모두 같은 id들 }.
 * 계산 가능한 물건이 2개 미만이면 bestIds는 빈 배열 (강조할 비교가 없음).
 */
export function rankSafest(items) {
  const usable = (Array.isArray(items) ? items : []).filter((x) => x
    && Number.isSafeInteger(x.totalClaims) && x.totalClaims >= 0
    && Number.isSafeInteger(x.market) && x.market > 0
    && Number.isSafeInteger(x.exposed) && x.exposed >= 0);
  const sorted = [...usable].sort((a, b) => compareRatio(a, b) || a.exposed - b.exposed);
  const order = sorted.map((x) => x.id);
  if (sorted.length < 2) return { order, bestIds: [] };
  const top = sorted[0];
  const bestIds = sorted
    .filter((x) => compareRatio(x, top) === 0 && x.exposed === top.exposed)
    .map((x) => x.id);
  return { order, bestIds };
}

// ---------------------------------------------------------------------------
// 인쇄용 점검표 모델. 화면과 같은 체크 상태를 ☐/☑ 표시로 바꾼 구조만 만든다.
// ---------------------------------------------------------------------------

export const PRINT_NOTICE = '이 목록은 계약 확인을 돕는 참고 체크리스트입니다. 등기부·건축물대장·납세 증명 등 원본 서류를 대신하지 않으며 법률 자문이 아닙니다. 기준값은 확인 필요 항목입니다.';

/**
 * p: 저장된 물건, analysis: analyzeProperty 결과(없어도 됨), today: 'YYYY-MM-DD'.
 * 메모와 주소 메모는 넣지 않는다 (인쇄물에 필요 없는 개인 정보).
 */
export function checklistPrintModel(p, today, analysis = null) {
  const checks = p.checks ?? {};
  const stages = CHECKLIST.map((s) => {
    const prog = stageProgress(checks, s.key);
    return {
      key: s.key,
      title: s.title,
      done: prog.done,
      total: prog.total,
      items: s.items.map((i) => ({
        id: i.id,
        text: i.text,
        hint: i.hint || '',
        done: Boolean(checks[i.id]),
        mark: checks[i.id] ? '☑' : '☐',
      })),
    };
  });
  const typeLabel = PROPERTY_TYPES.find((t) => t.value === p.type)?.label ?? '';
  const leaseLabel = LEASE_TYPES.find((t) => t.value === p.lease)?.label ?? '';
  const risk = analysis?.ok
    ? [`위험비율 ${formatPct(analysis.ratioPct)} (${analysis.band.label}, 참고)`, `기준일 ${CONSTANTS.기준일} · 확인 필요`]
    : [];
  return {
    title: `${p.name} · 전세 계약 점검표`,
    meta: [typeLabel, leaseLabel].filter(Boolean).join(' · '),
    printedOn: today,
    risk,
    overall: overallProgress(checks),
    stages,
    notice: PRINT_NOTICE,
  };
}
