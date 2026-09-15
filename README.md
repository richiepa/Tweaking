# Tweaking

Log how bad you're tweaking, 1 to 10. Slide to a number, add an optional note
or selfie, done. History shows a list of entries and a chart over time, and a
device can hold multiple profiles, each with its own log and profile picture.
See [REQUIREMENTS.md](REQUIREMENTS.md) for the full spec.

Everything — entries, photos, profiles — is stored in your browser's IndexedDB.
**Your log never leaves your device.** No sign-up, no server, no tracking.

## Running it

It's a static site with no build step. Serve the repo root with anything:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying

Host the repo root on any static host (GitHub Pages works: Settings → Pages →
deploy from branch, `/ (root)`). It's a PWA — served over HTTPS it works
offline and can be installed to the home screen from the browser menu.

## Files

| File | What it is |
|------|------------|
| `index.html` | The whole UI |
| `app.css` | Styles (light + dark via `prefers-color-scheme`) |
| `app.js` | Logging, history list, trend chart, IndexedDB storage |
| `sw.js` | Service worker — caches the app shell for offline use |
| `manifest.webmanifest` | PWA manifest (installability) |
| `icons/` | App icon (SVG source + rasterized PNGs) |
