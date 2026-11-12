# Chrome Web Store listing

Copy for the developer dashboard at `chrome.google.com/webstore/devconsole`.

## Item details

**Name** (max 45 characters)

```
PlayNext: Watch from IMDb
```

**Short description** (max 132 characters)

```
One click to play movies and TV shows from any IMDb page. Subtitles, progress sync and downloads.
```

**Category**

```
Productivity
```
(Video players sit in a "Video" category that is not offered to new
publishers, so Productivity is the usual fallback.)

**Language**

```
English (United States)
```

## Detailed description

```
PlayNext puts a Play button on every IMDb movie and TV show page. Press it and
the title starts playing right there. Nothing to install, no account, no
searching for a working link.

Playback
- A Play button is injected into every IMDb title page, for both movies and
  full series.
- An in-page player opens with the title and the poster.
- Series get a season and episode selector inside the player header.
- Open in New Tab launches a clean standalone player with fullscreen control.
- Picture in Picture keeps the video playing while you browse the rest of the
  page.
- Provider popups and tab hijacks are blocked, so the player never takes over
  navigation.

Progress and resume
- Playback position is saved automatically and immediately on pause and on
  end.
- Resume works from the IMDb page, the standalone player and the Picture in
  Picture window.
- Continue Watching in the popup lists everything you started, with posters
  and progress bars.
- The resume badge in the player header jumps to the saved timestamp when you
  click it.
- If the provider switches servers mid watch, playback continues from the same
  timestamp instead of starting over.
- Finished titles drop out of Continue Watching on their own.

Subtitles
- When the provider subtitle service is unreachable, the extension falls back
  to the free OpenSubtitles addon and serves the track automatically.
- Full control over font size, font family, bold, text colour, text opacity,
  background colour, background opacity, shadow and vertical nudge.
- Sync offset from -300 to +300 seconds in 0.1 second steps, applied live
  while you drag the slider. No reload needed.

Downloads
- The downloader lives inside the extension. No companion app and no external
  tools.
- Video and audio are merged into a single MP4 with sound, and the file is
  fully seekable.
- A matching SRT subtitle file is saved next to the video, so players such as
  VLC and mpv load it automatically.
- A quality picker appears for streams that offer several bitrates.
- Real progress, and a cancel button that stops the download immediately.
- Downloads work while the title is already playing.

Watchlist
- Add and remove titles from the popup.
- Copy the IMDb id of any detected title with one click.
- Watch progress, watchlist and subtitle settings are stored on your device
  only.

PlayNext does not host any video content. It embeds the public player page of
a third party provider. You are responsible for making sure your use of it
complies with the law where you live.

Privacy
- No accounts, no analytics, no telemetry and no advertising.
- Nothing you watch is sent to the extension author.
- See the privacy policy for the full details.
```

## Privacy tab answers

**Single purpose description**

```
PlayNext adds a Play button to IMDb title pages and opens the title in an
embedded video player, with subtitles, saved watch progress and an optional
download of the stream that is currently playing.
```

**Data usage declaration**

- Do you collect or use user data? **No**
- Do you sell or transfer user data to third parties? **No**
- Is data used for advertising or marketing? **No**
- Is data used for purposes other than the single purpose listed above?
  **No**
- Do you transmit data to a server in an encrypted form? **No user data is
  transmitted.**

**Privacy policy URL**

```
https://github.com/<your-username>/PlayNext/blob/main/PRIVACY.md
```
(Replace with the real URL once the repository is public. A GitHub "raw" URL
works too: `https://raw.githubusercontent.com/<your-username>/PlayNext/main/PRIVACY.md`.)

## Permission justifications

The dashboard asks for a justification for each permission. Use these.

**storage**

```
Saves watch progress, the watchlist and subtitle preferences on the user's
own device so playback can resume and settings persist. Nothing is sent
anywhere.
```

**downloads**

```
Used only when the user presses the Download button. It saves the stream they
are currently watching as a video file, plus a subtitle sidecar file, to the
location the user picks.
```

**Host permission: imdb.com**

```
The extension reads the IMDb title page to detect which movie or episode is
open and injects the Play button and the player into it.
```

**Host permission: vidnest.fun and new.vidnest.fun**

```
The extension embeds the streaming provider's player page in an iframe. A
small bundled script runs inside that frame to provide subtitle fallback and
styling, to apply subtitle sync, to capture the playlist for the download
feature, and to restore the playback position if the provider fails over to a
different server.
```

**Host permission: api.themoviedb.org**

```
Resolves the IMDb id of the current title into the provider's own title id
and episode numbers, which are needed to build the playback URL.
```

**Optional host permission: all sites**

```
The video segments for a stream are served from different content delivery
hosts depending on which provider server is active. The extension asks for
this permission only at the moment the user starts a download, so it can read
the media segments and write them into the file the user chooses.
```

## Graphics checklist

| Asset | Size | File |
| --- | --- | --- |
| Extension icon | 128 x 128 | `icons/icon128.png` |
| Small promo tile | 440 x 280 | `store/small-promo.png` |
| Screenshot 1 | 1280 x 800 | `store/screenshot-1.png` |
| Screenshot 2 | 1280 x 800 | `store/screenshot-2.png` |
| Screenshot 3 | 1280 x 800 | `store/screenshot-3.png` |

## Pre-upload checklist

1. Set `GITHUB_REPO` in `popup/popup.js` to your real repository, otherwise
   the update check inside the About panel stays hidden.
2. Bump `version` in `manifest.json` for every upload. The store rejects a
   version it has already seen.
3. Run `tools/package.ps1` to build the upload zip.
4. Upload the zip, fill in the fields above, submit.
5. Review usually takes a few days. You will get an email either way.

## Risk notes for this kind of extension

Read this before submitting.

- The Chrome Web Store forbids extensions whose primary purpose is to enable
  copyright infringement. PlayNext embeds a third party streaming provider,
  which is exactly the pattern reviewers look at.
- Reviewers may ask for a demo of a working stream. Have one ready.
- Do not use IMDb logos, artwork or footage in the screenshots. The graphics
  in `store/` are original and use no third party assets.
- Be explicit in the listing that the extension hosts no content of its own
  and is a front end for a third party provider. Transparency helps.
- If the listing is rejected, the extension keeps working when loaded
  unpacked, and the same package can be published on the Edge Add-ons store
  or distributed as a signed CRX.
