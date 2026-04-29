# Suno One-Click WAV + Auto Marker

A small Chrome / Chromium extension for people who generate a lot of music in Suno and want a fast cleanup workflow.

**Download:** [Latest release](https://github.com/kostyantyn898-netizen/suno-one-click-wav-highlight/releases/latest)

Choose any number from **1** to **10**, download the newest matching Suno songs as **WAV**, save lyrics and cover art, then select/highlight the downloaded cards on `suno.com` so you can manually trash or organize them. AUTO mode repeats the selected batch size, with a visible counter, until you press STOP.

> This is an unofficial community tool. It is not affiliated with Suno.

## Features

- Custom count field: choose **1-10** tracks.
- Manual **DOWNLOAD** mode saves one batch using the selected count.
- **AUTO** mode repeats the selected count per cycle and marks completed tracks before continuing.
- Feed paging for AUTO mode, so it can continue past the first 20 already-marked tracks.
- Downloads WAV files into `Downloads/Suno_Songs/`.
- Saves lyrics as `.txt` when available.
- Saves cover images when available.
- Highlights successfully downloaded Suno cards with a bright badge.
- Handles Suno's virtualized feed by scrolling the list and re-scanning rendered cards.
- Manifest V3 service worker.
- No external servers, analytics, or telemetry.

## Install from source

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder.
6. Open `https://suno.com` in the same browser and make sure you are logged in.

## Usage

1. Open your Suno library/feed page.
2. Click the extension icon.
3. Enter a number from **1** to **10**. Use **DOWNLOAD** for one manual batch, or **AUTO** for a repeating conveyor.
4. Keep the Suno tab open while the extension fetches and downloads tracks.
5. Do not manually scroll the Suno page while **AUTO** runs; the extension uses the page position to keep its visual marker reliable.
6. Press **STOP** when you have enough. If a batch already finished downloading, the extension marks those tracks before exiting. The marked/highlighted cards are ready for your manual cleanup decision.

## Companion Converter Tool

This repository also includes `tools/suno_downloads_to_music.py`, a handy companion to the extension. The extension is good at getting the files out of Suno quickly; this script is good at turning that batch into a clean local music library.

Use it after downloading tracks with the extension when you want the audio, cover, and lyrics folded into properly tagged files instead of keeping loose sidecars in Downloads.

It scans your Downloads folder for MP3/WAV files plus matching sidecars such as:

```text
Song Title.wav
Song Title_cover.jpeg
Song Title.txt
```

MP3 files are copied into your Music folder with tags, cover art, and lyrics. WAV files are converted to FLAC with tags, cover art, and lyrics. Existing destination files with the same name are overwritten, which is useful when track names are intentional and should not be changed with `_1` suffixes.

Example:

```powershell
python tools\suno_downloads_to_music.py --dry-run
python tools\suno_downloads_to_music.py
```

The tool is local-only and does not contact any external service. It expects `ffmpeg`, `flac`, and `metaflac` to be installed locally.

By default, the tool uses `%USERPROFILE%\Downloads`, `%USERPROFILE%\Music`, and resolves `ffmpeg`, `flac`, and `metaflac` from PATH. You can override paths with CLI flags or environment variables:

```powershell
python tools\suno_downloads_to_music.py --src "D:\Downloads" --dst "D:\Music"
setx SUNO_CONVERT_FFMPEG "C:\tools\ffmpeg\bin\ffmpeg.exe"
```

## Why the maximum batch is 10

Suno can handle several downloads at once, but browsers, network speed, and Suno WAV conversion latency vary. This build lets the user choose **1-10** tracks so slower machines can stay conservative while faster setups can run larger AUTO cycles.

## Permissions

The extension asks for the minimum practical permissions needed for this workflow:

| Permission | Why it is needed |
|---|---|
| `downloads` | Save WAV, lyrics, and cover files. |
| `scripting` | Run the highlight logic on the active Suno tab. |
| `activeTab` | Access the currently opened Suno page after user action. |
| `storage` | Track temporary download state and the last successful batch. |
| `*://*.suno.com/*` | Read the logged-in Suno page and get the session token from the page context. |
| `studio-api*.suno.com` | Fetch the user's feed and trigger WAV conversion. |
| `cdn*.suno.ai` | Download generated media and covers. |

## Privacy

- No analytics.
- No tracking.
- No third-party backend.
- No data is sent anywhere except directly between your browser and Suno/CDN endpoints required for downloads.
- Temporary extension state is stored locally in your browser.

See [PRIVACY.md](PRIVACY.md) for the short privacy policy.

## Known limitations

- Suno may change private API endpoints at any time.
- WAV conversion can take time, especially for larger AUTO cycles.
- Highlighting depends on the current Suno UI and visible feed/list page.
- The extension highlights cards for manual cleanup; it does **not** auto-delete or auto-trash tracks.

## Release notes

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).

