# Changelog

## 1.5.0 - Custom 1-10 workflow

- Replaced fixed manual batch buttons with a custom 1-10 count control.
- Added plus/minus controls so the selected count is obvious in the popup.
- Manual DOWNLOAD now uses the selected count for one batch.
- AUTO now repeats the selected count per cycle with no extra delay between completed cycles.
- STOP now marks completed tracks from the current AUTO cycle before exiting.
- Hardened WAV polling when Suno reports complete/ready before returning a URL.
- Kept AUTO stop state cleaner so completed tracks can still be marked before exit.
- Updated popup title to match the current extension name.

## 1.4.10 - Auto Marker polish

- Added a visible AUTO counter in the popup for marked tracks.
- Added an in-popup warning not to scroll Suno while AUTO is running.
- AUTO feed fetching now pages forward so it can continue past the first 20 already-processed tracks.
- Kept cleanup manual and safe: tracks are marked/highlighted, not auto-deleted.

## 1.4.0 - Safer visible-range selection

- Changed batch buttons to 1 / 6 / 16 for a safer visible-range workflow.
- Added automatic Shift-click selection for downloaded cards when the visible batch can be selected safely.
- Kept neon highlight as fallback when Suno selection does not react or virtual scrolling is involved.
- Limited feed fetching to one page to reduce unnecessary requests and avoid risky 20-track virtualized-list selection.

## 1.3.1 - Reliability hardening

- Reset fetch/download state on early token, tab, and setup failures.
- Avoid blanket `storage.local.clear()` calls; remove only extension run-state keys.
- Preserve the last successful batch for manual re-highlight after completion.
- Prepared a cleaner release package workflow for public distribution.

## 1.3.0 - Public GitHub-ready release

- Polished Manifest V3 metadata for public release.
- Renamed extension to `Suno One-Click WAV + Highlight`.
- Added README, privacy policy, license, changelog, and gitignore.
- Generalized highlight CSS/internal labels from old `oneclick5` naming.
- Preserved the last successful batch after completion so manual re-highlight remains possible.
- Kept the working virtualized-list scroll scan for 20-track highlighting.

## 1.2.0

- Added 1 / 5 / 20 batch buttons.
- Added WAV download, lyrics, covers, popup progress, and Suno card highlight.



