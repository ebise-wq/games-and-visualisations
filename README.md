# Games and visualisations

Play in the browser: https://ebise-wq.github.io/games-and-visualisations/

- `src/` holds the original React (`.jsx`) source for each game.
- `docs/` holds the built, self-contained HTML pages that GitHub Pages serves.
- `docs/MazeRunner.html` (three.js) and `docs/BoomBust.html` are plain HTML pages, edited directly with no build step.

## Rebuilding after editing a game

```
npm install
npm run build
```

## Notes

The games were first written as Claude artifacts, which have a `window.storage` API.
Here it is replaced by `src/storage-shim.js`, which uses the browser's localStorage.
Stats and settings are saved per browser. Online multiplayer rooms in Race do not
work outside Claude: "shared" storage only reaches other tabs in the same browser.

## Installable app

The arcade is an installable web app (`docs/manifest.json`, `docs/sw.js`, `docs/pwa.js`, `docs/icons/`).
The service worker keeps a copy of every page for offline play.
**After changing any page, bump `VERSION` in `docs/sw.js`**, or installed copies keep the old files.
A new game also needs adding to the `CORE` list in `docs/sw.js`, plus the same head tags as the other pages.
When replacing a thumbnail, save it under a new file name (e.g. `race-3.jpg`), or browsers keep showing the old one.

## Daily game limit

`docs/limit.js` holds one games-per-day limit for the whole arcade (1–5, or no limit),
picked once a day and saved in the browser. A game counts when it starts. The day rolls
over at 04:00. Each game calls `window.Arcade.tryStart()` before starting a new game;
a new game must do the same.
