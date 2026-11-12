(function () {
  const VIDNEST_URL = 'https://vidnest.fun';
  const TMDB_API_KEY = '61e2290429798c561450eb56b26de19b'; // public key also used by vidnest.fun's own frontend

  // IMDb -> TMDB id lookup (VidNest only accepts TMDB ids)
  const tmdbIdCache = {};

  function isTvType(mediaType) {
    return mediaType === 'video.tv_show' || mediaType === 'video.episode';
  }

  async function getTmdbId(imdbId, mediaType) {
    const cacheKey = `${isTvType(mediaType) ? 'tv' : 'movie'}:${imdbId}`;
    if (tmdbIdCache[cacheKey]) return tmdbIdCache[cacheKey];
    try {
      const res = await fetch(
        `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`
      );
      if (!res.ok) return null;
      const data = await res.json();
      const match = isTvType(mediaType)
        ? (data.tv_results || [])[0]
        : (data.movie_results || [])[0];
      const tmdbId = match && match.id ? match.id : null;
      if (tmdbId) tmdbIdCache[cacheKey] = tmdbId;
      return tmdbId;
    } catch (e) {
      console.error('[PlayNext] TMDB lookup failed:', e);
      return null;
    }
  }

  // SVG Icons
  const playIcon = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
  const closeIcon = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
  const newTabIcon = `<svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>`;
  const pipIcon = `<svg viewBox="0 0 24 24"><path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"/></svg>`;
  const dlIcon = `<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;

  let overlayElement = null;

  let extensionEnabled = true;
  let hasAutoPlayed = false;

  function init() {
    // Fetch initial setting
    chrome.storage.local.get({ enableExtension: true }, (settings) => {
      extensionEnabled = settings.enableExtension;
      if (extensionEnabled) {
        checkAndInject();

        if (!hasAutoPlayed && window.location.search.includes('play=1') && document.body) {
          const info = getImdbInfo();
          if (info) {
            hasAutoPlayed = true;
            openPlayer(info);
          }
        }
      } else {
        removeButton();
      }
    });

    // Observe documentElement for SPA navigations and immediate DOM stream
    const observer = new MutationObserver(() => {
      if (extensionEnabled) {
        checkAndInject();

        if (window.location.search.includes('play=1')) {
          if (!hasAutoPlayed && document.body) {
            const info = getImdbInfo();
            if (info) {
              hasAutoPlayed = true;
              openPlayer(info);
            }
          }
        } else {
          hasAutoPlayed = false;
        }
      } else {
        removeButton();
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function getImdbInfo() {
    const segments = window.location.pathname.split('/').filter(Boolean);
    if (segments.length < 2 || segments[0] !== 'title' || !segments[1].startsWith('tt')) {
      return null;
    }
    const imdb_id = segments[1];

    let media_type = 'movie'; // default to movie
    const ogTypeElement = document.querySelector('meta[property="og:type"]');
    if (ogTypeElement && ogTypeElement.content) {
      media_type = ogTypeElement.content;
    } else if (document.body && document.body.innerText.includes('TV Series')) {
      media_type = 'video.tv_show';
    }

    return { imdb_id, media_type };
  }

  function checkAndInject() {
    const info = getImdbInfo();
    if (!info) {
      removeButton();
      return;
    }

    if (document.querySelector('.play-next-btn-wrapper')) {
      return; // Already injected for this page state
    }

    injectButton(info);
  }

  function removeButton() {
    const btn = document.querySelector('.play-next-btn-wrapper');
    if (btn) btn.remove();
  }

  function scrapeMovieDetails(info) {
    const h1 = document.querySelector('h1');
    if (!h1) return null;
    const titleText = h1.innerText;
    const ratingSpan = document.querySelector('[data-testid="hero-rating-bar__aggregate-rating__score"] span');
    const rating = ratingSpan ? ratingSpan.innerText.replace(/\/10$/, '') : 'N/A';
    let runtime = '';
    const inlineLists = document.querySelectorAll('ul.ipc-inline-list');
    for (const ul of inlineLists) {
      const texts = [...ul.children].map(li => li.innerText.trim());
      const rt = texts.find(t => t.match(/^\d+h( \d+m)?$|^\d+m$/));
      if (rt) {
        runtime = rt;
        break;
      }
    }
    let genre = '';
    const genreContainer = document.querySelector('[data-testid="genres"]') || document.querySelector('[data-testid="interests"]');
    if (genreContainer) {
      genre = genreContainer.querySelector('.ipc-chip__text')?.innerText || '';
    }
    if (!genre) {
      const genreLinks = [...document.querySelectorAll('a[href*="genres="]')].map(el => el.innerText.trim()).filter(Boolean);
      if (genreLinks.length > 0) genre = genreLinks[0];
    }
    let metaText = [runtime, genre].filter(Boolean).join(' • ');
    if (!metaText) metaText = 'Details unavailable';
    const posterImg = document.querySelector('.ipc-poster img');
    const posterSrc = posterImg ? posterImg.src : null;
    return {
      title: titleText,
      rating: rating,
      meta: metaText,
      imdbId: info.imdb_id,
      posterSrc: posterSrc,
      media_type: info.media_type
    };
  }

  function injectButton(info) {
    const h1 = document.querySelector('h1');
    if (!h1) return;

    const targetContainer = h1.parentElement;
    targetContainer.classList.add('play-next-title-grid');

    if (!targetContainer) return;

    // Extract details and save to local storage for the popup
    const movieData = scrapeMovieDetails(info);
    if (movieData) {
      chrome.storage.local.set({ lastMovie: movieData });
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'play-next-btn-wrapper';

    const btn = document.createElement('button');
    btn.className = 'play-next-btn';
    btn.setAttribute('aria-label', 'Play this title');
    btn.innerHTML = `${playIcon} PlayNext`;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openPlayer(info);
    });

    wrapper.appendChild(btn);

    // Append inside the title/meta container
    targetContainer.appendChild(wrapper);
  }

  async function getVideoUrl(info, resume) {
    if (info.customUrl) return info.customUrl;
    const tmdbId = await getTmdbId(info.imdb_id, info.media_type);
    if (!tmdbId) return null;
    // ?imdb= is read by subtitle-fallback.js inside the player page for the
    // OpenSubtitles fallback lookup.
    // ?progress= is REQUIRED by the vidnest player: without it the player
    // never emits PLAYER_EVENT (so our watch progress never saves) and its
    // own internal resume stays dead too.
    // ?startAt= (seconds) is checked BEFORE the player's own resume storage,
    // so our saved position always wins.
    const base = `imdb=${info.imdb_id}&progress=${tmdbId}`;
    const startAt = resume && resume.position > 10 ? `&startAt=${Math.floor(resume.position)}` : '';
    if (isTvType(info.media_type)) {
      // Resume the last-watched episode instead of defaulting to S1 E1.
      const s = (resume && resume.season) || 1;
      const e = (resume && resume.episode) || 1;
      return `${VIDNEST_URL}/tv/${tmdbId}/${s}/${e}?${base}${startAt}`;
    }
    return `${VIDNEST_URL}/movie/${tmdbId}?${base}${startAt}`;
  }

  function fmtTime(totalSec) {
    const t = Math.max(0, Math.floor(totalSec || 0));
    const h = Math.floor(t / 3600);
    const m = String(Math.floor(t / 60) % 60).padStart(2, '0');
    const s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${m}:${s}` : `${m}:${s}`;
  }

  async function fetchTmdbJson(path) {
    try {
      const res = await fetch(`https://api.themoviedb.org/3${path}?api_key=${TMDB_API_KEY}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('[PlayNext] TMDB fetch failed:', e);
      return null;
    }
  }

  function buildTvSelector(tmdbId, imdbId, header, iframe, resume) {
    const bar = document.createElement('div');
    bar.className = 'play-next-tv-bar';

    const seasonSel = document.createElement('select');
    seasonSel.className = 'play-next-tv-select';
    seasonSel.setAttribute('aria-label', 'Season');

    const episodeSel = document.createElement('select');
    episodeSel.className = 'play-next-tv-select';
    episodeSel.setAttribute('aria-label', 'Episode');

    bar.appendChild(seasonSel);
    bar.appendChild(episodeSel);
    header.insertBefore(bar, header.firstChild);

    // Only the very first setEpisode call may carry the resume position
    // (the initial src set by getVideoUrl already includes it; later calls
    // are user-driven episode changes and must start fresh).
    let firstEpisodeSet = true;
    const pendingResumePos = resume && resume.position > 10 ? Math.floor(resume.position) : null;

    function setEpisode(season, episode) {
      let url = `${VIDNEST_URL}/tv/${tmdbId}/${season}/${episode}?imdb=${imdbId}&progress=${tmdbId}`;
      if (firstEpisodeSet && pendingResumePos != null) url += `&startAt=${pendingResumePos}`;
      firstEpisodeSet = false;
      iframe.src = url;
    }

    async function fillEpisodes(season) {
      episodeSel.disabled = true;
      const data = await fetchTmdbJson(`/tv/${tmdbId}/season/${season}`);
      episodeSel.innerHTML = '';
      const eps = data && Array.isArray(data.episodes) ? data.episodes : [];
      eps.forEach(ep => {
        const opt = document.createElement('option');
        opt.value = ep.episode_number;
        opt.textContent = `E${String(ep.episode_number).padStart(2, '0')}${ep.name ? ' · ' + ep.name : ''}`;
        episodeSel.appendChild(opt);
      });
      episodeSel.disabled = false;
      return eps.length;
    }

    (async () => {
      const data = await fetchTmdbJson(`/tv/${tmdbId}`);
      if (!data || !Array.isArray(data.seasons)) return;
      const seasons = data.seasons.filter(s => s.episode_count > 0);
      if (!seasons.length) { bar.remove(); return; }

      seasons.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.season_number;
        opt.textContent = `S${String(s.season_number).padStart(2, '0')} · ${s.name}`;
        seasonSel.appendChild(opt);
      });

      // Default selection: last-watched episode if saved, else season 1,
      // else the first regular season.
      const rSeason = resume && resume.season != null ? String(resume.season) : null;
      const rEpisode = resume && resume.episode != null ? String(resume.episode) : null;
      const defaultSeason = (rSeason && seasons.find(s => String(s.season_number) === rSeason))
        || seasons.find(s => s.season_number === 1)
        || seasons[0];
      seasonSel.value = String(defaultSeason.season_number);
      await fillEpisodes(defaultSeason.season_number);

      // Align the player URL with the selection (handles shows without a
      // season 1, and selects the resume episode when present).
      const epVal = (rEpisode && [...episodeSel.options].some(o => o.value === rEpisode))
        ? rEpisode : (episodeSel.value || '1');
      episodeSel.value = epVal;
      const urlSeason = String((resume && resume.season) || 1);
      const urlEpisode = String((resume && resume.episode) || 1);
      if (String(defaultSeason.season_number) !== urlSeason || epVal !== urlEpisode) {
        setEpisode(defaultSeason.season_number, epVal);
      }

      seasonSel.addEventListener('change', async () => {
        const count = await fillEpisodes(seasonSel.value);
        if (count) setEpisode(seasonSel.value, episodeSel.value);
      });
      episodeSel.addEventListener('change', () => {
        setEpisode(seasonSel.value, episodeSel.value);
      });
    })();
  }

  const ccIcon = `<svg viewBox="0 0 24 24"><path d="M19 4H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>`;

  function toggleSubsPanel(overlay) {
    // Panel lives in the shared subs-panel.js (also used by the standalone
    // player page), so both surfaces stay in sync.
    if (window.PlayNextSubs) window.PlayNextSubs.toggle(overlay);
  }

  // ---- Watch progress ("continue where you left off") ----
  // The VidNest player posts PLAYER_EVENT messages to the parent window
  // (this page) with {event, currentTime, duration, tmdbId, season, episode}.
  // We persist them per IMDb id and use them to reopen the right episode.
  let activeInfo = null;
  let lastProgressSave = 0;

  // Latest playback position reported by the player — used to preserve the
  // exact spot when the iframe gets reloaded (PiP moves reload iframes).
  let lastLive = null;

  // Moving an iframe between documents reloads it, so pin the current
  // playback position into its URL (vidnest's ?startAt=) before the move.
  function pinStartAt(frame) {
    try {
      if (!lastLive || !(lastLive.time > 10)) return;
      const u = new URL(frame.src);
      u.searchParams.set('startAt', String(Math.floor(lastLive.time)));
      frame.src = u.href;
    } catch (e) { /* keep going */ }
  }

  function saveProgress(data, force) {
    if (!activeInfo || activeInfo.custom) return;
    const { event, currentTime, duration } = data;
    if (typeof currentTime !== 'number' || typeof duration !== 'number' || duration <= 0) return;
    const now = Date.now();
    if (!force && now - lastProgressSave < 5000) return;
    lastProgressSave = now;

    const nearEnd = currentTime / duration > 0.97;
    const rec = {
      imdbId: activeInfo.imdb_id,
      mediaType: activeInfo.media_type,
      season: data.season != null ? data.season : null,
      episode: data.episode != null ? data.episode : null,
      position: nearEnd && event === 'ended' ? 0 : currentTime,
      duration: duration,
      title: (document.querySelector('h1') || {}).innerText || '',
      posterSrc: (document.querySelector('.ipc-poster img') || {}).src || null,
      updatedAt: now
    };

    chrome.storage.local.get({ watchProgress: {} }, (res) => {
      const wp = res.watchProgress;
      if (nearEnd && event === 'ended') delete wp[activeInfo.imdb_id]; // finished — clear it
      else wp[activeInfo.imdb_id] = rec;
      chrome.storage.local.set({ watchProgress: wp });
    });
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.type !== 'PLAYER_EVENT' || !d.data) return;
    // Only accept events from the player iframe we opened.
    if (!overlayElement) return;
    const frame = overlayElement.querySelector('.play-next-iframe');
    if (!frame || e.source !== frame.contentWindow) return;
    if (typeof d.data.currentTime === 'number') lastLive = { time: d.data.currentTime };
    saveProgress(d.data, d.data.event === 'pause' || d.data.event === 'ended');
  });

  async function openPlayer(info) {
    if (overlayElement) return;

    // Look up saved progress for this title (used for episode + badge).
    let resume = null;
    if (!info.customUrl) {
      try {
        const wp = await new Promise(r =>
          chrome.storage.local.get({ watchProgress: {} }, d => r(d.watchProgress[info.imdb_id] || null))
        );
        if (wp && Date.now() - (wp.updatedAt || 0) < 30 * 864e5) resume = wp; // ignore >30 days
      } catch (e) { /* storage unavailable */ }
    }

    const video_url = await getVideoUrl(info, resume);
    if (!video_url) {
      console.error('[PlayNext] Could not resolve this title on the new provider.');
      return;
    }

    overlayElement = document.createElement('div');
    overlayElement.className = 'play-next-overlay';
    overlayElement.setAttribute('role', 'dialog');
    overlayElement.setAttribute('aria-modal', 'true');

    // Header
    const header = document.createElement('div');
    header.className = 'play-next-overlay-header';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'play-next-close-btn';
    closeBtn.setAttribute('aria-label', 'Close player');
    closeBtn.innerHTML = closeIcon;
    closeBtn.addEventListener('click', closePlayer);
    header.appendChild(closeBtn);

    // Player Container
    const playerContainer = document.createElement('div');
    playerContainer.className = 'play-next-player-container';
    const iframe = document.createElement('iframe');
    iframe.className = 'play-next-iframe';
    iframe.src = video_url;
    iframe.allow = 'autoplay; fullscreen; picture-in-picture';
    playerContainer.appendChild(iframe);

    // Start tracking progress events from this playback
    activeInfo = { imdb_id: info.imdb_id, media_type: info.media_type, custom: !!info.customUrl };
    lastProgressSave = 0;

    // "Continue where you left off" badge — click to jump to that timestamp.
    if (resume) {
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'play-next-resume-badge';
      badge.textContent = (resume.season != null && resume.episode != null)
        ? `Resuming S${String(resume.season).padStart(2, '0')} E${String(resume.episode).padStart(2, '0')}`
        : `Resuming at ${fmtTime(resume.position)}`;
      badge.title = 'Jump to ' + fmtTime(resume.position);
      badge.addEventListener('click', () => {
        try {
          iframe.contentWindow.postMessage({ type: 'playnext:seek', time: resume.position }, '*');
        } catch (e) { /* frame not ready — ignore */ }
      });
      header.insertBefore(badge, header.firstChild);
      // Auto-hide after 15s so it doesn't crowd the header all movie long.
      setTimeout(() => {
        badge.classList.add('play-next-resume-hide');
        setTimeout(() => badge.remove(), 400); // wait for the fade-out
      }, 15000);
    }

    // TV titles get a season/episode selector in the header bar
    if (!info.customUrl && isTvType(info.media_type)) {
      const tmdbId = await getTmdbId(info.imdb_id, info.media_type);
      if (tmdbId) buildTvSelector(tmdbId, info.imdb_id, header, iframe, resume);
    }

    // Footer
    const footer = document.createElement('div');
    footer.className = 'play-next-overlay-footer';
    if ('documentPictureInPicture' in window) {
      const pipBtn = document.createElement('button');
      pipBtn.className = 'play-next-pip-btn';
      pipBtn.innerHTML = `Picture-in-Picture (PiP) ${pipIcon}`;
      pipBtn.addEventListener('click', async () => {
        try {
          const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 800, height: 450 });

          const style = pipWindow.document.createElement('style');
          style.textContent = `
            body { margin: 0; padding: 0; background: #000; overflow: hidden; }
            iframe { width: 100vw; height: 100vh; border: none; display: block; }
          `;
          pipWindow.document.head.appendChild(style);

          // Moving the iframe into the PiP window reloads it — pin the
          // current playback position into the URL so the reloaded player
          // seeks straight back to it.
          pinStartAt(iframe);

          // The iframe's messages go to the PiP window (its parent), so keep
          // tracking progress there too — otherwise progress pauses while
          // watching in PiP.
          pipWindow.addEventListener('message', (ev) => {
            const d = ev.data;
            if (!d || d.type !== 'PLAYER_EVENT' || !d.data) return;
            if (typeof d.data.currentTime === 'number') lastLive = { time: d.data.currentTime };
            saveProgress(d.data, d.data.event === 'pause' || d.data.event === 'ended');
          });

          // Move iframe to PiP window
          pipWindow.document.body.appendChild(iframe);

          pipWindow.addEventListener('pagehide', () => {
            // Moving back to the overlay reloads the iframe again — pin the
            // position once more before returning it.
            pinStartAt(iframe);
            // Move iframe back to overlay when PiP closes
            if (playerContainer) {
              playerContainer.appendChild(iframe);
            }
          });

          overlayElement._pipWindow = pipWindow;
        } catch (e) {
          console.error('Failed to open PiP', e);
        }
      });
      footer.appendChild(pipBtn);
    }

    const subsBtn = document.createElement('button');
    subsBtn.className = 'play-next-new-tab-btn play-next-subs-btn';
    subsBtn.innerHTML = `Subtitles ${ccIcon}`;
    subsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSubsPanel(overlayElement);
    });
    footer.insertBefore(subsBtn, footer.firstChild);
    footer.classList.add('play-next-footer-start');

    const newTabBtn = document.createElement('button');
    newTabBtn.className = 'play-next-new-tab-btn';
    newTabBtn.innerHTML = `Open in New Tab ${newTabIcon}`;
    newTabBtn.addEventListener('click', () => {
      try {
        // Open our own player page (embeds the stream safely) instead of the
        // raw provider site, whose scripts can hijack/redirect the tab.
        const h1 = document.querySelector('h1');
        const poster = document.querySelector('.ipc-poster img');
        const wrapperUrl = chrome.runtime.getURL('player.html')
          + '?src=' + encodeURIComponent(video_url)
          + '&imdb=' + encodeURIComponent(info.imdb_id)
          + '&tv=' + (isTvType(info.media_type) ? '1' : '0')
          + '&title=' + encodeURIComponent((h1 && h1.innerText) || 'PlayNext')
          + '&poster=' + encodeURIComponent((poster && poster.src) || '');
        chrome.runtime.sendMessage({ action: 'open_new_tab', url: wrapperUrl });
      } catch (e) {
        // "Extension context invalidated" — the extension was reloaded while
        // this tab kept the old content script alive. A refresh fixes it.
        console.error('[PlayNext] Open in New Tab failed — reload the extension, then refresh this page.', e);
      }
    });
    footer.appendChild(newTabBtn);

    const dlBtn = document.createElement('button');
    dlBtn.className = 'play-next-new-tab-btn';
    dlBtn.innerHTML = `Download ${dlIcon}`;
    dlBtn.title = 'Download the current stream as a file';
    dlBtn.addEventListener('click', async () => {
      try {
        dlBtn.disabled = true;
        const res = await window.PlayNextStreamLinks.request(iframe);
        dlBtn.disabled = false;
        if (!res.urls.length) {
          if (window.PlayNextSubs) {
            window.PlayNextSubs.toast('No stream found — press Play in the player first, then try again.');
          }
          return;
        }
        // Hand every candidate to the downloader page; it probes them and
        // prefers a master playlist (quality picker) over a media one.
        const payload = encodeURIComponent(JSON.stringify(res.urls));
        const h1 = document.querySelector('h1');
        // imdb + tv feed the subtitle sidecar lookup in the downloader page.
        const dlUrl = chrome.runtime.getURL('downloader.html')
          + '?urls=' + payload
          + '&title=' + encodeURIComponent((h1 && h1.innerText) || 'video')
          + '&imdb=' + encodeURIComponent(info.imdb_id)
          + '&tv=' + (isTvType(info.media_type) ? '1' : '0');
        chrome.runtime.sendMessage({ action: 'open_new_tab', url: dlUrl });
      } catch (e) {
        dlBtn.disabled = false;
        console.error('[PlayNext] Download failed — reload the extension, then refresh this page.', e);
      }
    });
    footer.appendChild(dlBtn);

    overlayElement.appendChild(header);
    overlayElement.appendChild(playerContainer);
    overlayElement.appendChild(footer);

    document.body.appendChild(overlayElement);
    document.body.classList.add('play-next-no-scroll');

    // Force reflow
    void overlayElement.offsetWidth;
    overlayElement.classList.add('play-next-active');

    // Event Listeners
    overlayElement.addEventListener('click', (e) => {
      if (e.target === overlayElement) closePlayer();
    });

    document.addEventListener('keydown', handleKeyDown);

    // Focus management
    closeBtn.focus();
  }

  function closePlayer() {
    if (!overlayElement) return;

    if (overlayElement._pipWindow && !overlayElement._pipWindow.closed) {
      overlayElement._pipWindow.close();
    }

    overlayElement.classList.remove('play-next-active');
    document.body.classList.remove('play-next-no-scroll');
    document.removeEventListener('keydown', handleKeyDown);
    activeInfo = null; // stop progress tracking

    // Wait for transition to finish before removing
    setTimeout(() => {
      if (overlayElement) {
        overlayElement.remove();
        overlayElement = null;
      }
    }, 250);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      closePlayer();
    }
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'open_player') {
      openPlayer({ imdb_id: request.url.split('/').pop(), media_type: 'custom', customUrl: request.url });
    } else if (request.action === 'get_movie_info') {
      const info = getImdbInfo();
      if (info) {
        sendResponse(scrapeMovieDetails(info));
      } else {
        sendResponse(null);
      }
    }
  });

  // Run immediately!
  init();

})();
