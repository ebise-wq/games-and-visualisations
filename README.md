# Games and visualisations

Play in the browser: https://ebise-wq.github.io/games-and-visualisations/

- `src/` holds the original React (`.jsx`) source for each game.
- `docs/` holds the built, self-contained HTML pages that GitHub Pages serves.
- `docs/MazeRunner.html` is a plain HTML game (three.js), edited directly with no build step.

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
