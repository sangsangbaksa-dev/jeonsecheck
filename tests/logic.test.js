import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSTANTS, parseWon, formatKoreanWon, formatPct, bandFor, analyzeProperty, barPosition,
  parseYmd, toYmd, addMonths, addDays, diffDays, isLeapYear, daysInMonth, renewalWindow,
  buildTimeline, escapeIcsText, foldIcsLine, buildIcs, csvCell, toCsv,
  validateProperty, validateSettings, toggleCheck, stageProgress, overallProgress, CHECKLIST,
  normalizeData, normalizeProperty, loadData, saveData, buildBackup, parseBackup, STORAGE_KEY,
  defaultData, summaryRows, CLAUSES, makeId,
} from '../logic.js';

// 테스트용 메모리 저장소 (localStorage 흉내)
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    raw: map,
  };
}
const throwingStorage = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('quota'); },
};

const base = { market: 100_000_000, deposit: 50_000_000, seniorMortgage: 0, seniorTenant: 0, publicPrice: null };

describe('금액 파싱', () => {
  test('빈 값은 미입력(null)', () => {
    assert.deepEqual(parseWon(''), { ok: true, value: null });
    assert.deepEqual(parseWon('   '), { ok: true, value: null });
    assert.deepEqual(parseWon(null), { ok: true, value: null });
  });
  test('쉼표와 공백을 허용', () => {
    assert.deepEqual(parseWon('350,000,000'), { ok: true, value: 350_000_000 });
    assert.deepEqual(parseWon(' 1 000 '), { ok: true, value: 1000 });
  });
  test('음수·소수·문자·지수 표기는 거부', () => {
    assert.equal(parseWon('-1').ok, false);
    assert.equal(parseWon('1.5').ok, false);
    assert.equal(parseWon('abc').ok, false);
    assert.equal(parseWon('1e5').ok, false);
    assert.equal(parseWon('NaN').ok, false);
    assert.equal(parseWon('Infinity').ok, false);
  });
  test('상한 초과 거부 (1조 원)', () => {
    assert.equal(parseWon('1000000000000').ok, true);
    assert.equal(parseWon('1000000000001').ok, false);
    assert.equal(parseWon('99999999999999999999').ok, false);
  });
  test('0은 유효 값', () => {
    assert.deepEqual(parseWon('0'), { ok: true, value: 0 });
  });
});

describe('금액 표시', () => {
  test('억·만 단위', () => {
    assert.equal(formatKoreanWon(350_000_000), '3억 5,000만원');
    assert.equal(formatKoreanWon(100_000_000), '1억원');
    assert.equal(formatKoreanWon(12_345_678), '1,234만 5,678원');
    assert.equal(formatKoreanWon(0), '0원');
    assert.equal(formatKoreanWon(-5), '-');
  });
  test('비율은 소수 한 자리', () => {
    assert.equal(formatPct(85.04), '85.0%');
    assert.equal(formatPct(NaN), '-');
  });
});

describe('위험비율 계산 · 시세 0 / 시세 < 보증금 edge cases', () => {
  test('기본 계산: (근저당 + 선순위 임차 + 내 보증금) / 시세', () => {
    const a = analyzeProperty({ market: 200_000_000, deposit: 100_000_000, seniorMortgage: 30_000_000, seniorTenant: 20_000_000 });
    assert.equal(a.ok, true);
    assert.equal(a.totalClaims, 150_000_000);
    assert.equal(a.ratioPct, 75);
    assert.equal(a.band.label, '주의');
  });
  test('시세 0이면 계산 불가(NO_MARKET), 0으로 나누지 않음', () => {
    const a = analyzeProperty({ ...base, market: 0 });
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'NO_MARKET');
    assert.equal(a.ratioPct, null);
    assert.equal(a.band, null);
    assert.equal(a.scenarios.length, 0);
  });
  test('시세 0이고 보증금 0이어도 NO_MARKET (분모 0 우선)', () => {
    const a = analyzeProperty({ market: 0, deposit: 0, seniorMortgage: 0, seniorTenant: 0 });
    assert.equal(a.reason, 'NO_MARKET');
  });
  test('시세 < 보증금이면 비율 100% 초과, 매우 위험', () => {
    const a = analyzeProperty({ market: 80_000_000, deposit: 100_000_000, seniorMortgage: 0, seniorTenant: 0 });
    assert.equal(a.ok, true);
    assert.equal(a.ratioPct, 125);
    assert.equal(a.band.label, '매우 위험');
  });
  test('시세 < 보증금이면 경매 노출액은 전액 이상(내 보증금 전체가 배당 대상 밖)', () => {
    const a = analyzeProperty({ market: 80_000_000, deposit: 100_000_000, seniorMortgage: 0, seniorTenant: 0 });
    assert.equal(a.auction.auctionPrice, 64_000_000);
    assert.equal(a.auction.covered, 64_000_000);
    assert.equal(a.auction.exposed, 36_000_000);
  });
  test('필수 값 누락은 MISSING, 음수·소수는 INVALID', () => {
    assert.equal(analyzeProperty({ ...base, deposit: null }).reason, 'MISSING');
    assert.equal(analyzeProperty({ ...base, deposit: -1 }).reason, 'INVALID');
    assert.equal(analyzeProperty({ ...base, deposit: 1.5 }).reason, 'INVALID');
    assert.equal(analyzeProperty({ ...base, deposit: NaN }).reason, 'INVALID');
    assert.equal(analyzeProperty({ ...base, publicPrice: -10 }).reason, 'INVALID');
  });
});

describe('구간 경계값 (안전 ≤70 / 주의 ≤80 / 위험 ≤90 / 매우 위험 >90)', () => {
  const market = 100_000_000;
  test('정확히 70%는 안전', () => {
    assert.equal(bandFor(70_000_000, market).label, '안전');
  });
  test('70% + 1원은 주의', () => {
    assert.equal(bandFor(70_000_001, market).label, '주의');
  });
  test('정확히 80%는 주의, 80% + 1원은 위험', () => {
    assert.equal(bandFor(80_000_000, market).label, '주의');
    assert.equal(bandFor(80_000_001, market).label, '위험');
  });
  test('정확히 90%는 위험, 90% + 1원은 매우 위험', () => {
    assert.equal(bandFor(90_000_000, market).label, '위험');
    assert.equal(bandFor(90_000_001, market).label, '매우 위험');
  });
  test('0원 청구면 안전', () => {
    assert.equal(bandFor(0, market).label, '안전');
  });
  test('부동소수 오차 없이 경계 판정 (7/10 = 70%)', () => {
    // 시세 3, 청구 2.1 같은 소수 경계는 정수 연산으로 판정해야 함: 시세 1000원, 청구 700원
    assert.equal(bandFor(700, 1000).label, '안전');
    assert.equal(bandFor(701, 1000).label, '주의');
    assert.equal(bandFor(800, 1000).label, '주의');
    assert.equal(bandFor(900, 1000).label, '위험');
  });
  test('큰 금액(1조)에서도 경계가 정확', () => {
    const m = 1_000_000_000_000;
    assert.equal(bandFor(700_000_000_000, m).label, '안전');
    assert.equal(bandFor(700_000_000_001, m).label, '주의');
  });
});

describe('시세 하락 시나리오', () => {
  test('10%/20% 하락 시 비율과 등급이 올라간다', () => {
    const a = analyzeProperty({ market: 100_000_000, deposit: 60_000_000, seniorMortgage: 0, seniorTenant: 0 });
    assert.equal(a.band.label, '안전');
    const [s10, s20] = a.scenarios;
    assert.equal(s10.dropPct, 10);
    assert.equal(s10.marketAfter, 90_000_000);
    assert.ok(Math.abs(s10.ratioPct - 66.666) < 0.01);
    assert.equal(s10.band.label, '안전'); // 60M / 90M = 66.7%
    assert.equal(s20.marketAfter, 80_000_000);
    assert.equal(s20.ratioPct, 75);
    assert.equal(s20.band.label, '주의'); // 60M / 80M = 75%
  });
  test('하락 후 가상 시세가 청구와 같으면 100%로 매우 위험', () => {
    const a = analyzeProperty({ market: 1000, deposit: 900, seniorMortgage: 0, seniorTenant: 0 });
    assert.equal(a.ratioPct, 90);
    assert.equal(a.band.label, '위험');
    assert.equal(a.scenarios[0].marketAfter, 900);
    assert.equal(a.scenarios[0].ratioPct, 100);
    assert.equal(a.scenarios[0].band.label, '매우 위험');
  });
  test('하락 시나리오 경계 정수 판정: 시세 1000, 청구 630 → 10% 하락(900) 시 70%로 안전', () => {
    const a = analyzeProperty({ market: 1000, deposit: 630, seniorMortgage: 0, seniorTenant: 0 });
    assert.equal(a.scenarios[0].band.label, '안전');
    assert.equal(a.scenarios[0].ratioPct, 70);
  });
  test('시세가 작아 하락 후 0이 되면 ratio는 null', () => {
    const a = analyzeProperty({ market: 1, deposit: 0, seniorMortgage: 0, seniorTenant: 0 });
    assert.equal(a.scenarios[0].marketAfter, 0);
    assert.equal(a.scenarios[0].ratioPct, null);
  });
});

describe('경매 노출 (낙찰가율 가정)', () => {
  test('낙찰가 = 시세 × 80%, 선순위 채권 뺀 금액으로 보증금 보호', () => {
    const a = analyzeProperty({ market: 200_000_000, deposit: 50_000_000, seniorMortgage: 60_000_000, seniorTenant: 0 });
    // 낙찰가 160M - 선순위 60M = 배당가능 100M ≥ 보증금 50M → 전액 보호
    assert.equal(a.auction.auctionPrice, 160_000_000);
    assert.equal(a.auction.distributable, 100_000_000);
    assert.equal(a.auction.exposed, 0);
  });
  test('배당 가능액이 음수면 0 처리', () => {
    const a = analyzeProperty({ market: 100_000_000, deposit: 10_000_000, seniorMortgage: 90_000_000, seniorTenant: 0 });
    assert.equal(a.auction.distributable, 0);
    assert.equal(a.auction.exposed, 10_000_000);
  });
  test('사용자 설정 낙찰가율 반영', () => {
    const a = analyzeProperty({ market: 100_000_000, deposit: 0, seniorMortgage: 0, seniorTenant: 0 }, { auctionRatioPct: 70 });
    assert.equal(a.auction.auctionPrice, 70_000_000);
    assert.equal(a.auction.auctionPct, 70);
  });
});

describe('공시가격 140% 참고 판정', () => {
  test('공시가격 없으면 unknown', () => {
    assert.equal(analyzeProperty(base).protection.status, 'unknown');
  });
  test('청구 합계가 공시가격 140% 이내면 within', () => {
    const a = analyzeProperty({ market: 200_000_000, deposit: 100_000_000, seniorMortgage: 0, seniorTenant: 0, publicPrice: 100_000_000 });
    assert.equal(a.protection.limit, 140_000_000);
    assert.equal(a.protection.status, 'within');
  });
  test('140%를 1원이라도 넘으면 over', () => {
    const a = analyzeProperty({ market: 200_000_000, deposit: 140_000_001, seniorMortgage: 0, seniorTenant: 0, publicPrice: 100_000_000 });
    assert.equal(a.protection.status, 'over');
  });
  test('설정으로 비율 변경', () => {
    const a = analyzeProperty({ market: 200_000_000, deposit: 120_000_000, seniorMortgage: 0, seniorTenant: 0, publicPrice: 100_000_000 }, { publicRatioPct: 110 });
    assert.equal(a.protection.status, 'over');
  });
});

test('막대 위치는 0~100으로 잘린다', () => {
  assert.equal(barPosition(150), 100);
  assert.equal(barPosition(-5), 0);
  assert.equal(barPosition(NaN), 0);
  assert.equal(barPosition(42), 42);
});

describe('날짜 산술', () => {
  test('윤년 판정', () => {
    assert.equal(isLeapYear(2028), true);
    assert.equal(isLeapYear(2100), false);
    assert.equal(isLeapYear(2000), true);
    assert.equal(daysInMonth(2028, 2), 29);
    assert.equal(daysInMonth(2027, 2), 28);
  });
  test('존재하지 않는 날짜는 파싱 실패', () => {
    assert.equal(parseYmd('2027-02-29'), null);
    assert.equal(parseYmd('2028-02-29') !== null, true);
    assert.equal(parseYmd('2027-13-01'), null);
    assert.equal(parseYmd('2027-1-1'), null);
    assert.equal(parseYmd(''), null);
  });
  test('월말 보정: 1/31 + 1개월 = 2/28 (평년), 2/29 (윤년)', () => {
    assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  });
  test('윤일 기준 -6개월: 2028-02-29 → 2027-08-29', () => {
    assert.equal(addMonths('2028-02-29', -6), '2027-08-29');
  });
  test('-2개월 말일 보정: 2027-05-31 → 2027-03-31, 2027-04-30 → 2027-02-28', () => {
    assert.equal(addMonths('2027-05-31', -2), '2027-03-31');
    assert.equal(addMonths('2027-04-30', -2), '2027-02-28');
  });
  test('연도 경계 넘김: 2027-01-15 - 6개월 = 2026-07-15, +24개월', () => {
    assert.equal(addMonths('2027-01-15', -6), '2026-07-15');
    assert.equal(addMonths('2026-03-15', 24), '2028-03-15');
  });
  test('addDays: 월·연·윤년 경계', () => {
    assert.equal(addDays('2027-12-31', 1), '2028-01-01');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2027-02-28', 1), '2027-03-01');
    assert.equal(addDays('2026-11-06', -6), '2026-10-31');
  });
  test('diffDays', () => {
    assert.equal(diffDays('2028-02-28', '2028-03-01'), 2);
    assert.equal(diffDays('2027-01-01', '2026-12-31'), -1);
  });
  test('toYmd는 0 패딩', () => {
    assert.equal(toYmd({ y: 2027, m: 3, d: 5 }), '2027-03-05');
  });
  test('기준 날짜 잘못되면 던진다', () => {
    assert.throws(() => addMonths('2027-02-30', 1), RangeError);
  });
  test('계약갱신요구 기간: 만기 6개월 전 ~ 2개월 전', () => {
    const w = renewalWindow('2028-08-31');
    assert.equal(w.start, '2028-02-29'); // 윤년 말일 보정
    assert.equal(w.end, '2028-06-30');
  });
});

describe('날짜 타임라인', () => {
  test('만기 미입력 시 계약일 + 24개월 추정, estimated 표시', () => {
    const events = buildTimeline({ contractDate: '2026-03-15', moveInDate: null, expiryDate: null });
    const exp = events.find((e) => e.key === 'expiry');
    assert.equal(exp.date, '2028-03-15');
    assert.equal(exp.estimated, true);
  });
  test('입력된 만기일은 추정 아님, 대항력은 전입 다음 날', () => {
    const events = buildTimeline({ contractDate: '2026-03-15', moveInDate: '2026-04-01', expiryDate: '2028-04-01' });
    assert.equal(events.find((e) => e.key === 'opposingPower').date, '2026-04-02');
    assert.equal(events.find((e) => e.key === 'expiry').estimated, false);
  });
  test('날짜 오름차순 정렬', () => {
    const events = buildTimeline({ contractDate: '2026-03-15', moveInDate: '2026-04-01', expiryDate: '2028-04-01' });
    const dates = events.map((e) => e.date);
    assert.deepEqual([...dates].sort(), dates);
  });
  test('잘못된 날짜 문자열은 무시', () => {
    const events = buildTimeline({ contractDate: '2026-02-30', moveInDate: 'x', expiryDate: null });
    assert.equal(events.length, 0);
  });
});

describe('ICS 내보내기', () => {
  test('이스케이프: 쉼표·세미콜론·줄바꿈·백슬래시', () => {
    assert.equal(escapeIcsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  });
  test('75옥텟 접기: 줄 길이 제한과 UTF-8 문자 경계 유지', () => {
    const long = '전세보증금반환일정'.repeat(10);
    const folded = foldIcsLine(`SUMMARY:${long}`).split('\r\n');
    const enc = new TextEncoder();
    for (const line of folded) assert.ok(enc.encode(line).length <= 75, `line too long: ${line}`);
    // 접힌 조각을 이어 붙이면 원문과 같다 (continuation의 선행 공백 제거)
    const rejoined = folded.map((l, i) => (i === 0 ? l : l.slice(1))).join('');
    assert.equal(rejoined, `SUMMARY:${long}`);
  });
  test('VEVENT 구조와 all-day 날짜', () => {
    const ics = buildIcs([{ uid: 'p1-expiry', title: '만기일, 점검', date: '2028-03-15', description: '메모' }], '20261106T000000Z');
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.ok(ics.includes('DTSTART;VALUE=DATE:20280315'));
    assert.ok(ics.includes('DTEND;VALUE=DATE:20280316'));
    assert.ok(ics.includes('SUMMARY:만기일\\, 점검'));
    assert.ok(ics.includes('UID:p1-expiry@jeonsecheck'));
    assert.ok(ics.includes('TRIGGER:-P1D'));
  });
  test('윤일 날짜 DTEND 계산', () => {
    const ics = buildIcs([{ uid: 'x', title: 't', date: '2028-02-28' }], '20261106T000000Z');
    assert.ok(ics.includes('DTEND;VALUE=DATE:20280229'));
  });
});

describe('CSV', () => {
  test('쉼표·따옴표·줄바꿈 이스케이프', () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('x\ny'), '"x\ny"');
  });
  test('수식 주입 방지: = + - @ 시작 문자열은 앞에 작은따옴표', () => {
    assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
    assert.equal(csvCell('@sum'), "'@sum");
    assert.equal(csvCell(-5), '-5');
  });
  test('toCsv 헤더와 행, CRLF', () => {
    assert.equal(toCsv(['a', 'b'], [[1, 'x']]), 'a,b\r\n1,x\r\n');
  });
});

describe('입력 검증 (물건 폼)', () => {
  const good = {
    name: '  역삼 빌라 ', address: '', memo: '', type: 'villa', lease: 'jeonse',
    market: '300,000,000', deposit: '200,000,000', seniorMortgage: '0', seniorTenant: '', publicPrice: '', monthlyRent: '',
    contractDate: '2026-03-15', moveInDate: '', expiryDate: '2028-03-15',
  };
  test('정상 입력은 통과하고 이름은 trim, 빈 선순위 임차는 오류 (0 입력 요구)', () => {
    const r = validateProperty(good);
    assert.equal(r.ok, false);
    assert.ok(r.errors.seniorTenant);
    const r2 = validateProperty({ ...good, seniorTenant: '0' });
    assert.equal(r2.ok, true);
    assert.equal(r2.value.name, '역삼 빌라');
    assert.equal(r2.value.market, 300_000_000);
    assert.equal(r2.value.publicPrice, null);
  });
  test('음수·문자 오류가 필드별로 나온다', () => {
    const r = validateProperty({ ...good, deposit: '-100', market: 'abc' });
    assert.ok(r.errors.deposit);
    assert.ok(r.errors.market);
  });
  test('만기일이 계약일보다 이르면 오류', () => {
    const r = validateProperty({ ...good, seniorTenant: '0', expiryDate: '2026-01-01' });
    assert.ok(r.errors.expiryDate);
  });
  test('잘못된 날짜(2월 30일)는 오류', () => {
    const r = validateProperty({ ...good, seniorTenant: '0', contractDate: '2027-02-30' });
    assert.ok(r.errors.contractDate);
  });
  test('유형·계약 형태는 목록 값만 허용', () => {
    const r = validateProperty({ ...good, seniorTenant: '0', type: 'castle', lease: 'monthly' });
    assert.ok(r.errors.type);
    assert.ok(r.errors.lease);
  });
  test('이름 비어 있으면 오류, 40자 초과도 오류', () => {
    assert.ok(validateProperty({ ...good, seniorTenant: '0', name: '   ' }).errors.name);
    assert.ok(validateProperty({ ...good, seniorTenant: '0', name: 'a'.repeat(41) }).errors.name);
  });
  test('설정 검증: 낙찰가율 1~100, 공시가격 비율 50~300 정수', () => {
    assert.equal(validateSettings({ auctionRatioPct: 80, publicRatioPct: 140 }).ok, true);
    assert.equal(validateSettings({ auctionRatioPct: 0, publicRatioPct: 140 }).ok, false);
    assert.equal(validateSettings({ auctionRatioPct: 80.5, publicRatioPct: 140 }).ok, false);
    assert.equal(validateSettings({ auctionRatioPct: 80, publicRatioPct: 400 }).ok, false);
    assert.equal(validateSettings({ auctionRatioPct: 'abc', publicRatioPct: 140 }).ok, false);
  });
});

describe('점검표 체크 저장', () => {
  test('토글은 원본을 바꾸지 않고 새 객체를 돌려준다', () => {
    const before = {};
    const after = toggleCheck(before, 'reg-owner');
    assert.deepEqual(before, {});
    assert.deepEqual(after, { 'reg-owner': true });
    assert.deepEqual(toggleCheck(after, 'reg-owner'), {});
  });
  test('알 수 없는 항목 id는 무시', () => {
    assert.deepEqual(toggleCheck({}, 'hacked'), {});
  });
  test('단계별·전체 진행률', () => {
    let checks = {};
    checks = toggleCheck(checks, 'reg-owner');
    checks = toggleCheck(checks, 'reg-mortgage');
    assert.deepEqual(stageProgress(checks, 'before'), { done: 2, total: CHECKLIST[0].items.length });
    assert.equal(stageProgress(checks, 'move').done, 0);
    assert.equal(overallProgress(checks).done, 2);
    assert.equal(overallProgress(checks).total, CHECKLIST.reduce((n, s) => n + s.items.length, 0));
  });
  test('단계마다 항목 id가 중복되지 않는다', () => {
    const ids = CHECKLIST.flatMap((s) => s.items.map((i) => i.id));
    assert.equal(new Set(ids).size, ids.length);
  });
  test('체크 상태는 물건 단위로 저장되고 새로고침 후에도 남는다', () => {
    const storage = memoryStorage();
    const data = defaultData();
    const p = normalizeProperty({
      id: 'p1', name: '집A', address: '', memo: '', type: 'apt', lease: 'jeonse',
      market: 300_000_000, deposit: 200_000_000, seniorMortgage: 0, seniorTenant: 0,
      publicPrice: null, monthlyRent: null, contractDate: null, moveInDate: null, expiryDate: null,
      checks: { 'reg-owner': true, 'bogus-id': true, 'reg-mortgage': 'yes' },
    });
    assert.deepEqual(p.checks, { 'reg-owner': true }); // 알 수 없는 id·잘못된 값 제거
    data.properties.push(p);
    assert.equal(saveData(storage, data), true);
    // 다른 물건 B에는 영향 없음
    const reloaded = loadData(storage);
    assert.equal(reloaded.properties[0].checks['reg-owner'], true);
    const toggled = { ...reloaded.properties[0], checks: toggleCheck(reloaded.properties[0].checks, 'tax-arrears') };
    saveData(storage, { ...reloaded, properties: [toggled] });
    assert.deepEqual(loadData(storage).properties[0].checks, { 'reg-owner': true, 'tax-arrears': true });
  });
});

describe('저장소 · 백업', () => {
  test('저장소가 throw해도 기본값으로 동작 (읽기)', () => {
    assert.deepEqual(loadData(throwingStorage), defaultData());
  });
  test('저장소가 throw하면 saveData는 false', () => {
    assert.equal(saveData(throwingStorage, defaultData()), false);
  });
  test('깨진 JSON은 기본값', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{not json' });
    assert.deepEqual(loadData(storage), defaultData());
  });
  test('백업 → 복원 왕복', () => {
    const data = {
      ...defaultData(),
      properties: [normalizeProperty({
        id: 'p9', name: '다가구 B', address: '서울 어딘가 1-2', memo: '메모', type: 'house', lease: 'banjeonse',
        market: 500_000_000, deposit: 300_000_000, seniorMortgage: 100_000_000, seniorTenant: 50_000_000,
        publicPrice: 350_000_000, monthlyRent: 500_000, contractDate: '2026-05-01', moveInDate: null, expiryDate: '2028-04-30',
        checks: { 'reg-owner': true },
      })],
    };
    const text = buildBackup(data, '2026-11-06T00:00:00.000Z');
    const parsed = parseBackup(text);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.data.properties[0].checks, { 'reg-owner': true });
    assert.equal(parsed.data.properties[0].address, '서울 어딘가 1-2');
  });
  test('백업에 AI 키 등 민감 항목이 들어가지 않는다', () => {
    const text = buildBackup(defaultData(), '2026-11-06T00:00:00.000Z');
    assert.ok(!text.includes('sk-ant'));
    assert.ok(!text.includes('ai-key'));
  });
  test('다른 앱 백업이나 버전 불일치는 거부', () => {
    assert.equal(parseBackup('{"app":"other","version":1,"data":{}}').ok, false);
    assert.equal(parseBackup('{"app":"jeonsecheck","version":2,"data":{}}').ok, false);
    assert.equal(parseBackup('not json').ok, false);
  });
  test('손상된 항목은 버리고 나머지는 유지, 중복 id 제거', () => {
    const good = { id: 'a', name: 'A', type: 'apt', lease: 'jeonse', market: 1, deposit: 0, seniorMortgage: 0, seniorTenant: 0 };
    const data = normalizeData({
      properties: [good, { id: 'a', name: 'dup', type: 'apt', lease: 'jeonse', market: 1, deposit: 0, seniorMortgage: 0, seniorTenant: 0 }, { name: 'no id' }, null, { ...good, id: 'c', market: -5 }],
    });
    assert.equal(data.properties.length, 1);
    assert.equal(data.properties[0].id, 'a');
  });
  test('설정이 잘못되면 기본값으로 대체', () => {
    const data = normalizeData({ settings: { auctionRatioPct: 500, publicRatioPct: 140 } });
    assert.equal(data.settings.auctionRatioPct, CONSTANTS.auctionRatioPct);
  });
  test('makeId는 주입된 난수로 결정적', () => {
    assert.equal(makeId(() => 0.5, 1000), makeId(() => 0.5, 1000));
    assert.notEqual(makeId(() => 0.5, 1000), makeId(() => 0.6, 1000));
  });
});

describe('요약 CSV 행과 타임라인 편의', () => {
  test('요약 행은 계산 불가 물건에서 빈 칸', () => {
    const rows = summaryRows([
      { name: '=evil', type: 'apt', lease: 'jeonse', market: 0, deposit: 1, seniorMortgage: 0, seniorTenant: 0, expiryDate: null },
    ], defaultData().settings);
    assert.equal(rows[0][0], '=evil');
    assert.equal(rows[0][7], '');
    assert.equal(rows[0][8], '');
  });
  test('기준값마다 "확인 필요"와 기준일 라벨이 있다', () => {
    assert.ok(CONSTANTS.riskBandsSource.includes('확인 필요'));
    assert.ok(CONSTANTS.auctionRatioSource.includes('확인 필요'));
    assert.ok(CONSTANTS.publicRatioSource.includes('확인 필요'));
    assert.ok(CONSTANTS.renewalSource.includes('확인 필요'));
    assert.ok(CONSTANTS.기준일);
  });
  test('특약 문구 라이브러리는 id가 고유하고 복사할 본문이 있다', () => {
    const ids = CLAUSES.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(CLAUSES.every((c) => c.text.length > 20));
  });
});

// 안전 구간 보증금 상한 (safeDepositCeiling)
import { safeDepositCeiling, analyzeProperty as analyzeForCeiling } from '../logic.js';
describe('안전 구간 보증금 상한', () => {
  const base = { market: 300000000, deposit: 200000000, seniorMortgage: 50000000, seniorTenant: 0 };

  test('70% 경계값에 정확히 맞는 보증금을 상한으로 돌려준다', () => {
    const r = safeDepositCeiling(base);
    assert.equal(r.ceiling, 160000000); // (5천만 + 1억6천만) / 3억 = 70%
    assert.equal(r.reduceBy, 40000000);
    assert.equal(r.feasible, true);
    // 상한 그대로는 안전, 1원 올리면 주의 (분석 함수와 같은 판정)
    assert.equal(analyzeForCeiling({ ...base, deposit: r.ceiling }).band.label, '안전');
    assert.equal(analyzeForCeiling({ ...base, deposit: r.ceiling + 1 }).band.label, '주의');
  });

  test('시세 하락 가정에서는 상한이 낮아진다', () => {
    const r = safeDepositCeiling(base, { dropPct: 10 });
    assert.equal(r.ceiling, 139000000); // 2억7천 * 70% - 5천만
    assert.equal(r.reduceBy, 61000000);
  });

  test('이미 안전한 보증금이면 줄일 금액은 0이다', () => {
    const r = safeDepositCeiling({ ...base, deposit: 100000000 });
    assert.equal(r.reduceBy, 0);
    assert.ok(r.ceiling > 100000000);
  });

  test('선순위 채권만으로 구간을 넘으면 상한 0, feasible false', () => {
    const r = safeDepositCeiling({ market: 100000000, deposit: 10, seniorMortgage: 80000000, seniorTenant: 0 });
    assert.equal(r.ceiling, 0);
    assert.equal(r.feasible, false);
    assert.equal(r.reduceBy, 10);
  });

  test('잘못된 입력은 null을 돌려준다', () => {
    assert.equal(safeDepositCeiling(null), null);
    assert.equal(safeDepositCeiling({ ...base, deposit: -1 }), null);
    assert.equal(safeDepositCeiling({ ...base, market: NaN }), null);
    assert.equal(safeDepositCeiling(base, { dropPct: 100 }), null);
    assert.equal(safeDepositCeiling(base, { maxPct: 0 }), null);
  });

  test('시세 0원이면 상한은 0이고 줄일 금액은 보증금 전액이다', () => {
    const r = safeDepositCeiling({ ...base, market: 0 });
    assert.equal(r.ceiling, 0);
    assert.equal(r.reduceBy, base.deposit);
  });
});
