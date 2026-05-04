# Suno Selection Downloader

A Chrome/Chromium side-panel extension for downloading manually selected Suno tracks as WAV files, with optional lyrics and cover images.

This is the recommended and maintained tool in this repository.

Suno uses a virtual scrolling list: only the rows currently visible on screen exist in the page DOM. Because of that, the extension starts collecting selected rows as soon as the side panel opens. For larger selections, keep the side panel open and slowly scroll through the selected tracks with the mouse wheel so every selected row becomes visible at least once.

## Features

- Persistent Chrome side panel.
- Collects selected Suno rows while the panel is open.
- Downloads WAV, lyrics, and cover images when available.
- Queue size setting from 1 to 5.
- `REFRESH SUNO` button for stale Suno pages.
- No analytics, tracking, or external service of its own.

## Installation

1. Download the latest `suno-selection-downloader` ZIP from GitHub Releases.
2. Unzip it.
3. Open `chrome://extensions` or `brave://extensions`.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the unzipped `suno-selection-downloader` folder.
7. Open `suno.com` and stay logged in.

## Recommended Workflow

1. Open your Suno library.
2. Open the extension side panel.
3. Select the tracks you want on Suno.
4. If the selection is larger than the visible screen, slowly scroll through the selected tracks with the mouse wheel.
5. Check the collected count in the side panel.
6. Click `DOWNLOAD`.

## Experimental Auto Marker

The earlier Auto Marker experiment has been moved out of the main branch because Suno's virtual scrolling, hidden stem tracks, and UI filtering made fully automatic marking unreliable.

It is preserved for reference in the GitHub branch:

`codex/experimental-auto-marker-archive`

## Notes

- Suno can change its internal web app and API behavior at any time.
- If downloads stop working, reload the Suno tab and reload the extension.
- WAV generation can take time; the extension waits for Suno to produce the WAV URL.
- This project is not affiliated with Suno.

## License

MIT
