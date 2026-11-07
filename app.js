// jeonsecheck UI. 모든 사용자 데이터는 textContent로만 넣는다 (innerHTML 사용 안 함).
import {
  CONSTANTS, PROPERTY_TYPES, LEASE_TYPES, CHECKLIST, CLAUSES, clauseNotice, summaryHeaders, composeClauses,
  parseWon, formatKoreanWon, formatWon, formatPct, analyzeProperty, barPosition,
  formatKoreanDate, buildTimeline, renewalWindow, buildIcs, toCsv, summaryRows,
  validateProperty, validateSettings, toggleCheck, stageProgress, overallProgress,
  loadData, saveData, buildBackup, parseBackup, defaultData, makeId, toYmd, STORAGE_KEY,
  normalizeRegistry, defaultRegistry, summarizeRegistry, REGISTRY_LIMITS,
  timelineStatus, dDayLabel, nextEvent, reminderFor, REMINDER_LEAD_DAYS, rankSafest, checklistPrintModel,
  explainRiskNumbers, safeDepositCeiling,
} from './logic.js';
import {
  AI_KEY_STORAGE, isPlausibleKey, buildAdvicePayload, requestAdvice, fallbackAdvice,
} from './ai.js';
import {
  t, setLang, detectLang, applyI18n, langSelect, readSavedLang, writeSavedLang, getLang,
} from './i18n.js';

// ---------------------------------------------------------------------------
// 언어: 저장된 값 → 브라우저 언어(다섯 개 중 하나면) → 한국어
// ---------------------------------------------------------------------------
setLang(detectLang(readSavedLang()));

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
    toast(t('app.saveFail'));
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
      : el('span', { class: 'badge tone-none', text: a.reason === 'NO_MARKET' ? t('app.zeroMarket') : t('app.needInput') });

    const select = el('button', {
      type: 'button',
      class: 'prop-select',
      'aria-current': selected ? 'true' : null,
      'aria-label': t('app.selectAria', { name: p.name }),
      onclick: () => selectProperty(p.id),
    }, [
      el('span', { class: 'prop-name', text: p.name }),
      el('span', { class: 'prop-meta', text: `${labelOf(PROPERTY_TYPES, p.type)} · ${labelOf(LEASE_TYPES, p.lease)} · ${t('app.deposit')} ${formatKoreanWon(p.deposit)}` }),
      badge,
    ]);

    const inCompare = state.compare.includes(p.id);
    const checkbox = el('input', {
      type: 'checkbox',
      id: `cmp-${p.id}`,
      checked: inCompare ? true : null,
      onchange: (e) => toggleCompare(p.id, e.target),
    });
    const compareLabel = el('label', { class: 'prop-compare', for: `cmp-${p.id}` }, [checkbox, document.createTextNode(t('app.compareAdd'))]);

    list.append(el('article', { class: 'prop-card', 'data-id': p.id }, [select, compareLabel]));
  }
}

function toggleCompare(id, input) {
  if (input.checked) {
    if (state.compare.length >= 5) {
      input.checked = false;
      toast(t('app.compareMax'));
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
  $('#editor-title').textContent = p ? t('app.editTitle') : t('app.newTitle');
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
  $('#form-status').textContent = t('app.formErr');
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
      'aria-label': t('reg.mortgageAria', { n: i + 1 }),
      placeholder: t('ph.mortgage'),
      'aria-describedby': `prev-mortgage-${i} err-mortgage-${i}`,
      oninput: () => updateMortgagePreview(i),
    });
    const remove = el('button', {
      type: 'button', class: 'btn btn-ghost btn-sm', text: t('reg.deleteRow'),
      'aria-label': t('reg.deleteRowAria', { n: i + 1 }),
      onclick: () => {
        const rest = readMortgageValues().filter((_, idx) => idx !== i);
        renderMortgageRows(rest);
        $('#add-mortgage').focus();
      },
    });
    list.append(el('div', { class: 'mortgage-row' }, [
      el('div', { class: 'mortgage-main' }, [
        el('label', { for: `f-mortgage-${i}`, class: 'mortgage-label', text: t('reg.rowLabel', { n: i + 1 }) }),
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
  toast(t('app.saved'));
  renderAll();
}

function deleteSelected() {
  const p = selectedProperty();
  if (!p) return;
  if (!window.confirm(t('app.deleteConfirm', { name: p.name }))) return;
  state.data.properties = state.data.properties.filter((x) => x.id !== p.id);
  state.compare = state.compare.filter((x) => x !== p.id);
  state.selectedId = null;
  state.mode = 'view';
  persist();
  toast(t('app.deleted'));
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
      el('h3', { class: 'detail-title', text: t('app.pickProp') }),
      el('p', { class: 'muted', text: t('app.pickPropHint') }),
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
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('common.edit'), onclick: () => openEditor(p) }),
      el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: t('common.delete'), onclick: deleteSelected }),
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
  panel.append(el('p', { class: 'empty', text: t('app.noProperty') }));
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
    'aria-valuetext': ratioPct > 100 ? t('risk.meterOver', { r: formatPct(ratioPct) }) : formatPct(ratioPct),
  }, [fill, ...ticks]);
}

function renderAnalysis(panel, p) {
  if (!p) return needProperty(panel);
  const a = analysisOf(p);
  panel.append(el('h3', { class: 'panel-title', text: t('risk.title') }));

  if (!a.ok) {
    const msg = a.reason === 'NO_MARKET' ? t('risk.noMarketMsg') : t('risk.invalidMsg');
    panel.append(el('p', { class: 'note-warn', text: msg }));
    panel.append(el('button', { type: 'button', class: 'btn btn-ghost', text: t('risk.editInfo'), onclick: () => openEditor(p) }));
    return;
  }

  // 점수 카드
  const formula = t('risk.formula', {
    m: formatKoreanWon(p.seniorMortgage), t: formatKoreanWon(p.seniorTenant), d: formatKoreanWon(p.deposit), k: formatKoreanWon(p.market),
  });
  const over = a.ratioPct > 100 ? t('risk.overMarket') : '';
  panel.append(el('div', { class: 'score-card' }, [
    el('div', { class: 'score-top' }, [
      el('div', {}, [
        el('p', { class: 'muted score-label', text: t('risk.ratio') }),
        el('div', { class: 'score-value', text: formatPct(a.ratioPct) }),
      ]),
      el('span', { class: `badge ${toneClass(a.band)}`, text: t('risk.grade', { g: a.band.label }) }),
    ]),
    el('p', { class: 'formula', text: `${formula}${over}` }),
    meterElement(a.ratioPct, a.band, t('risk.meterLabel')),
    el('p', { class: 'source', text: t('risk.bandSummary', { rule: t('risk.bandRule'), src: CONSTANTS.riskBandsSource }) }),
  ]));

  panel.append(registryCard(p));
  panel.append(numberGuide(a));

  // 시나리오
  const rows = [
    el('tr', {}, [el('th', { scope: 'row', text: t('risk.scenarioCurrent') }), el('td', { class: 'num', text: formatWon(p.market) }), el('td', { class: 'num', text: formatPct(a.ratioPct) }), el('td', { text: a.band.label })]),
    ...a.scenarios.map((s) => el('tr', {}, [
      el('th', { scope: 'row', text: t('risk.scenarioDrop', { d: s.dropPct }) }),
      el('td', { class: 'num', text: formatWon(s.marketAfter) }),
      el('td', { class: 'num', text: s.ratioPct === null ? t('common.dash') : formatPct(s.ratioPct) }),
      el('td', { text: s.band.label }),
    ])),
  ];
  panel.append(el('div', { class: 'subcard subcard-gap' }, [
    el('h4', { text: t('risk.scenarioTitle') }),
    el('div', { class: 'table-wrap' }, [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { scope: 'col', text: t('risk.colKind') }),
          el('th', { scope: 'col', class: 'num', text: t('risk.colAssumed') }),
          el('th', { scope: 'col', class: 'num', text: t('risk.colRatio') }),
          el('th', { scope: 'col', text: t('risk.colBand') }),
        ])]),
        el('tbody', {}, rows),
      ]),
    ]),
    el('p', { class: 'source', text: CONSTANTS.scenarioSource }),
  ]));

  // 안전 구간을 유지하는 보증금 상한 (역산, 참고용)
  const ceilingLine = (label, r) => {
    let text;
    if (!r.feasible) text = t('risk.ceilingNotFeasible');
    else if (r.reduceBy === 0) text = t('risk.ceilingSafe', { c: formatKoreanWon(r.ceiling) });
    else text = t('risk.ceilingReduce', { r: formatKoreanWon(r.reduceBy), c: formatKoreanWon(r.ceiling) });
    return el('li', {}, [el('strong', { text: `${label}: ` }), document.createTextNode(text)]);
  };
  const now = safeDepositCeiling(p, { dropPct: 0 });
  const down = safeDepositCeiling(p, { dropPct: CONSTANTS.scenarioDropPcts[0] });
  if (now && down) {
    panel.append(el('div', { class: 'subcard subcard-gap' }, [
      el('h4', { text: t('risk.ceilingTitle') }),
      el('ul', { class: 'plain-list' }, [
        ceilingLine(t('risk.ceilingNow'), now),
        ceilingLine(t('risk.ceilingDown', { d: CONSTANTS.scenarioDropPcts[0] }), down),
      ]),
      el('p', { class: 'source', text: t('risk.ceilingNote', { src: CONSTANTS.riskBandsSource }) }),
    ]));
  }

  // 경매 노출 + 공시가격 참고
  const auction = a.auction;
  const exposedText = auction.exposed > 0
    ? t('risk.exposedSome', { x: formatKoreanWon(auction.exposed) })
    : t('risk.exposedNone');
  const prot = a.protection;
  let protText;
  if (prot.status === 'unknown') protText = t('risk.publicNeedInput');
  else if (prot.status === 'within') protText = t('risk.publicWithin', { t: formatKoreanWon(prot.totalClaims), p: prot.publicPct, l: formatKoreanWon(prot.limit) });
  else protText = t('risk.publicOver', { t: formatKoreanWon(prot.totalClaims), p: prot.publicPct, l: formatKoreanWon(prot.limit) });

  panel.append(el('div', { class: 'grid-2 subcard-gap' }, [
    el('div', { class: 'subcard' }, [
      el('h4', { text: t('risk.auctionTitle', { p: auction.auctionPct }) }),
      el('dl', { class: 'kv' }, [
        el('div', {}, [el('dt', { text: t('risk.auctionPrice') }), el('dd', { text: formatKoreanWon(auction.auctionPrice) })]),
        el('div', {}, [el('dt', { text: t('risk.auctionDistributable') }), el('dd', { text: formatKoreanWon(auction.distributable) })]),
        el('div', {}, [el('dt', { text: t('risk.auctionExposed') }), el('dd', { text: formatKoreanWon(auction.exposed) })]),
      ]),
      el('p', { class: 'source', text: exposedText }),
      el('p', { class: 'source', text: CONSTANTS.auctionRatioSource }),
    ]),
    el('div', { class: 'subcard' }, [
      el('h4', { text: t('risk.publicTitle') }),
      el('p', { text: protText }),
      el('p', { class: 'source', text: CONSTANTS.publicRatioSource }),
      el('p', { class: 'source', text: t('risk.publicNote') }),
    ]),
  ]));

  if ((p.monthlyRent ?? 0) > 0) {
    panel.append(el('p', { class: 'source subcard-gap', text: t('risk.rentNote', { r: formatKoreanWon(p.monthlyRent) }) }));
  }

  // 등급 범례
  panel.append(el('ul', { class: 'band-legend', 'aria-label': t('risk.legendLabel') },
    CONSTANTS.riskBands.map((b, i) => {
      const prev = i === 0 ? 0 : CONSTANTS.riskBands[i - 1].maxPct;
      const range = Number.isFinite(b.maxPct) ? t('risk.bandRange', { a: prev, b: b.maxPct }) : t('risk.bandOver', { a: prev });
      const text = i === 0 ? t('risk.bandFirst', { label: b.label, b: b.maxPct }) : t('risk.bandOther', { label: b.label, range });
      return el('li', { class: `badge-li ${toneClass(b)}`, text });
    }),
  ));

  panel.append(renderAiBox(p, a));

  panel.append(el('p', { class: 'note-warn subcard-gap', text: t('risk.disclaimer') }));
}

const BASIS_CLASS = { input: 'basis-input', calc: 'basis-calc', assume: 'basis-assume', ref: 'basis-ref' };

/** 숫자마다 뜻·계산식·근거를 붙여 보여 준다. */
function numberGuide(a) {
  const list = el('dl', { class: 'guide-list' });
  for (const it of explainRiskNumbers(a)) {
    list.append(el('div', { class: 'guide-item' }, [
      el('dt', {}, [
        el('span', { class: 'guide-label', text: it.label }),
        el('span', { class: `basis ${BASIS_CLASS[it.basis] ?? 'basis-calc'}`, text: t(`basis.${it.basis}`) }),
      ]),
      el('dd', {}, [
        el('p', { class: 'guide-value', text: it.value }),
        el('p', { class: 'guide-formula', text: it.formula }),
        el('p', { text: it.meaning }),
        el('p', { class: 'source', text: it.note }),
      ]),
    ]));
  }
  return el('details', { class: 'guide', open: true }, [
    el('summary', { text: t('risk.guideTitle') }),
    list,
  ]);
}

function registryCard(p) {
  const s = summarizeRegistry(p.registry);
  const countText = s.mortgageCount > 0
    ? t('reg.countWith', { n: s.mortgageCount, m: formatKoreanWon(p.seniorMortgage) })
    : t('reg.countSum', { m: formatKoreanWon(p.seniorMortgage) });
  const items = s.warnings.length
    ? s.warnings.map((w) => el('li', { class: `reg-warn ${toneClass({ tone: w.tone })}`, text: w.text }))
    : [el('li', { class: 'reg-ok', text: t('reg.none') })];
  return el('section', { class: 'subcard subcard-gap', 'aria-labelledby': 'reg-card-title' }, [
    el('h4', { id: 'reg-card-title', text: t('reg.title') }),
    el('p', { text: countText }),
    el('ul', { class: 'reg-list' }, items),
    el('p', { class: 'source', text: t('reg.note') }),
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
  const box = el('section', { class: 'subcard subcard-gap ai-box', 'aria-labelledby': 'ai-title' });
  const payload = buildAdvicePayload(p, a);
  const hasKey = Boolean(readStoredKey());

  box.append(el('h4', { id: 'ai-title', text: t('app.ai.title') }));
  box.append(el('p', { class: 'source', text: t('app.ai.sentNote') }));
  if (payload) {
    box.append(el('p', { class: 'source ai-sent-label', text: t('app.ai.sentLabel') }));
    box.append(el('pre', { class: 'ai-sent', text: payload.preview }));
  }

  // 키 입력 (localStorage 저장, 개발자도구에서 보일 수 있음)
  const keyInput = el('input', { type: 'password', id: 'ai-key', autocomplete: 'off', spellcheck: 'false', placeholder: t('app.ai.keyPh'), 'aria-describedby': 'ai-key-warn' });
  const saveKey = el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm', text: t('app.ai.keySave'),
    onclick: () => {
      const v = keyInput.value.trim();
      if (!isPlausibleKey(v)) {
        toast(t('app.ai.keyBad'));
        return;
      }
      if (writeStoredKey(v)) {
        keyInput.value = '';
        toast(t('app.ai.keySaved'));
      } else {
        toast(t('app.ai.keyFail'));
      }
      renderPanel();
    },
  });
  const removeKey = el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm', text: t('app.ai.keyRemove'), disabled: !hasKey,
    onclick: () => {
      writeStoredKey('');
      toast(t('app.ai.keyRemoved'));
      renderPanel();
    },
  });
  box.append(el('div', { class: 'ai-key-row' }, [
    el('label', { for: 'ai-key', class: 'source', text: hasKey ? t('app.ai.keyHas') : t('app.ai.keyNone') }),
    keyInput,
    el('div', { class: 'btn-row' }, [saveKey, removeKey]),
  ]));
  box.append(el('p', { id: 'ai-key-warn', class: 'warn-keys', text: t('app.ai.keyWarn') }));

  const askBtn = el('button', {
    type: 'button', class: 'btn btn-primary', disabled: state.ai.busy || !payload,
    text: state.ai.busy ? t('app.ai.busy') : (hasKey ? t('app.ai.withKey') : t('app.ai.noKey')),
    onclick: () => runAdvice(p, a, payload),
  });
  box.append(el('div', { class: 'btn-row ai-go' }, [askBtn]));

  const result = el('div', { class: 'ai-result', 'aria-live': 'polite' });
  if (state.ai.error) result.append(el('p', { class: 'form-status', text: state.ai.error }));
  if (state.ai.result) {
    result.append(el('p', { class: 'ai-mode', text: state.ai.mode === 'ai' ? t('app.ai.modeAi') : t('app.ai.modeRule') }));
    result.append(el('p', { text: state.ai.result.summary }));
    result.append(el('p', { class: 'source ai-q-label', text: t('app.ai.questions') }));
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
    state.ai = { busy: false, result: fb, mode: 'rule', error: t('app.ai.errorThenRule', { e: res.error }) };
  }
  renderPanel();
}

// ---------------------------------------------------------------------------
// 점검표 탭
// ---------------------------------------------------------------------------
function renderChecklist(panel, p) {
  if (!p) return needProperty(panel);
  panel.append(el('h3', { class: 'panel-title', text: t('app.ck.title') }));
  const overall = overallProgress(p.checks);
  const barFill = el('span', {});
  const overallBar = el('div', { class: 'progress-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': overall.total, 'aria-valuenow': overall.done, 'aria-label': t('app.ck.overallLabel') }, [barFill]);
  const overallText = el('p', { class: 'muted' });
  panel.append(overallText, overallBar);

  // 체크 변경 시 전체 진행률만 갱신 (포커스 유지를 위해 목록은 다시 그리지 않는다)
  const updateProgress = () => {
    const cur = overallProgress(selectedProperty()?.checks ?? {});
    overallText.textContent = t('app.ck.overallDone', { d: cur.done, t: cur.total });
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
      type: 'button', class: 'btn btn-primary btn-sm', text: t('app.ck.printBtn'),
      onclick: () => printChecklist(selectedProperty()),
    }),
    el('button', {
      type: 'button', class: 'btn btn-ghost btn-sm', text: t('app.ck.clearBtn'),
      onclick: () => {
        if (!window.confirm(t('app.ck.clearConfirm'))) return;
        const current = selectedProperty();
        state.data.properties = state.data.properties.map((x) => (x.id === current.id ? { ...x, checks: {} } : x));
        persist();
        renderPanel();
      },
    }),
  ]));
  panel.append(el('p', { class: 'source', text: t('app.ck.note') }));
}

/** 인쇄 전용 시트를 채우고 인쇄 대화상자를 연다. 화면에서는 숨겨져 있다(styles.css). */
function printChecklist(p) {
  if (!p) return;
  const model = checklistPrintModel(p, todayYmd(), analysisOf(p));
  const sheet = clear($('#print-sheet'));
  sheet.append(
    el('h1', { text: model.title }),
    el('p', { class: 'print-meta', text: t('app.print.metaLine', { m: model.meta, d: formatKoreanDate(model.printedOn) }) }),
    el('p', { class: 'print-meta', text: model.risk.length ? model.risk.join(' · ') : t('app.print.noRisk') }),
    el('p', { class: 'print-meta', text: t('app.ck.overallDone', { d: model.overall.done, t: model.overall.total }) }),
  );
  for (const s of model.stages) {
    sheet.append(el('section', { class: 'print-stage' }, [
      el('h2', { text: `${s.title} (${s.done}/${s.total})` }),
      el('ul', {}, s.items.map((i) => el('li', {}, [
        el('span', { class: 'print-mark', text: i.mark }),
        document.createTextNode(` ${i.text}`),
        i.hint ? el('small', { text: ` (${i.hint})` }) : null,
      ]))),
    ]));
  }
  sheet.append(el('p', { class: 'print-notice', text: model.notice }));
  window.print();
}

// ---------------------------------------------------------------------------
// 날짜·일정 탭
// ---------------------------------------------------------------------------
const LEAD_KEYS = { 1: 'app.tl.lead1', 7: 'app.tl.lead7', 30: 'app.tl.lead30' };

function renderTimeline(panel, p) {
  if (!p) return needProperty(panel);
  panel.append(el('h3', { class: 'panel-title', text: t('app.tl.heading') }));
  const events = buildTimeline(p);
  if (events.length === 0) {
    panel.append(el('p', { class: 'note-warn', text: t('app.tl.needDate') }));
    panel.append(el('button', { type: 'button', class: 'btn btn-ghost', text: t('app.tl.inputDates'), onclick: () => openEditor(p) }));
    return;
  }

  const today = todayYmd();
  const next = nextEvent(events, today);
  panel.append(el('div', { class: 'next-up' }, [
    el('span', { class: 'next-label', text: t('app.tl.next') }),
    next
      ? el('span', { class: 'next-body' }, [
        el('strong', { text: next.title }),
        document.createTextNode(t('app.tl.nextLine', { d: formatKoreanDate(next.date), x: dDayLabel(next.date, today) })),
      ])
      : el('span', { class: 'next-body', text: t('app.tl.noNext') }),
  ]));

  const hasExpiry = events.some((e) => e.key === 'expiry');
  if (hasExpiry) {
    const w = renewalWindow(events.find((e) => e.key === 'expiry').date);
    panel.append(el('p', { class: 'note-warn', text: t('app.tl.renewWindow', { a: formatKoreanDate(w.start), b: formatKoreanDate(w.end) }) }));
  }
  if (events.some((e) => e.estimated)) {
    panel.append(el('p', { class: 'source', text: t('app.tl.estNote') }));
  }

  // 알림 선행 일수 (일정 파일과 화면 알림일에 함께 쓴다)
  const leadSelect = el('select', {
    id: 'lead-days',
    'aria-describedby': 'lead-help',
    onchange: (e) => {
      state.leadDays = Number(e.target.value);
      renderPanel();
    },
  }, REMINDER_LEAD_DAYS.map((d) => el('option', { value: d, selected: d === state.leadDays ? true : null, text: t(LEAD_KEYS[d]) })));
  panel.append(el('div', { class: 'lead-row' }, [
    el('label', { for: 'lead-days', text: t('app.tl.leadLabel') }),
    leadSelect,
    el('p', { class: 'hint', id: 'lead-help', text: t('app.tl.leadHelp') }),
  ]));

  const list = el('ol', { class: 'timeline', 'aria-label': t('app.tl.listAria') });
  for (const e of events) {
    const status = timelineStatus(e.date, today);
    const r = reminderFor(e.date, today, state.leadDays);
    const reminderText = {
      passed: t('app.tl.remPassed'),
      today: t('app.tl.remToday'),
      upcoming: t('app.tl.remUp'),
    }[r.status];
    list.append(el('li', { class: `tl-item tl-${status}` }, [
      el('div', { class: 'tl-when' }, [
        el('span', { class: 'tl-date', text: formatKoreanDate(e.date) }),
        el('span', { class: 'tl-dday', text: dDayLabel(e.date, today) }),
      ]),
      el('div', { class: 'tl-body' }, [
        el('p', { class: 'tl-title' }, [
          document.createTextNode(e.title),
          e.estimated ? el('span', { class: 'tag-est', text: t('app.tl.estimated') }) : null,
        ]),
        el('p', { class: 'tl-note', text: e.note }),
        el('p', { class: `tl-remind tl-remind-${r.status}`, text: t('app.tl.remLine', { d: formatKoreanDate(r.date), s: reminderText }) }),
      ]),
    ]));
  }
  panel.append(list);

  panel.append(el('div', { class: 'btn-row' }, [
    el('button', {
      type: 'button', class: 'btn btn-primary', text: t('app.tl.ics'),
      onclick: () => {
        const cur = selectedProperty();
        const evs = buildTimeline(cur).map((e) => ({
          uid: `${cur.id}-${e.key}`,
          title: `[jeonsecheck] ${cur.name} · ${e.title}`,
          date: e.date,
          description: t('app.tl.icsDesc', { note: e.note, est: e.estimated ? t('app.tl.icsEst') : '' }),
        }));
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
        download(`${safeFileName(cur.name)}-${t('app.tl.fileSuffix')}.ics`, buildIcs(evs, stamp, state.leadDays), 'text/calendar');
        toast(t('app.tl.icsToast', { n: state.leadDays }));
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
  panel.append(el('h3', { class: 'panel-title', text: t('app.cl.title') }));
  panel.append(el('p', { class: 'note-warn', text: clauseNotice() }));

  // 여러 문구를 골라 번호 붙여 한 번에 복사 (선택 상태는 저장하지 않는다)
  const selCount = el('span', { class: 'muted', 'aria-live': 'polite' });
  const copySelBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: t('app.cl.copySel') });
  const refreshSel = () => {
    selCount.textContent = t('app.cl.count', { s: state.clauseSel.length, t: CLAUSES.length });
    copySelBtn.disabled = state.clauseSel.length === 0;
  };
  copySelBtn.addEventListener('click', async () => {
    const ok = await copyText(composeClauses(state.clauseSel));
    toast(ok ? t('app.cl.copiedN', { n: state.clauseSel.length }) : t('app.cl.copyFail'));
  });
  refreshSel();
  panel.append(el('div', { class: 'clause-toolbar' }, [selCount, copySelBtn]));

  const grid = el('div', { class: 'clause-grid' });
  for (const c of CLAUSES) {
    const btn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('app.cl.copyBtn') });
    btn.addEventListener('click', async () => {
      const ok = await copyText(c.text);
      btn.textContent = ok ? t('app.cl.copiedBtn') : t('app.cl.failBtn');
      toast(ok ? t('app.cl.copiedOne') : t('app.cl.copyFail'));
      setTimeout(() => { btn.textContent = t('app.cl.copyBtn'); }, 1800);
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
        el('label', { class: 'clause-check', for: `clause-${c.id}` }, [check, document.createTextNode(t('app.cl.select'))]),
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
  panel.append(el('h3', { class: 'panel-title', text: t('app.cmp.titleMax') }));
  const picked = state.compare.map((id) => state.data.properties.find((p) => p.id === id)).filter(Boolean);
  if (picked.length < 2) {
    panel.append(el('p', { class: 'compare-hint', text: t('app.cmp.hint') }));
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
    el('th', { scope: 'col', text: t('app.cmp.item') }),
    ...picked.map((p) => el('th', { scope: 'col', class: `num${isBest(p) ? ' is-best' : ''}` }, [
      document.createTextNode(p.name),
      isBest(p) ? el('span', { class: 'best-tag', text: t('app.cmp.bestTag') }) : null,
    ])),
  ]);
  const metric = (label, fn) => el('tr', {}, [
    el('th', { scope: 'row', text: label }),
    ...picked.map((p, i) => el('td', { class: `num${isBest(p) ? ' is-best' : ''}` }, [document.createTextNode(fn(p, analyses[i]))])),
  ]);
  const rows = [
    metric(t('app.cmp.rowType'), (p) => `${labelOf(PROPERTY_TYPES, p.type)} · ${labelOf(LEASE_TYPES, p.lease)}`),
    metric(t('app.cmp.rowMarket'), (p) => formatKoreanWon(p.market)),
    metric(t('app.cmp.rowDeposit'), (p) => formatKoreanWon(p.deposit)),
    metric(t('app.cmp.rowMortgage'), (p) => formatKoreanWon(p.seniorMortgage)),
    metric(t('app.cmp.rowTenant'), (p) => formatKoreanWon(p.seniorTenant)),
    metric(t('app.cmp.rowRatio'), (p, a) => (a.ok ? formatPct(a.ratioPct) : t('common.notCalc'))),
    metric(t('app.cmp.rowBand'), (p, a) => (a.ok ? a.band.label : t('common.dash'))),
    metric(t('app.cmp.rowRank'), (p) => {
      const idx = ranking.order.indexOf(p.id);
      return idx < 0 ? t('common.notCalc') : t('app.cmp.rankN', { n: idx + 1 });
    }),
    metric(t('app.cmp.rowDrop10'), (p, a) => (a.ok ? `${formatPct(a.scenarios[0].ratioPct)} · ${a.scenarios[0].band.label}` : t('common.dash'))),
    metric(t('app.cmp.rowDrop20'), (p, a) => (a.ok ? `${formatPct(a.scenarios[1].ratioPct)} · ${a.scenarios[1].band.label}` : t('common.dash'))),
    metric(t('app.cmp.rowExposed'), (p, a) => (a.ok ? formatKoreanWon(a.auction.exposed) : t('common.dash'))),
    metric(t('app.cmp.rowPublic'), (p, a) => (a.ok ? {
      unknown: t('ex.pub.unknown'),
      within: t('app.cmp.within', { p: a.protection.publicPct }),
      over: t('app.cmp.over', { p: a.protection.publicPct }),
    }[a.protection.status] : t('common.dash'))),
    metric(t('app.cmp.rowExpiry'), (p) => (p.expiryDate ? formatKoreanDate(p.expiryDate) : t('app.cmp.notEntered'))),
  ];
  if (ranking.bestIds.length) {
    const names = picked.filter((p) => isBest(p)).map((p) => p.name).join(', ');
    panel.append(el('p', { class: 'note-ok', text: t('app.cmp.bestLine', { n: names }) }));
  } else {
    panel.append(el('p', { class: 'source', text: t('app.cmp.noBest') }));
  }
  panel.append(el('div', { class: 'table-wrap' }, [el('table', { class: 'compare-table' }, [el('thead', {}, [head]), el('tbody', {}, rows)])]));
  panel.append(el('p', { class: 'source', text: t('app.cmp.foot') }));
}

// ---------------------------------------------------------------------------
// 설정 · 백업 탭
// ---------------------------------------------------------------------------
function renderData(panel) {
  panel.append(el('h3', { class: 'panel-title', text: t('app.dt.title') }));

  // 설정
  const s = state.data.settings;
  const form = el('form', { class: 'settings-form', novalidate: true, id: 'settings-form' });
  const aucInput = el('input', { id: 's-auction', name: 'auctionRatioPct', type: 'text', inputmode: 'numeric', value: String(s.auctionRatioPct), 'aria-describedby': 's-auction-help' });
  const pubInput = el('input', { id: 's-public', name: 'publicRatioPct', type: 'text', inputmode: 'numeric', value: String(s.publicRatioPct), 'aria-describedby': 's-public-help' });
  form.append(
    el('div', { class: 'field' }, [
      el('label', { for: 's-auction', text: t('app.dt.aucLabel') }),
      aucInput,
      el('p', { class: 'hint', id: 's-auction-help', text: t('app.dt.aucHelp', { d: CONSTANTS.auctionRatioPct, src: CONSTANTS.auctionRatioSource }) }),
      el('p', { class: 'error', id: 'err-s-auction' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 's-public', text: t('app.dt.pubLabel') }),
      pubInput,
      el('p', { class: 'hint', id: 's-public-help', text: t('app.dt.pubHelp', { d: CONSTANTS.publicRatioPct, src: CONSTANTS.publicRatioSource }) }),
      el('p', { class: 'error', id: 'err-s-public' }),
    ]),
    el('div', { class: 'btn-row full-row' }, [
      el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: t('app.dt.saveSettings') }),
      el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', text: t('app.dt.defaults'),
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
    toast(t('app.dt.savedToast'));
    renderAll();
  });

  // 백업 · CSV · 삭제
  const importInput = el('input', { type: 'file', accept: 'application/json,.json', id: 'import-file' });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast(t('app.dt.tooBig'));
      return;
    }
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) {
      toast(parsed.error);
      return;
    }
    if (!window.confirm(t('app.dt.importConfirmN', { n: parsed.data.properties.length }))) return;
    state.data = parsed.data;
    state.selectedId = null;
    state.compare = [];
    state.mode = 'view';
    persist();
    toast(t('app.dt.importedToast'));
    renderAll();
  });

  const exportBtn = el('button', {
    type: 'button', class: 'btn btn-primary btn-sm', text: t('app.dt.export'),
    onclick: () => {
      const stamp = todayYmd();
      download(`jeonsecheck-backup-${stamp}.json`, buildBackup(state.data, new Date().toISOString()), 'application/json');
      toast(t('app.dt.exportedToast'));
    },
  });
  const csvBtn = el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm', text: t('app.dt.csvBtn'),
    disabled: state.data.properties.length === 0,
    onclick: () => {
      const rows = summaryRows(state.data.properties, state.data.settings);
      // Excel 한글 깨짐 방지를 위해 BOM 추가
      download(`jeonsecheck-summary-${todayYmd()}.csv`, '﻿' + toCsv(summaryHeaders(), rows), 'text/csv');
      toast(t('app.dt.csvToast'));
    },
  });
  const clearBtn = el('button', {
    type: 'button', class: 'btn btn-danger btn-sm', text: t('app.dt.clearBtn'),
    onclick: () => {
      if (!window.confirm(t('app.dt.clearConfirm'))) return;
      state.data = defaultData();
      state.selectedId = null;
      state.compare = [];
      state.mode = 'view';
      persist();
      toast(t('app.dt.clearedToast'));
      renderAll();
    },
  });

  panel.append(el('div', { class: 'data-grid' }, [
    el('section', { class: 'data-block', 'aria-labelledby': 'set-title' }, [el('h3', { id: 'set-title', text: t('app.dt.settings') }), form]),
    el('section', { class: 'data-block', 'aria-labelledby': 'bak-title' }, [
      el('h3', { id: 'bak-title', text: t('app.dt.bakTitle') }),
      el('p', { text: t('app.dt.bakNote') }),
      el('div', { class: 'btn-row' }, [exportBtn,
        el('label', { class: 'btn btn-ghost btn-sm file-label', for: 'import-file' }, [el('span', { text: t('app.dt.importLabel') }), importInput]),
      ]),
    ]),
    el('section', { class: 'data-block', 'aria-labelledby': 'csv-title' }, [
      el('h3', { id: 'csv-title', text: t('app.dt.csvTitle') }),
      el('p', { text: t('app.dt.csvNote') }),
      el('div', { class: 'btn-row' }, [csvBtn]),
    ]),
    el('section', { class: 'data-block', 'aria-labelledby': 'del-title' }, [
      el('h3', { id: 'del-title', text: t('app.dt.delTitle') }),
      el('p', { text: t('app.dt.delNote', { n: state.data.properties.length }) }),
      el('div', { class: 'btn-row' }, [clearBtn]),
    ]),
  ]));

  panel.append(el('p', { class: 'source', text: t('app.dt.footNote', { d: CONSTANTS.기준일 }) }));
}

// ---------------------------------------------------------------------------
// 언어 전환: 정적 문구 교체 후 열린 화면을 다시 그린다
// ---------------------------------------------------------------------------
function refreshLanguage() {
  applyI18n(document);
  // 폼의 선택지와 placeholder 는 applyI18n 이 처리한다. 동적 영역만 다시 그린다.
  const editorOpen = !$('#editor').hidden;
  if (editorOpen) {
    $('#editor-title').textContent = state.mode === 'edit' ? t('app.editTitle') : t('app.newTitle');
    renderMortgageRows(readMortgageValues());
  }
  renderAll();
}

// ---------------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------------
function init() {
  applyI18n(document);
  langSelect($('#lang-select'), (l) => {
    setLang(l);
    writeSavedLang(l);
    refreshLanguage();
  });

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
  window.addEventListener('error', () => toast(t('app.errToast')));

  // 처음 방문 시 첫 물건이 있으면 선택해 두기
  if (state.data.properties.length) state.selectedId = state.data.properties[0].id;
  renderAll();
  if (!store) toast(t('app.noStorage'));
}

init();

