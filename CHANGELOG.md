# Changelog

## v1.7.1

- Publish a small maintenance update for the main Suno Selection Downloader.
- Keep WAV, lyrics, and cover downloads enabled together with no public per-type toggles.
- Skip tracks already completed during the current side-panel session.
- Auto-clear the collected list after a successful download and immediately resume collection.
- Add `suno-watcher-beta` as a separate beta direction without making it the recommended stable build.
- Polish the public popup footers, documentation, manifests, and release ZIPs.

## Suno Selection Downloader v0.3.7

- Bump extension manifests from `0.3.6` to `0.3.7`.
- Package `suno-selection-downloader-v0.3.7.zip` for GitHub Releases.

## Suno Watcher Beta v0.4.0

- Add beta popup/content-script watcher build in `suno-watcher-beta`.
- Keep the watcher separate from the stable side-panel downloader.
- Mark the extension name and manifest `version_name` as beta.

## v1.7.0

- Make Suno Selection Downloader the only maintained public tool on `main`.
- Move the experimental Auto Marker out of the main branch.
- Clarify the required workflow for Suno virtual scrolling: keep the panel open and slowly scroll selected tracks into view.

## Suno Selection Downloader v0.3.6

- Side panel starts collecting selection immediately when opened.
- Add 1-5 parallel download queue setting.
- Remove startup countdown.
- Add optional `REFRESH SUNO` button.
- Explain Suno virtual scrolling behavior in the UI.

## v1.6.0

- Published two clean extension folders in one repository.
- Added Suno WAV Auto Marker v1.5.1.
- Added Suno Selection Downloader v0.3.6.
- Used English-only public UI and documentation.

Auto Marker is now archived as experimental because it proved unreliable in real Suno workflows.
