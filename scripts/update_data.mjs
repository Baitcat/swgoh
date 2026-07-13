// Обновление датасета ТБ из genskaar/tb_empire:
//   node scripts/update_data.mjs
// Скачивает JS-файлы планет, парсит их и перезаписывает data/tb_data.js
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://genskaar.github.io/tb_empire/js/';
const PLANETS = ['bracca','corellia','coruscant','dathomir','deathstar','felucia','geonosis','haven','hoth','kafrene','kashyyyk','kessel','lothal','malachor','mandalore','mustafar','scarif','tatooine','vandor','zeffo'];

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  return r.text();
}

function loadVueData(code, file) {
  let captured = null;
  const sandbox = {
    Vue: function () {},
    window: { matchMedia: () => ({ matches: false }) },
    document: {},
    console,
  };
  sandbox.Vue.component = (name, def) => { captured = def.data(); };
  sandbox.Vue.directive = () => {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  return captured;
}

const main = loadVueData(await fetchText(BASE + 'main.js'), 'main.js');
const layout = {};
for (const m of main.missions || []) {
  if (!m.planet || !m.planetlink) continue;
  const match = m.planet[0].match(/Phase (\d+) (DS|LS|Mixed)( Bonus)?\s*-\s*(.+)/);
  if (!match) continue;
  const stars = (m.rewards || []).map(r => {
    const mm = r.match(/(\d)\*:\s*([\d,]+)/);
    return mm ? [mm[1], +mm[2].replace(/,/g, '')] : null;
  }).filter(Boolean);
  layout[m.planetlink.replace('.html', '')] = {
    phase: +match[1],
    alignment: match[2] === 'DS' ? 'dark' : match[2] === 'LS' ? 'light' : 'mixed',
    bonus: !!match[3],
    displayName: match[4].trim(),
    starThresholds: Object.fromEntries(stars),
  };
}

const out = { updatedAt: new Date().toISOString().slice(0, 10), planets: {} };
for (const p of PLANETS) {
  const d = loadVueData(await fetchText(BASE + p + '.js'), p + '.js');
  const platoonUnits = [];
  for (const arr of d.platoons || []) {
    for (let i = 0; i + 1 < arr.length; i += 2) platoonUnits.push({ name: arr[i], count: +arr[i + 1] });
  }
  const missions = [];
  let deployStars = null, platoonReqs = null;
  for (const m of d.missions || []) {
    if (m.type === 'deploy') deployStars = m.stars || null;
    else if (m.type === 'platoon') platoonReqs = m.preqs || null;
    else missions.push({
      id: m.id,
      name: m.name,
      type: m.type,
      reqs: (m.reqs || []).map(i => (d.reqs || [])[i]).filter(Boolean),
      rewards: m.rewards || [],
      notes: (m.notes || []).map(i => (d.notes || [])[i]).filter(Boolean),
    });
  }
  out.planets[p] = { key: p, ...layout[p], platoonReqs, platoonUnits, missions, deployStars };
  console.log('✔', p);
}

fs.writeFileSync(path.join(ROOT, 'data', 'tb_data.js'), 'window.TB_DATA = ' + JSON.stringify(out, null, 1) + ';\n');
console.log('data/tb_data.js обновлён');
