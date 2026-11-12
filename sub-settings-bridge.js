// Bridge between the extension and vidnest player pages (MAIN world scripts
// cannot access chrome.storage). Reads saved subtitle settings and forwards
// them to the player via postMessage — on load and on every change, so
// adjustments made in the overlay apply live.
//
// Also acts as the frame-side collector for the "Download Link" feature:
// the overlay/player page asks this frame for the media URLs it actually
// loaded (m3u8/mp4). Content scripts can read the frame's performance
// timeline, which is exactly what the player fetched.
(function () {
  function push() {
    try {
      chrome.storage.local.get({ subtitleSettings: {} }, (d) => {
        window.postMessage({ type: 'playnext:sub-settings', settings: d.subtitleSettings }, '*');
      });
    } catch (e) { /* extension context invalidated */ }
  }

  push();

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.subtitleSettings) push();
    });
  } catch (e) { /* ignore */ }

  // Playlist capture: MAIN-world wrappers (subtitle-fallback.js) post every
  // playlist URL they see here. This is the most reliable source for the
  // Download feature — performance entries alone are too easy to miss.
  const playlistUrls = [];
  const playlistSeen = new Set();
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.type !== 'playnext:playlist' || !d.url || !/^https?:/i.test(d.url)) return;
    if (playlistSeen.has(d.url)) return;
    playlistSeen.add(d.url);
    playlistUrls.push(d.url);
  });

  function collectMediaUrls() {
    const out = [];
    const seen = new Set();
    const add = (u, kind) => {
      if (!u || seen.has(u)) return;
      seen.add(u);
      out.push({ url: u, kind: kind });
    };
    // Captured playlists first (in fetch order — master usually first).
    for (const u of playlistUrls) add(u, /\.mp4(\?|$)/i.test(u) ? 'mp4' : 'hls');
    // Performance entries as backup: look for .m3u8 / mpegurl ANYWHERE in the
    // URL (segment filenames are deliberately obfuscated, but playlists are
    // always *.m3u8, possibly inside a proxy query string).
    try {
      const entries = performance.getEntriesByType('resource') || [];
      for (const e of entries) {
        const u = e.name || '';
        if (!/^https?:/i.test(u)) continue;
        if (/\.m3u8|mpegurl/i.test(u)) add(u, 'hls');
        else if (/\.mp4(\?|$)/i.test(u.split('?')[0]) || /type=mp4/i.test(u)) add(u, 'mp4');
      }
    } catch (err) { /* ignore */ }
    // MP4 first (single file = simplest to download), then HLS earliest-first
    // (the first m3u8 requested is usually the master playlist, which lets
    // the downloader offer quality choices).
    out.sort((a, b) => (a.kind === b.kind ? 0 : (a.kind === 'mp4' ? -1 : 1)));
    return out;
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d.type !== 'string') return;
    if (d.type === 'playnext:get-stream' && typeof d.reqId === 'number') {
      try {
        window.parent.postMessage({ type: 'playnext:stream-list', reqId: d.reqId, urls: collectMediaUrls() }, '*');
      } catch (err) { /* ignore */ }
      return;
    }
    // Seek command from the parent page (resume badge click): relay it into
    // the MAIN world, which owns the actual video element.
    if (d.type === 'playnext:seek' && typeof d.time === 'number' && e.source === window.parent) {
      try {
        window.postMessage({ type: 'playnext:seek', time: d.time }, '*');
      } catch (err) { /* ignore */ }
    }
  });
})();
