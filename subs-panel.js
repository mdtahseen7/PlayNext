// Shared subtitle-settings panel.
// Loaded in two contexts:
//   - as a content script on IMDb pages (isolated world), used by the overlay
//   - as a script in the extension's player.html page ("Open in New Tab")
// Exposes window.PlayNextSubs.toggle(container). Settings are persisted to
// chrome.storage.local.subtitleSettings; the bridge script forwards them into
// the player iframe live.
(function () {
  if (window.PlayNextSubs) return;

  const DEFAULTS = {
    fontSize: 0,        // 0 = player default
    fontFamily: '',     // '' = player default
    bold: false,
    color: '#ffffff',
    opacity: 100,
    bgColor: '#000000',
    bgOpacity: 0,
    shadow: true,
    offset: 0,          // vertical nudge, px
    delay: 0            // sync offset, seconds
  };

  const closeIcon = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;

  function getSettings() {
    return new Promise(resolve =>
      chrome.storage.local.get({ subtitleSettings: DEFAULTS }, d =>
        resolve({ ...DEFAULTS, ...d.subtitleSettings })
      )
    );
  }

  function saveSettings(s) {
    chrome.storage.local.set({ subtitleSettings: s });
  }

  function toggle(container) {
    const existing = container.querySelector('.play-next-subs-panel');
    if (existing) { existing.remove(); return; }
    getSettings().then(s => build(container, s));
  }

  function build(container, settings) {
    const panel = document.createElement('div');
    panel.className = 'play-next-subs-panel';

    panel.innerHTML = `
      <div class="psp-head">
        <span>Subtitle Settings</span>
        <button type="button" class="psp-close" aria-label="Close">${closeIcon}</button>
      </div>
      <label class="psp-row">
        <span class="psp-label">Font size <b class="psp-val" data-val="fontSize"></b></span>
        <input type="range" class="psp-fontSize" min="0" max="48" step="1">
      </label>
      <label class="psp-row">
        <span class="psp-label">Bottom offset <b class="psp-val" data-val="offset"></b></span>
        <input type="range" class="psp-offset" min="-200" max="200" step="10">
      </label>
      <label class="psp-row">
        <span class="psp-label">Sync <b class="psp-val" data-val="delay"></b></span>
        <input type="range" class="psp-delay" min="-300" max="300" step="0.1">
      </label>
      <div class="psp-row">
        <span class="psp-label">Fine tune</span>
        <span class="psp-inline psp-nudges">
          <button type="button" class="psp-nudge" data-d="-5">&minus;5s</button>
          <button type="button" class="psp-nudge" data-d="-0.5">&minus;0.5s</button>
          <button type="button" class="psp-nudge" data-d="0">0</button>
          <button type="button" class="psp-nudge" data-d="0.5">+0.5s</button>
          <button type="button" class="psp-nudge" data-d="5">+5s</button>
        </span>
      </div>
      <div class="psp-row">
        <span class="psp-label">Text color</span>
        <span class="psp-inline">
          <input type="color" class="psp-color">
          <span class="psp-inline-label">Opacity</span>
          <input type="range" class="psp-opacity" min="10" max="100" step="5">
        </span>
      </div>
      <div class="psp-row">
        <span class="psp-label">Backdrop</span>
        <span class="psp-inline">
          <input type="color" class="psp-bgColor">
          <span class="psp-inline-label">Opacity</span>
          <input type="range" class="psp-bgOpacity" min="0" max="100" step="5">
        </span>
      </div>
      <label class="psp-row">
        <span class="psp-label">Font</span>
        <span class="psp-inline">
          <select class="psp-fontFamily">
            <option value="">Default</option>
            <option value="Arial, sans-serif">Sans-serif</option>
            <option value="Georgia, serif">Serif</option>
            <option value="Consolas, monospace">Monospace</option>
            <option value="Comic Sans MS, cursive">Comic</option>
          </select>
          <span class="psp-inline-label">Bold</span>
          <input type="checkbox" class="psp-bold">
          <span class="psp-inline-label">Outline</span>
          <input type="checkbox" class="psp-shadow">
        </span>
      </label>
      <div class="psp-note">Sync nudges subtitle timing (+ = later) and applies within a second — the subtitle track is rebuilt automatically as you drag.</div>
      <button type="button" class="psp-reset">Reset to defaults</button>
    `;

    panel.querySelector('.psp-close').addEventListener('click', () => panel.remove());
    panel.querySelector('.psp-reset').addEventListener('click', () => {
      const d = { ...DEFAULTS };
      saveSettings(d);
      fillInputs(d);
    });

    const $ = sel => panel.querySelector(sel);
    function fillInputs(s) {
      $('.psp-fontSize').value = s.fontSize;
      $('.psp-offset').value = s.offset;
      $('.psp-delay').value = s.delay;
      $('.psp-color').value = s.color;
      $('.psp-opacity').value = s.opacity;
      $('.psp-bgColor').value = s.bgColor;
      $('.psp-bgOpacity').value = s.bgOpacity;
      $('.psp-fontFamily').value = s.fontFamily;
      $('.psp-bold').checked = s.bold;
      $('.psp-shadow').checked = s.shadow;
      updateVals(s);
    }

    function updateVals(s) {
      panel.querySelector('[data-val="fontSize"]').textContent = s.fontSize ? s.fontSize + 'px' : 'default';
      panel.querySelector('[data-val="offset"]').textContent = s.offset + 'px';
      const d = s.delay || 0;
      const sign = d > 0 ? '+' : '';
      const label = Math.abs(d) >= 60
        ? `${sign}${Math.floor(Math.abs(d) / 60)}m ${String(Math.round((Math.abs(d) % 60) * 10) / 10)}s`
        : `${sign}${d.toFixed(1)}s`;
      panel.querySelector('[data-val="delay"]').textContent = label;
    }

    function collect() {
      return {
        fontSize: +$('.psp-fontSize').value,
        offset: +$('.psp-offset').value,
        delay: Math.round(+$('.psp-delay').value * 10) / 10,
        color: $('.psp-color').value,
        opacity: +$('.psp-opacity').value,
        bgColor: $('.psp-bgColor').value,
        bgOpacity: +$('.psp-bgOpacity').value,
        fontFamily: $('.psp-fontFamily').value,
        bold: $('.psp-bold').checked,
        shadow: $('.psp-shadow').checked
      };
    }

    panel.querySelectorAll('.psp-nudge').forEach(b => {
      b.addEventListener('click', () => {
        const r = $('.psp-delay');
        const delta = parseFloat(b.dataset.d);
        const cur = parseFloat(r.value) || 0;
        r.value = delta === 0 ? 0 : Math.max(-300, Math.min(300, Math.round((cur + delta) * 10) / 10));
        r.dispatchEvent(new Event('input', { bubbles: true })); // reuse the normal save path
      });
    });

    panel.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', () => {
        const s = collect();
        updateVals(s);
        saveSettings(s);
      });
    });

    fillInputs(settings);
    container.appendChild(panel);
  }

  function toast(msg, ms) {
    const t = document.createElement('div');
    t.className = 'play-next-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms || 4500);
  }

  window.PlayNextSubs = { toggle: toggle, getSettings: getSettings, saveSettings: saveSettings, toast: toast, DEFAULTS: DEFAULTS };
})();
