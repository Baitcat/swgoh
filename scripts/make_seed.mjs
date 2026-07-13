// Генерирует data/guild_seed.js из guild.json (JSON с swgoh.gg/api/guild-profile/<ID>/)
//   node scripts/make_seed.mjs [путь-к-guild.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] || path.join(ROOT, 'guild.json');
const json = JSON.parse(fs.readFileSync(src, 'utf8'));
const d = json.data || json;

const members = (d.members || json.members || []).map(m => ({
  name: m.player_name || m.name || ('Игрок ' + m.ally_code),
  allyCode: String(m.ally_code || m.allyCode || ''),
  gp: m.galactic_power || 0,
  charGp: m.character_galactic_power || 0,
  shipGp: m.ship_galactic_power || 0,
})).filter(m => m.allyCode).sort((a, b) => b.gp - a.gp);

if (!members.length) {
  console.error('В ' + src + ' не найден список участников');
  process.exit(1);
}

const seed = {
  id: d.guild_id || '',
  name: d.name || 'Гильдия',
  gp: d.galactic_power || members.reduce((s, m) => s + m.gp, 0),
  memberCount: d.member_count || members.length,
  members,
  loadedAt: Date.now(),
  seed: true,
};

fs.writeFileSync(path.join(ROOT, 'data', 'guild_seed.js'),
  '// Сгенерировано scripts/make_seed.mjs — не редактируйте вручную\n' +
  'window.GUILD_SEED = ' + JSON.stringify(seed, null, 1) + ';\n');
console.log(`✔ data/guild_seed.js: ${seed.name}, участников: ${members.length}, ГП: ${(seed.gp / 1e6).toFixed(0)} млн`);
