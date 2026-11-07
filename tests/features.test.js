import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProperty, validateRegistry, normalizeRegistry, normalizeProperty, mortgageTotal,
  summarizeRegistry, defaultRegistry, REGISTRY_LIMITS, normalizeData, buildBackup, parseBackup, defaultData,
  timelineStatus, dDayLabel, nextEvent, reminderFor, buildIcs, buildTimeline, REMINDER_LEAD_DAYS,
} from '../logic.js';

const goodBase = {
  name: '역삼 빌라', address: '', memo: '', type: 'villa', lease: 'jeonse',
  market: '300000000', deposit: '200000000', seniorTenant: '0', publicPrice: '', monthlyRent: '',
  contractDate: '', moveInDate: '', expiryDate: '',
};

describe('등기부 요약 입력 검증', () => {
  test('근저당 행 합계가 선순위 근저당 합계가 된다', () => {
    const r = validateRegistry({ mortgages: ['120,000,000', '30000000'], seizureCount: '', leaseRegistration: false });
    assert.equal(r.ok, true);
    assert.deepEqual(r.value.mortgages, [120_000_000, 30_000_000]);
    assert.equal(mortgageTotal(r.value), 150_000_000);
  });
  test('행이 없으면 근저당 0으로 통과', () => {
    const r = validateRegistry({ mortgages: [], seizureCount: '0', leaseRegistration: false });
    assert.equal(r.ok, true);
    assert.equal(mortgageTotal(r.value), 0);
  });
  test('빈 근저당 행과 0원 행은 행 번호와 함께 오류', () => {
    const r = validateRegistry({ mortgages: ['100', '', '0'], seizureCount: '', leaseRegistration: false });
    assert.equal(r.ok, false);
    assert.ok(r.errors['mortgage-1'].startsWith('근저당 2'));
    assert.ok(r.errors['mortgage-2'].startsWith('근저당 3'));
    assert.equal(r.errors['mortgage-0'], undefined);
  });
  test('음수·소수·문자는 행별 오류', () => {
    const r = validateRegistry({ mortgages: ['-1', '1.5', 'abc'], seizureCount: '' });
    assert.equal(r.ok, false);
    assert.equal(Object.keys(r.errors).length, 3);
  });
  test('근저당은 최대 10건', () => {
    const rows = Array.from({ length: REGISTRY_LIMITS.maxMortgages + 1 }, () => '1000');
    const r = validateRegistry({ mortgages: rows, seizureCount: '' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.mortgages);
  });
  test('가압류 건수는 0 이상 정수, 최대 20건', () => {
    assert.equal(validateRegistry({ mortgages: [], seizureCount: '2' }).value.seizureCount, 2);
    assert.ok(validateRegistry({ mortgages: [], seizureCount: '-1' }).errors.seizureCount);
    assert.ok(validateRegistry({ mortgages: [], seizureCount: '1.5' }).errors.seizureCount);
    assert.ok(validateRegistry({ mortgages: [], seizureCount: '21' }).errors.seizureCount);
  });
  test('임차권등기 여부는 true일 때만 참', () => {
    assert.equal(validateRegistry({ mortgages: [], leaseRegistration: true }).value.leaseRegistration, true);
    assert.equal(validateRegistry({ mortgages: [], leaseRegistration: 'yes' }).value.leaseRegistration, false);
  });
});

describe('등기부 요약과 물건 검증 연결', () => {
  test('registry가 있으면 seniorMortgage 칸 없이 행 합계로 계산된다', () => {
    const r = validateProperty({ ...goodBase, registry: { mortgages: ['60000000', '40000000'], seizureCount: '0', leaseRegistration: false } });
    assert.equal(r.ok, true);
    assert.equal(r.value.seniorMortgage, 100_000_000);
    assert.equal(r.value.registry.mortgages.length, 2);
  });
  test('행을 모두 지우면 근저당 0 (seniorMortgage 칸은 요구하지 않음)', () => {
    const r = validateProperty({ ...goodBase, registry: { mortgages: [], seizureCount: '' } });
    assert.equal(r.ok, true);
    assert.equal(r.value.seniorMortgage, 0);
  });
  test('registry 오류는 물건 오류로 올라온다', () => {
    const r = validateProperty({ ...goodBase, registry: { mortgages: [''], seizureCount: '' } });
    assert.equal(r.ok, false);
    assert.ok(r.errors['mortgage-0']);
  });
  test('registry를 주지 않으면 기존처럼 seniorMortgage 칸을 받는다 (기존 동작 유지)', () => {
    const r = validateProperty({ ...goodBase, seniorMortgage: '0' });
    assert.equal(r.ok, true);
    assert.equal(r.value.seniorMortgage, 0);
    assert.deepEqual(r.value.registry, defaultRegistry());
    const missing = validateProperty({ ...goodBase });
    assert.ok(missing.errors.seniorMortgage);
  });
  test('저장된 등기부 요약은 백업 왕복에서 유지된다', () => {
    const p = normalizeProperty({
      id: 'r1', name: '다가구', type: 'house', lease: 'jeonse', market: 500_000_000, deposit: 200_000_000,
      seniorMortgage: 150_000_000, seniorTenant: 0,
      registry: { mortgages: [100_000_000, 50_000_000], seizureCount: 1, leaseRegistration: true },
    });
    assert.deepEqual(p.registry, { mortgages: [100_000_000, 50_000_000], seizureCount: 1, leaseRegistration: true });
    const parsed = parseBackup(buildBackup({ ...defaultData(), properties: [p] }, '2026-11-07T00:00:00.000Z'));
    assert.deepEqual(parsed.data.properties[0].registry, p.registry);
  });
  test('registry가 없는 예전 데이터는 기본 요약으로 읽힌다', () => {
    const data = normalizeData({ properties: [{ id: 'old', name: 'A', type: 'apt', lease: 'jeonse', market: 1, deposit: 0, seniorMortgage: 0, seniorTenant: 0 }] });
    assert.deepEqual(data.properties[0].registry, defaultRegistry());
  });
  test('깨진 registry 값은 버리고 나머지는 유지', () => {
    assert.deepEqual(normalizeRegistry({ mortgages: [-5, 0, 'x', 300], seizureCount: 99, leaseRegistration: 'yes' }), {
      mortgages: [300], seizureCount: 0, leaseRegistration: false,
    });
    assert.deepEqual(normalizeRegistry(null), defaultRegistry());
  });
});

describe('등기부 요약 경고', () => {
  test('가압류가 있으면 경고, 확인 필요 표시', () => {
    const s = summarizeRegistry({ mortgages: [1000], seizureCount: 2, leaseRegistration: false });
    assert.equal(s.mortgageTotal, 1000);
    assert.equal(s.mortgageCount, 1);
    const w = s.warnings.find((x) => x.key === 'seizure');
    assert.ok(w);
    assert.equal(w.tone, 'danger');
    assert.ok(w.text.includes('확인 필요'));
  });
  test('임차권등기가 있으면 주의 경고, 법적 결론 문장이 아니다', () => {
    const s = summarizeRegistry({ mortgages: [], seizureCount: 0, leaseRegistration: true });
    assert.equal(s.warnings.length, 1);
    assert.equal(s.warnings[0].key, 'leaseRegistration');
    assert.ok(s.warnings[0].text.includes('일반 설명'));
    assert.ok(s.warnings[0].text.includes('확인 필요'));
  });
  test('깨끗한 등기부는 경고가 없다', () => {
    assert.deepEqual(summarizeRegistry(defaultRegistry()).warnings, []);
  });
});

describe('일정 상태와 D-day', () => {
  test('지남 · 오늘 · 예정 구분', () => {
    assert.equal(timelineStatus('2026-11-06', '2026-11-07'), 'past');
    assert.equal(timelineStatus('2026-11-07', '2026-11-07'), 'today');
    assert.equal(timelineStatus('2026-11-08', '2026-11-07'), 'upcoming');
  });
  test('D-day 문구', () => {
    assert.equal(dDayLabel('2026-11-07', '2026-11-07'), '오늘');
    assert.equal(dDayLabel('2026-11-10', '2026-11-07'), 'D-3');
    assert.equal(dDayLabel('2026-11-05', '2026-11-07'), '2일 지남');
  });
  test('다음 일정은 오늘 이후 가장 가까운 것 (오늘 포함)', () => {
    const events = [
      { key: 'a', date: '2026-01-01' },
      { key: 'b', date: '2026-11-07' },
      { key: 'c', date: '2027-01-01' },
    ];
    assert.equal(nextEvent(events, '2026-11-07').key, 'b');
    assert.equal(nextEvent(events, '2026-11-08').key, 'c');
    assert.equal(nextEvent(events, '2027-02-01'), null);
  });
});

describe('알림 예정일', () => {
  test('기본 1일 전, 7일·30일 선택 가능', () => {
    assert.deepEqual(REMINDER_LEAD_DAYS, [1, 7, 30]);
    assert.deepEqual(reminderFor('2028-03-15', '2026-11-07', 7), { leadDays: 7, date: '2028-03-08', status: 'upcoming' });
    assert.equal(reminderFor('2028-03-15', '2026-11-07').leadDays, 1);
  });
  test('알림일이 지났으면 passed, 당일이면 today', () => {
    assert.equal(reminderFor('2026-11-08', '2026-11-07', 7).status, 'passed');
    assert.equal(reminderFor('2026-11-14', '2026-11-07', 7).status, 'today');
    assert.equal(reminderFor('2026-11-14', '2026-11-07', 7).date, '2026-11-07');
  });
  test('목록에 없는 선행 일수는 1일로 본다', () => {
    assert.equal(reminderFor('2026-11-10', '2026-11-07', 3).leadDays, 1);
  });
  test('30일 선행은 월말·연말 경계를 넘긴다', () => {
    assert.equal(reminderFor('2027-01-10', '2026-11-07', 30).date, '2026-12-11');
  });
});

describe('ICS 알림 선행 일수', () => {
  const ev = [{ uid: 'p1-expiry', title: '만기일', date: '2028-03-15', description: '' }];
  test('기본값은 1일 전 알림 (기존 동작)', () => {
    const ics = buildIcs(ev, '20261107T000000Z');
    assert.ok(ics.includes('TRIGGER:-P1D'));
    assert.ok(ics.includes('DESCRIPTION:내일: 만기일'));
  });
  test('7일 전 선택 시 트리거와 문구가 바뀐다', () => {
    const ics = buildIcs(ev, '20261107T000000Z', 7);
    assert.ok(ics.includes('TRIGGER:-P7D'));
    assert.ok(ics.includes('DESCRIPTION:7일 뒤: 만기일'));
    assert.ok(!ics.includes('TRIGGER:-P1D'));
  });
  test('허용되지 않은 값은 1일로 대체', () => {
    assert.ok(buildIcs(ev, '20261107T000000Z', 2).includes('TRIGGER:-P1D'));
  });
});

describe('타임라인 구성', () => {
  test('계약일만 있으면 만기 추정 일정이 생기고 날짜 순서가 맞다', () => {
    const events = buildTimeline({ contractDate: '2026-03-01', moveInDate: '2026-03-02' });
    const keys = events.map((e) => e.key);
    assert.equal(keys[0], 'contract');
    assert.ok(keys.includes('expiry'));
    const dates = events.map((e) => e.date);
    assert.deepEqual([...dates].sort(), dates);
  });
});
