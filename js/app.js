/* ===== SWGOH ТБ Rise of the Empire — планировщик ===== */
(() => {
'use strict';

/* ---------------- Константы и данные ТБ ---------------- */

const TB = window.TB_DATA;
const PHASES = [1, 2, 3, 4, 5, 6];
const ALIGN_RU = { dark: 'Тёмная', light: 'Светлая', mixed: 'Смешанная' };
const ALIGN_ICON = { dark: '🔴', light: '🔵', mixed: '🟣' };

// планеты по фазам
const planetsByPhase = {};
for (const p of Object.values(TB.planets)) {
  (planetsByPhase[p.phase] = planetsByPhase[p.phase] || []).push(p);
}
const alignOrder = { dark: 0, mixed: 1, light: 2 };
for (const list of Object.values(planetsByPhase)) {
  list.sort((a, b) => (a.bonus - b.bonus) || (alignOrder[a.alignment] - alignOrder[b.alignment]));
}

function relicReq(planet) {
  const s = (planet.platoonReqs || []).join(' ');
  const m = s.match(/Relic (\d+)/);
  return m ? +m[1] : null;
}

/* ---------------- Состояние ---------------- */

const store = {
  guild: load('tbp_guild'),     // {id, name, gp, memberCount, members:[{name, allyCode, gp, charGp, shipGp}], loadedAt}
  rosters: load('tbp_rosters') || {}, // {allyCode: {t, name, units:{norm:{r,s,c}}}}
  plan: load('tbp_plan') || {},       // {phase: {allyCode: planetKey}}
};

function load(k) {
  try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
}
function save(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); }
  catch (e) { alert('Не удалось сохранить данные (переполнено хранилище браузера): ' + e.message); }
}
const saveGuild = () => save('tbp_guild', store.guild);
const saveRosters = () => save('tbp_rosters', store.rosters);
const savePlan = () => save('tbp_plan', store.plan);

/* ---------------- Утилиты ---------------- */

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const fmt = n => (n == null ? '—' : Number(n).toLocaleString('ru-RU'));
const fmtM = n => (n == null ? '—' : (n / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн');

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}

// нормализация имён юнитов для сопоставления genskaar <-> swgoh.gg
function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

// разбор нескольких JSON-объектов, вставленных подряд
function splitJsonObjects(text) {
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) { out.push(text.slice(start, i + 1)); start = -1; }
    }
  }
  return out;
}

/* ---------------- Нормализация данных swgoh.gg ---------------- */

function normalizeGuild(json, guildId) {
  const d = json.data || json;
  const members = (d.members || json.members || []).map(m => ({
    name: m.player_name || m.name || ('Игрок ' + m.ally_code),
    allyCode: String(m.ally_code || m.allyCode || ''),
    gp: m.galactic_power || 0,
    charGp: m.character_galactic_power || 0,
    shipGp: m.ship_galactic_power || 0,
  })).filter(m => m.allyCode);
  if (!members.length) throw new Error('В JSON не найден список участников гильдии');
  members.sort((a, b) => b.gp - a.gp);
  return {
    id: d.guild_id || guildId || '',
    name: d.name || 'Гильдия',
    gp: d.galactic_power || members.reduce((s, m) => s + m.gp, 0),
    memberCount: d.member_count || members.length,
    members,
    loadedAt: Date.now(),
  };
}

function normalizePlayer(json) {
  const d = json.data || json;
  const units = {};
  for (const u of json.units || d.units || []) {
    const ud = u.data || u;
    if (!ud.name) continue;
    units[normName(ud.name)] = {
      r: ud.combat_type === 1 ? Math.max(0, (ud.relic_tier || 0) - 2) : 0, // отображаемый релик
      s: ud.rarity || 0,
      c: ud.combat_type || 1,
    };
  }
  if (!Object.keys(units).length) throw new Error('В JSON не найдены юниты игрока');
  return {
    allyCode: String(d.ally_code || ''),
    name: d.name || '',
    t: Date.now(),
    units,
  };
}

/* ---------------- Вкладки ---------------- */

$$('#main-tabs .tab').forEach(btn => btn.addEventListener('click', () => {
  $$('#main-tabs .tab').forEach(b => b.classList.toggle('active', b === btn));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
}));

/* ---------------- Вкладка «Гильдия» ---------------- */

const guildStatus = $('#guild-load-status');
function setStatus(node, text, cls) {
  node.classList.remove('hidden', 'ok', 'err');
  if (cls) node.classList.add(cls);
  node.textContent = text;
}

$('#guild-url').addEventListener('input', updateManualGuildLink);
function updateManualGuildLink() {
  const id = SwgohApi.parseGuildId($('#guild-url').value) || 'ID_ГИЛЬДИИ';
  $('#manual-guild-link').href = SwgohApi.guildApiUrl(id);
  $('#manual-guild-link').textContent = SwgohApi.guildApiUrl(id);
}
updateManualGuildLink();

$('#btn-load-guild').addEventListener('click', () => loadGuild());
$('#btn-refresh-guild').addEventListener('click', () => {
  if (store.guild) { $('#guild-url').value = store.guild.id; }
  loadGuild();
});

async function loadGuild() {
  const id = SwgohApi.parseGuildId($('#guild-url').value) || (store.guild && store.guild.id);
  if (!id) { setStatus(guildStatus, 'Не удалось распознать ID гильдии в ссылке', 'err'); return; }
  $('#btn-load-guild').disabled = true;
  try {
    setStatus(guildStatus, 'Загружаю данные гильдии…');
    const json = await SwgohApi.fetchJson(SwgohApi.guildApiUrl(id), t => setStatus(guildStatus, t));
    applyGuild(normalizeGuild(json, id));
    setStatus(guildStatus, 'Гильдия загружена ✔', 'ok');
  } catch (e) {
    setStatus(guildStatus, '⚠ ' + e.message, 'err');
    $('#manual-import').open = true;
  } finally {
    $('#btn-load-guild').disabled = false;
  }
}

$('#btn-manual-guild').addEventListener('click', () => {
  try {
    const text = $('#manual-guild-json').value.trim();
    if (!text) return;
    const json = JSON.parse(splitJsonObjects(text)[0] || text);
    const id = SwgohApi.parseGuildId($('#guild-url').value);
    applyGuild(normalizeGuild(json, id));
    setStatus(guildStatus, 'Гильдия импортирована ✔', 'ok');
    $('#manual-guild-json').value = '';
    $('#manual-import').open = false;
  } catch (e) {
    setStatus(guildStatus, '⚠ Не удалось разобрать JSON: ' + e.message, 'err');
  }
});

function applyGuild(g) {
  store.guild = g;
  saveGuild();
  renderAll();
}

$('#btn-clear-all').addEventListener('click', () => {
  if (!confirm('Удалить все сохранённые данные (гильдия, ростеры, план)?')) return;
  localStorage.removeItem('tbp_guild');
  localStorage.removeItem('tbp_rosters');
  localStorage.removeItem('tbp_plan');
  store.guild = null; store.rosters = {}; store.plan = {};
  renderAll();
});

/* --- таблица участников --- */

let memberSort = { key: 'gp', dir: -1 };
$$('#members-table th[data-sort]').forEach(th => th.addEventListener('click', () => {
  const key = th.dataset.sort;
  memberSort = { key, dir: memberSort.key === key ? -memberSort.dir : (key === 'name' ? 1 : -1) };
  renderMembers();
}));

function renderGuild() {
  const g = store.guild;
  $('#guild-content').classList.toggle('hidden', !g);
  $('#guild-badge').classList.toggle('hidden', !g);
  if (!g) return;
  $('#guild-badge').textContent = g.name + ' · ' + fmtM(g.gp) + ' ГП';
  $('#guild-title').textContent = g.name;
  const withRoster = g.members.filter(m => store.rosters[m.allyCode]).length;
  $('#guild-stats').innerHTML = '';
  $('#guild-stats').append(
    stat(fmt(g.memberCount), 'участников'),
    stat(fmtM(g.gp), 'ГП гильдии'),
    stat(fmtM(g.members.reduce((s, m) => s + m.charGp, 0)), 'ГП персонажей'),
    stat(fmtM(g.members.reduce((s, m) => s + m.shipGp, 0)), 'ГП флота'),
    stat(withRoster + ' / ' + g.members.length, 'ростеров загружено'),
    stat(new Date(g.loadedAt).toLocaleDateString('ru-RU'), 'данные от'),
  );
  renderMembers();
}
function stat(v, l) {
  return el('div', { class: 'stat' }, [el('div', { class: 'v' }, v), el('div', { class: 'l' }, l)]);
}

function renderMembers() {
  const g = store.guild;
  if (!g) return;
  const tbody = $('#members-table tbody');
  tbody.innerHTML = '';
  const rows = [...g.members].sort((a, b) => {
    const va = a[memberSort.key], vb = b[memberSort.key];
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * memberSort.dir;
  });
  for (const m of rows) {
    const r = store.rosters[m.allyCode];
    tbody.append(el('tr', {}, [
      el('td', {}, [
        m.name + ' ',
        el('a', { href: 'https://swgoh.gg/p/' + m.allyCode + '/', target: '_blank', rel: 'noopener', class: 'muted' }, '↗'),
      ]),
      el('td', { class: 'num' }, fmt(m.gp)),
      el('td', { class: 'num' }, fmt(m.charGp)),
      el('td', { class: 'num' }, fmt(m.shipGp)),
      el('td', { class: 'num' }, r
        ? el('span', { class: 'pill ok', title: 'Загружен ' + new Date(r.t).toLocaleString('ru-RU') }, '✓')
        : el('span', { class: 'pill', title: 'Ростер не загружен' }, '—')),
    ]));
  }
}

/* --- загрузка ростеров --- */

let rosterLoading = false;
$('#btn-load-rosters').addEventListener('click', loadAllRosters);

async function loadAllRosters() {
  if (rosterLoading || !store.guild) return;
  rosterLoading = true;
  $('#btn-load-rosters').disabled = true;
  const prog = $('#roster-progress');
  const targets = store.guild.members.filter(m => {
    const r = store.rosters[m.allyCode];
    return !r || (Date.now() - r.t) > 24 * 3600 * 1000; // обновляем раз в сутки
  });
  let ok = 0, fail = 0;
  for (let i = 0; i < targets.length; i++) {
    const m = targets[i];
    setStatus(prog, `Ростеры: ${i + 1} / ${targets.length} — ${m.name}… (успешно ${ok}, ошибок ${fail})`);
    try {
      const json = await SwgohApi.fetchJson(SwgohApi.playerApiUrl(m.allyCode));
      const p = normalizePlayer(json);
      p.allyCode = p.allyCode || m.allyCode;
      store.rosters[p.allyCode] = p;
      ok++;
      if (ok % 5 === 0) saveRosters();
    } catch (e) {
      fail++;
      if (fail >= 3 && ok === 0) break; // всё падает — нет смысла продолжать
    }
    renderMembers();
    await new Promise(r => setTimeout(r, 350)); // не душим API
  }
  saveRosters();
  rosterLoading = false;
  $('#btn-load-rosters').disabled = false;
  const missing = store.guild.members.filter(m => !store.rosters[m.allyCode]);
  if (missing.length) {
    setStatus(prog, `Готово: загружено ${ok}, не удалось ${missing.length}. Используйте ручной импорт ниже.`, fail ? 'err' : 'ok');
    renderRosterManual(missing);
    $('#roster-manual').classList.remove('hidden');
    $('#roster-manual').open = true;
  } else {
    setStatus(prog, `Все ростеры загружены ✔ (обновлено: ${ok})`, 'ok');
    $('#roster-manual').classList.add('hidden');
  }
  renderAll();
}

function renderRosterManual(missing) {
  const box = $('#roster-links');
  box.innerHTML = '';
  for (const m of missing) {
    box.append(el('a', { href: SwgohApi.playerApiUrl(m.allyCode), target: '_blank', rel: 'noopener' }, m.name));
  }
}

$('#btn-manual-player').addEventListener('click', () => {
  const text = $('#manual-player-json').value.trim();
  if (!text) return;
  let ok = 0, fail = 0;
  for (const chunk of splitJsonObjects(text)) {
    try {
      const p = normalizePlayer(JSON.parse(chunk));
      if (!p.allyCode) throw new Error('нет ally_code');
      store.rosters[p.allyCode] = p;
      ok++;
    } catch { fail++; }
  }
  saveRosters();
  $('#manual-player-json').value = '';
  setStatus($('#roster-progress'), `Импортировано ростеров: ${ok}` + (fail ? `, с ошибками: ${fail}` : ''), fail ? 'err' : 'ok');
  if (store.guild) renderRosterManual(store.guild.members.filter(m => !store.rosters[m.allyCode]));
  renderAll();
});

/* ---------------- Вкладка «Фазы» ---------------- */

function renderPhases() {
  const root = $('#phases-overview');
  root.innerHTML = '';
  for (const ph of PHASES) {
    const block = el('div', { class: 'phase-block' }, [
      el('h2', {}, `Фаза ${ph}`),
    ]);
    const grid = el('div', { class: 'phase-zones' });
    for (const p of planetsByPhase[ph] || []) {
      const rr = relicReq(p);
      const card = el('div', { class: 'pz-card' });
      card.append(el('h4', {}, [
        ALIGN_ICON[p.alignment] + ' ' + p.displayName,
        el('span', { class: 'badge ' + p.alignment }, ALIGN_RU[p.alignment]),
        p.bonus ? el('span', { class: 'badge bonus' }, 'Бонус') : null,
        rr ? el('span', { class: 'badge relic' }, 'Платуны: R' + rr) : null,
      ]));
      if (p.starThresholds && p.starThresholds['1']) {
        card.append(el('div', { class: 'th-line' },
          `★ ${fmtM(p.starThresholds['1'])} · ★★ ${fmtM(p.starThresholds['2'])} · ★★★ ${fmtM(p.starThresholds['3'])}`));
      }
      const reqs = new Set();
      for (const ms of p.missions) for (const r of ms.reqs) reqs.add((ms.type === 'fleet' ? '🚀 ' : '⚔ ') + r);
      if (reqs.size) {
        card.append(el('ul', {}, [...reqs].map(r => el('li', {}, r))));
      }
      grid.append(card);
    }
    block.append(grid);
    root.append(block);
  }
}

/* ---------------- Вкладка «Планировщик» ---------------- */

let plannerPhase = 1;

function deployZones(phase) {
  return (planetsByPhase[phase] || []).filter(p => !p.bonus);
}

function renderPlannerPicker() {
  const box = $('#planner-phase-picker');
  box.innerHTML = '';
  for (const ph of PHASES) {
    box.append(el('button', {
      class: ph === plannerPhase ? 'active' : '',
      onclick: () => { plannerPhase = ph; renderPlanner(); },
    }, 'Фаза ' + ph));
  }
}

function renderPlanner() {
  renderPlannerPicker();
  const zonesBox = $('#planner-zones');
  const tbody = $('#planner-table tbody');
  zonesBox.innerHTML = '';
  tbody.innerHTML = '';
  const g = store.guild;
  if (!g) {
    zonesBox.append(el('p', { class: 'muted' }, 'Сначала загрузите гильдию на вкладке «Гильдия».'));
    return;
  }
  const zones = deployZones(plannerPhase);
  const assign = store.plan[plannerPhase] || {};

  // суммы по зонам
  const totals = {}, counts = {};
  for (const z of zones) { totals[z.key] = 0; counts[z.key] = 0; }
  let unassigned = 0;
  for (const m of g.members) {
    const zk = assign[m.allyCode];
    if (zk && totals[zk] != null) { totals[zk] += m.gp; counts[zk]++; }
    else unassigned++;
  }

  for (const z of zones) {
    const card = el('div', { class: 'zone-card' });
    card.append(el('h4', {}, [
      el('span', { class: 'align-' + z.alignment }, ALIGN_ICON[z.alignment] + ' ' + z.displayName),
    ]));
    card.append(el('div', { class: 'zone-total' }, fmt(totals[z.key])));
    card.append(el('div', { class: 'zone-count' }, counts[z.key] + ' игроков · деплой (без учёта миссий)'));
    const bars = el('div', { class: 'star-bars' });
    for (const star of [1, 2, 3]) {
      const need = z.starThresholds && z.starThresholds[star];
      if (!need) continue;
      const pct = Math.min(100, totals[z.key] / need * 100);
      bars.append(el('div', { class: 'star-bar' }, [
        el('div', { class: 'fill' + (pct >= 100 ? ' done' : ''), style: 'width:' + pct.toFixed(1) + '%' }),
        el('div', { class: 'lbl' }, [
          el('span', {}, '★'.repeat(star)),
          el('span', {}, pct.toFixed(0) + '% из ' + fmtM(need)),
        ]),
      ]));
    }
    card.append(bars);
    zonesBox.append(card);
  }

  $('#planner-unassigned-info').textContent = unassigned ? `— не распределено: ${unassigned}` : '— все распределены';

  for (const m of g.members) {
    const sel = el('select', {
      onchange: ev => {
        const ph = store.plan[plannerPhase] = store.plan[plannerPhase] || {};
        if (ev.target.value) ph[m.allyCode] = ev.target.value;
        else delete ph[m.allyCode];
        savePlan();
        renderPlanner();
      },
    });
    sel.append(el('option', { value: '' }, '— не назначен —'));
    for (const z of zones) {
      const opt = el('option', { value: z.key }, ALIGN_ICON[z.alignment] + ' ' + z.displayName);
      if (assign[m.allyCode] === z.key) opt.selected = true;
      sel.append(opt);
    }
    tbody.append(el('tr', {}, [
      el('td', {}, m.name),
      el('td', { class: 'num' }, fmt(m.gp)),
      el('td', {}, sel),
    ]));
  }
}

/* --- авторазложение --- */

$('#btn-auto-distribute').addEventListener('click', () => {
  const g = store.guild;
  if (!g) return;
  const zones = deployZones(plannerPhase);
  if (!zones.length) return;
  if (!confirm(`Перераспределить всех игроков по зонам фазы ${plannerPhase} автоматически? Текущие назначения фазы будут заменены.`)) return;

  const targets = zones.map(z => ({ key: z.key, need: (z.starThresholds && z.starThresholds['3']) || 1, total: 0 }));
  const assign = {};
  const members = [...g.members].sort((a, b) => b.gp - a.gp);
  for (const m of members) {
    // зона с наибольшим относительным дефицитом до 3*
    targets.sort((a, b) => (b.need - b.total) / b.need - (a.need - a.total) / a.need);
    const t = targets[0];
    assign[m.allyCode] = t.key;
    t.total += m.gp;
  }
  store.plan[plannerPhase] = assign;
  savePlan();
  renderPlanner();
});

/* --- копирование / экспорт / импорт плана --- */

$('#btn-copy-plan').addEventListener('click', async () => {
  const g = store.guild;
  if (!g) return;
  const zones = deployZones(plannerPhase);
  const assign = store.plan[plannerPhase] || {};
  let text = `📋 План фазы ${plannerPhase} — ${g.name}\n`;
  for (const z of zones) {
    const ms = g.members.filter(m => assign[m.allyCode] === z.key);
    const total = ms.reduce((s, m) => s + m.gp, 0);
    text += `\n${ALIGN_ICON[z.alignment]} ${z.displayName} (${ms.length} чел., ${fmtM(total)}):\n`;
    text += ms.map(m => '  • ' + m.name).join('\n') + '\n';
  }
  const rest = g.members.filter(m => !assign[m.allyCode]);
  if (rest.length) text += `\n❓ Не распределены: ${rest.map(m => m.name).join(', ')}\n`;
  try {
    await navigator.clipboard.writeText(text);
    alert('План скопирован в буфер обмена');
  } catch {
    prompt('Скопируйте текст:', text);
  }
});

$('#btn-export-plan').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ guildId: store.guild && store.guild.id, plan: store.plan }, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'tb_plan.json' });
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#import-plan-file').addEventListener('change', ev => {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.plan) throw new Error('нет поля plan');
      store.plan = data.plan;
      savePlan();
      renderPlanner();
      alert('План импортирован');
    } catch (e) {
      alert('Не удалось импортировать план: ' + e.message);
    }
  };
  reader.readAsText(file);
  ev.target.value = '';
});

/* ---------------- Вкладка «Платуны» ---------------- */

let platoonPhase = 1;
let platoonPlanet = null;

function renderPlatoonPickers() {
  const phBox = $('#platoons-phase-picker');
  phBox.innerHTML = '';
  for (const ph of PHASES) {
    phBox.append(el('button', {
      class: ph === platoonPhase ? 'active' : '',
      onclick: () => { platoonPhase = ph; platoonPlanet = null; renderPlatoons(); },
    }, 'Фаза ' + ph));
  }
  const plBox = $('#platoons-planet-picker');
  plBox.innerHTML = '';
  const planets = planetsByPhase[platoonPhase] || [];
  if (!platoonPlanet || !planets.some(p => p.key === platoonPlanet)) {
    platoonPlanet = planets[0] && planets[0].key;
  }
  for (const p of planets) {
    plBox.append(el('button', {
      class: p.key === platoonPlanet ? 'active' : '',
      onclick: () => { platoonPlanet = p.key; renderPlatoons(); },
    }, ALIGN_ICON[p.alignment] + ' ' + p.displayName + (p.bonus ? ' (бонус)' : '')));
  }
}

// индекс: normName -> {have: [{name, r, s}], combatType}
function unitIndex() {
  const idx = {};
  for (const [ac, roster] of Object.entries(store.rosters)) {
    const member = store.guild && store.guild.members.find(m => m.allyCode === ac);
    const pname = (member && member.name) || roster.name || ac;
    for (const [nn, u] of Object.entries(roster.units)) {
      const rec = idx[nn] = idx[nn] || { players: [], c: u.c };
      rec.players.push({ name: pname, r: u.r, s: u.s, c: u.c });
    }
  }
  return idx;
}

function renderPlatoons() {
  renderPlatoonPickers();
  const box = $('#platoons-content');
  box.innerHTML = '';
  const planet = TB.planets[platoonPlanet];
  if (!planet) return;
  const rr = relicReq(planet) || 0;
  const rostersLoaded = Object.keys(store.rosters).length;

  box.append(el('p', { class: 'muted' },
    `Требование платунов: персонажи Relic ${rr}+, корабли 7★. ` +
    `Число — сколько слотов этого юнита суммарно в операциях планеты.`));

  if (!rostersLoaded) {
    box.append(el('div', { class: 'status' },
      'Ростеры игроков не загружены — видно только требования. Загрузите ростеры на вкладке «Гильдия», чтобы увидеть готовность гильдии.'));
  }

  const idx = rostersLoaded ? unitIndex() : null;
  const table = el('table', { class: 'table' });
  table.append(el('thead', {}, el('tr', {}, [
    el('th', {}, 'Юнит'),
    el('th', { class: 'num' }, 'Нужно'),
    el('th', { class: 'num' }, 'Есть готовых'),
    el('th', {}, 'Готовность'),
  ])));
  const tbody = el('tbody');

  const units = [...planet.platoonUnits].sort((a, b) => b.count - a.count);
  let totalNeed = 0, totalHave = 0, unknown = 0;
  for (const u of units) {
    totalNeed += u.count;
    let ready = [], status = null;
    if (idx) {
      const rec = idx[normName(u.name)];
      if (!rec) { unknown++; status = 'нет данных'; }
      else {
        ready = rec.players.filter(p => p.c === 2 ? p.s >= 7 : p.r >= rr);
        totalHave += Math.min(ready.length, u.count);
      }
    }
    const pill = !idx ? null
      : status ? el('span', { class: 'pill warn', title: 'Юнит не найден в загруженных ростерах — возможно, ни у кого нет, либо имя не совпало' }, '❔ нет данных')
      : ready.length >= u.count ? el('span', { class: 'pill ok' }, '✓ хватает')
      : ready.length > 0 ? el('span', { class: 'pill warn' }, 'не хватает ' + (u.count - ready.length))
      : el('span', { class: 'pill bad' }, 'ни у кого нет');
    tbody.append(el('tr', {}, [
      el('td', {}, [u.name, ready.length ? el('div', { class: 'who' },
        ready.slice(0, 8).map(p => p.name).join(', ') + (ready.length > 8 ? ` и ещё ${ready.length - 8}` : '')) : null]),
      el('td', { class: 'num' }, String(u.count)),
      el('td', { class: 'num' }, idx && !status ? String(ready.length) : '—'),
      el('td', {}, pill),
    ]));
  }
  table.append(tbody);

  if (idx) {
    const pct = totalNeed ? Math.round(totalHave / totalNeed * 100) : 0;
    box.append(el('div', { class: 'platoon-summary' }, [
      stat(pct + '%', 'заполняемость слотов (по готовым юнитам)'),
      stat(fmt(totalNeed), 'всего слотов'),
      unknown ? stat(String(unknown), 'юнитов без данных') : null,
    ]));
  }
  box.append(table);
}

/* ---------------- Вкладка «Спецмиссии» ---------------- */

function renderSpecials() {
  const box = $('#specials-content');
  box.innerHTML = '';
  for (const ph of PHASES) {
    const items = [];
    for (const p of planetsByPhase[ph] || []) {
      for (const ms of p.missions) {
        if (!ms.type.startsWith('special') && ms.type !== 'reva') continue;
        items.push(el('div', { class: 'spec-item' }, [
          el('div', { class: 'where' }, ALIGN_ICON[p.alignment] + ' ' + p.displayName + (p.bonus ? ' (бонусная зона)' : '')),
          el('div', {}, ms.reqs.length ? ms.reqs.join('; ') : 'Требования уточняются'),
          ms.rewards.length ? el('div', { class: 'muted', style: 'font-size:12px' }, 'Награда: ' + ms.rewards.join(', ')) : null,
        ]));
      }
    }
    if (items.length) {
      const blockEl = el('div', { class: 'spec-phase' }, [el('h3', {}, 'Фаза ' + ph)]);
      items.forEach(i => blockEl.append(i));
      box.append(blockEl);
    }
  }
}

/* ---------------- Инициализация ---------------- */

function renderAll() {
  renderGuild();
  renderPhases();
  renderPlanner();
  renderPlatoons();
  renderSpecials();
}

if (store.guild) $('#guild-url').value = store.guild.id;
updateManualGuildLink();
renderAll();

})();
