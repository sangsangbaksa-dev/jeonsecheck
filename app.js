// jeonsecheck UI. 모든 사용자 데이터는 textContent로만 넣는다 (innerHTML 사용 안 함).
import {
  CONSTANTS, PROPERTY_TYPES, LEASE_TYPES, CHECKLIST, CLAUSES, CLAUSE_NOTICE, SUMMARY_HEADERS, composeClauses,
  parseWon, formatKoreanWon, formatWon, formatPct, analyzeProperty, barPosition,
  formatKoreanDate, diffDays, buildTimeline, renewalWindow, buildIcs, toCsv, summaryRows,
  validateProperty, validateSettings, toggleCheck, stageProgress, overallProgress,
  loadData, saveData, buildBackup, parseBackup, defaultData, makeId, toYmd, STORAGE_KEY,
  normalizeRegistry, defaultRegistry, summarizeRegistry, REGISTRY_LIMITS,
  timelineStatus, dDayLabel, nextEvent, reminderFor, REMINDER_LEAD_DAYS, rankSafest,
} from './logic.js';
import {
  AI_KEY_STORAGE, isPlausibleKey, buildAdvicePayload, requestAdvice, fallbackAdvice,
} from './ai.js';

// ---------------------------------------------------------------------------
// 작은 DOM 헬퍼
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

function labelOf(list, value) {
  return list.find((x) => x.value === value)?.label ?? '';
}

function todayYmd() {
  const d = new Date();
  return toYmd({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
}

function safeFileName(text) {
  return String(text).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'property';
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let toastTimer = null;
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
}

// ---------------------------------------------------------------------------
// 상태 · 저장
// ---------------------------------------------------------------------------
function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const store = getStorage();
const state = {
  data: loadData(store),
  selectedId: null,
  tab: 'analysis',
  mode: 'view', // view | edit | new
  compare: [], // 최대 5개 물건 id
  ai: { busy: false, result: null, mode: null, error: null },
  leadDays: 1, // 일정 파일 알림 선행 일수 (저장하지 않음)
  clauseSel: [], // 특약 문구 선택 (저장하지 않음)
};

function persist() {
  if (!saveData(store, state.data)) {
    toast('이 브라우저에 저장하지 못했어요. 저장 공간 설정을 확인해 주세요.');
    return false;
  }
  return true;
}

function selectedProperty() {
  return state.data.properties.find((p) => p.id === state.selectedId) ?? null;
}

function analysisOf(p) {
  return analyzeProperty(p, state.data.settings);
}

function toneClass(band) {
  return band ? `tone-${band.tone}` : 'tone-none';
}

// ---------------------------------------------------------------------------
// 물건 목록
// ---------------------------------------------------------------------------
function renderList() {
  const list = clear($('#property-list'));
  const props = state.data.properties;
  $('#list-empty').hidden = props.length > 0;

  for (const p of props) {
    const a = analysisOf(p);
    const selected = p.id === state.selectedId;
    const badge = a.ok
      ? el('span', { class: `badge ${toneClass(a.band)}`, text: `${a.band.label} · ${formatPct(a.ratioPct)}` })
      : el('span', { class: 'badge tone-none', text: a.reason === 'NO_MARKET' ? '시세 0원' : '입력 필요' });

    const select = el('button', {
      type: 'button',
      class: 'prop-select',
      'aria-current': selected ? 'true' : null,
      'aria-label': `${p.name} 선택`,
      onclick: () => selectProperty(p.id),
    }, [
      el('span', { class: 'prop-name', text: p.name }),
      el('span', { class: 'prop-meta', text: `${labelOf(PROPERTY_TYPES, p.type)} · ${labelOf(LEASE_TYPES, p.lease)} · 보증금 ${formatKoreanWon(p.deposit)}` }),
      badge,
    ]);

    const inCompare = state.compare.includes(p.id);
    const checkbox = el('input', {
      type: 'checkbox',
      id: `cmp-${p.id}`,
      checked: inCompare ? true : null,
      onchange: (e) => toggleCompare(p.id, e.target),
    });
    const compareLabel = el('label', { class: 'prop-compare', for: `cmp-${p.id}` }, [checkbox, document.createTextNode(' 비교에 추가 (최대 5)')]);

    list.append(el('article', { class: 'prop-card', 'data-id': p.id }, [select, compareLabel]));
  }
}

function toggleCompare(id, input) {
  if (input.checked) {
    if (state.compare.length >= 5) {
      input.checked = false;
      toast('비교는 최대 5개까지 가능해요. 하나를 빼고 다시 선택하세요.');
      return;
    }
    if (!state.compare.includes(id)) state.compare.push(id);
  } else {
    state.compare = state.compare.filter((x) => x !== id);
  }
  if (state.tab === 'compare') renderPanel();
}

function selectProperty(id) {
  state.selectedId = id;
  state.mode = 'view';
  state.ai = { busy: false, result: null, mode: null, error: null };
  renderAll();
  $('#detail').scrollIntoView({ block: 'start' });
}

// ---------------------------------------------------------------------------
// 편집 폼
// ---------------------------------------------------------------------------
// 선순위 근저당은 등기부 행 목록에서 합계로 계산하므로 여기 목록에 두지 않는다.
const MONEY_FIELDS = ['market', 'deposit', 'seniorTenant', 'publicPrice', 'monthlyRent'];
const FORM_FIELDS = ['name', 'address', 'type', 'lease', ...MONEY_FIELDS, 'contractDate', 'moveInDate', 'expiryDate', 'memo'];

function openEditor(p) {
  state.mode = p ? 'edit' : 'new';
  const form = $('#property-form');
  form.reset();
  $('#editor-title').textContent = p ? '물건 정보 수정' : '새 물건 입력';
  for (const key of FORM_FIELDS) {
    const input = form.elements.namedItem(key);
    if (!input) continue;
    const value = p ? p[key] : null;
    if (MONEY_FIELDS.includes(key)) input.value = value === null || value === undefined ? '' : String(value);
    else input.value = value ?? (key === 'type' ? 'apt' : key === 'lease' ? 'jeonse' : '');
  }
  const reg = p ? normalizeRegistry(p.registry) : defaultRegistry();
  // 등기부 행 정보가 없는 예전 데이터는 합계를 한 행으로 옮겨 보여 준다.
  let rows = reg.mortgages.map(String);
  if (p && rows.length === 0 && p.seniorMortgage > 0) rows = [String(p.seniorMortgage)];
  renderMortgageRows(rows);
  $('#f-seizureCount').value = reg.seizureCount ? String(reg.seizureCount) : '';
  $('#f-leaseRegistration').checked = reg.leaseRegistration;
  clearFormErrors();
  for (const key of MONEY_FIELDS) updatePreview(key);
  $('#editor').hidden = false;
  renderDetailHeader();
  renderPanel();
  $('#editor').scrollIntoView({ block: 'start' });
  form.elements.namedItem('name').focus();
}

function closeEditor() {
  state.mode = 'view';
  $('#editor').hidden = true;
  renderAll();
}

function clearFormErrors() {
  for (const node of $('#property-form').querySelectorAll('.error')) node.textContent = '';
  for (const input of $('#property-form').querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
  $('#form-status').textContent = '';
}

function showFormErrors(errors) {
  for (const [key, message] of Object.entries(errors)) {
    const err = document.getElementById(`err-${key}`);
    if (err) err.textContent = message;
    const input = inputFor(key);
    if (input) input.setAttribute('aria-invalid', 'true');
  }
  const first = Object.keys(errors)[0];
  if (first) inputFor(first)?.focus();
  $('#form-status').textContent = '입력 내용을 확인해 주세요.';
}

/** 오류 키 → 입력 칸. 근저당 행(mortgage-N)은 행 입력 id로 찾는다. */
function inputFor(key) {
  if (key.startsWith('mortgage-')) return document.getElementById(`f-${key}`);
  return $('#property-form').elements.namedItem(key);
}

// ---------------------------------------------------------------------------
// 등기부 근저당 행
// ---------------------------------------------------------------------------
function renderMortgageRows(values) {
  const list = clear($('#reg-mortgages'));
  values.forEach((value, i) => {
    const input = el('input', {
      id: `f-mortgage-${i}`,
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'off',
      value,
      'data-mortgage': String(i),
      'aria-label': `근저당 ${i + 1} 채권최고액 (원)`,
      placeholder: '예: 120000000',
      'aria-describedby': `prev-mortgage-${i} err-mortgage-${i}`,
      oninput: () => updateMortgagePreview(i),
    });
    const remove = el('button', {
      type: 'button', class: 'btn btn-ghost btn-sm', text: '행 삭제',
      'aria-label': `근저당 ${i + 1} 행 삭제`,
      onclick: () => {
        const rest = readMortgageValues().filter((_, idx) => idx !== i);
        renderMortgageRows(rest);
        $('#add-mortgage').focus();
      },
    });
    list.append(el('div', { class: 'mortgage-row' }, [
      el('div', { class: 'mortgage-main' }, [
        el('label', { for: `f-mortgage-${i}`, class: 'mortgage-label', text: `근저당 ${i + 1}` }),
        input,
        el('p', { class: 'preview', id: `prev-mortgage-${i}`, 'aria-live': 'polite' }),
        el('p', { class: 'error', id: `err-mortgage-${i}`, 'aria-live': 'polite' }),
      ]),
      remove,
    ]));
    updateMortgagePreview(i);
  });
  $('#add-mortgage').disabled = values.length >= REGISTRY_LIMITS.maxMortgages;
}

function readMortgageValues() {
  return [...document.querySelectorAll('#reg-mortgages input[data-mortgage]')].map((input) => input.value);
}

function updateMortgagePreview(i) {
  const input = document.getElementById(`f-mortgage-${i}`);
  const node = document.getElementById(`prev-mortgage-${i}`);
  if (!input || !node) return;
  const parsed = parseWon(input.value);
  node.textContent = parsed.ok && parsed.value !== null ? `= ${formatKoreanWon(parsed.value)}` : '';
}

function readRegistry() {
  return {
    mortgages: readMortgageValues(),
    seizureCount: $('#f-seizureCount').value,
    leaseRegistration: $('#f-leaseRegistration').checked,
  };
}

function updatePreview(key) {
  const input = $('#property-form').elements.namedItem(key);
  const node = document.getElementById(`prev-${key}`);
  if (!input || !node) return;
  const parsed = parseWon(input.value);
  if (!parsed.ok) node.textContent = '';
  else if (parsed.value === null) node.textContent = '';
  else node.textContent = `= ${formatKoreanWon(parsed.value)}`;
}

function readForm() {
  const form = $('#property-form');
  const out = {};
  for (const key of FORM_FIELDS) {
    const input = form.elements.namedItem(key);
    out[key] = input ? input.value : '';
  }
  return out;
}

function submitForm(event) {
  event.preventDefault();
  clearFormErrors();
  const prev = state.mode === 'edit' ? selectedProperty() : null;
  const result = validateProperty({ ...readForm(), registry: readRegistry() }, prev);
  if (!result.ok) {
    showFormErrors(result.errors);
    return;
  }
  const now = new Date().toISOString();
  const value = { ...result.value, updatedAt: now };
  if (prev) {
    state.data.properties = state.data.properties.map((p) => (p.id === prev.id ? { ...value, id: prev.id } : p));
    state.selectedId = prev.id;
  } else {
    const id = makeId();
    state.data.properties = [...state.data.properties, { ...value, id, checks: {}, updatedAt: now }];
    state.selectedId = id;
  }
  if (!persist()) return;
  state.mode = 'view';
  state.ai = { busy: false, result: null, mode: null, error: null };
  $('#editor').hidden = true;
  toast('저장했어요.');
  renderAll();
}

function deleteSelected() {
  const p = selectedProperty();
  if (!p) return;
  if (!window.confirm(`"${p.name}" 물건과 점검 기록을 삭제할까요? 되돌릴 수 없어요.`)) return;
  state.data.properties = state.data.properties.filter((x) => x.id !== p.id);
  state.compare = state.compare.filter((x) => x !== p.id);
  state.selectedId = null;
  state.mode = 'view';
  persist();
  toast('삭제했어요.');
  renderAll();
}

// ---------------------------------------------------------------------------
// 상세 헤더 · 탭
// ---------------------------------------------------------------------------
function renderDetailHeader() {
  const head = clear($('#detail-head'));
  const p = selectedProperty();
  if (!p) {
    head.append(el('div', {}, [
      el('h3', { class: 'detail-title', text: '물건을 선택하세요' }),
      el('p', { class: 'muted', text: '목록에서 물건을 고르거나 "새 물건"으로 추가하면 분석이 열립니다. 설정·백업과 특약 문구는 물건 없이도 쓸 수 있어요.' }),
    ]));
    return;
  }
  const chips = el('div', { class: 'chip-row' }, [
    el('span', { class: 'chip', text: labelOf(PROPERTY_TYPES, p.type) }),
    el('span', { class: 'chip', text: labelOf(LEASE_TYPES, p.lease) }),
    p.address ? el('span', { class: 'chip', text: p.address }) : null,
  ]);
  head.append(
    el('div', {}, [el('h3', { class: 'detail-title', text: p.name }), chips]),
    el('div', { class: 'detail-actions' }, [
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '수정', onclick: () => openEditor(p) }),
      el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: '삭제', onclick: deleteSelected }),
    ]),
  );
}

const TAB_ORDER = ['analysis', 'checklist', 'timeline', 'clauses', 'compare', 'data'];

function selectTab(name, focus = false) {
  state.tab = name;
  for (const btn of document.querySelectorAll('#tabs [role="tab"]')) {
    const on = btn.dataset.tab === name;
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    btn.tabIndex = on ? 0 : -1;
    if (on && focus) btn.focus();
  }
  $('#panel').setAttribute('aria-labelledby', `tab-${name}`);
  renderPanel();
}

function onTabKey(event) {
  const idx = TAB_ORDER.indexOf(state.tab);
  let next = null;
  if (event.key === 'ArrowRight') next = TAB_ORDER[(idx + 1) % TAB_ORDER.length];
  else if (event.key === 'ArrowLeft') next = TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length];
  else if (event.key === 'Home') next = TAB_ORDER[0];
  else if (event.key === 'End') next = TAB_ORDER[TAB_ORDER.length - 1];
  if (next) {
    event.preventDefault();
    selectTab(next, true);
  }
}

function renderPanel() {
  const panel = clear($('#panel'));
  const p = selectedProperty();
  switch (state.tab) {
    case 'analysis': return renderAnalysis(panel, p);
    case 'checklist': return renderChecklist(panel, p);
    case 'timeline': return renderTimeline(panel, p);
    case 'clauses': return renderClauses(panel);
    case 'compare': return renderCompare(panel);
    case 'data': return renderData(panel);
    default: return undefined;
  }
}

function renderAll() {
  renderList();
  renderDetailHeader();
  renderPanel();
  $('#detail').hidden = false;
}

function needProperty(panel) {
  panel.append(el('p', { class: 'empty', text: '먼저 물건을 선택하거나 추가해 주세요.' }));
}

// ---------------------------------------------------------------------------
// 위험 분석 탭
// ---------------------------------------------------------------------------
function meterElement(ratioPct, band, label) {
  const pos = barPosition(ratioPct);
  const fill = el('div', { class: `meter-fill ${toneClass(band)}`, style: `width:${pos}%` });
  const ticks = CONSTANTS.riskBands
    .filter((b) => Number.isFinite(b.maxPct) && b.maxPct < 100)
    .map((b) => el('div', { class: 'meter-tick', style: `left:${b.maxPct}%`, 'aria-hidden': 'true' }, [el('span', { text: `${b.maxPct}%` })]));
  return el('div', {
    class: 'meter',
    role: 'meter',
    'aria-label': label,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': Math.round(pos),
    'aria-valuetext': ratioPct > 100 ? `${formatPct(ratioPct)} (시세보다 큼)` : formatPct(ratioPct),
  }, [fill, ...ticks]);
}

function renderAnalysis(panel, p) {
  if (!p) return needProperty(panel);
  const a = analysisOf(p);
  panel.append(el('h3', { class: 'panel-title', text: '위험 분석 (참고용)' }));

  if (!a.ok) {
    const msg = a.reason === 'NO_MARKET'
      ? '예상 매매 시세가 0원이라 위험비율을 계산할 수 없어요. 시세를 다시 확인해 주세요.'
      : '금액을 확인해 주세요. 빈 칸이 있으면 분석할 수 없어요.';
    panel.append(el('p', { class: 'note-warn', text: msg }));
    panel.append(el('button', { type: 'button', class: 'btn btn-ghost', text: '정보 수정', onclick: () => openEditor(p) }));
    return;
  }

  // 점수 카드
  const formula = `(선순위 근저당 ${formatKoreanWon(p.seniorMortgage)} + 선순위 임차 ${formatKoreanWon(p.seniorTenant)} + 내 보증금 ${formatKoreanWon(p.deposit)}) ÷ 예상 시세 ${formatKoreanWon(p.market)}`;
  const over = a.ratioPct > 100 ? ' 청구 합계가 시세보다 큽니다.' : '';
  panel.append(el('div', { class: 'score-card' }, [
    el('div', { class: 'score-top' }, [
      el('div', {}, [
        el('p', { class: 'muted', style: 'margin:0', text: '위험비율' }),
        el('div', { class: 'score-value', text: formatPct(a.ratioPct) }),
      ]),
      el('span', { class: `badge ${toneClass(a.band)}`, text: `등급: ${a.band.label}` }),
    ]),
    el('p', { class: 'formula', text: `${formula}${over}` }),
    meterElement(a.ratioPct, a.band, '위험비율 막대'),
    el('p', { class: 'source', text: `등급 구간: 70% 이하 안전 · 80% 이하 주의 · 90% 이하 위험 · 90% 초과 매우 위험. ${CONSTANTS.riskBandsSource}` }),
  ]));

  panel.append(registryCard(p));

  // 시나리오
  const rows = [
    el('tr', {}, [el('th', { scope: 'row', text: '현재 시세' }), el('td', { class: 'num', text: formatWon(p.market) }), el('td', { class: 'num', text: formatPct(a.ratioPct) }), el('td', { text: a.band.label })]),
    ...a.scenarios.map((s) => el('tr', {}, [
      el('th', { scope: 'row', text: `시세 ${s.dropPct}% 하락` }),
      el('td', { class: 'num', text: formatWon(s.marketAfter) }),
      el('td', { class: 'num', text: s.ratioPct === null ? '-' : formatPct(s.ratioPct) }),
      el('td', { text: s.band.label }),
    ])),
  ];
  panel.append(el('div', { class: 'subcard', style: 'margin-top:1rem' }, [
    el('h4', { text: '시세 하락 시나리오' }),
    el('div', { class: 'table-wrap' }, [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [el('th', { text: '구분' }), el('th', { class: 'num', text: '가정 시세' }), el('th', { class: 'num', text: '위험비율' }), el('th', { text: '등급' })])]),
        el('tbody', {}, rows),
      ]),
    ]),
    el('p', { class: 'source', text: CONSTANTS.scenarioSource }),
  ]));

  // 경매 노출 + 공시가격 참고
  const auction = a.auction;
  const exposedText = auction.exposed > 0
    ? `${formatKoreanWon(auction.exposed)} 정도는 배당을 못 받을 수 있어요 (단순 모델).`
    : '가정한 낙찰가 기준으로는 보증금 전액이 배당 범위 안에 있어요.';
  const prot = a.protection;
  let protText;
  if (prot.status === 'unknown') protText = '공시가격을 입력하면 140% 기준으로 대략 비교해 드려요.';
  else if (prot.status === 'within') protText = `청구 합계 ${formatKoreanWon(prot.totalClaims)}이 공시가격 ${prot.publicPct}% (${formatKoreanWon(prot.limit)}) 이내예요. 보증보험 가입 가능성이 상대적으로 있을 수 있어요 (참고).`;
  else protText = `청구 합계 ${formatKoreanWon(prot.totalClaims)}이 공시가격 ${prot.publicPct}% (${formatKoreanWon(prot.limit)})를 넘어요. 보증보험 가입이 어려울 수 있어요 (참고).`;

  panel.append(el('div', { class: 'grid-2', style: 'margin-top:1rem' }, [
    el('div', { class: 'subcard' }, [
      el('h4', { text: `경매 시 노출 (낙찰가율 ${auction.auctionPct}% 가정)` }),
      el('dl', { class: 'kv' }, [
        el('div', {}, [el('dt', { text: '가정 낙찰가' }), el('dd', { text: formatKoreanWon(auction.auctionPrice) })]),
        el('div', {}, [el('dt', { text: '선순위 채권 차감 후 배당 가능액' }), el('dd', { text: formatKoreanWon(auction.distributable) })]),
        el('div', {}, [el('dt', { text: '내 보증금 중 배당 못 받을 수 있는 금액' }), el('dd', { text: formatKoreanWon(auction.exposed) })]),
      ]),
      el('p', { class: 'source', text: exposedText }),
      el('p', { class: 'source', text: CONSTANTS.auctionRatioSource }),
    ]),
    el('div', { class: 'subcard' }, [
      el('h4', { text: '공시가격 기준 참고 (보증보험)' }),
      el('p', { text: protText }),
      el('p', { class: 'source', text: CONSTANTS.publicRatioSource }),
      el('p', { class: 'source', text: '참고용 판정이며 실제 가입 여부와 한도는 보증기관에서 확인해야 합니다.' }),
    ]),
  ]));

  if ((p.monthlyRent ?? 0) > 0) {
    panel.append(el('p', { class: 'source', style: 'margin-top:0.75rem', text: `월세 ${formatKoreanWon(p.monthlyRent)}은 위험비율 계산에 넣지 않았어요.` }));
  }

  // 등급 범례
  panel.append(el('ul', { class: 'band-legend', 'aria-label': '등급 구간 범례' },
    CONSTANTS.riskBands.map((b, i) => {
      const prev = i === 0 ? 0 : CONSTANTS.riskBands[i - 1].maxPct;
      const range = Number.isFinite(b.maxPct) ? `${prev}% 초과 ~ ${b.maxPct}% 이하` : `${prev}% 초과`;
      const text = i === 0 ? `${b.label} · 0 ~ ${b.maxPct}%` : `${b.label} · ${range}`;
      return el('li', { class: `badge-li ${toneClass(b)}`, style: 'display:block', text });
    }),
  ));

  panel.append(renderAiBox(p, a));

  panel.append(el('p', { class: 'note-warn', style: 'margin-top:1rem', text: '이 결과는 입력값 기준의 참고 계산입니다. 보장된 안전이 아니며 법률·세무·재무 자문이 아닙니다. 등기부와 임대인 정보를 직접 확인하세요.' }));
}

function registryCard(p) {
  const s = summarizeRegistry(p.registry);
  const countText = s.mortgageCount > 0
    ? `선순위 근저당 ${s.mortgageCount}건 · 합계 ${formatKoreanWon(p.seniorMortgage)}`
    : `선순위 근저당 합계 ${formatKoreanWon(p.seniorMortgage)} (건별 금액 미입력)`;
  const items = s.warnings.length
    ? s.warnings.map((w) => el('li', { class: `reg-warn ${toneClass({ tone: w.tone })}`, text: w.text }))
    : [el('li', { class: 'reg-ok', text: '입력된 범위에서 가압류·임차권등기 경고는 없어요. 등기부 원본은 직접 확인하세요.' })];
  return el('section', { class: 'subcard', style: 'margin-top:1rem', 'aria-labelledby': 'reg-card-title' }, [
    el('h4', { id: 'reg-card-title', text: '등기부 요약' }),
    el('p', { text: countText }),
    el('ul', { class: 'reg-list' }, items),
    el('p', { class: 'source', text: '근저당은 채권최고액 기준이며 실제 대출잔액과 다를 수 있어요. 가압류·임차권등기는 계산에 넣지 않고 경고로만 보여 줍니다.' }),
  ]);
}

// ---------------------------------------------------------------------------
// AI 설명 패널
// ---------------------------------------------------------------------------
function readStoredKey() {
  try {
    return store ? store.getItem(AI_KEY_STORAGE) || '' : '';
  } catch {
    return '';
  }
}

function writeStoredKey(value) {
  try {
    if (!store) return false;
    if (value) store.setItem(AI_KEY_STORAGE, value);
    else store.removeItem(AI_KEY_STORAGE);
    return true;
  } catch {
    return false;
  }
}

function renderAiBox(p, a) {
  const box = el('section', { class: 'subcard ai-box', 'aria-labelledby': 'ai-title' });
  const payload = buildAdvicePayload(p, a);
  const hasKey = Boolean(readStoredKey());

  box.append(el('h4', { id: 'ai-title', text: 'AI로 쉽게 설명 받기 (선택)' }));
  box.append(el('p', { class: 'source', text: '버튼을 눌렀을 때만 아래 숫자와 주택 유형이 Anthropic API로 전송됩니다. 주소·이름·메모는 보내지 않습니다.' }));
  if (payload) {
    box.append(el('p', { class: 'source', style: 'margin:0', text: '전송될 내용:' }));
    box.append(el('pre', { class: 'ai-sent', text: payload.preview }));
  }

  // 키 입력 (localStorage 저장, 개발자도구에서 보일 수 있음)
  const keyInput = el('input', { type: 'password', id: 'ai-key', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-... (내 API 키)', 'aria-describedby': 'ai-key-warn' });
  const saveKey = el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm', text: '키 저장',
    onclick: () => {
      const v = keyInput.value.trim();
      if (!isPlausibleKey(v)) {
        toast('키 형식이 맞지 않아요. sk-ant-로 시작하는 키를 입력하세요.');
        return;
      }
      if (writeStoredKey(v)) {
        keyInput.value = '';
        toast('이 브라우저에 키를 저장했어요.');
      } else {
        toast('키를 저장하지 못했어요. 브라우저 설정을 확인하세요.');
      }
      renderPanel();
    },
  });
  const removeKey = el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm', text: '키 삭제', disabled: !hasKey,
    onclick: () => {
      writeStoredKey('');
      toast('키를 삭제했어요.');
      renderPanel();
    },
  });
  box.append(el('div', { class: 'ai-key-row' }, [
    el('label', { for: 'ai-key', class: 'source', text: hasKey ? '저장된 키가 있어요. 새 키를 넣으면 교체됩니다.' : '내 Anthropic API 키 (없으면 규칙 기반 설명을 봅니다)' }),
    keyInput,
    el('div', { class: 'btn-row' }, [saveKey, removeKey]),
  ]));
  box.append(el('p', { id: 'ai-key-warn', class: 'warn-keys', text: '주의: 브라우저에 저장한 키는 개발자도구에서 볼 수 있어요. 공용 컴퓨터에서는 저장하지 마세요.' }));

  const askBtn = el('button', {
    type: 'button', class: 'btn btn-primary', disabled: state.ai.busy || !payload,
    text: state.ai.busy ? '설명 만드는 중…' : (hasKey ? 'AI로 설명 받기' : '규칙 기반 설명 보기'),
    onclick: () => runAdvice(p, a, payload),
  });
  box.append(el('div', { class: 'btn-row', style: 'margin-top:0.75rem' }, [askBtn]));

  const result = el('div', { class: 'ai-result', 'aria-live': 'polite' });
  if (state.ai.error) result.append(el('p', { class: 'form-status', text: state.ai.error }));
  if (state.ai.result) {
    result.append(el('p', { class: 'ai-mode', text: state.ai.mode === 'ai' ? 'AI 응답 (내용은 틀릴 수 있어요)' : '규칙 기반 설명 (AI 아님, 키 없이 동작)' }));
    result.append(el('p', { text: state.ai.result.summary }));
    result.append(el('p', { class: 'source', style: 'margin-bottom:0.25rem', text: '임대인·중개사에게 물어볼 질문' }));
    result.append(el('ol', {}, state.ai.result.questions.map((q) => el('li', { text: q }))));
  }
  box.append(result);
  return box;
}

async function runAdvice(p, a, payload) {
  if (!payload || state.ai.busy) return;
  const key = readStoredKey();
  state.ai = { busy: true, result: null, mode: null, error: null };
  renderPanel();
  if (!key) {
    const fb = fallbackAdvice(p, a);
    state.ai = { busy: false, result: fb, mode: 'rule', error: null };
    renderPanel();
    return;
  }
  const res = await requestAdvice({ key, prompt: payload.prompt });
  if (res.ok) {
    state.ai = { busy: false, result: res.advice, mode: 'ai', error: null };
  } else {
    const fb = fallbackAdvice(p, a);
    state.ai = { busy: false, result: fb, mode: 'rule', error: `${res.error} 아래는 규칙 기반 설명입니다.` };
  }
  renderPanel();
}

// ---------------------------------------------------------------------------
// 점검표 탭
// ---------------------------------------------------------------------------
function renderChecklist(panel, p) {
  if (!p) return needProperty(panel);
  panel.append(el('h3', { class: 'panel-title', text: '단계별 점검표' }));
  const overall = overallProgress(p.checks);
  const barFill = el('span', {});
  const overallBar = el('div', { class: 'progress-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': overall.total, 'aria-valuenow': overall.done, 'aria-label': '전체 진행률' }, [barFill]);
  const overallText = el('p', { class: 'muted' });
  panel.append(overallText, overallBar);

  // 체크 변경 시 전체 진행률만 갱신 (포커스 유지를 위해 목록은 다시 그리지 않는다)
  const updateProgress = () => {
    const cur = overallProgress(selectedProperty()?.checks ?? {});
    overallText.textContent = `전체 ${cur.done} / ${cur.total} 완료`;
    overallBar.setAttribute('aria-valuenow', String(cur.done));
    barFill.style.width = `${cur.total ? Math.round((cur.done / cur.total) * 100) : 0}%`;
    return cur;
  };
  updateProgress();

  for (const stage of CHECKLIST) {
    const sp = stageProgress(p.checks, stage.key);
    const stageCount = el('span', { class: 'muted', 'data-stage-count': stage.key, text: `${sp.done} / ${sp.total}` });
    const list = el('ul', { class: 'check-list' });
    for (const item of stage.items) {
      const checked = Boolean(p.checks[item.id]);
      const input = el('input', {
        type: 'checkbox',
        id: `chk-${item.id}`,
        checked: checked ? true : null,
        onchange: (e) => {
          const current = selectedProperty();
          if (!current) return;
          const nextChecks = toggleCheck(current.checks, item.id);
          state.data.properties = state.data.properties.map((x) => (x.id === current.id ? { ...x, checks: nextChecks } : x));
          persist();
          e.target.closest('.check-item')?.classList.toggle('is-done', e.target.checked);
          const sc = stageProgress(nextChecks, stage.key);
          stageCount.textContent = `${sc.done} / ${sc.total}`;
          updateProgress();
        },
      });
      const text = el('span', {}, [
        el('span', { class: 'check-text', text: item.text }),
        item.hint ? el('span', { class: 'check-hint', text: item.hint }) : null,
      ]);
      list.append(el('li', { class: `check-item${checked ? ' is-done' : ''}` }, [
        el('label', { for: `chk-${item.id}` }, [input, text]),
      ]));
    }
    panel.append(el('section', { class: 'stage', 'aria-labelledby': `stage-${stage.key}` }, [
      el('div', { class: 'stage-head' }, [el('h3', { id: `stage-${stage.key}`, text: stage.title }), stageCount]),
      list,
    ]));
  }

  panel.append(el('div', { class: 'btn-row' }, [
    el('button', {
      type: 'button', class: 'btn btn-ghost btn-sm', text: '이 물건의 체크 초기화',
      onclick: () => {
        if (!window.confirm('이 물건의 체크를 모두 지울까요?')) return;
        const current = selectedProperty();
        state.data.properties = state.data.properties.map((x) => (x.id === current.id ? { ...x, checks: {} } : x));
        persist();
        renderPanel();
      },
    }),
  ]));
  panel.append(el('p', { class: 'source', text: '체크 상태는 이 브라우저에 물건별로 저장됩니다. 등기부·건축물대장 등 실제 서류 확인을 대신하지 않습니다.' }));
}

// ---------------------------------------------------------------------------
// 날짜·일정 탭
// ---------------------------------------------------------------------------
function renderTimeline(panel, p) {
  if (!p) return needProperty(panel);
  panel.append(el('h3', { class: 'panel-title', text: '날짜·일정' }));
  const events = buildTimeline(p);
  if (events.length === 0) {
    panel.append(el('p', { class: 'note-warn', text: '계약일, 잔금·입주일, 만기일 중 하나를 입력하면 날짜가 계산됩니다.' }));
    panel.append(el('button', { type: 'button', class: 'btn btn-ghost', text: '날짜 입력하기', onclick: () => openEditor(p) }));
    return;
  }

  const today = todayYmd();
  const next = nextEvent(events, today);
  panel.append(el('div', { class: 'next-up' }, [
    el('span', { class: 'next-label', text: '다음 일정' }),
    next
      ? el('span', { class: 'next-body' }, [
        el('strong', { text: next.title }),
        document.createTextNode(` · ${formatKoreanDate(next.date)} (${dDayLabel(next.date, today)})`),
      ])
      : el('span', { class: 'next-body', text: '오늘 이후 남은 일정이 없어요.' }),
  ]));

  const hasExpiry = events.some((e) => e.key === 'expiry');
  if (hasExpiry) {
    const w = renewalWindow(events.find((e) => e.key === 'expiry').date);
    panel.append(el('p', { class: 'note-warn', text: `계약갱신요구 가능 기간: ${formatKoreanDate(w.start)} ~ ${formatKoreanDate(w.end)} (만기 6~2개월 전, 확인 필요)` }));
  }
  if (events.some((e) => e.estimated)) {
    panel.append(el('p', { class: 'source', text: '만기일을 입력하지 않아 계약일 + 24개월로 추정했습니다. 계약서의 실제 만기일로 수정하세요.' }));
  }

  // 알림 선행 일수 (일정 파일과 화면 알림일에 함께 쓴다)
  const leadSelect = el('select', {
    id: 'lead-days',
    'aria-describedby': 'lead-help',
    onchange: (e) => {
      state.leadDays = Number(e.target.value);
      renderPanel();
    },
  }, REMINDER_LEAD_DAYS.map((d) => el('option', { value: d, selected: d === state.leadDays ? true : null, text: `${d}일 전` })));
  panel.append(el('div', { class: 'lead-row' }, [
    el('label', { for: 'lead-days', text: '알림 시점' }),
    leadSelect,
    el('p', { class: 'hint', id: 'lead-help', text: '선택한 날짜 전에 알림이 울리도록 일정 파일을 만듭니다. 알림일은 아래 목록에도 표시됩니다.' }),
  ]));

  const list = el('ol', { class: 'timeline', 'aria-label': '날짜 목록' });
  for (const e of events) {
    const status = timelineStatus(e.date, today);
    const r = reminderFor(e.date, today, state.leadDays);
    const reminderText = {
      passed: '알림일이 지났어요',
      today: '오늘 알림',
      upcoming: '알림 예정',
    }[r.status];
    list.append(el('li', { class: `tl-item tl-${status}` }, [
      el('div', { class: 'tl-when' }, [
        el('span', { class: 'tl-date', text: formatKoreanDate(e.date) }),
        el('span', { class: 'tl-dday', text: dDayLabel(e.date, today) }),
      ]),
      el('div', { class: 'tl-body' }, [
        el('p', { class: 'tl-title' }, [
          document.createTextNode(e.title),
          e.estimated ? el('span', { class: 'tag-est', text: '추정' }) : null,
        ]),
        el('p', { class: 'tl-note', text: e.note }),
        el('p', { class: `tl-remind tl-remind-${r.status}`, text: `알림 ${formatKoreanDate(r.date)} · ${reminderText}` }),
      ]),
    ]));
  }
  panel.append(list);

  panel.append(el('div', { class: 'btn-row' }, [
    el('button', {
      type: 'button', class: 'btn btn-primary', text: '일정 파일(.ics) 내려받기',
      onclick: () => {
        const cur = selectedProperty();
        const evs = buildTimeline(cur).map((e) => ({
          uid: `${cur.id}-${e.key}`,
          title: `[jeonsecheck] ${cur.name} · ${e.title}`,
          date: e.date,
          description: `${e.note}${e.estimated ? ' (추정 날짜)' : ''}. 참고용 일정이며 법률 자문이 아닙니다.`,
        }));
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
        download(`${safeFileName(cur.name)}-일정.ics`, buildIcs(evs, stamp, state.leadDays), 'text/calendar');
        toast(`일정 파일을 내려받았어요. ${state.leadDays}일 전 알림이 들어 있어요.`);
      },
    }),
  ]));
  panel.append(el('p', { class: 'source', text: `${CONSTANTS.renewalSource}. ${CONSTANTS.opposingPowerSource}.` }));
}

// ---------------------------------------------------------------------------
// 특약 탭
// ---------------------------------------------------------------------------
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 아래 대체 방법으로 진행
  }
  const ta = el('textarea', { readonly: true, style: 'position:fixed;left:-9999px;top:0' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function renderClauses(panel) {
  panel.append(el('h3', { class: 'panel-title', text: '특약 문구 라이브러리' }));
  panel.append(el('p', { class: 'note-warn', text: CLAUSE_NOTICE }));

  // 여러 문구를 골라 번호 붙여 한 번에 복사 (선택 상태는 저장하지 않는다)
  const selCount = el('span', { class: 'muted', 'aria-live': 'polite' });
  const copySelBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: '선택한 문구 복사' });
  const refreshSel = () => {
    selCount.textContent = `선택 ${state.clauseSel.length}개 / 전체 ${CLAUSES.length}개`;
    copySelBtn.disabled = state.clauseSel.length === 0;
  };
  copySelBtn.addEventListener('click', async () => {
    const ok = await copyText(composeClauses(state.clauseSel));
    toast(ok ? `선택한 ${state.clauseSel.length}개 문구를 복사했어요. 계약서에 붙여 넣고 수정하세요.` : '복사하지 못했어요. 문구를 직접 선택해 복사해 주세요.');
  });
  refreshSel();
  panel.append(el('div', { class: 'clause-toolbar' }, [selCount, copySelBtn]));

  const grid = el('div', { class: 'clause-grid' });
  for (const c of CLAUSES) {
    const btn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '복사' });
    btn.addEventListener('click', async () => {
      const ok = await copyText(c.text);
      btn.textContent = ok ? '복사됨' : '복사 실패';
      toast(ok ? '특약 문구를 복사했어요. 계약서에 붙여 넣고 수정하세요.' : '복사하지 못했어요. 문구를 직접 선택해 복사해 주세요.');
      setTimeout(() => { btn.textContent = '복사'; }, 1800);
    });
    const check = el('input', {
      type: 'checkbox',
      id: `clause-${c.id}`,
      checked: state.clauseSel.includes(c.id) ? true : null,
      onchange: (e) => {
        state.clauseSel = e.target.checked
          ? [...state.clauseSel, c.id]
          : state.clauseSel.filter((x) => x !== c.id);
        refreshSel();
      },
    });
    grid.append(el('article', { class: 'clause' }, [
      el('div', { class: 'clause-head' }, [
        el('label', { class: 'clause-check', for: `clause-${c.id}` }, [check, document.createTextNode(' 선택')]),
        btn,
      ]),
      el('h3', { text: c.title }),
      el('p', { text: c.text }),
    ]));
  }
  panel.append(grid);
}

// ---------------------------------------------------------------------------
// 비교 탭
// ---------------------------------------------------------------------------
function renderCompare(panel) {
  panel.append(el('h3', { class: 'panel-title', text: '물건 비교 (최대 5개)' }));
  const picked = state.compare.map((id) => state.data.properties.find((p) => p.id === id)).filter(Boolean);
  if (picked.length < 2) {
    panel.append(el('p', { class: 'compare-hint', text: '물건 목록에서 "비교에 추가"를 2개 이상 체크하면 나란히 볼 수 있어요.' }));
    return;
  }
  const analyses = picked.map((p) => analysisOf(p));
  const ranking = rankSafest(picked.map((p, i) => ({
    id: p.id,
    totalClaims: analyses[i].totalClaims,
    market: p.market,
    exposed: analyses[i].ok ? analyses[i].auction.exposed : null,
  })));
  const isBest = (p) => ranking.bestIds.includes(p.id);
  const head = el('tr', {}, [
    el('th', { scope: 'col', text: '항목' }),
    ...picked.map((p) => el('th', { scope: 'col', class: `num${isBest(p) ? ' is-best' : ''}` }, [
      document.createTextNode(p.name),
      isBest(p) ? el('span', { class: 'best-tag', text: '위험비율 가장 낮음 (참고)' }) : null,
    ])),
  ]);
  const metric = (label, fn) => el('tr', {}, [
    el('th', { scope: 'row', text: label }),
    ...picked.map((p, i) => el('td', { class: `num${isBest(p) ? ' is-best' : ''}` }, [document.createTextNode(fn(p, analyses[i]))])),
  ]);
  const rows = [
    metric('유형·계약', (p) => `${labelOf(PROPERTY_TYPES, p.type)} · ${labelOf(LEASE_TYPES, p.lease)}`),
    metric('예상 매매 시세', (p) => formatKoreanWon(p.market)),
    metric('내 보증금', (p) => formatKoreanWon(p.deposit)),
    metric('선순위 근저당 합계', (p) => formatKoreanWon(p.seniorMortgage)),
    metric('선순위 임차 합계', (p) => formatKoreanWon(p.seniorTenant)),
    metric('위험비율', (p, a) => (a.ok ? formatPct(a.ratioPct) : '계산 불가')),
    metric('등급 (참고)', (p, a) => (a.ok ? a.band.label : '-')),
    metric('비교 순위 (참고)', (p) => {
      const idx = ranking.order.indexOf(p.id);
      return idx < 0 ? '계산 불가' : `${idx + 1}위`;
    }),
    metric('시세 10% 하락 시', (p, a) => (a.ok ? `${formatPct(a.scenarios[0].ratioPct)} · ${a.scenarios[0].band.label}` : '-')),
    metric('시세 20% 하락 시', (p, a) => (a.ok ? `${formatPct(a.scenarios[1].ratioPct)} · ${a.scenarios[1].band.label}` : '-')),
    metric('경매 시 배당 못 받을 수 있는 금액 (가정)', (p, a) => (a.ok ? formatKoreanWon(a.auction.exposed) : '-')),
    metric('공시가격 대비 참고', (p, a) => (a.ok ? { unknown: '공시가격 미입력', within: `${a.protection.publicPct}% 이내`, over: `${a.protection.publicPct}% 초과` }[a.protection.status] : '-')),
    metric('만기일', (p) => (p.expiryDate ? formatKoreanDate(p.expiryDate) : '미입력')),
  ];
  if (ranking.bestIds.length) {
    const names = picked.filter((p) => isBest(p)).map((p) => p.name).join(', ');
    panel.append(el('p', { class: 'note-ok', text: `입력값 기준 위험비율이 가장 낮은 물건: ${names}. 이 강조는 참고 순서일 뿐이며, 등기·임대인 확인과 다른 조건(확인 필요)을 대신하지 않아요.` }));
  } else {
    panel.append(el('p', { class: 'source', text: '위험비율이 같거나 계산 가능한 물건이 2개 미만이면 순서 강조를 하지 않아요.' }));
  }
  panel.append(el('div', { class: 'table-wrap' }, [el('table', { class: 'compare-table' }, [el('thead', {}, [head]), el('tbody', {}, rows)])]));
  panel.append(el('p', { class: 'source', text: '비교표는 같은 가정(낙찰가율·공시가격 비율)으로 계산합니다. 가정 값은 설정·백업 탭에서 바꿀 수 있어요.' }));
}

// ---------------------------------------------------------------------------
// 설정 · 백업 탭
// ---------------------------------------------------------------------------
function renderData(panel) {
  panel.append(el('h3', { class: 'panel-title', text: '설정 · 백업' }));

  // 설정
  const s = state.data.settings;
  const form = el('form', { class: 'settings-form', novalidate: true, id: 'settings-form' });
  const aucInput = el('input', { id: 's-auction', name: 'auctionRatioPct', type: 'text', inputmode: 'numeric', value: String(s.auctionRatioPct), 'aria-describedby': 's-auction-help' });
  const pubInput = el('input', { id: 's-public', name: 'publicRatioPct', type: 'text', inputmode: 'numeric', value: String(s.publicRatioPct), 'aria-describedby': 's-public-help' });
  form.append(
    el('div', { class: 'field' }, [
      el('label', { for: 's-auction', text: '경매 낙찰가율 가정 (%)' }),
      aucInput,
      el('p', { class: 'hint', id: 's-auction-help', text: `기본 ${CONSTANTS.auctionRatioPct}%. 1~100 정수. ${CONSTANTS.auctionRatioSource}` }),
      el('p', { class: 'error', id: 'err-s-auction' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 's-public', text: '공시가격 대비 참고 비율 (%)' }),
      pubInput,
      el('p', { class: 'hint', id: 's-public-help', text: `기본 ${CONSTANTS.publicRatioPct}%. 50~300 정수. ${CONSTANTS.publicRatioSource}` }),
      el('p', { class: 'error', id: 'err-s-public' }),
    ]),
    el('div', { class: 'btn-row', style: 'grid-column:1/-1' }, [
      el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: '설정 저장' }),
      el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', text: '기본값으로',
        onclick: () => {
          aucInput.value = String(CONSTANTS.auctionRatioPct);
          pubInput.value = String(CONSTANTS.publicRatioPct);
        },
      }),
    ]),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    for (const id of ['err-s-auction', 'err-s-public']) document.getElementById(id).textContent = '';
    const check = validateSettings({ auctionRatioPct: aucInput.value.trim(), publicRatioPct: pubInput.value.trim() });
    if (!check.ok) {
      if (check.errors.auctionRatioPct) document.getElementById('err-s-auction').textContent = check.errors.auctionRatioPct;
      if (check.errors.publicRatioPct) document.getElementById('err-s-public').textContent = check.errors.publicRatioPct;
      return;
    }
    state.data.settings = check.value;
    persist();
    toast('설정을 저장했어요. 모든 물건의 계산에 반영됩니다.');
    renderAll();
  });

  // 백업 · CSV · 삭제
  const importInput = el('input', { type: 'file', accept: 'application/json,.json', id: 'import-file' });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('백업 파일이 너무 커요 (2MB 이하).');
      return;
    }
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) {
      toast(parsed.error);
      return;
    }
    if (!window.confirm(`백업의 물건 ${parsed.data.properties.length}개로 현재 데이터를 바꿉니다. 계속할까요?`)) return;
    state.data = parsed.data;
    state.selectedId = null;
    state.compare = [];
    state.mode = 'view';
    persist();
    toast('백업을 불러왔어요.');
    renderAll();
  });

  const exportBtn = el('button', {
    type: 'button', class: 'btn btn-primary btn-sm', text: 'JSON 백업 내려받기',
    onclick: () => {
      const stamp = todayYmd();
      download(`jeonsecheck-backup-${stamp}.json`, buildBackup(state.data, new Date().toISOString()), 'application/json');
      toast('백업 파일을 저장했어요. AI 키는 포함되지 않습니다.');
    },
  });
  const csvBtn = el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm', text: 'CSV로 내보내기 (요약)',
    disabled: state.data.properties.length === 0,
    onclick: () => {
      const rows = summaryRows(state.data.properties, state.data.settings);
      // Excel 한글 깨짐 방지를 위해 BOM 추가
      download(`jeonsecheck-summary-${todayYmd()}.csv`, '﻿' + toCsv(SUMMARY_HEADERS, rows), 'text/csv');
      toast('CSV 파일을 저장했어요.');
    },
  });
  const clearBtn = el('button', {
    type: 'button', class: 'btn btn-danger btn-sm', text: '모든 데이터 지우기',
    onclick: () => {
      if (!window.confirm('이 브라우저의 모든 물건과 체크 기록을 지웁니다. 백업이 없다면 되돌릴 수 없어요. 계속할까요?')) return;
      state.data = defaultData();
      state.selectedId = null;
      state.compare = [];
      state.mode = 'view';
      persist();
      toast('모든 데이터를 지웠어요.');
      renderAll();
    },
  });

  panel.append(el('div', { class: 'data-grid' }, [
    el('section', { class: 'data-block', 'aria-labelledby': 'set-title' }, [el('h3', { id: 'set-title', text: '분석 가정 설정' }), form]),
    el('section', { class: 'data-block', 'aria-labelledby': 'bak-title' }, [
      el('h3', { id: 'bak-title', text: '백업과 복원' }),
      el('p', { text: '백업 파일은 이 브라우저 밖으로 나가지 않습니다. 기기를 옮길 때 가져오기로 복원하세요.' }),
      el('div', { class: 'btn-row' }, [exportBtn,
        el('label', { class: 'btn btn-ghost btn-sm file-label', for: 'import-file' }, [el('span', { text: 'JSON 가져오기' }), importInput]),
      ]),
    ]),
    el('section', { class: 'data-block', 'aria-labelledby': 'csv-title' }, [
      el('h3', { id: 'csv-title', text: '엑셀용 요약' }),
      el('p', { text: '물건별 위험비율과 등급을 CSV로 저장합니다. 서류 원본은 포함하지 않습니다.' }),
      el('div', { class: 'btn-row' }, [csvBtn]),
    ]),
    el('section', { class: 'data-block', 'aria-labelledby': 'del-title' }, [
      el('h3', { id: 'del-title', text: '데이터 지우기' }),
      el('p', { text: `현재 물건 ${state.data.properties.length}개가 이 브라우저에 저장되어 있습니다.` }),
      el('div', { class: 'btn-row' }, [clearBtn]),
    ]),
  ]));

  panel.append(el('p', { class: 'source', text: `저장 키: ${STORAGE_KEY}. 기준일 ${CONSTANTS.기준일}. 기준값은 모두 CONSTANTS 객체에 있으며 확인 필요 표시가 붙어 있습니다.` }));
}

// ---------------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------------
function init() {
  $('#new-btn').addEventListener('click', () => openEditor(null));
  $('#cancel-btn').addEventListener('click', closeEditor);
  $('#property-form').addEventListener('submit', submitForm);
  $('#add-mortgage').addEventListener('click', () => {
    const rows = readMortgageValues();
    if (rows.length >= REGISTRY_LIMITS.maxMortgages) return;
    renderMortgageRows([...rows, '']);
    document.getElementById(`f-mortgage-${rows.length}`)?.focus();
  });
  for (const key of MONEY_FIELDS) {
    const input = $('#property-form').elements.namedItem(key);
    input.addEventListener('input', () => updatePreview(key));
  }
  const tabs = document.querySelectorAll('#tabs [role="tab"]');
  for (const btn of tabs) {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab));
    btn.addEventListener('keydown', onTabKey);
  }
  window.addEventListener('error', () => toast('문제가 생겼어요. 페이지를 새로고침해 주세요.'));

  // 처음 방문 시 첫 물건이 있으면 선택해 두기
  if (state.data.properties.length) state.selectedId = state.data.properties[0].id;
  renderAll();
  if (!store) toast('이 브라우저에서는 저장 공간을 쓸 수 없어 데이터가 남지 않아요.');
}

init();
