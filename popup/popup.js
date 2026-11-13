document.addEventListener('DOMContentLoaded', () => {
  let currentMovie = null;

  /* ─── View Routing ─────────────────────────────────────── */
  const mainView = document.getElementById('mainView');
  const aboutView = document.getElementById('aboutView');
  const mainFooter = document.getElementById('mainFooter');
  const aboutFooter = document.getElementById('aboutFooter');
  const btnAbout = document.getElementById('btnAbout');
  const btnCloseAbout = document.getElementById('btnCloseAbout');

  function showAbout(on) {
    [mainView, mainFooter].filter(Boolean).forEach(el => el.classList.toggle('hidden', on));
    [aboutView, aboutFooter].filter(Boolean).forEach(el => el.classList.toggle('hidden', !on));
    if (btnAbout) btnAbout.classList.toggle('hidden', on);
    if (btnCloseAbout) btnCloseAbout.classList.toggle('hidden', !on);
  }

  btnAbout.addEventListener('click', () => showAbout(true));
  btnCloseAbout.addEventListener('click', () => showAbout(false));

  /* ─── IMDb open link ───────────────────────────────────── */
  document.getElementById('goToImdb').addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://www.imdb.com' });
  });

  /* ─── Continue Watching ────────────────────────────────── */
  const continueSection = document.getElementById('continueSection');
  const continueContainer = document.getElementById('continueContainer');
  const continueCountEl = document.getElementById('continueCount');

  function fmtClock(totalSec) {
    const t = Math.max(0, Math.floor(totalSec || 0));
    const h = Math.floor(t / 3600);
    const m = String(Math.floor(t / 60) % 60).padStart(2, '0');
    const s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${m}:${s}` : `${m}:${s}`;
  }

  function cwMeta(p) {
    const pos = `${fmtClock(p.position)} / ${fmtClock(p.duration)}`;
    if (p.season != null && p.episode != null) {
      return `S${String(p.season).padStart(2, '0')} E${String(p.episode).padStart(2, '0')} · ${pos}`;
    }
    return pos;
  }

  // Records without a title (rare scrape miss) get filled from TMDB.
  async function ensureTitle(p, card) {
    if (p.title) return;
    try {
      const r = await fetch(`https://api.themoviedb.org/3/find/${p.imdbId}?api_key=61e2290429798c561450eb56b26de19b&external_source=imdb_id`);
      if (!r.ok) return;
      const d = await r.json();
      const m = (d.movie_results || [])[0] || (d.tv_results || [])[0];
      const name = m && (m.title || m.name);
      if (!name) return;
      card.querySelector('.wl-title').textContent = name;
      chrome.storage.local.get({ watchProgress: {} }, res => {
        const wp = res.watchProgress;
        if (wp[p.imdbId]) {
          wp[p.imdbId].title = name;
          if (!wp[p.imdbId].posterSrc && m.poster_path) {
            wp[p.imdbId].posterSrc = `https://image.tmdb.org/t/p/w1280${m.poster_path}`;
            card.querySelector('.wl-poster').style.backgroundImage = `url('${wp[p.imdbId].posterSrc}')`;
          }
          chrome.storage.local.set({ watchProgress: wp });
        }
      });
    } catch (e) { /* leave card as-is */ }
  }

  function createContinueCard(p) {
    const card = document.createElement('div');
    card.className = 'wl-card cw-card';
    card.dataset.id = p.imdbId;
    const pct = p.duration > 0 ? Math.min(100, Math.round((p.position / p.duration) * 100)) : 0;
    card.innerHTML = `
      <div class="wl-poster" style="background-image:url('${p.posterSrc || ''}')"></div>
      <div class="wl-details">
        <span class="wl-title">${p.title || 'Loading…'}</span>
        <span class="wl-meta">${cwMeta(p)}</span>
        <div class="cw-bar"><div class="cw-bar-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="wl-btns">
        <button class="wl-play" title="Resume">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="wl-remove" title="Remove">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    `;

    if (!p.title) ensureTitle(p, card);

    card.querySelector('.wl-play').addEventListener('click', () => {
      // ?play=1 auto-opens the overlay, which resumes the last episode/position
      chrome.tabs.create({ url: `https://www.imdb.com/title/${p.imdbId}/?play=1` });
      window.close();
    });

    card.querySelector('.wl-remove').addEventListener('click', () => {
      card.classList.add('removing');
      chrome.storage.local.get({ watchProgress: {} }, res => {
        const wp = res.watchProgress;
        delete wp[p.imdbId];
        chrome.storage.local.set({ watchProgress: wp }, renderContinue);
      });
    });

    return card;
  }

  function renderContinue() {
    chrome.storage.local.get({ watchProgress: {} }, d => {
      const entries = Object.values(d.watchProgress)
        .filter(p => p && p.imdbId && Date.now() - (p.updatedAt || 0) < 30 * 864e5)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      continueCountEl.textContent = entries.length;
      continueSection.classList.toggle('hidden', entries.length === 0);
      continueContainer.innerHTML = '';
      entries.forEach(p => continueContainer.appendChild(createContinueCard(p)));
    });
  }

  /* ─── Watchlist ────────────────────────────────────────── */
  const watchlistContainer = document.getElementById('watchlistContainer');
  const watchlistCountEl = document.getElementById('watchlistCount');
  const qaWatchlist = document.getElementById('qaWatchlist');
  const watchlistText = document.getElementById('watchlistText');

  function getWatchlist(cb) {
    chrome.storage.local.get({ watchlist: [] }, d => cb(d.watchlist));
  }

  function setWatchlist(list, cb) {
    chrome.storage.local.set({ watchlist: list }, cb);
  }

  function renderWatchlist() {
    getWatchlist(list => {
      watchlistCountEl.textContent = list.length;

      // Determine existing IDs in DOM
      const existing = new Set(
        [...watchlistContainer.querySelectorAll('.wl-card')].map(el => el.dataset.id)
      );
      const incoming = new Set(list.map(m => m.imdbId));

      // Remove cards that are no longer in list
      watchlistContainer.querySelectorAll('.wl-card').forEach(card => {
        if (!incoming.has(card.dataset.id)) {
          card.classList.add('removing');
          setTimeout(() => card.remove(), 320);
        }
      });

      // Show/hide empty state
      let emptyEl = document.getElementById('emptyWatchlist');
      if (list.length === 0) {
        if (!emptyEl) {
          emptyEl = document.createElement('div');
          emptyEl.id = 'emptyWatchlist';
          emptyEl.className = 'empty-watchlist';
          emptyEl.innerHTML = `
            <svg viewBox="0 0 24 24" width="36" height="36" fill="rgba(255,255,255,0.1)"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
            <p>Your watchlist is empty</p>
            <span>Save movies & shows to watch later</span>
          `;
          watchlistContainer.appendChild(emptyEl);
        }
        return;
      } else if (emptyEl) {
        emptyEl.remove();
      }

      // Add new cards
      list.forEach(movie => {
        if (existing.has(movie.imdbId)) return; // already rendered
        const card = createWatchlistCard(movie);
        watchlistContainer.appendChild(card);
      });
    });
  }

  function createWatchlistCard(movie) {
    const card = document.createElement('div');
    card.className = 'wl-card';
    card.dataset.id = movie.imdbId;
    card.innerHTML = `
      <div class="wl-poster" style="background-image:url('${movie.posterSrc || ''}')"></div>
      <div class="wl-details">
        <span class="wl-title">${movie.title || 'Unknown'}</span>
        <span class="wl-meta">${movie.meta || 'Details unavailable'}</span>
      </div>
      <div class="wl-btns">
        <button class="wl-play" title="Play">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="wl-remove" title="Remove">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    `;

    card.querySelector('.wl-play').addEventListener('click', () => {
      chrome.tabs.create({ url: `https://www.imdb.com/title/${movie.imdbId}/?play=1` });
    });

    card.querySelector('.wl-remove').addEventListener('click', () => {
      card.classList.add('removing');
      getWatchlist(list => {
        setWatchlist(list.filter(m => m.imdbId !== movie.imdbId), () => {
          updateWatchlistBtn();
        });
      });
      setTimeout(() => {
        card.remove();
        renderWatchlist();
      }, 200);
    });

    return card;
  }

  function updateWatchlistBtn() {
    if (!currentMovie) return;
    getWatchlist(list => {
      const inList = list.some(m => m.imdbId === currentMovie.imdbId);
      qaWatchlist.classList.toggle('wl-active', inList);
      watchlistText.textContent = inList ? 'Remove from list' : 'Add to Watchlist';
    });
  }

  qaWatchlist.addEventListener('click', () => {
    if (!currentMovie) return;
    getWatchlist(list => {
      const inList = list.some(m => m.imdbId === currentMovie.imdbId);
      let newList;
      if (inList) {
        newList = list.filter(m => m.imdbId !== currentMovie.imdbId);
      } else {
        newList = [currentMovie, ...list];
      }
      setWatchlist(newList, () => {
        updateWatchlistBtn();
        renderWatchlist();
      });
    });
  });

  /* ─── GitHub Updater & Versioning ──────────────────────── */
  // Set this to "<your-github-username>/PlayNext" once the repo is public.
  // While it points at the placeholder, the GitHub + update-check buttons
  // are hidden so nothing links anywhere unexpected.
  const GITHUB_REPO = 'mdtahseen7/PlayNext';
  const HAS_REPO = !/YOUR_USERNAME/.test(GITHUB_REPO);
  const manifest = chrome.runtime.getManifest();
  const currentVersion = manifest.version;

  const versionAbout = document.getElementById('versionAbout');
  const versionFooter = document.getElementById('versionFooter');
  const btnGithub = document.getElementById('btnGithub');
  const btnCheckUpdates = document.getElementById('btnCheckUpdates');

  if (versionAbout) versionAbout.textContent = `Version ${currentVersion}`;
  if (versionFooter) versionFooter.textContent = `v${currentVersion}`;
  if (btnGithub) {
    btnGithub.href = `https://github.com/${GITHUB_REPO}`;
    if (!HAS_REPO) btnGithub.classList.add('hidden');
  }

  if (btnCheckUpdates && !HAS_REPO) {
    btnCheckUpdates.classList.add('hidden');
  }

  if (btnCheckUpdates && HAS_REPO) {
    btnCheckUpdates.addEventListener('click', async () => {
      // If an update was found, this button turns into a link to the release page
      if (btnCheckUpdates.dataset.url) {
        chrome.tabs.create({ url: btnCheckUpdates.dataset.url });
        return;
      }

      const originalText = btnCheckUpdates.innerHTML;
      btnCheckUpdates.innerHTML = 'Checking...';
      btnCheckUpdates.disabled = true;

      try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
        if (!response.ok) throw new Error('API request failed');
        const data = await response.json();
        
        // Strip 'v' prefix if present
        const latestTag = data.tag_name.replace(/^v/, '');
        
        // Compare semantic version (e.g., "1.0.1" > "1.0.0")
        if (latestTag > currentVersion) {
          btnCheckUpdates.innerHTML = `Update Available (v${latestTag})`;
          btnCheckUpdates.style.color = 'var(--accent)';
          btnCheckUpdates.style.borderColor = 'var(--accent)';
          btnCheckUpdates.dataset.url = data.html_url;
          btnCheckUpdates.disabled = false;
        } else {
          btnCheckUpdates.innerHTML = 'Up to date';
          setTimeout(() => {
            btnCheckUpdates.innerHTML = originalText;
            btnCheckUpdates.disabled = false;
          }, 2000);
        }
      } catch (error) {
        console.error('Update check failed:', error);
        btnCheckUpdates.innerHTML = 'Update check failed';
        setTimeout(() => {
          btnCheckUpdates.innerHTML = originalText;
          btnCheckUpdates.disabled = false;
        }, 2000);
      }
    });
  }

  /* ─── Populate movie info ──────────────────────────────── */
  function showDetected(info, tabId) {
    currentMovie = info;
    document.getElementById('noPageState').classList.add('hidden');
    document.getElementById('detectedState').classList.remove('hidden');

    document.getElementById('movieTitle').textContent = info.title || 'Unknown';
    document.getElementById('ratingText').textContent = (info.rating || 'N/A').replace(/\/10$/, '');
    const metaEl = document.getElementById('movieMeta');
    metaEl.textContent = info.meta || 'Details unavailable';
    document.getElementById('imdbIdText').textContent = info.imdbId;

    if (info.posterSrc) {
      const p = document.getElementById('moviePoster');
      p.style.backgroundImage = `url(${info.posterSrc})`;
      p.innerHTML = '';
    }

    const playBtn = document.getElementById('playBtnMain');
    const newTabBtn = document.getElementById('qaNewTab');
    playBtn.disabled = false;
    newTabBtn.disabled = false;
    qaWatchlist.disabled = false;

    const resolveUrl = async () => {
      const isTv = info.media_type === 'video.tv_show' || info.media_type === 'video.episode';
      try {
        const r = await fetch(`https://api.themoviedb.org/3/find/${info.imdbId}?api_key=61e2290429798c561450eb56b26de19b&external_source=imdb_id`);
        if (r.ok) {
          const d = await r.json();
          const m = isTv ? (d.tv_results || [])[0] : (d.movie_results || [])[0];
          if (m && m.id) {
            // ?imdb= feeds the subtitle-fallback script inside the player page.
            // ?progress= is required by the vidnest player for PLAYER_EVENT
            // emission (without it watch progress never saves).
            return isTv ? `https://vidnest.fun/tv/${m.id}/1/1?imdb=${info.imdbId}&progress=${m.id}` : `https://vidnest.fun/movie/${m.id}?imdb=${info.imdbId}&progress=${m.id}`;
          }
        }
      } catch (e) { console.error('[PlayNext] TMDB lookup failed:', e); }
      return null;
    };

    // Clone to strip old listeners
    const pb2 = playBtn.cloneNode(true);
    playBtn.replaceWith(pb2);
    pb2.addEventListener('click', async () => {
      const videoUrl = await resolveUrl();
      if (!videoUrl) return;
      if (tabId) chrome.tabs.sendMessage(tabId, { action: 'open_player', url: videoUrl });
      else chrome.tabs.create({ url: videoUrl });
      window.close();
    });

    const nt2 = newTabBtn.cloneNode(true);
    newTabBtn.replaceWith(nt2);
    nt2.addEventListener('click', async () => {
      let videoUrl = await resolveUrl();
      if (!videoUrl) return;
      // Restore the saved position if there is one (vidnest reads ?startAt=
      // with top priority, before its own resume storage).
      try {
        const wp = await new Promise(r => chrome.storage.local.get({ watchProgress: {} }, d => r(d.watchProgress)));
        const rec = wp[info.imdbId];
        if (rec && rec.position > 10 && Date.now() - (rec.updatedAt || 0) < 30 * 864e5) {
          videoUrl += '&startAt=' + Math.floor(rec.position);
        }
      } catch (e) { /* storage unavailable — skip resume */ }
      const isTv = info.media_type === 'video.tv_show' || info.media_type === 'video.episode';
      const wrapperUrl = chrome.runtime.getURL('player.html')
        + '?src=' + encodeURIComponent(videoUrl)
        + '&imdb=' + encodeURIComponent(info.imdbId)
        + '&tv=' + (isTv ? '1' : '0')
        + '&title=' + encodeURIComponent(info.title || 'PlayNext')
        + '&poster=' + encodeURIComponent(info.posterSrc || '');
      chrome.tabs.create({ url: wrapperUrl });
    });

    const cp = document.getElementById('copyId');
    const cp2 = cp.cloneNode(true);
    cp.replaceWith(cp2);
    cp2.addEventListener('click', () => {
      navigator.clipboard.writeText(info.imdbId).catch(() => { });
      const el = document.getElementById('imdbIdText');
      el.textContent = 'Copied!';
      setTimeout(() => { el.textContent = info.imdbId; }, 1500);
    });

    updateWatchlistBtn();
  }

  function showNoPage() {
    document.getElementById('noPageState').classList.remove('hidden');
    document.getElementById('detectedState').classList.add('hidden');
  }

  /* ─── Bootstrap ────────────────────────────────────────── */
  renderContinue();
  renderWatchlist();

  // Scrape the live tab or show No Page state
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    const isImdb = tab && tab.url && tab.url.includes('imdb.com/title/');

    if (!isImdb) {
      showNoPage();
      return;
    }

    function handleDetected(movieData) {
      if (!movieData) {
        showNoPage();
        return;
      }
      showDetected(movieData, tab.id);

      // Auto-heal watchlist with missing or old meta
      chrome.storage.local.get({ watchlist: [] }, wlData => {
        let updated = false;
        const newList = wlData.watchlist.map(m => {
          if (m.imdbId === movieData.imdbId && m.meta !== movieData.meta) {
            updated = true;
            return { ...m, meta: movieData.meta, title: movieData.title, posterSrc: movieData.posterSrc };
          }
          return m;
        });
        if (updated) {
          chrome.storage.local.set({ watchlist: newList }, () => {
            renderWatchlist();
          });
        }
      });
    }

    // Request fresh info from the active tab's content script
    chrome.tabs.sendMessage(tab.id, { action: 'get_movie_info' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        // Fallback to storage in case content script isn't responsive
        chrome.storage.local.get(['lastMovie'], d => {
          if (d.lastMovie && tab.url.includes(d.lastMovie.imdbId)) {
            handleDetected(d.lastMovie);
          } else {
            showNoPage();
          }
        });
        return;
      }
      handleDetected(response);
    });
  });
});
