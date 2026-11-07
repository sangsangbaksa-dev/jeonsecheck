import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProperty, validateRegistry, normalizeRegistry, normalizeProperty, mortgageTotal,
  summarizeRegistry, defaultRegistry, REGISTRY_LIMITS, normalizeData, buildBackup, parseBackup, defaultData,
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
