# Suno Watcher Beta

Beta Chrome/Chromium extension for watching selected Suno rows through a content script and starting a WAV download flow from the popup.

This is not the recommended stable build. Use `suno-selection-downloader` for the maintained side-panel workflow.

## Notes

- Keep `suno.com` open and logged in.
- Select tracks on Suno, then scroll through the selected range so the watcher sees each row.
- Open the extension popup to download watched tracks.
- The popup may start a download automatically when watched tracks are present.
- Batch size is stored locally and can be changed from the extension action context menu.

## Status

Beta. Suno UI changes can break watcher row detection.
