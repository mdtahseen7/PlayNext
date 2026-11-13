<div align="center">

<img src="icons/logo.png" width="96" alt="PlayNext logo" />

# PlayNext

**Watch movies and TV shows directly from IMDb pages.**

One click on any title and it plays. No tab hopping, no external player, no
looking for a working link.

</div>

---

## Contents

- [Features](#features)
  - [Playback](#playback)
  - [Progress and resume](#progress-and-resume)
  - [Subtitles](#subtitles)
  - [Download](#download)
  - [Watchlist and continue watching](#watchlist-and-continue-watching)
  - [Interface](#interface)
  - [Privacy](#privacy)
- [Install](#install)
- [How it works](#how-it-works)
- [Project layout](#project-layout)
- [Keyboard and pointer notes](#keyboard-and-pointer-notes)
- [Credits](#credits)
- [License](#license)

---

## Features

### Playback

- A Play button is injected into every IMDb movie and TV show page.
- Movies and full series are both supported.
- An in-page overlay player opens with the title, the poster and the controls.


### Progress and resume

- Playback position is saved automatically every few seconds, and immediately
  on pause and on end.
- Resume works from every entry point: the IMDb overlay, the standalone
  player and the Picture in Picture window.


### Download

- The downloader lives inside the extension. No companion app, no external
  tools, nothing to install.
- A quality picker appears for streams that offer several bitrates.


### Watchlist and continue watching

- Add and remove titles from the popup.
- Continue Watching section with posters, progress bars and resume times.
- Copy the IMDb id of any detected title with one click.
- Everything is stored locally in your browser.


### Privacy

- No accounts, no telemetry, no analytics and no server of our own.
- Watch progress, watchlist and subtitle settings stay in local extension
  storage on your machine.
- PlayNext does not host any video content. Streams come from the third party
  provider the extension talks to.

---

## Install

### Unpacked (development)

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked and select this folder.
4. Open any IMDb title page and press Play.

### Chromium browsers

The extension is Manifest V3, so it runs in Chrome, Edge, Brave, Opera and
other Chromium based browsers.

### Keeping it up to date

The About panel in the popup has a Check for Updates button. It compares the
installed version against the latest GitHub release and links to it when a
newer one exists. To enable it, set `GITHUB_REPO` near the top of
`popup/popup.js` to your own `owner/repository`.

---

## How it works

1. A content script on IMDb detects the title, resolves it to a TMDB id and
   injects the Play button.
2. Pressing Play opens the player inside an iframe pointed at the provider,
   with the IMDb id, the progress key and the resume position in the URL.
3. A small script runs inside the player frame. It supplies fallback
   subtitles, applies the subtitle styling and the sync offset, captures the
   playlist for the downloader, and restores the position when the provider
   fails over to another server.
4. Playback events are reported back to the page and written to local storage
   as the watch progress entry for that title.

---

## Project layout

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest, Manifest V3 |
| `content.js` | Play button, overlay player, episode selector, progress tracking, Picture in Picture |
| `content.css` | Styling for the injected button, overlay and panels |
| `popup/popup.html` | Popup markup |
| `popup/popup.css` | Popup styling |
| `popup/popup.js` | Title detection, watchlist, continue watching, update check |
| `player.html` | Standalone player page |
| `player.js` | Standalone player logic, progress sync, download trigger |
| `downloader.html` | Downloader page |
| `downloader.js` | Downloader logic and the fragmented MP4 muxer |
| `subtitle-fallback.js` | Subtitle fallback, styling, sync, failover resume, playlist capture |
| `sub-settings-bridge.js` | Bridges extension settings and commands into the player frame |
| `stream-link.js` | Shared helper that collects media URLs from the player frame |
| `subs-panel.js` | Shared subtitle settings panel |
| `block-popups.js` | Stops the provider from opening popups or hijacking tabs |
| `background.js` | Service worker, handles new tab requests |
| `tools/make-icon.js` | Generates the extension icons |
| `icons/` | Logo and icon sizes |

---

## Credits

Built by **Stella**.

---

## License

MIT. See [LICENSE](LICENSE).
