# Suno One-Click WAV Tools

Two Chrome/Chromium extensions for saving Suno tracks as WAV files, with optional lyrics and cover images.

This repository contains two tools for different workflows:

| Tool | Best for | Folder |
| --- | --- | --- |
| Suno WAV Auto Marker | Downloading the newest Suno tracks automatically, then marking them on the page for manual cleanup | `suno-auto-marker/` |
| Suno Selection Downloader | Downloading tracks you manually select on Suno, including longer selections collected while scrolling | `suno-selection-downloader/` |

These extensions are personal workflow tools for logged-in Suno users. They do not bypass access controls. They use your active Suno browser session and Chrome's normal Downloads API.

## Tool 1: Suno WAV Auto Marker

Use this when you want to process the newest tracks from your Suno library.

Features:

- Pick 1-10 tracks per batch.
- Manual `DOWNLOAD` for one batch.
- `AUTO` mode repeats batches and marks downloaded tracks on the Suno page.
- Downloads WAV, lyrics, and cover images when available.
- Remembers the selected batch size.
- Leaves deletion/cleanup as a manual user action.

Folder: `suno-auto-marker/`

## Tool 2: Suno Selection Downloader

Use this when you want to manually choose specific tracks on the Suno page.

Suno uses a virtual scrolling list, so only visible rows exist in the page DOM at any moment. Because of that, the side panel starts collecting as soon as it opens. Select visible tracks, and for longer selections scroll through the selected range so the panel can see every selected row at least once.

Features:

- Persistent Chrome side panel.
- Starts collecting selected rows immediately when opened.
- Downloads the collected selection as WAV, lyrics, and cover images when available.
- Optional parallel queue size from 1 to 5.
- `REFRESH SUNO` button for cases where the Suno page gets stale.

Folder: `suno-selection-downloader/`

## Installation

1. Download the ZIP for the tool you want from the latest GitHub Release.
2. Unzip it.
3. Open `chrome://extensions`.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the unzipped extension folder.
7. Open `suno.com` and stay logged in.

## Notes

- Suno can change its internal web app and API behavior at any time.
- If a download mode stops working, reload the Suno tab and reload the extension.
- WAV generation can take time; the extensions wait for Suno to produce the WAV URL.
- These tools are not affiliated with Suno.

## License

MIT
