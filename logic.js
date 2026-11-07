// jeonsecheck 순수 로직 모듈 (DOM 없음). 모든 계산·검증·날짜·ICS·CSV·저장 로직이 여기 있다.
// 이 앱의 결과는 참고용 추정치이며 법률·세무·재무 자문이 아니다. 보장된 안전을 의미하지 않는다.
// 사용자에게 보이는 문구는 모두 i18n.js 의 t()로 가져온다. 기본 언어는 ko 이다.

import { t, getLang, localeTag } from './i18n.js';

const AS_OF = '2026-11';
const src = (key) => t(key, { d: AS_OF });
const isKo = () => getLang() === 'ko';
const fmtInt = (n) => new Intl.NumberFormat(localeTag()).format(n);

/**
 * 모든 기준값은 이 객체에 모은다. 법령·수수료·시장 관행은 바뀔 수 있다.
 * 출처 문구(src.*)는 화면에 그대로 노출된다. 값을 바꾸기 전에 반드시 최신 출처를 확인할 것.
 */
export const CONSTANTS = Object.freeze({
  // 작성 시점 표기. 실제 배포 전 모든 '확인 필요' 항목을 다시 검토해야 한다.
  기준일: AS_OF,
  riskBands: Object.freeze([
    // maxPct 이하(경계값 포함)면 해당 구간. 70% 정확히는 '안전'.
    band(70, 'band.safe', 'safe'),
    band(80, 'band.caution', 'caution'),
    band(90, 'band.danger', 'danger'),
    band(Infinity, 'band.severe', 'severe'),
  ]),
  get riskBandsSource() { return src('src.riskBands'); },
  scenarioDropPcts: Object.freeze([10, 20]),
  get scenarioSource() { return src('src.scenario'); },
  // 경매 낙찰가율(시세 대비 %) 가정. 사용자가 설정에서 바꿀 수 있다.
  auctionRatioPct: 80,
  get auctionRatioSource() { return src('src.auction'); },
  // 공시가격 대비 참고 비율(%). 보증보험 가입 가능성을 대략 가늠하는 용도일 뿐이다.
  publicRatioPct: 140,
  get publicRatioSource() { return src('src.publicRatio'); },
  // 계약갱신요구권 행사 기간: 임대차 기간 만료 6개월 전 ~ 2개월 전 (주택임대차보호법 제6조의3 기준, 확인 필요).
  renewalWindow: Object.freeze({ fromMonthsBefore: 6, toMonthsBefore: 2 }),
  get renewalSource() { return src('src.renewal'); },
  // 대항력: 전입신고(주민등록) 다음 날 0시부터 (주택임대차보호법 제3조 제1항) · 확인 필요
  opposingPowerDelayDays: 1,
  get opposingPowerSource() { return src('src.opposing'); },
  // 표준 임대차 기간(만기 추정용). 실제 만기는 계약서를 따른다.
  defaultTermMonths: 24,
  get defaultTermSource() { return src('src.defaultTerm'); },
  // 입력 상한 (원). 이보다 큰 값은 오타로 보고 거부한다.
  maxWon: 1_000_000_000_000, // 1조 원
  maxMemoLength: 500,
  maxNameLength: 40,
  maxAddressLength: 120,
});

function band(maxPct, key, tone) {
  return Object.freeze({ maxPct, tone, key, get label() { return t(key); } });
}

function option(value, key) {
  return Object.freeze({ value, key, get label() { return t(key); } });
}

export const PROPERTY_TYPES = Object.freeze([
  option('apt', 'type.apt'),
  option('villa', 'type.villa'),
  option('officetel', 'type.officetel'),
  option('house', 'type.house'),
]);

export const LEASE_TYPES = Object.freeze([
  option('jeonse', 'lease.jeonse'),
  option('banjeonse', 'lease.banjeonse'),
]);

const TYPE_VALUES = PROPERTY_TYPES.map((x) => x.value);
const LEASE_VALUES = LEASE_TYPES.map((x) => x.value);

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
  if (s.startsWith('-')) return { ok: false, error: t('err.negative') };
  if (s.includes('.')) return { ok: false, error: t('err.decimal') };
  if (!/^\d+$/.test(s)) return { ok: false, error: t('err.digits') };
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return { ok: false, error: t('err.tooLarge') };
  if (n > CONSTANTS.maxWon) return { ok: false, error: t('err.maxWon') };
  return { ok: true, value: n };
}

/**
 * 정수 원 금액을 표시한다. 한국어는 '3억 5,000만원' 형태, 그 밖의 언어는 로캘에 맞는 숫자 표기와 KRW 코드를 쓴다.
 * 함수 이름은 이전 버전과 호환을 위해 그대로 둔다.
 */
export function formatKoreanWon(n) {
  if (!Number.isSafeInteger(n) || n < 0) return t('money.na');
  if (!isKo()) return formatKrwCode(n);
  if (n === 0) return t('money.zero');
  const eok = Math.floor(n / 1e8);
  const man = Math.floor((n % 1e8) / 1e4);
  const rest = n % 1e4;
  const parts = [];
  if (eok) parts.push(`${fmtInt(eok)}${t('unit.eok')}`);
  if (man) parts.push(`${fmtInt(man)}${t('unit.man')}`);
  if (rest) parts.push(fmtInt(rest));
  return `${parts.join(' ')}${t('unit.won')}`;
}

function formatKrwCode(n) {
  return new Intl.NumberFormat(localeTag(), { style: 'currency', currency: 'KRW', currencyDisplay: 'code' }).format(n);
}

/** 정수 원 금액을 '350,000,000원' 형태로 표시한다 (한국어). 다른 언어는 KRW 코드 표기. */
export function formatWon(n) {
  if (!Number.isSafeInteger(n)) return t('money.na');
  if (!isKo()) return formatKrwCode(n);
  return `${fmtInt(n)}${t('unit.won')}`;
}

/** 비율(%)을 소수 한 자리 문자열로 표시한다. 계산은 정수 연산, 표시만 소수. */
export function formatPct(pct) {
  if (!Number.isFinite(pct)) return t('money.na');
  const rounded = Math.round(pct * 10) / 10;
  return `${new Intl.NumberFormat(localeTag(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rounded)}%`;
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
  for (const b of CONSTANTS.riskBands) {
    if (b.maxPct === Infinity) return b;
    // T*100*100 <= maxPct * M * (100-d)   (양변에 100을 한 번 더 곱해 분모 제거)
    if (T * 10000n <= BigInt(b.maxPct) * M * D) return b;
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

/**
 * 안전 구간(기본 70% 이하)을 유지하려면 내 보증금을 얼마까지 낮춰야 하는지 역산한다.
 * 위험비율 = (선순위 근저당 + 선순위 임차 + 내 보증금) / 시세 (분석과 같은 식, 같은 정수 비교).
 * dropPct가 있으면 시세가 그만큼 떨어진 가정에서 계산한다.
 * 반환: { ceiling, reduceBy, feasible, maxPct, dropPct }
 *   ceiling  : 보증금 상한(원). 선순위 채권만으로도 구간을 넘으면 0.
 *   reduceBy : 현재 보증금에서 줄여야 할 금액(0 이상). 이미 안전하면 0.
 *   feasible : 보증금을 0으로 줄이면 구간 안에 들어오는지 여부.
 * 입력이 잘못되면 null을 돌려준다.
 */
export function safeDepositCeiling(p, { maxPct = CONSTANTS.riskBands[0].maxPct, dropPct = 0 } = {}) {
  if (!p) return null;
  const { market, deposit, seniorMortgage, seniorTenant } = p;
  const values = [market, deposit, seniorMortgage, seniorTenant];
  if (!values.every(isWholeNonNeg)) return null;
  if (!Number.isFinite(maxPct) || maxPct <= 0) return null;
  if (!Number.isSafeInteger(dropPct) || dropPct < 0 || dropPct >= 100) return null;
  // 분석 함수와 같은 정수 연산: T * 10000 <= maxPct * M * (100 - d)
  const allowedTotal = (BigInt(maxPct) * BigInt(market) * BigInt(100 - dropPct)) / 10000n;
  const senior = BigInt(seniorMortgage) + BigInt(seniorTenant);
  const room = allowedTotal - senior;
  const ceiling = room > 0n ? Number(room) : 0;
  const feasible = room >= 0n;
  const reduceBy = Math.max(0, deposit - ceiling);
  return { ceiling, reduceBy, feasible, maxPct, dropPct };
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
  if (!p) throw new RangeError('invalid date');
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const d = Math.min(p.d, daysInMonth(y, m));
  return toYmd({ y, m, d });
}

/** 일 단위 이동 (UTC 기준). */
export function addDays(ymd, n) {
  const p = typeof ymd === 'string' ? parseYmd(ymd) : ymd;
  if (!p) throw new RangeError('invalid date');
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return toYmd({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
}

/** 두 날짜 사이 일수 (b - a). */
export function diffDays(a, b) {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  if (!pa || !pb) throw new RangeError('invalid date');
  const ms = Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d);
  return Math.round(ms / 86400000);
}

/** 날짜 표시. 한국어는 '2026년 11월 7일', 그 밖의 언어는 로캘의 긴 날짜 형식(UTC 기준). */
export function formatKoreanDate(ymd) {
  const p = parseYmd(ymd);
  if (!p) return t('money.na');
  if (!isKo()) {
    return new Intl.DateTimeFormat(localeTag(), { dateStyle: 'long', timeZone: 'UTC' })
      .format(new Date(Date.UTC(p.y, p.m - 1, p.d)));
  }
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
    events.push({ key: 'contract', title: t('tl.contract'), date: contract, note: t('tl.contractNote'), estimated: false });
  }
  if (moveIn) {
    events.push({ key: 'moveIn', title: t('tl.moveIn'), date: moveIn, note: t('tl.moveInNote'), estimated: false });
    events.push({
      key: 'opposingPower',
      title: t('tl.opposing'),
      date: addDays(moveIn, CONSTANTS.opposingPowerDelayDays),
      note: t('tl.opposingNote'),
      estimated: false,
    });
  }
  if (expiry) {
    const window = renewalWindow(expiry);
    events.push({ key: 'renewalStart', title: t('tl.renewStart'), date: window.start, note: t('tl.renewStartNote'), estimated });
    events.push({ key: 'renewalEnd', title: t('tl.renewEnd'), date: window.end, note: t('tl.renewEndNote'), estimated });
    events.push({
      key: 'expiry',
      title: t('tl.expiry'),
      date: expiry,
      note: estimated ? t('tl.expiryEst') : t('tl.expiryReal'),
      estimated,
    });
    events.push({ key: 'deposit', title: t('tl.deposit'), date: expiry, note: t('tl.depositNote'), estimated });
    events.push({ key: 'registrar', title: t('tl.registrar'), date: expiry, note: t('tl.registrarNote'), estimated });
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
  if (diff === 0) return t('dd.today');
  if (diff > 0) return t('dd.ahead', { n: diff });
  return t('dd.ago', { n: Math.abs(diff) });
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
    const alarmText = lead === 1
      ? t('ics.alarmTomorrow', { t: ev.title })
      : t('ics.alarmDays', { n: lead, t: ev.title });
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
  if (name.length === 0) errors.name = t('v.nameRequired');
  else if (name.length > CONSTANTS.maxNameLength) errors.name = t('v.nameMax', { n: CONSTANTS.maxNameLength });

  const address = trimmedString(input.address);
  if (address.length > CONSTANTS.maxAddressLength) errors.address = t('v.addressMax', { n: CONSTANTS.maxAddressLength });

  const memo = trimmedString(input.memo);
  if (memo.length > CONSTANTS.maxMemoLength) errors.memo = t('v.memoMax', { n: CONSTANTS.maxMemoLength });

  const type = TYPE_VALUES.includes(input.type) ? input.type : null;
  if (!type) errors.type = t('v.type');
  const lease = LEASE_VALUES.includes(input.lease) ? input.lease : null;
  if (!lease) errors.lease = t('v.lease');

  const money = {};
  // 등기부 입력(registry)이 함께 오면 근저당 합계는 행 목록에서 계산하므로 seniorMortgage 칸은 따로 받지 않는다.
  const useRegistry = input.registry !== undefined;
  const moneyFields = [
    ['market', t('f.market'), true],
    ['deposit', t('f.deposit'), true],
    ...(useRegistry ? [] : [['seniorMortgage', t('f.seniorMortgage'), true]]),
    ['seniorTenant', t('f.seniorTenant'), true],
    ['publicPrice', t('f.publicPrice'), false],
    ['monthlyRent', t('f.monthlyRent'), false],
  ];
  for (const [key, label, required] of moneyFields) {
    const parsed = parseWon(input[key]);
    if (!parsed.ok) {
      errors[key] = t('v.field', { label, msg: parsed.error });
      money[key] = null;
    } else if (parsed.value === null) {
      if (required) errors[key] = t('v.required', { label });
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
      errors[key] = t('v.date');
    }
  }
  if (dates.contractDate && dates.expiryDate && dates.expiryDate <= dates.contractDate) {
    errors.expiryDate = t('v.expiryAfter');
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
    errors.mortgages = t('reg.maxRows', { n: REGISTRY_LIMITS.maxMortgages });
  }
  const mortgages = [];
  rows.slice(0, REGISTRY_LIMITS.maxMortgages).forEach((raw, i) => {
    const label = t('reg.rowLabel', { n: i + 1 });
    const parsed = parseWon(raw);
    if (!parsed.ok) errors[`mortgage-${i}`] = t('v.field', { label, msg: parsed.error });
    else if (parsed.value === null || parsed.value === 0) errors[`mortgage-${i}`] = t('reg.rowEmpty', { label });
    else mortgages.push(parsed.value);
  });

  const seizureRaw = trimmedString(input?.seizureCount);
  let seizureCount = 0;
  if (seizureRaw !== '') {
    if (!/^\d+$/.test(seizureRaw)) errors.seizureCount = t('reg.seizureFormat');
    else if (Number(seizureRaw) > REGISTRY_LIMITS.maxSeizures) errors.seizureCount = t('reg.seizureMax', { n: REGISTRY_LIMITS.maxSeizures });
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
    warnings.push({ key: 'seizure', tone: 'danger', text: t('reg.warnSeizure', { n: r.seizureCount }) });
  }
  if (r.leaseRegistration) {
    warnings.push({ key: 'leaseRegistration', tone: 'caution', text: t('reg.warnLease') });
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
  if (!Number.isInteger(auction) || auction < 1 || auction > 100) errors.auctionRatioPct = t('set.auction');
  if (!Number.isInteger(pub) || pub < 50 || pub > 300) errors.publicRatioPct = t('set.public');
  if (Object.keys(errors).length) return { ok: false, value: null, errors };
  return { ok: true, value: { auctionRatioPct: auction, publicRatioPct: pub }, errors: {} };
}

// ---------------------------------------------------------------------------
// 점검표 (단계별 체크, 물건마다 저장)
// ---------------------------------------------------------------------------

const checkItem = (id) => Object.freeze({
  id,
  get text() { return t(`ck.${id}.text`); },
  get hint() { return t(`ck.${id}.hint`); },
});

export const CHECKLIST = Object.freeze([
  Object.freeze({
    key: 'before',
    titleKey: 'stage.before',
    get title() { return t('stage.before'); },
    items: Object.freeze([
      checkItem('reg-owner'),
      checkItem('reg-mortgage'),
      checkItem('reg-seizure'),
      checkItem('reg-trust'),
      checkItem('bldg-violation'),
      checkItem('tax-arrears'),
      checkItem('id-agent'),
      checkItem('broker-guarantee'),
      checkItem('insurance-check'),
    ]),
  }),
  Object.freeze({
    key: 'contract',
    titleKey: 'stage.contract',
    get title() { return t('stage.contract'); },
    items: Object.freeze([checkItem('special-clause'), checkItem('deposit-account')]),
  }),
  Object.freeze({
    key: 'move',
    titleKey: 'stage.move',
    get title() { return t('stage.move'); },
    items: Object.freeze([checkItem('same-day-move'), checkItem('opposing-power'), checkItem('reg-recheck')]),
  }),
  Object.freeze({
    key: 'living',
    titleKey: 'stage.living',
    get title() { return t('stage.living'); },
    items: Object.freeze([checkItem('renewal-window'), checkItem('keep-address')]),
  }),
  Object.freeze({
    key: 'move-out',
    titleKey: 'stage.moveOut',
    get title() { return t('stage.moveOut'); },
    items: Object.freeze([checkItem('return-order'), checkItem('registrar'), checkItem('deposit-check')]),
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

const clause = (id) => Object.freeze({
  id,
  get title() { return t(`cl.${id}.title`); },
  get text() { return t(`cl.${id}.text`); },
});

export const CLAUSES = Object.freeze([
  clause('no-new-rights'),
  clause('mortgage-cancel'),
  clause('tax-clear'),
  clause('prior-disclosure'),
  clause('guarantee-cooperation'),
  clause('repair-scope'),
  clause('renewal-terms'),
  clause('simultaneous-return'),
  clause('deposit-account-owner'),
  clause('confirm-date-cooperation'),
  clause('broker-disclosure'),
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

export function clauseNotice() {
  return t('clauseNotice');
}

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
    return { ok: false, error: t('backup.notJson') };
  }
  if (!obj || obj.app !== BACKUP_APP || obj.version !== BACKUP_VERSION || !obj.data) {
    return { ok: false, error: t('backup.wrong') };
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

export function summaryHeaders() {
  return [
    t('csv.name'), t('csv.type'), t('csv.lease'), t('csv.market'), t('csv.deposit'),
    t('csv.seniorMortgage'), t('csv.seniorTenant'), t('csv.ratio'), t('csv.band'), t('csv.expiry'),
  ];
}

export function summaryRows(properties, settings) {
  return properties.map((p) => {
    const a = analyzeProperty(p, settings);
    return [
      p.name,
      PROPERTY_TYPES.find((x) => x.value === p.type)?.label ?? '',
      LEASE_TYPES.find((x) => x.value === p.lease)?.label ?? '',
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
// 분석 화면의 숫자 설명. 기준·가정 값에는 항상 '확인 필요'를 붙인다.
// basis: 'input' | 'calc' | 'assume' | 'ref'  (표시는 t('basis.' + basis))
// ---------------------------------------------------------------------------

/**
 * 분석 화면의 숫자마다 "무엇을 뜻하는지, 어디서 나왔는지"를 적는다.
 * 분석이 계산 불가면 빈 배열.
 */
export function explainRiskNumbers(a) {
  if (!a || !a.ok) return [];
  const items = [];
  items.push({
    key: 'ratio',
    label: t('ex.ratio.label'),
    value: formatPct(a.ratioPct),
    formula: t('ex.ratio.formula'),
    meaning: t('ex.ratio.meaning'),
    basis: 'calc',
    note: t('ex.ratio.note'),
  });
  items.push({
    key: 'band',
    label: t('ex.band.label'),
    value: a.band.label,
    formula: t('risk.bandRule'),
    meaning: t('ex.band.meaning'),
    basis: 'ref',
    note: CONSTANTS.riskBandsSource,
  });
  a.scenarios.forEach((s) => {
    items.push({
      key: `drop${s.dropPct}`,
      label: t('ex.drop.label', { d: s.dropPct }),
      value: s.ratioPct === null ? t('common.notCalc') : formatPct(s.ratioPct),
      formula: t('ex.drop.formula', { r: 100 - s.dropPct }),
      meaning: t('ex.drop.meaning', { d: s.dropPct }),
      basis: 'assume',
      note: CONSTANTS.scenarioSource,
    });
  });
  items.push({
    key: 'auctionPrice',
    label: t('ex.auction.label'),
    value: formatKoreanWon(a.auction.auctionPrice),
    formula: t('ex.auction.formula', { p: a.auction.auctionPct }),
    meaning: t('ex.auction.meaning'),
    basis: 'assume',
    note: CONSTANTS.auctionRatioSource,
  });
  items.push({
    key: 'distributable',
    label: t('ex.dist.label'),
    value: formatKoreanWon(a.auction.distributable),
    formula: t('ex.dist.formula'),
    meaning: t('ex.dist.meaning'),
    basis: 'calc',
    note: t('ex.dist.note'),
  });
  items.push({
    key: 'exposed',
    label: t('ex.exposed.label'),
    value: formatKoreanWon(a.auction.exposed),
    formula: t('ex.exposed.formula'),
    meaning: t('ex.exposed.meaning'),
    basis: 'calc',
    note: t('ex.exposed.note'),
  });
  const prot = a.protection;
  items.push({
    key: 'publicLimit',
    label: t('ex.pub.label'),
    value: prot.status === 'unknown' ? t('ex.pub.unknown') : formatKoreanWon(prot.limit),
    formula: t('ex.pub.formula', { p: prot.publicPct }),
    meaning: t('ex.pub.meaning'),
    basis: 'ref',
    note: t('ex.pub.note', { src: CONSTANTS.publicRatioSource }),
  });
  return items;
}

export function printNotice() {
  return t('printNotice');
}

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
  const typeLabel = PROPERTY_TYPES.find((x) => x.value === p.type)?.label ?? '';
  const leaseLabel = LEASE_TYPES.find((x) => x.value === p.lease)?.label ?? '';
  const risk = analysis?.ok
    ? [
      t('print.riskLine', { r: formatPct(analysis.ratioPct), b: analysis.band.label }),
      t('print.asOfLine', { d: CONSTANTS.기준일 }),
    ]
    : [];
  return {
    title: t('print.title', { name: p.name }),
    meta: [typeLabel, leaseLabel].filter(Boolean).join(' · '),
    printedOn: today,
    risk,
    overall: overallProgress(checks),
    stages,
    notice: printNotice(),
  };
}
