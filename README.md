<div align="center">

<img src="icons/logo.png" width="96" alt="PlayNext logo" />

# PlayNext

**Watch anything, right from IMDb.**

One click on any movie or TV show page and it plays — no tab-hopping, no
external player, no searching for a working link.

</div>

---

## Features

- **One-click playback** — a Play button injected into every IMDb title page.
- **Full show support** — season/episode selector for TV series.
- **Watch progress everywhere** — resume where you left off on the IMDb page,
  in the standalone player, and even in Picture-in-Picture.
- **Resume that survives server failovers** — if the upstream provider switches
  servers mid-watch, playback continues from the same timestamp.
- **Smart subtitles** — automatic fallback to the OpenSubtitles addon when the
  provider's own subtitle API is down, with font, size, colour, background,
  opacity and ±300s sync adjustment applied instantly.
- **Download** — save the stream as a proper `.mp4` (video **and** audio, fully
  seekable) plus a matching `.srt` sidecar, straight from the extension.
- **Picture-in-Picture** — pop the player out and keep watching while you browse.
- **Watchlist & Continue Watching** — tracked locally in your browser.

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Pin *PlayNext* and open any IMDb title

## Install (Chromium browsers)

The extension is Manifest V3 and works in Chrome, Edge, Brave and other
Chromium-based browsers.

## Project layout

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (MV3) |
| `content.js` / `content.css` | IMDb page injection: play button, overlay, TV selector, progress |
| `popup/` | Toolbar popup: detection, watchlist, continue watching, settings |
| `player.html` / `player.js` | Standalone "Open in New Tab" player |
| `downloader.html` / `downloader.js` | In-extension downloader with fMP4 muxer |
| `subtitle-fallback.js` | Subtitle fallback, styling, sync (runs in the player frame) |
| `sub-settings-bridge.js` | Bridges extension settings into the player frame |
| `stream-link.js` | Shared helper to collect media URLs from the player frame |
| `block-popups.js` | Stops the provider from hijacking tabs with popups |
| `background.js` | Service worker: new-tab handling |
| `tools/make-icon.js` | Generates the extension icons |

## Notes

- Nothing leaves your browser — no accounts, no telemetry, no server.
- Watch progress, watchlist and subtitle settings are stored in local
  extension storage only.

## Credits

Built by **Stella**.

## License

MIT — see [LICENSE](LICENSE).
