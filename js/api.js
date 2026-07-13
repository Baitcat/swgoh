/* ===== Загрузка данных swgoh.gg: прямой fetch + каскад CORS-прокси ===== */
const SwgohApi = (() => {

  const GG = 'https://swgoh.gg';

  // Стратегии получения URL. swgoh.gg закрыт Cloudflare + не отдаёт CORS,
  // поэтому пробуем прямой запрос и несколько публичных прокси по очереди.
  const strategies = [
    { name: 'напрямую',      wrap: u => u },
    { name: 'corsproxy.io',  wrap: u => 'https://corsproxy.io/?url=' + encodeURIComponent(u) },
    { name: 'allorigins',    wrap: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
    { name: 'codetabs',      wrap: u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u) },
    { name: 'whateverorigin',wrap: u => 'https://api.whateverorigin.org/get?url=' + encodeURIComponent(u), unwrap: j => JSON.parse(j.contents) },
  ];

  // Запоминаем рабочую стратегию на сессию, чтобы не перебирать каждый раз
  let goodStrategy = null;

  async function tryStrategy(strat, url, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(strat.wrap(url), { signal: ctrl.signal });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      let json = JSON.parse(text);
      if (strat.unwrap) json = strat.unwrap(json);
      // Cloudflare challenge отдаёт HTML — JSON.parse его отсеет
      return json;
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchJson(url, onStatus) {
    const order = goodStrategy
      ? [goodStrategy, ...strategies.filter(s => s !== goodStrategy)]
      : strategies;
    let lastErr = null;
    for (const strat of order) {
      try {
        if (onStatus) onStatus('Пробую: ' + strat.name + '…');
        const json = await tryStrategy(strat, url, 20000);
        goodStrategy = strat;
        return json;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error('Все способы загрузки не сработали (' + (lastErr && lastErr.message) + '). Используйте ручной импорт.');
  }

  function guildApiUrl(guildId) {
    return GG + '/api/guild-profile/' + guildId + '/';
  }
  function playerApiUrl(allyCode) {
    return GG + '/api/player/' + String(allyCode).replace(/-/g, '') + '/';
  }

  // Из ссылки/строки достаём ID гильдии
  function parseGuildId(input) {
    input = (input || '').trim();
    const m = input.match(/\/g\/([A-Za-z0-9_-]{10,})/);
    if (m) return m[1];
    if (/^[A-Za-z0-9_-]{10,}$/.test(input)) return input;
    return null;
  }

  return { fetchJson, guildApiUrl, playerApiUrl, parseGuildId };
})();
