# Privacy Policy

**PlayNext** is a browser extension for Chrome and other Chromium based
browsers.

Last updated: 13 November 2026

## Summary

PlayNext does not collect, transmit, sell or share any personal data. There is
no account system, no analytics, no telemetry and no advertising. Everything
the extension remembers stays on your own device.

## What is stored locally

The extension uses `chrome.storage.local` to remember the following on your
device only:

- **Watch progress**: the title, position and duration of what you have
  watched, so playback can resume where it stopped.
- **Watchlist**: the titles you choose to save for later.
- **Subtitle preferences**: font size, font family, bold, text colour, text
  opacity, background colour, background opacity, shadow, vertical nudge and
  sync offset.

These values never leave your browser. Clearing extension data or uninstalling
the extension removes all of them permanently.

## What is sent over the network

PlayNext talks to two kinds of services, both of which are visible in the
network tab of your browser:

1. **IMDb and The Movie Database**, to read the title you are viewing and to
   resolve its metadata.
2. **The streaming provider** whose public player page the extension embeds
   in order to play the title, plus the content delivery hosts that serve the
   video segments.

Those requests carry only what the page needs to load, such as the title id
and the episode number. The extension does not add any identifier, does not
send anything to us, and does not use cookies of its own.

If you use the download feature, the extension requests access to the
content delivery hosts so it can read the media segments and write them to
the file you choose. That permission is requested only when you start a
download, and it can be removed at any time from the browser's extension
settings.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `storage` | Saves watch progress, watchlist and subtitle settings locally. |
| `downloads` | Saves the stream as a video file and its subtitle file when you ask for it. |
| Access to `imdb.com` | Detects the title and injects the Play button and player. |
| Access to `vidnest.fun` | Runs inside the embedded player to supply fallback subtitles and capture the playlist for the downloader. |
| Access to `api.themoviedb.org` | Resolves title and episode metadata. |
| Optional access to all sites | Requested only when you download, because the video segments are served from different delivery hosts depending on the stream server. |

## Children

PlayNext is not directed at children and does not knowingly collect data from
anyone.

## Changes

If this policy changes, the updated version will be committed to the project
repository and the date above will change.

## Contact

Questions about this policy can be raised in the project's GitHub issue
tracker.
