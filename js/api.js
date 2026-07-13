/* ===== Загрузка данных swgoh.gg: мост Tampermonkey + прямой fetch + каскад CORS-прокси ===== */
const SwgohApi = (() => {

  const GG = 'https://swgoh.gg';

  /* --- Мост с юзерскриптом (swgoh_bridge.user.js, Tampermonkey) ---
     Юзерскрипт делает запросы через браузер пользователя, поэтому
     проходит Cloudflare и не упирается в CORS. */
  const bridge = (() => {
    let ready = false;
    let seq = 0;
    const pending = new Map();
    const readyCallbacks = [];

    window.addEventListener('message', ev => {
      if (ev.source !== window || !ev.data) return;
      if (ev.data.type === 'swgoh-bridge-ready' && !ready) {
        ready = true;
        readyCallbacks.forEach(cb => { try { cb(); } catch {} });
      } else if (ev.data.type === 'swgoh-bridge-result') {
        const cb = pending.get(ev.data.id);
        if (cb) { pending.delete(ev.data.id); cb(ev.data); }
      }
    });

    // юзерскрипт мог загрузиться раньше нас — попингуем несколько раз
    function ping() { window.postMessage({ type: 'swgoh-bridge-ping' }, '*'); }
    ping();
    setTimeout(ping, 500);
    setTimeout(ping, 2000);

    function fetchUrl(url, timeoutMs = 30000) {
      return new Promise((resolve, reject) => {
        const id = 'b' + (++seq);
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('мост не ответил'));
        }, timeoutMs);
        pending.set(id, res => {
          clearTimeout(timer);
          if (res.error) return reject(new Error(res.error));
          if (res.status === 403) return reject(new Error(
            'HTTP 403 — Cloudflare. Откройте swgoh.gg в соседней вкладке (пройдите проверку) и повторите.'));
          if (res.status !== 200) return reject(new Error('HTTP ' + res.status));
          try { resolve(JSON.parse(res.text)); }
          catch { reject(new Error('получен не JSON')); }
        });
        window.postMessage({ type: 'swgoh-bridge-fetch', id, url }, '*');
      });
    }

    return {
      isReady: () => ready,
      onReady: cb => { if (ready) cb(); else readyCallbacks.push(cb); },
      fetchUrl,
    };
  })();

  /* --- Прямой fetch и публичные CORS-прокси (могут не работать из-за Cloudflare) --- */
  const strategies = [
    { name: 'напрямую',     wrap: u => u },
    { name: 'corsproxy.io', wrap: u => 'https://corsproxy.io/?url=' + encodeURIComponent(u) },
    { name: 'allorigins',   wrap: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
    { name: 'codetabs',     wrap: u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u) },
  ];

  let goodStrategy = null;

  async function tryStrategy(strat, url, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(strat.wrap(url), { signal: ctrl.signal });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      return JSON.parse(text); // Cloudflare challenge отдаёт HTML — JSON.parse его отсеет
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchJson(url, onStatus) {
    // 1) мост, если установлен — самый надёжный способ
    if (bridge.isReady()) {
      try {
        if (onStatus) onStatus('Загружаю через мост браузера…');
        return await bridge.fetchUrl(url);
      } catch (e) {
        if (onStatus) onStatus('Мост: ' + e.message + '. Пробую прокси…');
      }
    }
    // 2) прямой fetch и прокси
    const order = goodStrategy
      ? [goodStrategy, ...strategies.filter(s => s !== goodStrategy)]
      : strategies;
    let lastErr = null;
    for (const strat of order) {
      try {
        if (onStatus) onStatus('Пробую: ' + strat.name + '…');
        const json = await tryStrategy(strat, url, 15000);
        goodStrategy = strat;
        return json;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error('Все способы загрузки не сработали (' + (lastErr && lastErr.message) +
      '). Установите мост браузера (см. подсказку) или используйте ручной импорт.');
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

  return { fetchJson, guildApiUrl, playerApiUrl, parseGuildId, bridge };
})();
