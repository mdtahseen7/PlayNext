// Shared helper for the "Download" feature: asks a player iframe (via
// postMessage — the frame-side collector lives in sub-settings-bridge.js)
// for the media URLs it actually loaded (m3u8 / mp4), read from the frame's
// performance timeline. Used by both the IMDb overlay and player.html.
(function () {
  if (window.PlayNextStreamLinks) return;

  let reqId = 0;

  function request(iframe, timeoutMs) {
    return new Promise((resolve) => {
      const id = ++reqId;
      let done = false;
      function finish(result) {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        resolve(result);
      }
      function onMsg(e) {
        const d = e.data;
        if (!d || d.type !== 'playnext:stream-list' || d.reqId !== id) return;
        if (iframe.contentWindow && e.source !== iframe.contentWindow) return;
        finish({ urls: (d.urls || []).map((u) => ({ url: u.url, kind: u.kind })) });
      }
      window.addEventListener('message', onMsg);
      try {
        iframe.contentWindow.postMessage({ type: 'playnext:get-stream', reqId: id }, '*');
      } catch (err) {
        finish({ urls: [] });
        return;
      }
      setTimeout(() => finish({ urls: [] }), timeoutMs || 2500);
    });
  }

  window.PlayNextStreamLinks = { request: request };
})();
