// ==UserScript==
// @name         SWGOH TB Planner Bridge
// @namespace    https://baitcat.github.io/swgoh/
// @version      1.0
// @description  Позволяет планировщику ТБ автоматически загружать данные swgoh.gg через ваш браузер (обход CORS и Cloudflare)
// @match        https://baitcat.github.io/swgoh/*
// @match        http://localhost/*
// @match        http://127.0.0.1/*
// @connect      swgoh.gg
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  function announce() {
    window.postMessage({ type: 'swgoh-bridge-ready', version: '1.0' }, '*');
  }

  window.addEventListener('message', ev => {
    if (ev.source !== window || !ev.data) return;

    if (ev.data.type === 'swgoh-bridge-ping') { announce(); return; }
    if (ev.data.type !== 'swgoh-bridge-fetch') return;

    const { id, url } = ev.data;
    const reply = payload => window.postMessage(Object.assign({ type: 'swgoh-bridge-result', id }, payload), '*');

    if (typeof url !== 'string' || !url.startsWith('https://swgoh.gg/')) {
      reply({ error: 'URL не разрешён (только https://swgoh.gg/)' });
      return;
    }
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      headers: { 'Accept': 'application/json' },
      timeout: 25000,
      onload: r => reply({ status: r.status, text: r.responseText }),
      onerror: () => reply({ error: 'сетевая ошибка' }),
      ontimeout: () => reply({ error: 'таймаут' }),
    });
  });

  announce();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announce);
  }
})();
