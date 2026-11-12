// PlayNext stream downloader (extension page, downloader.html).
//
// Receives candidate media URLs (collected from the player frame) via
// ?urls=<json>, then:
//   1. On Start: requests broad optional host permission (segment CDNs vary
//      per server), probes candidates:
//        - .mp4  → direct streamed save
//        - HLS master playlist → quality picker (audio renditions tracked)
//        - HLS media playlist → single-quality download
//   2. Most of these servers serve fMP4 HLS with the audio as a SEPARATE
//      rendition. We merge video + audio into one proper .mp4 by combining
//      the two init segments (moov) into a dual-track movie box and
//      interleaving the fragments, patching track ids / sequence numbers.
//      Validated against real streams: ffprobe sees video + audio, ffmpeg
//      decodes the whole thing cleanly.
//   3. MPEG-TS streams are concatenated as before. If a TS stream has a
//      separate audio rendition it is saved as a second file.
//   4. A matching .srt sidecar subtitle is fetched (OpenSubtitles addon) so
//      players like VLC pick it up automatically.
//   5. Writes straight to disk with the File System Access API (flat memory
//      usage); falls back to an in-memory Blob + chrome.downloads.
(function () {
  const params = new URLSearchParams(location.search);
  let candidates = [];
  try {
    const raw = params.get('urls');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        candidates = arr.filter((c) => c && /^https?:/i.test(c.url))
          .map((c) => ({ url: c.url, kind: c.kind || 'hls' }));
      }
    }
  } catch (e) { /* fall through to legacy format */ }
  if (!candidates.length && params.get('url')) {
    candidates = [{ url: params.get('url'), kind: 'hls' }];
  }

  const imdbId = params.get('imdb') || '';
  const isTv = params.get('tv') === '1';
  // Turn the IMDb title into something that reads well and is safe as a filename.
  const title = (params.get('title') || 'video')
    .replace(/\s*:\s*/g, ' - ')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 90);

  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const statusText = $('statusText');
  const fillEl = $('fill');
  const detailEl = $('detail');
  const progressWrap = $('progressWrap');
  const pctEl = $('pct');
  const speedEl = $('speed');
  const etaEl = $('eta');
  const qualityWrap = $('qualityWrap');
  const qualitySel = $('quality');
  const qualityHint = $('qualityHint');
  const startBtn = $('startBtn');
  const cancelBtn = $('cancelBtn');
  const againBtn = $('againBtn');
  const openBtn = $('openBtn');

  $('ttl').textContent = title;
  try {
    $('ver').textContent = 'v' + (chrome.runtime.getManifest().version || '');
  } catch (e) { /* no manifest */ }

  // Poster art, when the caller passed one (IMDb page or popup).
  const posterUrl = params.get('poster') || '';
  if (posterUrl && /^https?:\/\//i.test(posterUrl)) {
    const img = $('poster');
    img.addEventListener('error', () => { $('posterWrap').classList.remove('on'); });
    img.addEventListener('load', () => { $('posterWrap').classList.add('on'); });
    img.src = posterUrl;
  }
  // Don't display the full stream URL (it's long and private to the session).
  try {
    $('srcLine').textContent = 'Source: ' + new URL(candidates[0].url).hostname;
  } catch (e) {
    $('srcLine').textContent = candidates.length ? 'Source ready' : 'No stream URL was passed.';
  }

  let cancelled = false;
  let running = false;
  let picked = false;      // quality already chosen, a re-run can skip probing
  let variants = null;     // parsed master variants
  let audioRenditions = {}; // group id -> audio playlist url
  let lastDownloadId = null;

  // ---- UI state helpers -------------------------------------------------
  function setRunning(on) {
    running = on;
    cancelBtn.classList.toggle('hidden', !on);
    startBtn.disabled = on;
    qualitySel.disabled = on;
    if (on) {
      againBtn.classList.add('hidden');
      openBtn.classList.add('hidden');
    }
  }
  cancelBtn.addEventListener('click', () => {
    cancelled = true;
    setStatus('Cancelling, finishing the current segment', 'busy');
  });

  function setStatus(msg, kind) {
    statusText.textContent = msg;
    statusEl.classList.remove('ok', 'err', 'busy');
    if (kind) statusEl.classList.add(kind);
  }
  function setDetail(msg) { detailEl.textContent = msg; }
  function setProgress(pct) {
    const p = Math.min(100, Math.max(0, pct));
    fillEl.style.width = p.toFixed(1) + '%';
    pctEl.textContent = p.toFixed(p < 10 ? 1 : 0);
  }
  function showProgress(on) { progressWrap.classList.toggle('hidden', !on); }
  function setSpeed(text) { speedEl.textContent = text || ''; }
  function setEta(text) { etaEl.textContent = text || ''; }
  function fmtMB(n) { return (n / 1048576).toFixed(1) + ' MB'; }
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) return '';
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return m + 'm ' + String(r).padStart(2, '0') + 's';
  }

  // Finished state: the primary button turns into "Download again" so the
  // page never looks like it is still waiting for the first download.
  function finishOk(message) {
    setRunning(false);
    setStatus(message, 'ok');
    startBtn.classList.add('hidden');
    againBtn.classList.remove('hidden');
    if (lastDownloadId != null) openBtn.classList.remove('hidden');
  }
  function failWith(message) {
    setRunning(false);
    setStatus(message, 'err');
    startBtn.classList.remove('hidden');
    startBtn.disabled = false;
    againBtn.classList.add('hidden');
    openBtn.classList.add('hidden');
  }
  againBtn.addEventListener('click', () => {
    startBtn.classList.remove('hidden');
    againBtn.classList.add('hidden');
    openBtn.classList.add('hidden');
    startBtn.click();
  });
  openBtn.addEventListener('click', () => {
    if (lastDownloadId == null) return;
    try { chrome.downloads.show(lastDownloadId); } catch (e) { /* ignore */ }
  });

  // Initial state
  if (!candidates.length) {
    setStatus('No stream was passed to this page. Open it from the player.', 'err');
    startBtn.disabled = true;
  } else {
    setStatus('Ready. Press Download to start.', '');
  }

  // ------------------------------------------------------------------
  // Permissions — segment CDNs differ per server, so ask for https/http.
  // ------------------------------------------------------------------
  const ALL_ORIGINS = ['https://*/*', 'http://*/*'];
  async function ensurePermission() {
    try {
      if (await chrome.permissions.contains({ origins: ALL_ORIGINS })) return true;
      return await chrome.permissions.request({ origins: ALL_ORIGINS });
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------------
  // Playlist parsing
  // ------------------------------------------------------------------
  function resolveUrl(u, base) {
    try { return new URL(u, base).href; } catch (e) { return u; }
  }

  function parseAttributes(str) {
    const out = {};
    const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
    let m;
    while ((m = re.exec(str))) out[m[1]] = m[2].replace(/^"|"$/g, '');
    return out;
  }

  function parseMaster(text, base) {
    const audioRenditions = {}; // groupId → URI
    const variants = [];
    const lines = text.split(/\r?\n/);
    for (const raw of lines) {
      const L = raw.trim();
      if (L.startsWith('#EXT-X-MEDIA')) {
        const a = parseAttributes(L.slice(13));
        if ((a.TYPE || '').toUpperCase() === 'AUDIO' && a['GROUP-ID'] && a.URI) {
          audioRenditions[a['GROUP-ID']] = resolveUrl(a.URI, base);
        }
      } else if (L.startsWith('#EXT-X-STREAM-INF')) {
        const a = parseAttributes(L.slice(L.indexOf(':') + 1));
        let j = lines.indexOf(L) + 1;
        while (j < lines.length && (lines[j].trim() === '' || lines[j].trim().startsWith('#'))) j++;
        if (j < lines.length) {
          variants.push({
            url: resolveUrl(lines[j].trim(), base),
            bandwidth: parseInt(a.BANDWIDTH || '0', 10),
            res: a.RESOLUTION || '',
            audioGroup: a.AUDIO || null
          });
        }
      }
    }
    variants.sort((x, y) => y.bandwidth - x.bandwidth);
    return { variants, audioRenditions };
  }

  function parseByteRange(spec, prevEnd) {
    if (!spec) return null;
    const at = spec.indexOf('@');
    let len, off;
    if (at === -1) { len = parseInt(spec, 10); off = prevEnd; }
    else { len = parseInt(spec.slice(0, at), 10); off = parseInt(spec.slice(at + 1), 10); }
    if (!len || isNaN(off) || off == null) return null;
    return { start: off, end: off + len - 1, next: off + len };
  }

  function parseMedia(text, base) {
    const segments = [];
    let key = null;
    let mediaSeq = 0;
    let pendingDur = 0;
    let pendingRange = null;
    let rangeCursor = null;
    let init = null;
    for (const raw of text.split(/\r?\n/)) {
      const L = raw.trim();
      if (!L) continue;
      if (L.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
        mediaSeq = parseInt(L.split(':')[1], 10) || 0;
      } else if (L.startsWith('#EXT-X-KEY')) {
        const a = parseAttributes(L.slice(11));
        if (!a.METHOD || a.METHOD === 'NONE') key = null;
        else {
          key = {
            method: a.METHOD,
            keyUri: a.URI ? resolveUrl(a.URI, base) : null,
            iv: a.IV || null
          };
        }
      } else if (L.startsWith('#EXT-X-MAP')) {
        const a = parseAttributes(L.slice(11));
        init = { url: resolveUrl(a.URI, base), range: a.BYTERANGE || null };
      } else if (L.startsWith('#EXTINF')) {
        pendingDur = parseFloat(L.split(':')[1]) || 0;
      } else if (L.startsWith('#EXT-X-BYTERANGE')) {
        pendingRange = L.split(':')[1];
      } else if (!L.startsWith('#')) {
        const range = parseByteRange(pendingRange, rangeCursor);
        rangeCursor = range ? range.next : null;
        pendingRange = null;
        segments.push({
          url: resolveUrl(L, base),
          seq: mediaSeq + segments.length,
          key: key ? { method: key.method, keyUri: key.keyUri, iv: key.iv } : null,
          range: range,
          duration: pendingDur
        });
      }
    }
    return { segments: segments, init: init };
  }

  // ------------------------------------------------------------------
  // Fetching + decryption
  // ------------------------------------------------------------------
  async function fetchText(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }

  const keyCache = new Map();
  async function loadKey(keyUri) {
    if (keyCache.has(keyUri)) return keyCache.get(keyUri);
    const r = await fetch(keyUri);
    if (!r.ok) throw new Error('key HTTP ' + r.status);
    const bytes = new Uint8Array(await r.arrayBuffer());
    keyCache.set(keyUri, bytes);
    return bytes;
  }

  function hexToBytes(hex) {
    const h = hex.replace(/^0x/i, '');
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) out[i] = parseInt(h.substr(i * 2, 2), 16) || 0;
    return out;
  }

  function seqToIv(seq) {
    const iv = new Uint8Array(16);
    let s = seq;
    for (let i = 15; i >= 0 && s > 0; i--) { iv[i] = s & 0xff; s = Math.floor(s / 256); }
    return iv;
  }

  async function fetchOne(seg) {
    const init = seg.range ? { headers: { Range: 'bytes=' + seg.range.start + '-' + seg.range.end } } : undefined;
    const r = await fetch(seg.url, init);
    if (!r.ok) throw new Error('segment HTTP ' + r.status);
    let data = new Uint8Array(await r.arrayBuffer());
    if (seg.key) {
      if (seg.key.method !== 'AES-128') throw new Error('Unsupported encryption: ' + seg.key.method);
      const rawKey = await loadKey(seg.key.keyUri);
      const iv = seg.key.iv ? hexToBytes(seg.key.iv) : seqToIv(seg.seq || 0);
      const ck = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, false, ['decrypt']);
      data = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv }, ck, data));
    }
    return data;
  }

  // ------------------------------------------------------------------
  // ISOBMFF toolkit + fMP4 muxer (merges demuxed video/audio renditions)
  // ------------------------------------------------------------------
  function concatBytes(list) {
    let total = 0;
    for (const a of list) total += a.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const a of list) { out.set(a, p); p += a.length; }
    return out;
  }
  function readU32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function writeU32(b, o, v) {
    b[o] = (v >>> 24) & 0xff; b[o + 1] = (v >>> 16) & 0xff;
    b[o + 2] = (v >>> 8) & 0xff; b[o + 3] = v & 0xff;
  }
  function readBoxes(buf, start, end) {
    const out = [];
    let p = start || 0;
    end = end == null ? buf.length : end;
    while (p + 8 <= end) {
      let size = readU32(buf, p);
      const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
      let hdr = 8;
      if (size === 1) {
        const hi = readU32(buf, p + 8), lo = readU32(buf, p + 12);
        size = hi * 4294967296 + lo;
        hdr = 16;
      } else if (size === 0) {
        size = end - p;
      }
      if (size < hdr || p + size > end) return out; // corrupt — stop
      out.push({ type: type, start: p, size: size, contentStart: p + hdr });
      p += size;
    }
    return out;
  }
  function children(box, buf) { return readBoxes(buf, box.contentStart, box.start + box.size); }
  function findAllIn(box, buf, type) { return children(box, buf).filter((b) => b.type === type); }
  function findFirstIn(box, buf, type) { return children(box, buf).find((b) => b.type === type) || null; }
  function sliceBox(box, buf) { return buf.subarray(box.start, box.start + box.size); }

  function analyzeTrak(trakBox, buf) {
    const tkhd = findFirstIn(trakBox, buf, 'tkhd');
    if (!tkhd) return null;
    const cs = tkhd.contentStart;
    const version = buf[cs];
    const idOff = cs + 4 + (version ? 16 : 8); // ctime+mtime are 8 bytes each in v1
    const id = readU32(buf, idOff);
    const mdia = findFirstIn(trakBox, buf, 'mdia');
    let handler = '';
    if (mdia) {
      const hdlr = findFirstIn(mdia, buf, 'hdlr');
      if (hdlr) handler = String.fromCharCode(buf[hdlr.contentStart + 8], buf[hdlr.contentStart + 9], buf[hdlr.contentStart + 10], buf[hdlr.contentStart + 11]);
    }
    return { box: trakBox, id: id, idOff: idOff, handler: handler };
  }

  // Build a dual-track moov from the video and audio init segments.
  function buildMergedMoov(videoInit, audioInit, totalDurationSec) {
    const vMoov = readBoxes(videoInit).find((b) => b.type === 'moov');
    const aMoov = readBoxes(audioInit).find((b) => b.type === 'moov');
    if (!vMoov || !aMoov) throw new Error('init segments missing moov');
    const vTraks = findAllIn(vMoov, videoInit, 'trak').map((t) => analyzeTrak(t, videoInit));
    const aTraks = findAllIn(aMoov, audioInit, 'trak').map((t) => analyzeTrak(t, audioInit));
    const vTrak = vTraks.find((t) => t && t.handler === 'vide') || vTraks[0];
    const aTrak = aTraks.find((t) => t && t.handler === 'soun') || aTraks[0];
    if (!vTrak || !aTrak) throw new Error('traks not found');

    let audioPatchedInit = null;
    let audioNewId = aTrak.id;
    if (vTraks.some((t) => t && t.id === aTrak.id)) {
      audioNewId = Math.max.apply(null, vTraks.map((t) => t.id).concat([aTrak.id])) + 1;
      audioPatchedInit = new Uint8Array(audioInit); // copy for patching
      writeU32(audioPatchedInit, aTrak.idOff, audioNewId);
    }

    // mvex (mandatory for fragmented MP4): collect trex from both, patch ids.
    let mvexParts = [];
    const vMvex = findFirstIn(vMoov, videoInit, 'mvex');
    const aMvex = findFirstIn(aMoov, audioPatchedInit || audioInit, 'mvex');
    if (vMvex) for (const t of findAllIn(vMvex, videoInit, 'trex')) mvexParts.push(new Uint8Array(sliceBox(t, videoInit)));
    if (aMvex) {
      const aInit2 = audioPatchedInit || audioInit;
      for (const t of findAllIn(aMvex, aInit2, 'trex')) {
        const tb = new Uint8Array(sliceBox(t, aInit2));
        writeU32(tb, 8 + 4, audioNewId); // trex: version+flags(4) then track_ID(4)
        mvexParts.push(tb);
      }
    }
    if (!mvexParts.length) throw new Error('no trex boxes');
    const mvexBody = concatBytes(mvexParts);
    const mvexFull = concatBytes([u32box('mvex', mvexBody.length), mvexBody]);

    // mvhd from the video init, duration patched to the full runtime.
    const vMvhd = findFirstIn(vMoov, videoInit, 'mvhd');
    if (!vMvhd) throw new Error('no mvhd');
    const mvhdBuf = new Uint8Array(sliceBox(vMvhd, videoInit));
    const version = mvhdBuf[8];
    const tsOff = 8 + 4 + (version ? 16 : 8); // skip version+flags+ctime+mtime
    const timescale = readU32(mvhdBuf, tsOff) || 1000;
    writeU32(mvhdBuf, tsOff + 4, Math.floor(totalDurationSec * timescale));

    const vTrakBytes = new Uint8Array(sliceBox(vTrak.box, videoInit));
    const aTrakBytes = new Uint8Array(sliceBox(aTrak.box, audioPatchedInit || audioInit));
    const moovBody = concatBytes([mvhdBuf, vTrakBytes, aTrakBytes, mvexFull]);
    const moovFull = concatBytes([u32box('moov', moovBody.length), moovBody]);

    const ftypBox = readBoxes(videoInit).find((b) => b.type === 'ftyp');
    const ftypFull = ftypBox ? new Uint8Array(sliceBox(ftypBox, videoInit))
      : concatBytes([new Uint8Array([0, 0, 0, 24]), strBytes('ftypisom\x00\x00\x02\x00isomiso2avc1mp41')]);

    return { moov: moovFull, ftyp: ftypFull, audioNewId: audioNewId, videoId: vTrak.id };
  }
  function u32box(type, bodyLen) {
    const b = new Uint8Array(8);
    writeU32(b, 0, 8 + bodyLen);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    return b;
  }
  function strBytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // Patch a fragment: renumber mfhd sequence, force tfhd track id.
  function patchSegment(seg, trackId, seq) {
    const buf = new Uint8Array(seg); // copy
    const tops = readBoxes(buf);
    for (const top of tops) {
      if (top.type !== 'moof') continue;
      const mfhd = findFirstIn(top, buf, 'mfhd');
      if (mfhd) writeU32(buf, mfhd.contentStart + 4, seq);
      for (const traf of findAllIn(top, buf, 'traf')) {
        const tfhd = findFirstIn(traf, buf, 'tfhd');
        if (tfhd) writeU32(buf, tfhd.contentStart + 4, trackId);
      }
    }
    return buf;
  }

  // ------------------------------------------------------------------
  // Output: File System Access first, Blob fallback second
  // ------------------------------------------------------------------
  async function pickFile(suggestedName) {
    if (!window.showSaveFilePicker) return null;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggestedName,
        types: [{ description: 'Video', accept: { 'video/mp4': ['.mp4'], 'video/mp2t': ['.ts'] } }]
      });
      return await handle.createWritable();
    } catch (e) {
      return null; // user cancelled the picker or API unavailable
    }
  }

  function finishBlob(chunks, mime, ext, suffix) {
    const blob = new Blob(chunks, { type: mime });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url: url,
      filename: 'PlayNext/' + title + (suffix || '') + '.' + ext,
      saveAs: true
    }, (id) => {
      if (chrome.runtime.lastError) {
        failWith('Save failed: ' + chrome.runtime.lastError.message);
        return;
      }
      lastDownloadId = id;
      openBtn.classList.remove('hidden');
    });
  }

  // Sidecar subtitle (OpenSubtitles addon — the same source the player uses
  // for fallback subs). Saved next to the download so VLC/mpv auto-load it.
  async function saveSubtitleSidecar() {
    if (!imdbId || !/^tt\d+$/.test(imdbId)) return null;
    try {
      const res = await fetch(`https://opensubtitles-v3.strem.io/subtitles/${isTv ? 'tv' : 'movie'}/${imdbId}`);
      if (!res.ok) return null;
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.subtitles) ? data.subtitles : []);
      const pick = list.find((s) => s && s.url && (s.lang || '').toLowerCase().startsWith('en')) || (list[0] && list[0].url ? list[0] : null);
      if (pick && pick.url) {
        const sub = await fetch(pick.url);
        const text = await sub.text();
        const blob = new Blob([text], { type: 'text/plain' });
        chrome.downloads.download({
          url: URL.createObjectURL(blob),
          filename: 'PlayNext/' + title + '.en.srt',
          saveAs: false
        });
        return ' Subtitle saved to Downloads/PlayNext/ — keep it next to the video for auto-load.';
      }
    } catch (e) { /* subtitles are best effort */ }
    return null;
  }

  // ------------------------------------------------------------------
  // Main flows
  // ------------------------------------------------------------------
  async function downloadMp4(url) {
    setRunning(true);
    showProgress(true);
    setProgress(0);
    setStatus('Requesting the file', 'busy');
    const started = Date.now();
    const writable = await pickFile(title + '.mp4');
    const chunks = [];
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = parseInt(res.headers.get('content-length') || '0', 10);
    let got = 0;
    const reader = res.body.getReader();
    while (true) {
      if (cancelled) { reader.cancel(); break; }
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (writable) await writable.write({ type: 'write', data: value });
      else chunks.push(value);
      const elapsed = Math.max(0.001, (Date.now() - started) / 1000);
      const speed = got / elapsed;
      setSpeed(fmtMB(speed) + '/s');
      if (total) {
        setProgress((got / total) * 100);
        setDetail(fmtMB(got) + ' of ' + fmtMB(total));
        setEta(fmtTime((total - got) / speed));
      } else {
        setDetail(fmtMB(got));
      }
    }
    if (writable) await writable.close();
    if (cancelled) {
      setRunning(false);
      setStatus('Cancelled. The partial file was kept where you saved it.');
      return;
    }
    setProgress(100);
    setDetail(fmtMB(got));
    setSpeed('');
    setEta('');
    if (!writable) finishBlob(chunks, 'video/mp4', 'mp4');
    const subNote = await saveSubtitleSidecar();
    finishOk('Saved ' + title + '.mp4 with video and audio.' + (subNote || ''));
  }

  // Single rendition (video-only or audio-only) download — TS concat or fMP4
  // init+fragments passthrough.
  async function downloadTrack(media, ext, mime, suffix, label) {
    setRunning(true);
    showProgress(true);
    setProgress(0);
    const segs = media.segments;
    const started = Date.now();
    const writable = await pickFile(title + suffix + '.' + ext);
    if (!writable) setStatus('Saving the ' + label + ' to a temp file. A save dialog appears at the end.', 'busy');
    else setStatus('Downloading the ' + label, 'busy');
    const totalDur = segs.reduce((s, x) => s + (x.duration || 0), 0);
    let doneDur = 0;
    let bytes = 0;
    const chunks = [];

    if (media.init) {
      const data = await fetchOne({ url: media.init.url, seq: 0, range: media.init.range ? parseByteRange(media.init.range, null) : null });
      if (writable) await writable.write({ type: 'write', data: data });
      else chunks.push(data);
      bytes += data.length;
    }

    const PREFETCH = 4;
    let fetchIdx = 0;
    const pending = new Map();
    function ensureAhead(writeIdx) {
      while (fetchIdx < segs.length && fetchIdx < writeIdx + PREFETCH) {
        const i = fetchIdx++;
        pending.set(i, fetchOne(segs[i]));
      }
    }

    for (let i = 0; i < segs.length; i++) {
      if (cancelled) break;
      ensureAhead(i);
      const data = await pending.get(i);
      pending.delete(i);
      if (writable) await writable.write({ type: 'write', data: data });
      else chunks.push(data);
      bytes += data.length;
      doneDur += segs[i].duration || 0;
      const pct = totalDur ? (doneDur / totalDur) * 100 : ((i + 1) / segs.length) * 100;
      const elapsed = Math.max(0.001, (Date.now() - started) / 1000);
      const speed = bytes / elapsed;
      setProgress(pct);
      setDetail(fmtMB(bytes) + ' · segment ' + (i + 1) + ' of ' + segs.length);
      setSpeed(fmtMB(speed) + '/s');
      if (totalDur) setEta(fmtTime((totalDur - doneDur) / (doneDur / Math.max(0.001, elapsed))));
    }

    if (cancelled) {
      if (writable) { try { await writable.close(); } catch (e) { /* ignore */ } }
      setRunning(false);
      setStatus('Cancelled. The partial file was kept where you saved it.');
      return;
    }
    if (writable) await writable.close();
    else finishBlob(chunks, mime, ext, suffix);
    setRunning(false);
  }

  // The main event: merge a video rendition and its separate audio rendition
  // (both fMP4) into one proper .mp4 file.
  async function downloadMuxed(vMedia, aMedia, audioUrl) {
    setRunning(true);
    showProgress(true);
    setProgress(0);
    const segs = vMedia.segments;
    const totalDur = Math.max(
      segs.reduce((s, x) => s + (x.duration || 0), 0),
      aMedia.segments.reduce((s, x) => s + (x.duration || 0), 0)
    );
    const started = Date.now();

    setStatus('Preparing the video and audio tracks', 'busy');
    const vInit = await fetchOne({ url: vMedia.init.url, seq: 0, range: vMedia.init.range ? parseByteRange(vMedia.init.range, null) : null });
    const aInit = await fetchOne({ url: aMedia.init.url, seq: 0, range: aMedia.init.range ? parseByteRange(aMedia.init.range, null) : null });
    const merged = buildMergedMoov(vInit, aInit, totalDur);

    const writable = await pickFile(title + '.mp4');
    if (!writable) setStatus('Building the file in memory. A save dialog appears at the end.', 'busy');
    else setStatus('Downloading video and audio', 'busy');
    const chunks = [];
    let bytes = merged.ftyp.length + merged.moov.length;
    if (writable) {
      await writable.write({ type: 'write', data: merged.ftyp });
      await writable.write({ type: 'write', data: merged.moov });
    } else {
      chunks.push(merged.ftyp, merged.moov);
    }

    const n = Math.max(segs.length, aMedia.segments.length);
    const PREFETCH = 2; // pairs
    let pairIdx = 0;
    const pendingPairs = new Map();
    function ensureAhead(writeIdx) {
      while (pairIdx < n && pairIdx < writeIdx + PREFETCH) {
        const i = pairIdx++;
        const vs = segs[i] ? fetchOne(segs[i]).catch(() => null) : Promise.resolve(null);
        const as = aMedia.segments[i] ? fetchOne(aMedia.segments[i]).catch(() => null) : Promise.resolve(null);
        pendingPairs.set(i, Promise.all([vs, as]));
      }
    }

    let seq = 1;
    for (let i = 0; i < n; i++) {
      if (cancelled) break;
      ensureAhead(i);
      const pair = await pendingPairs.get(i);
      pendingPairs.delete(i);
      const vData = pair[0], aData = pair[1];
      if (!vData && !aData) continue; // both failed — skip pair
      if (vData) {
        const p = patchSegment(vData, merged.videoId, seq++);
        if (writable) await writable.write({ type: 'write', data: p });
        else chunks.push(p);
        bytes += p.length;
      }
      if (aData) {
        const p = patchSegment(aData, merged.audioNewId, seq++);
        if (writable) await writable.write({ type: 'write', data: p });
        else chunks.push(p);
        bytes += p.length;
      }
      const doneDur = Math.min(i + 1, segs.length) * (segs[i] ? segs[i].duration : 0) || ((i + 1) / n) * totalDur;
      const pct = totalDur ? (Math.min(i + 1, n) / n) * 100 : 0;
      const elapsed = Math.max(0.001, (Date.now() - started) / 1000);
      const speed = bytes / elapsed;
      setProgress(pct);
      setDetail(fmtMB(bytes) + ' · segment ' + (i + 1) + ' of ' + n);
      setSpeed(fmtMB(speed) + '/s');
      if (totalDur) setEta(fmtTime((totalDur - doneDur) / (doneDur / Math.max(0.001, elapsed))));
    }

    if (cancelled) {
      if (writable) { try { await writable.close(); } catch (e) { /* ignore */ } }
      setRunning(false);
      setStatus('Cancelled. The partial file was kept where you saved it.');
      return;
    }
    if (writable) await writable.close();
    else finishBlob(chunks, 'video/mp4', 'mp4', '');
    setProgress(100);
    setDetail(fmtMB(bytes));
    setSpeed('');
    setEta('');
    const subNote = await saveSubtitleSidecar();
    finishOk('Saved ' + title + '.mp4 with video and audio.' + (subNote || ''));
  }

  async function downloadVariant(variantUrl, audioUrl) {
    const media = parseMedia(await fetchText(variantUrl), variantUrl);
    const segs = media.segments;
    if (!segs.length) throw new Error('No segments found in playlist.');

    // fMP4 streams carry an init segment (#EXT-X-MAP). Segment filenames are
    // obfuscated on these servers, so the init presence is the reliable test.
    const isFmp4 = !!media.init;

    if (isFmp4 && audioUrl) {
      const aMedia = parseMedia(await fetchText(audioUrl), audioUrl);
      if (aMedia.segments.length) {
        await downloadMuxed(media, aMedia, audioUrl);
        return;
      }
    }

    if (isFmp4) {
      await downloadTrack(media, 'mp4', 'video/mp4', '', 'video');
    } else {
      await downloadTrack(media, 'ts', 'video/mp2t', '', 'video');
      // TS with a separate audio rendition: save the audio as a second file.
      if (audioUrl && !cancelled) {
        const aMedia = parseMedia(await fetchText(audioUrl), audioUrl);
        if (aMedia.segments.length) {
          setStatus('Video saved. Now saving the separate audio track.', 'busy');
          await downloadTrack(aMedia, 'ts', 'video/mp2t', ' (audio)', 'audio track');
          const subNote = await saveSubtitleSidecar();
          finishOk('Saved the video and the audio track as two files.' + (subNote || ''));
          return;
        }
      }
    }
    const subNote = await saveSubtitleSidecar();
    finishOk('Download finished.' + (subNote || ''));
  }

  // Runs the download with the chosen quality.
  async function runDownload() {
    const v = variants[+qualitySel.value || 0];
    const audioUrl = v.audioGroup ? audioRenditions[v.audioGroup] : null;
    await downloadVariant(v.url, audioUrl);
  }

  startBtn.addEventListener('click', async () => {
    if (running) return;
    startBtn.disabled = true;
    cancelled = false;
    try {
      if (!candidates.length) throw new Error('No stream URL was passed.');

      // Quality already picked (or only one available): go straight to work.
      if (picked && variants && variants.length) {
        setRunning(true);
        await runDownload();
        return;
      }

      setStatus('Requesting network permission', 'busy');
      const ok = await ensurePermission();
      if (!ok) { failWith('Permission denied, so the download cannot run.'); return; }

      // Direct MP4?
      const mp4 = candidates.find((c) => c.kind === 'mp4' || /\.mp4(\?|$)/i.test(c.url.split('?')[0]));
      if (mp4) { setRunning(true); await downloadMp4(mp4.url); return; }

      // HLS: find a master playlist (gives quality options), else a media playlist.
      let master = null;
      let mediaSingle = null;
      let lastErr = null;
      for (const c of candidates) {
        if (cancelled) break;
        try {
          const text = await fetchText(c.url);
          if (text.includes('#EXT-X-STREAM-INF')) { master = { url: c.url, text: text }; break; }
          if (text.includes('#EXTINF') && !mediaSingle) mediaSingle = c.url;
        } catch (e) { lastErr = e; }
      }
      if (cancelled) { setRunning(false); setStatus('Cancelled.'); return; }

      if (master) {
        const parsed = parseMaster(master.text, master.url);
        variants = parsed.variants;
        audioRenditions = parsed.audioRenditions;
        if (variants.length > 1) {
          qualitySel.innerHTML = '';
          variants.forEach((v, i) => {
            const o = document.createElement('option');
            o.value = String(i);
            o.textContent = (v.res ? v.res + ' · ' : '') + (v.bandwidth ? Math.round(v.bandwidth / 1000) + ' kbps' : 'variant ' + (i + 1));
            qualitySel.appendChild(o);
          });
          qualityHint.textContent = variants.length + ' qualities available. The highest is selected by default.';
          qualityWrap.classList.remove('hidden');
          picked = true;
          setRunning(false);
          startBtn.disabled = false;
          setStatus('Pick a quality, then press Download.', 'busy');
          return;
        }
        const v = variants.length ? variants[0] : { url: master.url, audioGroup: null };
        variants = [v];
        picked = true;
        setRunning(true);
        await runDownload();
        return;
      }

      if (mediaSingle) {
        variants = [{ url: mediaSingle, audioGroup: null }];
        picked = true;
        setRunning(true);
        await runDownload();
        return;
      }
      throw lastErr || new Error('Could not read a playlist from the given URLs.');
    } catch (e) {
      failWith(e.message || String(e));
    }
  });
})();
