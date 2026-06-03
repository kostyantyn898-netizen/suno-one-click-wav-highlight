# Suno One-Click WAV Tools

Chrome/Chromium extension tools for downloading manually selected Suno tracks as WAV files, with lyrics and cover images when available.

The recommended public build is `suno-selection-downloader`.

Suno uses a virtual scrolling list: only the rows currently visible on screen exist in the page DOM. Because of that, the extension starts collecting selected rows as soon as the side panel opens. For larger selections, keep the side panel open and slowly scroll through the selected tracks with the mouse wheel so every selected row becomes visible at least once.

## Project Directions

- `suno-selection-downloader` is the stable, recommended side-panel downloader.
- `suno-watcher-beta` is a beta watcher build. It watches selected rows through a content script and can start downloading from the popup when watched tracks are present.
- The older Auto Marker direction is archived as experimental in `codex/experimental-auto-marker-archive`.

## Stable Features

- Persistent Chrome side panel.
- Collects selected Suno rows while the panel is open.
- Downloads WAV, lyrics, and cover images together.
- Queue size setting from 1 to 5.
- Skips tracks already downloaded during the current panel session.
- Auto-clears the collected list after a completed download and resumes collection.
- No analytics, tracking, or external service of its own.

## Watcher Beta

`suno-watcher-beta` is included for testing a different workflow. It installs a content script on Suno pages, keeps a watched list of selected rows that have been seen while scrolling, and uses a popup download flow. Treat it as beta: the stable side-panel downloader remains the safer default.

## Installation

1. Download the latest `suno-selection-downloader` ZIP from GitHub Releases. Use `suno-watcher-beta` only if you want to test the beta watcher direction.
2. Unzip it.
3. Open `chrome://extensions` or `brave://extensions`.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the unzipped extension folder.
7. Open `suno.com` and stay logged in.

For this local development checkout, Chrome can load either the repository root
`suno-one-click-wav-highlight` or the inner `suno-selection-downloader` folder for the stable build. For the watcher beta, load `suno-watcher-beta`.

## Recommended Workflow

1. Open your Suno library.
2. Open the extension side panel.
3. Select the tracks you want on Suno.
4. If the selection is larger than the visible screen, slowly scroll through the selected tracks with the mouse wheel.
5. Check the collected count in the side panel.
6. Click `DOWNLOAD`.
7. After the run finishes, the panel starts watching for the next selection again.

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
