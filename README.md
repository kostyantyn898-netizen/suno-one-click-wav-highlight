# Suno One-Click WAV + Highlight

A small Chrome / Chromium extension for people who generate a lot of music in Suno and want a fast cleanup workflow.

Pick **1**, **5**, or **20** tracks, download the newest matching Suno songs as **WAV**, save lyrics and cover art, then visually highlight the downloaded cards on `suno.com` so you can manually trash or organize them.

> This is an unofficial community tool. It is not affiliated with Suno.

## Features

- One-click batch buttons: **1 / 5 / 20**.
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
3. Choose **1**, **5**, or **20**.
4. Keep the Suno tab open while the extension fetches and downloads tracks.
5. After download, highlighted cards show which tracks were saved successfully.

## Why 20 sometimes needs extra logic

Suno's UI can virtualize the feed: the API may return 20 songs, but the page may only render about 16 cards in the DOM at first. This extension scrolls the feed container and repeats the matching pass, so the remaining cards can render and be highlighted too.

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
- WAV conversion can take time, especially for 20-track batches.
- Highlighting depends on the current Suno UI and visible feed/list page.
- The extension highlights cards for manual cleanup; it does **not** auto-delete or auto-trash tracks.

## Release notes

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
