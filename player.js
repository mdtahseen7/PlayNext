// Standalone player page ("Open in New Tab"). Embeds the VidNest stream in an
// iframe inside our own extension page so the site's scripts cannot hijack or
// redirect the host tab, while our injected tweaks (subtitle fallback + styles,
// popup blocking) still run inside the frame. Also keeps "continue watching"
// progress in sync by listening for the player's PLAYER_EVENT messages.
(function () {
  const params = new URLSearchParams(location.search);
  const src = params.get('src') || '';
  const imdbId = params.get('imdb') || '';
  const isTv = params.get('tv') === '1';
  const title = params.get('title') || 'PlayNext';
  const poster = params.get('poster') || null;

  // Season and episode for series, read from the provider URL
  // (.../tv/{tmdbId}/{season}/{episode}). Used for the subtitle sidecar.
  let tvSeason = params.get('season') || '';
  let tvEpisode = params.get('episode') || '';
  if (isTv && (!tvSeason || !tvEpisode)) {
    const m = /\/tv\/\d+\/(\d+)\/(\d+)/.exec(src);
    if (m) { tvSeason = m[1]; tvEpisode = m[2]; }
  }

  // Only allow known player hosts — never let this page embed arbitrary URLs.
  if (!/^https:\/\/([\w-]+\.)*(vidnest\.fun)(\/|$)/.test(src)) {
    document.getElementById('wrap').style.display = 'none';
    document.getElementById('bar').style.display = 'none';
    document.getElementById('err').style.display = 'block';
    return;
  }

  document.title = title + ' · PlayNext';
  document.getElementById('title').textContent = title;

  const frame = document.createElement('iframe');
  frame.src = src;
  frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  document.getElementById('wrap').appendChild(frame);

  document.getElementById('fsBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.getElementById('wrap').requestFullscreen().catch(() => { });
  });

  // Same settings panel as the IMDb overlay (shared subs-panel.js). Settings
  // reach the iframe through the bridge content script watching chrome.storage.
  document.getElementById('subsBtn').addEventListener('click', () => {
    if (window.PlayNextSubs) window.PlayNextSubs.toggle(document.body);
  });

  // Download: collect the media URLs the frame actually loaded and hand them
  // to the extension's downloader page.
  document.getElementById('dlBtn').addEventListener('click', async () => {
    const btn = document.getElementById('dlBtn');
    const toast = (msg) => (window.PlayNextSubs && window.PlayNextSubs.toast(msg, 4000));
    btn.disabled = true;
    const res = await window.PlayNextStreamLinks.request(frame);
    btn.disabled = false;
    if (!res.urls.length) {
      toast('No stream found — press Play in the player first, then try again.');
      return;
    }
    const payload = encodeURIComponent(JSON.stringify(res.urls));
    // imdb + tv feed the subtitle sidecar lookup in the downloader page.
    let safeTitle = title.replace(/\s*:\s*/g, ' - ').replace(/[\\/:*?"<>|]+/g, '').trim();
    if (isTv && tvSeason && tvEpisode && !/\bS\d{2}E\d{2}\b/.test(safeTitle)) {
      safeTitle += ' S' + String(tvSeason).padStart(2, '0') + 'E' + String(tvEpisode).padStart(2, '0');
    }
    const dlUrl = chrome.runtime.getURL('downloader.html')
      + '?urls=' + payload
      + '&title=' + encodeURIComponent(safeTitle)
      + '&imdb=' + encodeURIComponent(imdbId)
      + '&tv=' + (isTv ? '1' : '0')
      + '&season=' + encodeURIComponent(tvSeason || '')
      + '&episode=' + encodeURIComponent(tvEpisode || '')
      + '&poster=' + encodeURIComponent(poster || '');
    chrome.tabs.create({ url: dlUrl });
    toast('Downloader opened in a new tab.');
  });

  // ---- Watch progress (same chrome.storage shape as the IMDb overlay) ----
  let lastSave = 0;
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.type !== 'PLAYER_EVENT' || !d.data || !imdbId) return;
    const { event, currentTime, duration } = d.data;
    if (typeof currentTime !== 'number' || typeof duration !== 'number' || duration <= 0) return;
    const now = Date.now();
    const force = event === 'pause' || event === 'ended';
    if (!force && now - lastSave < 5000) return;
    lastSave = now;

    const nearEnd = currentTime / duration > 0.97;
    chrome.storage.local.get({ watchProgress: {} }, (res) => {
      const wp = res.watchProgress;
      if (nearEnd && event === 'ended') delete wp[imdbId];
      else {
        wp[imdbId] = {
          imdbId: imdbId,
          mediaType: isTv ? 'video.tv_show' : 'movie',
          season: d.data.season != null ? d.data.season : null,
          episode: d.data.episode != null ? d.data.episode : null,
          position: nearEnd && event === 'ended' ? 0 : currentTime,
          duration: duration,
          title: title,
          posterSrc: poster,
          updatedAt: now
        };
      }
      chrome.storage.local.set({ watchProgress: wp });
    });
  });
})();
