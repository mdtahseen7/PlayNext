# Changelog

All notable changes to PlayNext are recorded here.

## 2.0.0

### Added

- Full downloader that runs entirely inside the extension. It merges the
  separate video and audio renditions into a single seekable MP4 with a
  built in fragmented MP4 muxer, and saves a matching SRT subtitle file next
  to the video.
- Quality picker for streams that offer several bitrates.
- Real download progress with byte and segment counts, plus a cancel button
  that only appears while a download is running.
- Playlist capture inside the player frame, so downloads can start while a
  title is already playing.
- Resume that survives a provider server failover. When the provider switches
  servers mid watch, playback continues from the same timestamp.
- Clickable resume badge in the player header. It jumps to the saved position
  and fades out on its own after fifteen seconds.
- Open in New Tab player with fullscreen control, subtitle settings and the
  download button.

### Changed

- Complete visual redesign. Pure black canvas, blue accents, Geist typeface.
- New geometric logo.
- Episode selector for series, with resume applied per episode.

### Fixed

- Subtitle fallback now activates when the provider returns an empty response,
  not only when the request fails.
- Subtitle sync changes apply instantly instead of requiring a reload.
- Picture in Picture keeps the playback position when the window opens and
  closes.

## 1.9.0

- Added the download feature, the subtitle fallback and the progress resume
  system.

## 1.0.0

- First public release.
