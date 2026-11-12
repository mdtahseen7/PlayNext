// PlayNext MP4 muxer.
//
// Merges the demuxed tracks of a fragmented MP4 HLS stream into a single
// playable file:
//   - video rendition + separate audio rendition  -> one MP4 with both tracks
//   - optional subtitle track (SRT cues)         -> a real mov_text track
//
// The box layout was validated against ffmpeg output (ffprobe reads the
// result, ffmpeg decodes every stream and can extract the subtitles back).
//
// Runs in the browser (window.PlayNextMuxer) and in Node (module.exports)
// so the exact same code can be tested outside the extension.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlayNextMuxer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------
  // Byte helpers
  // ---------------------------------------------------------------
  function concatBytes(list) {
    let total = 0;
    for (const a of list) total += a.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const a of list) { out.set(a, p); p += a.length; }
    return out;
  }
  function readU32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function readU64(b, o) { return b[o] * 4294967296 + readU32(b, o + 4); }
  function writeU32(b, o, v) {
    b[o] = (v >>> 24) & 0xff; b[o + 1] = (v >>> 16) & 0xff;
    b[o + 2] = (v >>> 8) & 0xff; b[o + 3] = v & 0xff;
  }
  function writeU64(b, o, v) {
    const hi = Math.floor(v / 4294967296);
    writeU32(b, o, hi >>> 0);
    writeU32(b, o + 4, v >>> 0);
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
  function hexBytes(hex) {
    const h = hex.replace(/\s+/g, '');
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  function u16(v) { return new Uint8Array([(v >>> 8) & 0xff, v & 0xff]); }

  // ---------------------------------------------------------------
  // ISOBMFF box toolkit
  // ---------------------------------------------------------------
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
      if (size < hdr || p + size > end) return out; // corrupt, stop
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
    const idOff = cs + 4 + (version ? 16 : 8); // ctime + mtime are 8 bytes each in v1
    const id = readU32(buf, idOff);
    const mdia = findFirstIn(trakBox, buf, 'mdia');
    let handler = '';
    if (mdia) {
      const hdlr = findFirstIn(mdia, buf, 'hdlr');
      if (hdlr) handler = String.fromCharCode(buf[hdlr.contentStart + 8], buf[hdlr.contentStart + 9], buf[hdlr.contentStart + 10], buf[hdlr.contentStart + 11]);
    }
    return { box: trakBox, id: id, idOff: idOff, handler: handler };
  }

  // ---------------------------------------------------------------
  // Subtitle track (mov_text / tx3g)
  // ---------------------------------------------------------------

  // Sample description for a tx3g track, byte compatible with what ffmpeg
  // writes: one tx3g entry with an Arial font table.
  const TX3G_STSD_HEX =
    '0000005073747364000000000000000100000040747833670000000000000001' +
    '000001ff000000ff000000000000000000010010ffffffff00000012667461620001' +
    '000105417269616c';

  // Identity display matrix.
  const MATRIX = [
    0x00010000, 0, 0,
    0, 0x00010000, 0,
    0, 0, 0x40000000
  ];

  function buildSubtitleTrak(trackId, timescale) {
    // tkhd
    const tkhdBody = new Uint8Array(84);
    writeU32(tkhdBody, 0, 0x00000007); // enabled | in movie | in preview
    writeU32(tkhdBody, 12, trackId);
    // matrix at offset 40
    for (let i = 0; i < 9; i++) writeU32(tkhdBody, 40 + i * 4, MATRIX[i]);
    const tkhd = concatBytes([u32box('tkhd', tkhdBody.length), tkhdBody]);

    // mdhd
    const mdhdBody = new Uint8Array(24);
    writeU32(mdhdBody, 0, 0);
    writeU32(mdhdBody, 12, timescale);
    writeU32(mdhdBody, 16, 0x000055c4); // 'und'
    const mdhd = concatBytes([u32box('mdhd', mdhdBody.length), mdhdBody]);

    // hdlr
    const name = strBytes('PlayNext\0');
    const hdlrBody = new Uint8Array(24 + name.length);
    writeU32(hdlrBody, 8, 0x7362746c); // 'sbtl'
    hdlrBody.set(name, 24);
    const hdlr = concatBytes([u32box('hdlr', hdlrBody.length), hdlrBody]);

    // nmhd
    const nmhd = concatBytes([u32box('nmhd', 4), new Uint8Array(4)]);

    // dinf -> dref -> one self contained url entry
    const urlEntry = concatBytes([u32box('url ', 4), new Uint8Array([0, 0, 0, 1])]);
    const drefBody = concatBytes([new Uint8Array(4), new Uint8Array([0, 0, 0, 1]), urlEntry]);
    const dref = concatBytes([u32box('dref', drefBody.length), drefBody]);
    const dinf = concatBytes([u32box('dinf', dref.length), dref]);

    // stbl (fragmented track: the sample tables stay empty)
    const stsd = hexBytes(TX3G_STSD_HEX);
    const emptyCount = concatBytes([new Uint8Array(4), new Uint8Array(4)]);
    const stts = concatBytes([u32box('stts', emptyCount.length), emptyCount]);
    const stsc = concatBytes([u32box('stsc', emptyCount.length), emptyCount]);
    const stszBody = new Uint8Array(8);
    const stsz = concatBytes([u32box('stsz', stszBody.length), stszBody]);
    const stco = concatBytes([u32box('stco', emptyCount.length), emptyCount]);
    const stblBody = concatBytes([stsd, stts, stsc, stsz, stco]);
    const stbl = concatBytes([u32box('stbl', stblBody.length), stblBody]);

    const minfBody = concatBytes([nmhd, dinf, stbl]);
    const minf = concatBytes([u32box('minf', minfBody.length), minfBody]);
    const mdiaBody = concatBytes([mdhd, hdlr, minf]);
    const mdia = concatBytes([u32box('mdia', mdiaBody.length), mdiaBody]);
    const trakBody = concatBytes([tkhd, mdia]);
    return concatBytes([u32box('trak', trakBody.length), trakBody]);
  }

  function buildSubtitleTrex(trackId) {
    const body = new Uint8Array(24);
    writeU32(body, 4, trackId);
    writeU32(body, 8, 1); // default sample description index
    return concatBytes([u32box('trex', body.length), body]);
  }

  // A tx3g sample is a 16 bit length followed by the UTF-8 text.
  function tx3gSample(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      const c = text.codePointAt(i);
      if (c > 0xffff) {
        i++;
        bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else if (c > 0x7ff) {
        bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else {
        bytes.push(c & 0xff);
      }
    }
    const len = bytes.length > 0xffff ? 0xffff : bytes.length;
    const out = new Uint8Array(2 + len);
    out[0] = (len >>> 8) & 0xff;
    out[1] = len & 0xff;
    for (let i = 0; i < len; i++) out[2 + i] = bytes[i];
    return out;
  }

  // Build one subtitle fragment (moof + mdat) for the cues inside a window.
  // windowStart / windowEnd are in seconds.
  function buildSubtitleFragment(cues, trackId, timescale, windowStart, windowEnd, seq) {
    const inWindow = cues.filter((c) => c.start < windowEnd && c.end > windowStart);
    if (!inWindow.length) return null;

    const samples = [];
    let cursor = windowStart;
    for (const cue of inWindow) {
      if (cue.start > cursor + 0.01) {
        // Gap: an empty sample keeps the timeline honest.
        const gapMs = Math.round((cue.start - cursor) * timescale);
        if (gapMs > 0) samples.push({ dur: gapMs, data: tx3gSample('') });
      }
      const durMs = Math.max(1, Math.round((cue.end - cue.start) * timescale));
      samples.push({ dur: durMs, data: tx3gSample(cue.text) });
      cursor = Math.max(cursor, cue.end);
    }
    if (!samples.length) return null;

    const payload = concatBytes(samples.map((s) => s.data));

    // trun: data offset + duration + size + flags per sample
    const trunBody = new Uint8Array(12 + samples.length * 12);
    writeU32(trunBody, 0, 0x00000701); // data-offset | duration | size | flags
    writeU32(trunBody, 4, samples.length);
    // data offset patched after the moof size is known
    let p = 12;
    for (const s of samples) {
      writeU32(trunBody, p, s.dur); p += 4;
      writeU32(trunBody, p, s.data.length); p += 4;
      writeU32(trunBody, p, s.data.length ? 0x02000000 : 0x01010000); p += 4;
    }
    const trun = concatBytes([u32box('trun', trunBody.length), trunBody]);

    // tfhd: default base is moof, sample description index present
    const tfhdBody = new Uint8Array(12);
    writeU32(tfhdBody, 0, 0x020002);
    writeU32(tfhdBody, 4, trackId);
    writeU32(tfhdBody, 8, 1);
    const tfhd = concatBytes([u32box('tfhd', tfhdBody.length), tfhdBody]);

    // tfdt: version 1 with a 64 bit base media decode time
    const tfdtBody = new Uint8Array(12);
    tfdtBody[0] = 1;
    const baseTime = BigInt(Math.round(windowStart * timescale));
    writeU32(tfdtBody, 4, Number((baseTime >> BigInt(32)) & BigInt(0xffffffff)));
    writeU32(tfdtBody, 8, Number(baseTime & BigInt(0xffffffff)));
    const tfdt = concatBytes([u32box('tfdt', tfdtBody.length), tfdtBody]);

    const trafBody = concatBytes([tfhd, tfdt, trun]);
    const traf = concatBytes([u32box('traf', trafBody.length), trafBody]);

    const mfhdBody = new Uint8Array(8);
    writeU32(mfhdBody, 4, seq);
    const mfhd = concatBytes([u32box('mfhd', mfhdBody.length), mfhdBody]);

    const moofBody = concatBytes([mfhd, traf]);
    const moof = concatBytes([u32box('moof', moofBody.length), moofBody]);

    // The trun data offset points at the mdat payload, relative to the moof.
    const dataOffset = moof.length + 8;
    writeU32(trunBody, 8, dataOffset);
    // trun was already copied into moofBody, so rebuild it with the offset.
    const trunFixed = concatBytes([u32box('trun', trunBody.length), trunBody]);
    const trafBody2 = concatBytes([tfhd, tfdt, trunFixed]);
    const traf2 = concatBytes([u32box('traf', trafBody2.length), trafBody2]);
    const moofBody2 = concatBytes([mfhd, traf2]);
    const moof2 = concatBytes([u32box('moof', moofBody2.length), moofBody2]);
    // The offset changed the moof size? No: the trun body length is the same.

    const mdat = concatBytes([u32box('mdat', payload.length), payload]);
    return { moof: moof2, mdat: mdat };
  }

  // ---------------------------------------------------------------
  // Merged moov
  // ---------------------------------------------------------------
  // Build a multi track moov from the video and audio init segments and an
  // optional subtitle track id.
  function buildMergedMoov(videoInit, audioInit, totalDurationSec, subTrackId, subTimescale) {
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

    // mvex: collect the trex of both inits and patch the ids.
    const mvexParts = [];
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
    if (subTrackId != null) mvexParts.push(buildSubtitleTrex(subTrackId));
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
    const parts = [mvhdBuf, vTrakBytes, aTrakBytes];
    if (subTrackId != null) parts.push(buildSubtitleTrak(subTrackId, subTimescale || 1000));
    parts.push(mvexFull); // mvex must be part of the moov
    const moovBody = concatBytes(parts);
    const moovFull = concatBytes([u32box('moov', moovBody.length), moovBody]);

    const ftypBox = readBoxes(videoInit).find((b) => b.type === 'ftyp');
    const ftypFull = ftypBox ? new Uint8Array(sliceBox(ftypBox, videoInit))
      : concatBytes([new Uint8Array([0, 0, 0, 24]), strBytes('ftypisom\x00\x00\x02\x00isomiso2avc1mp41')]);

    return { moov: moovFull, ftyp: ftypFull, audioNewId: audioNewId, videoId: vTrak.id };
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

  // ---------------------------------------------------------------
  // SRT parsing
  // ---------------------------------------------------------------
  function stripTags(s) {
    return s
      .replace(/<\/?(i|b|u|font|ruby|rt)([^>]*)>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  function parseSrtCues(text) {
    const cues = [];
    if (!text) return cues;
    const blocks = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n{2,}/);
    for (const block of blocks) {
      const lines = block.split('\n').filter((l) => l.trim() !== '');
      if (!lines.length) continue;
      let i = 0;
      if (/^\d+$/.test(lines[0].trim())) i = 1;
      if (i >= lines.length) continue;
      const m = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(lines[i]);
      if (!m) continue;
      const start = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
      const end = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
      const body = stripTags(lines.slice(i + 1).join('\n'));
      if (!body) continue;
      cues.push({ start: start, end: Math.max(end, start + 0.3), text: body });
    }
    return cues;
  }

  // ---------------------------------------------------------------
  // Timescale handling
  // ---------------------------------------------------------------
  // The video and audio renditions of a stream often use different
  // timescales (for example 12800 and 44100). Players that mix both in one
  // file then compute a single duration from the largest timestamp of any
  // track, which makes the duration wrong. Putting every track on the same
  // timescale fixes that, so the audio track is rescaled onto the video one.

  function getTrackTimescale(init) {
    const moov = readBoxes(init).find((b) => b.type === 'moov');
    if (!moov) return 1000;
    for (const trak of findAllIn(moov, init, 'trak')) {
      const mdia = findFirstIn(trak, init, 'mdia');
      if (!mdia) continue;
      const mdhd = findFirstIn(mdia, init, 'mdhd');
      if (!mdhd) continue;
      const version = init[mdhd.contentStart];
      const off = mdhd.contentStart + 4 + (version ? 16 : 8);
      return version ? readU64(init, off) : readU32(init, off);
    }
    return 1000;
  }

  // Patch the timescale of a track inside an init segment.
  function rescaleInitTimescale(init, toTs) {
    const buf = new Uint8Array(init);
    const moov = readBoxes(buf).find((b) => b.type === 'moov');
    if (!moov) return buf;
    for (const trak of findAllIn(moov, buf, 'trak')) {
      const mdia = findFirstIn(trak, buf, 'mdia');
      if (!mdia) continue;
      const mdhd = findFirstIn(mdia, buf, 'mdhd');
      if (!mdhd) continue;
      const version = buf[mdhd.contentStart];
      const off = mdhd.contentStart + 4 + (version ? 16 : 8);
      if (version) writeU64(buf, off, toTs); else writeU32(buf, off, toTs);
    }
    return buf;
  }

  // Rescale one fragment from one timescale to another.
  // Sample durations are rescaled against the cumulative time so the error
  // never accumulates over a long movie.
  function rescaleFragmentTimescale(seg, fromTs, toTs) {
    if (fromTs === toTs) return new Uint8Array(seg);
    const buf = new Uint8Array(seg);
    const ratio = toTs / fromTs;
    for (const top of readBoxes(buf)) {
      if (top.type !== 'moof') continue;
      for (const traf of findAllIn(top, buf, 'traf')) {
        const kids = children(traf, buf);

        // tfdt: base media decode time
        const tfdt = kids.find((b) => b.type === 'tfdt');
        if (tfdt) {
          const version = buf[tfdt.contentStart];
          if (version === 1) {
            writeU64(buf, tfdt.contentStart + 4, Math.round(readU64(buf, tfdt.contentStart + 4) * ratio));
          } else {
            writeU32(buf, tfdt.contentStart + 4, Math.round(readU32(buf, tfdt.contentStart + 4) * ratio));
          }
        }

        // tfhd: default sample duration
        const tfhd = kids.find((b) => b.type === 'tfhd');
        if (tfhd) {
          const flags = readU32(buf, tfhd.contentStart) & 0xffffff;
          let p = tfhd.contentStart + 8;
          if (flags & 0x01) p += 4; // base data offset
          if (flags & 0x02) p += 4; // sample description index
          if (flags & 0x08) { // default sample duration
            writeU32(buf, p, Math.max(1, Math.round(readU32(buf, p) * ratio)));
            p += 4;
          }
        }

        // trun: per sample durations
        const trun = kids.find((b) => b.type === 'trun');
        if (trun) {
          const flags = readU32(buf, trun.contentStart) & 0xffffff;
          let p = trun.contentStart + 8;
          if (flags & 0x001) p += 4; // data offset
          if (flags & 0x004) p += 4; // first sample flags
          const count = readU32(buf, trun.contentStart + 4);
          if (flags & 0x100) {
            let cum = 0;
            let prevScaled = 0;
            for (let i = 0; i < count; i++) {
              const dur = readU32(buf, p);
              const scaledEnd = Math.round((cum + dur) * ratio);
              writeU32(buf, p, Math.max(1, scaledEnd - prevScaled));
              prevScaled = scaledEnd;
              cum += dur;
              p += 4;
            }
          }
        }
      }
    }
    return buf;
  }

  // Start time of a fragment in seconds.
  function getFragmentStart(seg, timescale) {
    for (const top of readBoxes(seg)) {
      if (top.type !== 'moof') continue;
      for (const traf of findAllIn(top, seg, 'traf')) {
        const tfdt = findFirstIn(traf, seg, 'tfdt');
        if (!tfdt) continue;
        const version = seg[tfdt.contentStart];
        const base = version === 1 ? readU64(seg, tfdt.contentStart + 4) : readU32(seg, tfdt.contentStart + 4);
        return base / timescale;
      }
    }
    return 0;
  }

  // Duration of a fragment in seconds (sum of the sample durations).
  function getFragmentDuration(seg, timescale) {
    let total = 0;
    for (const top of readBoxes(seg)) {
      if (top.type !== 'moof') continue;
      for (const traf of findAllIn(top, seg, 'traf')) {
        const kids = children(traf, seg);
        const tfhd = kids.find((b) => b.type === 'tfhd');
        let defDur = null;
        if (tfhd) {
          const flags = readU32(seg, tfhd.contentStart) & 0xffffff;
          let p = tfhd.contentStart + 8;
          if (flags & 0x01) p += 4;
          if (flags & 0x02) p += 4;
          if (flags & 0x08) { defDur = readU32(seg, p); p += 4; }
        }
        const trun = kids.find((b) => b.type === 'trun');
        if (!trun) continue;
        const flags = readU32(seg, trun.contentStart) & 0xffffff;
        let p = trun.contentStart + 8;
        if (flags & 0x001) p += 4;
        if (flags & 0x004) p += 4;
        const count = readU32(seg, trun.contentStart + 4);
        if (flags & 0x100) {
          for (let i = 0; i < count; i++) { total += readU32(seg, p); p += 4; }
        } else if (defDur) {
          total += defDur * count;
        }
      }
    }
    return total / timescale;
  }

  // The source segments carry styp/sidx boxes that describe the original
  // single segment file. In a merged file those indexes are meaningless and
  // players use them to work out the duration, which then comes out several
  // times too long. Dropping them keeps the timeline clean.
  function stripSegmentHeaders(seg) {
    const parts = [];
    for (const b of readBoxes(seg)) {
      if (b.type === 'styp' || b.type === 'sidx' || b.type === 'ssix') continue;
      parts.push(seg.subarray(b.start, b.start + b.size));
    }
    return concatBytes(parts);
  }

  return {
    concatBytes: concatBytes,
    readBoxes: readBoxes,
    buildMergedMoov: buildMergedMoov,
    patchSegment: patchSegment,
    buildSubtitleFragment: buildSubtitleFragment,
    parseSrtCues: parseSrtCues,
    tx3gSample: tx3gSample,
    getTrackTimescale: getTrackTimescale,
    rescaleInitTimescale: rescaleInitTimescale,
    rescaleFragmentTimescale: rescaleFragmentTimescale,
    getFragmentStart: getFragmentStart,
    getFragmentDuration: getFragmentDuration,
    stripSegmentHeaders: stripSegmentHeaders
  };
});
