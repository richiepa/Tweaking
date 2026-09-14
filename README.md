# Tweaking

Log how bad you're tweaking, 1 to 10. Open it, slide to a number, optionally say
what triggered it, done. Look back at a list of your entries and a chart of your
spiral. See [REQUIREMENTS.md](REQUIREMENTS.md) for the full spec.

Everything is stored in your browser's IndexedDB — **your log never leaves your
device**. No accounts, no server, no tracking.

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
