// Subtitle fallback + customization for vidnest.fun players.
//
// 1) Subtitle fallback: VidNest's primary subtitle API (sub.wyzie.io) returns
//    403 "Invalid API key" (dead key) and its fallback (sub.vdrk.site) is
//    missing many titles. This script wraps window.fetch and, whenever a
//    subtitle request fails or comes back empty, answers with results from the
//    free Stremio OpenSubtitles addon, keyed by IMDb id (passed as ?imdb=).
// 2) Subtitle customization: the extension's settings UI (on the IMDb overlay)
//    saves preferences to chrome.storage; an isolated-world bridge script
//    forwards them here via postMessage. Styling is applied with CSS overrides
//    on the player's caption elements (Vidstack renders [data-part="cue"]),
//    and sync offset is applied by shifting subtitle timestamps — both when
//    subtitle files are fetched and live for natively-created cues via a
//    VTTCue wrapper.
(function () {
  if (window.__playNextSubsPatched) return;
  window.__playNextSubsPatched = true;

  const SUB_HOSTS = /sub\.wyzie\.io|sub\.vdrk\.site/;
  const SUB_FILE = /\.(vtt|srt)(\?|#|$)/i;
  const OS_API = 'https://opensubtitles-v3.strem.io/subtitles';

  // Cache per video so episode switches don't re-query.
  const cache = new Map();

  // ------------------------------------------------------------------
  // Settings (font size, color, sync offset, ...)
  // ------------------------------------------------------------------
  let settings = null; // null until the bridge delivers stored settings
  let styleEl = null;

  function hexToRgb(hex) {
    const m = (hex || '').replace('#', '');
    const full = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
    const n = parseInt(full, 16);
    if (isNaN(n) || full.length !== 6) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function applySubtitleStyles(s) {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'playnext-sub-styles';
      (document.head || document.documentElement).appendChild(styleEl);
    }
    if (!s) { styleEl.textContent = ''; return; }

    const rgb = hexToRgb(s.color) || [255, 255, 255];
    const bg = hexToRgb(s.bgColor) || [0, 0, 0];
    const op = (s.opacity != null ? s.opacity : 100) / 100;
    const bgOp = (s.bgOpacity != null ? s.bgOpacity : 0) / 100;
    const fs = s.fontSize ? s.fontSize + 'px' : null;
    const ff = s.fontFamily || null;
    const fw = s.bold ? '700' : null;
    const shadow = s.shadow ? '0 0 4px #000, 1px 1px 2px #000, -1px -1px 2px #000' : 'none';
    const off = s.offset ? s.offset + 'px' : null;

    // VidNest's captions container styles everything through --cue-* custom
    // properties (its own default box is --cue-bg-color: #000000b3). Setting
    // the variables on the container overrides both the default dark box and
    // the player's responsive font sizing.
    const vars = [
      `--cue-color:rgba(${rgb.join(',')},${op})!important`,
      `--cue-bg-color:rgba(${bg.join(',')},${bgOp})!important`,
      fs ? `--cue-font-size:${fs}!important` : null
    ].filter(Boolean).join(';');

    let css = '';
    if (off) css += `[data-part="captions"],.vds-captions{transform:translateY(${off})!important;}\n`;
    css += `[data-part="captions"],.vds-captions,[class*="captions"]{${vars};}\n`;

    // Direct overrides on the cue element too (font family / weight / shadow
    // are not exposed as variables), plus native <track> fallback.
    const textRules = [
      fs ? `font-size:${fs}!important` : null,
      ff ? `font-family:${ff}!important` : null,
      fw ? `font-weight:${fw}!important` : null,
      `color:rgba(${rgb.join(',')},${op})!important`,
      `background:rgba(${bg.join(',')},${bgOp})!important`,
      `text-shadow:${shadow}!important`
    ].filter(Boolean).join(';');
    css += `[data-part="cue"]{${textRules};}\n`;
    css += `video::cue{font-size:${fs || 'inherit'};font-family:${ff || 'inherit'};font-weight:${fw || 'normal'};color:rgba(${rgb.join(',')},${op});background:rgba(${bg.join(',')},${bgOp});text-shadow:${shadow};}\n`;
    styleEl.textContent = css;
  }

  // ------------------------------------------------------------------
  // Live sync: wrap VTTCue so cue times are evaluated dynamically against
  // the current delay. Changing the delay instantly re-evaluates which cues
  // are active for players using native cue objects.
  // ------------------------------------------------------------------
  let subDelay = 0;

  function installCueWrap() {
    if (!window.VTTCue || window.VTTCue.__playNextWrapped) return;
    const Orig = window.VTTCue;
    function Wrapped(startTime, endTime, text) {
      const cue = new Orig(startTime, endTime, text);
      let s0 = cue.startTime, e0 = cue.endTime;
      try {
        Object.defineProperty(cue, 'startTime', {
          get() { return Math.max(0, s0 + subDelay); },
          set(v) { s0 = v; },
          configurable: true
        });
        Object.defineProperty(cue, 'endTime', {
          get() { return Math.max(s0 + subDelay + 0.05, e0 + subDelay); },
          set(v) { e0 = v; },
          configurable: true
        });
      } catch (e) { /* older engines: fall back to load-time shifting only */ }
      return cue;
    }
    Wrapped.prototype = Orig.prototype;
    Wrapped.__playNextWrapped = true;
    window.VTTCue = Wrapped;
  }

  // ------------------------------------------------------------------
  // Load-time sync: shift timestamps inside fetched subtitle files
  // ------------------------------------------------------------------
  function fmt(ms) {
    ms = Math.max(0, Math.round(ms));
    const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
    const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
    const f = String(ms % 1000).padStart(3, '0');
    return { h, m, s, f };
  }

  function shiftSubText(text, offsetSec) {
    const offMs = offsetSec * 1000;
    return text.replace(/(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/g, (all, h, m, s, f) => {
      const t = (+h) * 3600000 + (+m) * 60000 + (+s) * 1000 + (+f.padEnd(3, '0')) + offMs;
      const p = fmt(t);
      // Keep the original separator style (VTT uses '.', SRT uses ',')
      const sep = all.includes(',') ? ',' : '.';
      return `${p.h}:${p.m}:${p.s}${sep}${p.f}`;
    });
  }

  // Remember the last subtitle file we saw, so a sync change can instantly
  // rebuild and swap the track (see reloadSubtitleTracks).
  let lastSub = null;

  function srtToVtt(text) {
    return 'WEBVTT\n\n' + text.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  }

  function reloadSubtitleTracks() {
    if (!lastSub) return;
    try {
      const shifted = subDelay ? shiftSubText(lastSub.text, subDelay) : lastSub.text;
      const vtt = lastSub.isSrt ? srtToVtt(shifted) : shifted;
      const blobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      document.querySelectorAll('track').forEach(t => {
        const kind = (t.kind || '').toLowerCase();
        if (kind !== 'subtitles' && kind !== 'captions') return;
        const mode = t.track ? t.track.mode : null;
        t.src = blobUrl;
        if (t.track && mode) { try { t.track.mode = mode; } catch (e) { /* keep going */ } }
      });
    } catch (e) { /* best effort */ }
  }

  // ------------------------------------------------------------------
  // Subtitle source fallback (Stremio OpenSubtitles addon)
  // ------------------------------------------------------------------
  const LANG_NAMES = {
    eng: 'English', spa: 'Spanish', fre: 'French', fra: 'French',
    ger: 'German', deu: 'German', ita: 'Italian', por: 'Portuguese',
    rus: 'Russian', ara: 'Arabic', hin: 'Hindi', jpn: 'Japanese',
    kor: 'Korean', chi: 'Chinese', zho: 'Chinese', tur: 'Turkish',
    pol: 'Polish', dut: 'Dutch', nld: 'Dutch', swe: 'Swedish',
    nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', gre: 'Greek',
    ell: 'Greek', heb: 'Hebrew', ron: 'Romanian', rum: 'Romanian',
    ces: 'Czech', cze: 'Czech', hun: 'Hungarian', tha: 'Thai',
    vie: 'Vietnamese', ind: 'Indonesian', ukr: 'Ukrainian',
    sqi: 'Albanian', alb: 'Albanian', srp: 'Serbian', bul: 'Bulgarian',
    fas: 'Persian', per: 'Persian', tam: 'Tamil', tel: 'Telugu',
    kan: 'Kannada', mal: 'Malayalam', ben: 'Bengali', mar: 'Marathi',
    fil: 'Filipino', msa: 'Malay', may: 'Malay', cat: 'Catalan',
    eus: 'Basque', glg: 'Galician', slv: 'Slovenian', slk: 'Slovak',
    svk: 'Slovak', est: 'Estonian', lav: 'Latvian', lit: 'Lithuanian'
  };

  function getVideoContext() {
    try {
      const u = new URL(location.href);
      const imdb = u.searchParams.get('imdb');
      if (!imdb || !/^tt\d+$/.test(imdb)) return null;
      const isTv = /\/tv\//.test(location.pathname);
      const m = location.pathname.match(/\/tv\/[^/]+\/(\d+)\/(\d+)/);
      return {
        type: isTv ? 'tv' : 'movie',
        // Stremio video id: "tt123" for movies, "tt123:S:E" for episodes.
        id: (isTv && m) ? `${imdb}:${m[1]}:${m[2]}` : imdb
      };
    } catch (e) {
      return null;
    }
  }

  async function fetchFallback(ctx) {
    const key = `${ctx.type}:${ctx.id}`;
    if (cache.has(key)) return cache.get(key);
    let mapped = [];
    try {
      const res = await fetch(`${OS_API}/${ctx.type}/${encodeURIComponent(ctx.id)}`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.subtitles) ? data.subtitles : []);
        mapped = list
          .filter(s => s && s.url)
          .map(s => {
            const code = (s.lang || '').toLowerCase();
            const name = LANG_NAMES[code] || s.lang || 'Unknown';
            // Include both field shapes so whichever mapper the player uses
            // (wyzie: url/display/language, vdrk: file/label) works.
            return {
              url: s.url,
              file: s.url,
              lang: s.lang || code,
              display: name,
              label: name
            };
          });
      }
    } catch (e) { /* keep mapped = [] */ }
    cache.set(key, mapped);
    return mapped;
  }

  function syntheticResponse(items) {
    return new Response(JSON.stringify(items), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }

  async function parseItems(res) {
    try {
      if (!res || !res.ok) return null;
      const data = await res.clone().json();
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.subtitles)) return data.subtitles;
      return null;
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // fetch() wrapper
  // ------------------------------------------------------------------
  const origFetch = window.fetch.bind(window);

  // Playlist capture for the Download feature: the downloader page can't see
  // through the player's network stack, so we report every playlist URL that
  // passes through here (hls.js loads them via fetch/XHR). Reported to the
  // isolated-world bridge via postMessage.
  const reportedPlaylists = new Set();
  function reportPlaylist(u) {
    try {
      if (!u || !/\.m3u8(\?|#|$)|mpegurl/i.test(u)) return;
      if (reportedPlaylists.has(u)) return;
      reportedPlaylists.add(u);
      window.postMessage({ type: 'playnext:playlist', url: u }, '*');
    } catch (e) { /* ignore */ }
  }

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
    reportPlaylist(url);

    // Remember raw subtitle file content so sync changes can re-apply
    // instantly (reloadSubtitleTracks). No shifting here — the VTTCue
    // wrapper applies the offset dynamically; shifting here too would
    // double-apply it.
    if (SUB_FILE.test(url)) {
      return origFetch(input, init).then(async (res) => {
        try {
          if (res && res.ok) {
            const ct = (res.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('subrip') || ct.includes('vtt') || ct.startsWith('text/')) {
              const text = await res.clone().text();
              if (/-->/.test(text)) {
                lastSub = {
                  text: text,
                  isSrt: ct.includes('subrip') || /\d:\d{2}:\d{2},\d{3}/.test(text.slice(0, 500))
                };
              }
            }
          }
        } catch (e) { /* caching is best effort */ }
        return res;
      });
    }

    if (!SUB_HOSTS.test(url)) return origFetch(input, init);

    const ctx = getVideoContext();
    if (!ctx) return origFetch(input, init);

    // Fire the fallback lookup in parallel so the total time stays inside
    // the player's ~5s subtitle timeout.
    const fallback = fetchFallback(ctx).catch(() => null);

    return origFetch(input, init).then(async (res) => {
      const items = await parseItems(res);
      if (items && items.length) return res; // provider worked
      const fb = await fallback;
      return (fb && fb.length) ? syntheticResponse(fb) : res;
    }).catch(async (err) => {
      const fb = await fallback;
      if (fb && fb.length) return syntheticResponse(fb);
      throw err;
    });
  };

  // XHR wrapper: hls.js fetches playlists with XMLHttpRequest, not fetch().
  const OrigXHR = window.XMLHttpRequest;
  if (OrigXHR && OrigXHR.prototype) {
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;
    OrigXHR.prototype.open = function (method, url) {
      try { this.__playnextUrl = typeof url === 'string' ? url : (url && url.href) || ''; } catch (e) { /* ignore */ }
      return origOpen.apply(this, arguments);
    };
    OrigXHR.prototype.send = function () {
      try {
        const u = this.__playnextUrl;
        if (u && /\.m3u8(\?|#|$)|mpegurl/i.test(u)) {
          this.addEventListener('load', () => {
            try {
              const finalUrl = this.responseURL || u;
              if (/\.m3u8(\?|#|$)|mpegurl/i.test(finalUrl) || /\.m3u8/i.test(u)) reportPlaylist(finalUrl);
            } catch (e) { /* ignore */ }
          });
        }
      } catch (e) { /* ignore */ }
      return origSend.apply(this, arguments);
    };
  }

  // ------------------------------------------------------------------
  // Settings bridge: the isolated-world script forwards stored settings
  // here on load and on every change.
  // ------------------------------------------------------------------
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.type !== 'playnext:sub-settings') return;
    settings = d.settings || {};
    const newDelay = Number(settings.delay) || 0;
    const delayChanged = newDelay !== subDelay;
    subDelay = newDelay;
    applySubtitleStyles(settings);
    installCueWrap();
    // Sync slider moved: rebuild + swap the subtitle track instantly so the
    // offset applies without waiting for a reload.
    if (delayChanged) reloadSubtitleTracks();
  });
  installCueWrap();

  // ------------------------------------------------------------------
  // Failover resume: VidNest's built-in server failover swaps the media
  // source inside the same player instance, and its resume logic only runs
  // on initial load — so the next server starts back at 0. Track the
  // furthest playback position and restore it whenever the source resets
  // after real playback has begun.
  //   'emptied' fires when the player loads a new source (failover) but not
  //   on ordinary seeking, so a manual seek back to 0 is never fought.
  // ------------------------------------------------------------------
  let failoverMaxTime = 0;
  let failoverReset = false;
  document.addEventListener('emptied', () => { failoverReset = true; }, true);
  document.addEventListener('timeupdate', (e) => {
    const t = e.target && e.target.currentTime;
    if (typeof t === 'number' && t > failoverMaxTime) failoverMaxTime = t;
  }, true);
  function tryFailoverRestore(v) {
    if (!v || v.tagName !== 'VIDEO') return;
    if (v.currentTime > 5) { failoverReset = false; return; }
    if (!failoverReset || failoverMaxTime < 15) return;
    if (v.readyState >= 1) {
      try { v.currentTime = failoverMaxTime; } catch (err) { /* ignore */ }
      failoverReset = false;
    }
    // readyState 0: keep the flag; loadedmetadata/playing will re-fire.
  }
  document.addEventListener('loadedmetadata', (e) => tryFailoverRestore(e.target), true);
  document.addEventListener('playing', (e) => tryFailoverRestore(e.target), true);

  // ------------------------------------------------------------------
  // Seek command (parent page → bridge → here): used by the "Resuming at…"
  // badge in the IMDb overlay to jump the player to the saved timestamp.
  // ------------------------------------------------------------------
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.type !== 'playnext:seek' || typeof d.time !== 'number' || !isFinite(d.time)) return;
    let tries = 0;
    const apply = () => {
      const v = document.querySelector('video');
      if (!v) {
        if (++tries < 40) setTimeout(apply, 250); // player still mounting
        return;
      }
      try {
        v.currentTime = Math.max(0, d.time);
        v.play().catch(() => { /* autoplay policies — leave paused */ });
      } catch (err) { /* metadata not loaded yet */ }
    };
    apply();
  });
})();
