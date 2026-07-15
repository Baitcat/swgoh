/* ===== SWGOH ТБ Rise of the Empire — планировщик ===== */
(() => {
'use strict';

/* ---------------- Константы и данные ТБ ---------------- */

const TB = window.TB_DATA;
const PHASES = [1, 2, 3, 4, 5, 6];
const ALIGN_RU = { dark: 'Тёмная', light: 'Светлая', mixed: 'Смешанная' };
const ALIGN_ICON = { dark: '🔴', light: '🔵', mixed: '🟣' };
const PATH_LABEL = { dark: 'слева · тёмная', mixed: 'центр · смешанная', light: 'справа · светлая' };

// русские названия планет
const RU_NAMES = {
  mustafar: 'Мустафар', corellia: 'Кореллия', coruscant: 'Корусант',
  geonosis: 'Джеонозис', felucia: 'Фелуция', bracca: 'Бракка',
  dathomir: 'Датомир', tatooine: 'Татуин', kashyyyk: 'Кашиик',
  haven: 'Мед. станция «Хейвен»', kessel: 'Кессель', lothal: 'Лотал',
  malachor: 'Малакор', vandor: 'Вандор', kafrene: 'Кольцо Кафрены',
  deathstar: 'Звезда Смерти', hoth: 'Хот', scarif: 'Скариф',
  zeffo: 'Зеффо', mandalore: 'Мандалор',
};
for (const p of Object.values(TB.planets)) {
  if (RU_NAMES[p.key]) p.displayName = RU_NAMES[p.key];
}

// планеты по фазам
const planetsByPhase = {};
for (const p of Object.values(TB.planets)) {
  (planetsByPhase[p.phase] = planetsByPhase[p.phase] || []).push(p);
}
const alignOrder = { dark: 0, mixed: 1, light: 2 };
for (const list of Object.values(planetsByPhase)) {
  list.sort((a, b) => (a.bonus - b.bonus) || (alignOrder[a.alignment] - alignOrder[b.alignment]));
}

// три пути ТБ: тёмный / смешанный / светлый, по планете на фазу
const PATHS = { dark: [], mixed: [], light: [] };
for (const ph of PHASES) {
  for (const p of planetsByPhase[ph] || []) if (!p.bonus) PATHS[p.alignment].push(p);
}
function pathPredecessor(p) {
  const path = PATHS[p.alignment] || [];
  const i = path.findIndex(x => x.key === p.key);
  return i > 0 ? path[i - 1] : null;
}

function relicReq(planet) {
  const s = (planet.platoonReqs || []).join(' ');
  const m = s.match(/Relic (\d+)/);
  return m ? +m[1] : null;
}

/* ---------------- Состояние ---------------- */

const store = {
  // {id, name, gp, memberCount, members:[{name, allyCode, gp, charGp, shipGp}], loadedAt}
  // если гильдия ещё не загружалась, берём вшитую (data/guild_seed.js)
  guild: load('tbp_guild') || window.GUILD_SEED || null,
  rosters: load('tbp_rosters') || {}, // {allyCode: {t, name, units:{norm:{r,s,c}}}}
  plan: load('tbp_plan') || {},       // {phase: {allyCode: planetKey}}
  settings: load('tbp_settings') || { participation: 90 }, // «участие», % ГП
};
const saveSettings = () => save('tbp_settings', store.settings);
// доля ГП, которая реально деплоится (погрешность на неразместившихся)
const participation = () => Math.min(100, Math.max(50, +store.settings.participation || 90)) / 100;

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
    gp: d.galactic_power || 0,
    charGp: d.character_galactic_power || 0,
    shipGp: d.ship_galactic_power || 0,
    units,
  };
}

// В JSON гильдии нет разбивки ГП на персонажей/флот — берём её из ростеров игроков
function syncGpFromRosters() {
  if (!store.guild) return;
  let changed = false;
  for (const m of store.guild.members) {
    const r = store.rosters[m.allyCode];
    if (!r) continue;
    for (const [src, dst] of [['charGp', 'charGp'], ['shipGp', 'shipGp'], ['gp', 'gp']]) {
      if (r[src] && m[dst] !== r[src]) { m[dst] = r[src]; changed = true; }
    }
  }
  if (changed) saveGuild();
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

$('#btn-manual-guild').addEventListener('click', () => {
  try {
    const text = $('#manual-guild-json').value.trim();
    if (!text) return;
    const json = JSON.parse(splitJsonObjects(text)[0] || text);
    const id = SwgohApi.parseGuildId($('#guild-url').value);
    applyGuild(normalizeGuild(json, id));
    setStatus(guildStatus, 'Гильдия импортирована ✔ Загружаю ростеры игроков…', 'ok');
    $('#manual-guild-json').value = '';
    loadAllRosters(); // ростеры подгружаем автоматически сразу после импорта
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
      el('td', { class: 'num' }, m.charGp ? fmt(m.charGp) : '—'),
      el('td', { class: 'num' }, m.shipGp ? fmt(m.shipGp) : '—'),
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
    // r.gp == null — ростер сохранён старой версией без ГП, перезагружаем
    return !r || r.gp == null || (Date.now() - r.t) > 24 * 3600 * 1000; // обновляем раз в сутки
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

const th = (z, star) => (z.starThresholds && z.starThresholds[star]) || Infinity;
const th3 = z => th(z, 3);

/* Симуляция всего ТБ по текущему плану.
   Правила RotE:
   — на каждом пути (тёмный/смешанный/светлый) в каждый момент открыта ровно
     одна планета — «фронтир» пути; первая открыта с фазы 1;
   — звёзды фиксируются в конце фазы: если взята хотя бы 1★, планета
     ЗАКРЫВАЕТСЯ НАВСЕГДА с этими звёздами (добрать позже нельзя),
     и со следующей фазы открывается следующая планета пути;
   — если звёзд нет, планета остаётся открытой и очки копятся. */
function simulate() {
  const g = store.guild;
  // считаем ожидаемые очки: ГП игрока × участие
  const part = participation();
  const gpByAlly = g ? Object.fromEntries(g.members.map(m => [m.allyCode, m.gp * part])) : {};
  const starsOf = (p, pts) => pts >= th(p, 3) ? 3 : pts >= th(p, 2) ? 2 : pts >= th(p, 1) ? 1 : 0;
  const frontier = { dark: 0, mixed: 0, light: 0 };
  const cum = {};        // key -> накопленные очки
  const finalStars = {}; // key -> зафиксированные звёзды закрытой планеты
  const closedAt = {};   // key -> фаза, в конце которой планета закрылась
  const phases = {};
  for (let f = 1; f <= 6; f++) {
    const open = new Set();
    for (const [al, path] of Object.entries(PATHS)) {
      if (frontier[al] < path.length) open.add(path[frontier[al]].key);
    }
    const cur = {};
    for (const [ac, pk] of Object.entries(store.plan[f] || {})) {
      cur[pk] = (cur[pk] || 0) + (gpByAlly[ac] || 0);
    }
    phases[f] = { open, carry: { ...cum }, cur };
    // деплой засчитывается только в открытые планеты
    for (const [pk, v] of Object.entries(cur)) {
      if (open.has(pk)) cum[pk] = (cum[pk] || 0) + v;
    }
    // конец фазы: фиксация звёзд на фронтирах
    for (const [al, path] of Object.entries(PATHS)) {
      const i = frontier[al];
      if (i >= path.length) continue;
      const p = path[i];
      const s = starsOf(p, cum[p.key] || 0);
      if (s >= 1) {
        finalStars[p.key] = s;
        closedAt[p.key] = f;
        frontier[al]++;
      }
    }
  }
  return { phases, finalStars, closedAt, cum };
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
  const assign = store.plan[plannerPhase] || {};
  const sim = simulate();
  const ph = sim.phases[plannerPhase];
  const counts = {};
  let unassigned = 0;
  for (const m of g.members) {
    const zk = assign[m.allyCode];
    if (zk) counts[zk] = (counts[zk] || 0) + 1;
    else unassigned++;
  }

  // в фазе показываем только открытые планеты (по одной на путь)
  const visible = Object.values(PATHS).flat().filter(p => ph.open.has(p.key));

  for (const z of visible) {
    const carry = ph.carry[z.key] || 0;
    const cur = ph.cur[z.key] || 0;
    const total = carry + cur;

    const card = el('div', { class: 'zone-card' });
    card.append(el('h4', {}, [
      el('span', { class: 'align-' + z.alignment }, ALIGN_ICON[z.alignment] + ' ' + z.displayName),
      el('span', { class: 'badge ' + z.alignment }, PATH_LABEL[z.alignment]),
      z.phase !== plannerPhase ? el('span', { class: 'badge relic' }, 'планета ф.' + z.phase) : null,
    ]));
    card.append(el('div', { class: 'zone-total' }, fmt(Math.round(total))));
    card.append(el('div', { class: 'zone-count' },
      `${counts[z.key] || 0} игроков · эта фаза: ${fmtM(cur)}` +
      (carry ? ` · перенос: ${fmtM(carry)}` : '') +
      ` · ожидаемо при участии ${Math.round(participation() * 100)}%` +
      ' · ★ в конце фазы закроет планету'));
    const bars = el('div', { class: 'star-bars' });
    for (const star of [1, 2, 3]) {
      const need = z.starThresholds && z.starThresholds[star];
      if (!need) continue;
      const pct = Math.min(100, total / need * 100);
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
        const phPlan = store.plan[plannerPhase] = store.plan[plannerPhase] || {};
        if (ev.target.value) phPlan[m.allyCode] = ev.target.value;
        else delete phPlan[m.allyCode];
        savePlan();
        renderPlanner();
      },
    });
    sel.append(el('option', { value: '' }, '— не назначен —'));
    for (const z of visible) {
      const opt = el('option', { value: z.key },
        ALIGN_ICON[z.alignment] + ' ' + z.displayName);
      if (assign[m.allyCode] === z.key) opt.selected = true;
      sel.append(opt);
    }
    // назначение в закрытую/недоступную планету (например, после смены плана)
    const cur = assign[m.allyCode];
    if (cur && !ph.open.has(cur) && TB.planets[cur]) {
      const opt = el('option', { value: cur },
        '⚠ ' + TB.planets[cur].displayName + ' — недоступна');
      opt.selected = true;
      sel.append(opt);
    }
    tbody.append(el('tr', {}, [
      el('td', {}, m.name),
      el('td', { class: 'num' }, fmt(m.gp)),
      el('td', {}, sel),
    ]));
  }
}

/* --- участие (погрешность) --- */

$('#opt-participation').value = store.settings.participation;
$('#opt-participation').addEventListener('change', () => {
  store.settings.participation = Math.min(100, Math.max(50, +$('#opt-participation').value || 90));
  $('#opt-participation').value = store.settings.participation;
  saveSettings();
  renderPlanner(); // ожидаемые очки в карточках зависят от участия
});

/* --- авторазложение --- */

$('#btn-auto-distribute').addEventListener('click', () => {
  const g = store.guild;
  if (!g) return;
  if (!confirm(`Перераспределить всех игроков по зонам фазы ${plannerPhase} автоматически? Текущие назначения фазы будут заменены.`)) return;

  // считаем доступность без назначений текущей фазы
  const saved = store.plan[plannerPhase];
  delete store.plan[plannerPhase];
  const sim = simulate();
  const ph = sim.phases[plannerPhase];
  if (saved) store.plan[plannerPhase] = saved;

  const targets = [...ph.open].map(k => {
    const z = TB.planets[k];
    return { key: k, th1: th(z, 1), th3: th3(z), have: ph.carry[k] || 0 };
  }).filter(t => t.have < t.th3 && isFinite(t.th3));
  if (!targets.length) { alert('В этой фазе нет открытых планет для деплоя.'); return; }

  const assign = {};
  for (const m of [...g.members].sort((a, b) => b.gp - a.gp)) {
    // приоритет 1: добрать 1★ везде (открывает пути); приоритет 2: добивать 3★
    let pool = targets.filter(t => t.have < t.th1);
    let metric = t => (t.th1 - t.have) / t.th1;
    if (!pool.length) {
      pool = targets.filter(t => t.have < t.th3);
      metric = t => (t.th3 - t.have) / t.th3;
    }
    if (!pool.length) pool = targets; // всё добито — ровняем по минимуму
    pool.sort((a, b) => metric ? metric(b) - metric(a) : a.have - b.have);
    const t = pool[0];
    assign[m.allyCode] = t.key;
    t.have += m.gp * participation();
  }
  store.plan[plannerPhase] = assign;
  savePlan();
  renderPlanner();
});

/* --- глобальный оптимизатор всех фаз --- */

/* Beam search по фазам 1..6 по правилам RotE: на каждом пути открыт один
   фронтир; взятые в конце фазы звёзды фиксируются, планета закрывается,
   путь сдвигается. Копить очки можно только не взяв ни одной звезды.
   Для каждого фронтира перебираются цели: «копим» (0) / 1★ / 2★ / 3★;
   остаток ёмкости банкуется на копящих планетах, не пересекая порог 1★.
   Ёмкость фазы = суммарный ГП гильдии × участие (погрешность). */
function optimizePlan(participation) {
  const g = store.guild;
  const pathsArr = Object.values(PATHS); // [dark[], mixed[], light[]]
  const C = g.members.reduce((s, m) => s + m.gp, 0) * participation;

  // дробная ценность банка на планете (сколько звёзд он «почти» даёт)
  const fracStars = (p, bank) => {
    const t1 = th(p, 1), t2 = th(p, 2), t3 = th(p, 3);
    if (bank >= t3) return 3;
    if (bank >= t2) return 2 + (bank - t2) / (t3 - t2);
    if (bank >= t1) return 1 + (bank - t1) / (t2 - t1);
    return t1 ? bank / t1 : 0;
  };
  // потенциал состояния = взятые звёзды + прогресс банка на фронтирах.
  // Используется для отсечения, чтобы «заготовки под будущие звёзды» не выбрасывались.
  const potential = st => {
    let p = st.stars;
    for (let pi = 0; pi < 3; pi++) {
      const path = pathsArr[pi];
      if (st.fr[pi] < path.length) p += fracStars(path[st.fr[pi]], st.bank[pi]);
    }
    return p;
  };

  // состояние: fr — индексы фронтиров, bank — очки на фронтирах, stars — взято звёзд,
  // alloc — очки по планетам ЭТОЙ фазы, parent — предыдущее состояние (для восстановления плана)
  let beam = [{ fr: [0, 0, 0], bank: [0, 0, 0], stars: 0, alloc: null, parent: null }];
  const CAP = 4000; // держим почти все различимые состояния — задача маленькая

  for (let f = 1; f <= 6; f++) {
    const next = [];
    for (const st of beam) {
      const open = []; // {pi, p, cum}
      for (let pi = 0; pi < 3; pi++) {
        const path = pathsArr[pi];
        if (st.fr[pi] < path.length) open.push({ pi, p: path[st.fr[pi]], cum: st.bank[pi] });
      }
      // цели по каждому фронтиру: копим / добрать до 1★ / 2★ / 3★
      const combos = [];
      (function dfs(k, cost, tg) {
        if (k === open.length) { combos.push(tg.slice()); return; }
        const o = open[k];
        const opts = [{ c: 0, s: 0 }];
        for (let s = 1; s <= 3; s++) {
          const c = th(o.p, s) - o.cum;
          if (isFinite(c) && cost + Math.max(0, c) <= C) opts.push({ c: Math.max(0, c), s });
        }
        for (const o2 of opts) { tg.push(o2); dfs(k + 1, cost + o2.c, tg); tg.pop(); }
      })(0, 0, []);

      for (const tg of combos) {
        const fr = st.fr.slice(), bank = st.bank.slice();
        let stars = st.stars;
        const alloc = {};
        let leftover = C - tg.reduce((a, b) => a + b.c, 0);
        // остаток банкуем на копящих фронтирах, не пересекая порог 1★ (иначе планета закроется)
        const staying = open.map((o, k) => ({ o, k })).filter(x => tg[x.k].s === 0)
          .sort((a, b) => (th(a.o.p, 1) - a.o.cum) - (th(b.o.p, 1) - b.o.cum));
        const extra = {};
        for (const { o } of staying) {
          if (leftover <= 0) break;
          const room = Math.max(0, th(o.p, 1) * 0.97 - o.cum - (extra[o.pi] || 0));
          const add = Math.min(leftover, room);
          if (add > 0) { extra[o.pi] = (extra[o.pi] || 0) + add; leftover -= add; }
        }
        for (let k = 0; k < open.length; k++) {
          const o = open[k], t = tg[k];
          if (t.s >= 1) {
            stars += t.s;
            fr[o.pi]++;
            bank[o.pi] = 0;
            if (t.c > 0) alloc[o.p.key] = { pts: t.c, star: t.s };
          } else {
            const add = extra[o.pi] || 0;
            bank[o.pi] = o.cum + add;
            if (add > 0) alloc[o.p.key] = { pts: add, star: 0 };
          }
        }
        next.push({ fr, bank, stars, alloc, parent: st });
      }
    }
    // дедуп по (фронтиры, банк): при равном состоянии оставляем максимум звёзд, затем потенциал
    const seen = new Map();
    for (const st of next) {
      const sig = st.fr.join(',') + '|' + st.bank.map(x => Math.round(x / 2e6)).join(',');
      const cur = seen.get(sig);
      if (!cur || st.stars > cur.stars || (st.stars === cur.stars && potential(st) > potential(cur))) {
        seen.set(sig, st);
      }
    }
    let arr = [...seen.values()];
    if (arr.length > CAP) arr = arr.sort((a, b) => potential(b) - potential(a)).slice(0, CAP);
    beam = arr;
  }

  // итог: максимум фактически взятых звёзд (банк без звезды в зачёт не идёт)
  const best = beam.sort((a, b) => b.stars - a.stars || potential(b) - potential(a))[0];
  if (!best) return null;
  // восстанавливаем план по фазам, идя по цепочке parent
  const chain = [];
  for (let s = best; s && s.alloc != null; s = s.parent) chain.unshift(s);
  const summary = [];
  for (let f = 1; f <= 6; f++) {
    const st = chain[f - 1];
    const rows = st ? Object.entries(st.alloc).map(([key, v]) => ({ f, key, pts: v.pts, star: v.star })) : [];
    summary.push(rows);
  }
  const allocs = summary.map(rows => Object.fromEntries(rows.map(r => [r.key, r.pts])));
  return { best: { allocs, log: summary.flat() }, summary, totalStars: best.stars, capacity: C };
}

$('#btn-optimize-all').addEventListener('click', () => {
  const g = store.guild;
  if (!g) { alert('Сначала загрузите гильдию.'); return; }
  const hasPlan = Object.values(store.plan).some(p => Object.keys(p).length);
  if (hasPlan && !confirm('Пересчитать оптимальный план всех 6 фаз? Текущие назначения будут заменены.')) return;

  const part = participation();
  const res = optimizePlan(part);
  if (!res) { alert('Не удалось построить план.'); return; }

  /* Раскладываем игроков по целям каждой фазы (в ожидаемых очках = ГП × участие).
     На планеты-«копилки» нельзя класть больше 95% порога 1★ — иначе случайная
     звезда закроет планету раньше времени. Лишние игроки идут на планеты,
     где звёзды берутся в эту фазу (перебор там безвреден), иначе — в резерв. */
  store.plan = {};
  const actualCum = {};  // фактически набранные (ожидаемые) очки по планетам
  const plannedCum = {}; // плановые очки по планетам
  for (let f = 1; f <= 6; f++) {
    const events = res.summary[f - 1] || [];
    const starT = [], bankT = [];
    for (const e of events) {
      const p = TB.planets[e.key];
      const have = actualCum[e.key] || 0;
      plannedCum[e.key] = (plannedCum[e.key] || 0) + e.pts;
      if (e.star > 0) {
        // цель — реальный порог звезды с учётом фактического переноса
        starT.push({ key: e.key, rem: th(p, e.star) - have });
      } else {
        bankT.push({
          key: e.key,
          rem: plannedCum[e.key] - have,
          roomToCap: Math.max(0, th(p, 1) * 0.95 - have),
        });
      }
    }
    if (!starT.length && !bankT.length) continue;
    const assign = {};
    for (const m of [...g.members].sort((a, b) => b.gp - a.gp)) {
      const egp = m.gp * part;
      // сначала закрываем недоборы (звёздные цели и копилки с местом)
      const cand = [
        ...starT.filter(t => t.rem > 0),
        ...bankT.filter(t => t.rem > 0 && egp <= t.roomToCap),
      ].sort((a, b) => b.rem - a.rem);
      let t = cand[0];
      if (!t && starT.length) {
        // цели закрыты — лишних кладём на звёздную планету с наименьшим перебором
        t = starT.reduce((x, y) => (y.rem > x.rem ? y : x));
      }
      if (!t) continue; // некуда без риска — игрок в резерве
      assign[m.allyCode] = t.key;
      t.rem -= egp;
      if (t.roomToCap != null) t.roomToCap -= egp;
      actualCum[t.key] = (actualCum[t.key] || 0) + egp;
    }
    if (Object.keys(assign).length) store.plan[f] = assign;
  }
  savePlan();

  // сводка
  const box = $('#optimize-summary');
  box.classList.remove('hidden', 'err');
  box.classList.add('ok');
  const starStr = n => n ? '★'.repeat(n) : '—';
  let html = `<b>Оптимальный план: ${res.totalStars} ★ из ${Object.values(PATHS).flat().length * 3}</b>` +
    ` <span class="muted">(участие ${Math.round(part * 100)}%, ёмкость фазы ${fmtM(res.capacity)})</span><table>`;
  for (let f = 1; f <= 6; f++) {
    const rows = res.summary[f - 1]
      .filter(r => r.pts > 0 || r.star > 0)
      .map(r => {
        const p = TB.planets[r.key];
        return `${ALIGN_ICON[p.alignment]} ${p.displayName}: +${fmtM(r.pts)}` +
          (r.star > 0 ? ` → ${starStr(r.star)} (закрыта)` : ' (копим)');
      });
    html += `<tr><th>Фаза ${f}</th><td>${rows.join('<br>') || '—'}</td></tr>`;
  }
  html += '</table>';
  box.innerHTML = html;
  renderPlanner();
});

/* --- копирование / экспорт / импорт плана --- */

$('#btn-copy-plan').addEventListener('click', async () => {
  const g = store.guild;
  if (!g) return;
  const assign = store.plan[plannerPhase] || {};
  const sim = simulate();
  const ph = sim.phases[plannerPhase];
  let text = `📋 План фазы ${plannerPhase} — ${g.name}\n`;
  for (const key of Object.keys(TB.planets)) {
    const z = TB.planets[key];
    if (z.bonus || !z.phase || z.phase > plannerPhase) continue;
    const ms = g.members.filter(m => assign[m.allyCode] === z.key);
    if (!ms.length) continue;
    const carry = ph.carry[z.key] || 0;
    const cur = ph.cur[z.key] || 0;
    text += `\n${ALIGN_ICON[z.alignment]} ${z.displayName} (${ms.length} чел., деплой ${fmtM(cur)}` +
      (carry ? `, всего с прошлых фаз ${fmtM(carry + cur)}` : '') + `):\n`;
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
  syncGpFromRosters();
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
