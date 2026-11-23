// Bundles each game into one self-contained HTML file in docs/ (served by GitHub Pages).
import { build } from "esbuild";
import { writeFileSync } from "node:fs";

const games = [
  { file: "InfluenceFloodGlobe", title: "Influence Flood: Globe" },
  { file: "InfluenceFloodRace", title: "Influence Flood: Race" },
];

for (const g of games) {
  const entry = `
    import "./src/storage-shim.js";
    import React from "react";
    import { createRoot } from "react-dom/client";
    import Game from "./src/${g.file}.jsx";
    createRoot(document.getElementById("root")).render(React.createElement(Game));
  `;
  const out = await build({
    stdin: { contents: entry, resolveDir: ".", loader: "jsx" },
    bundle: true, minify: true, write: false, format: "iife",
    jsx: "automatic", loader: { ".jsx": "jsx" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const js = out.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
  writeFileSync(`docs/${g.file}.html`, `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${g.title}</title>
<script src="https://cdn.tailwindcss.com/3.4.16"></script>
<style>html,body{margin:0;background:#0f1420}</style>
</head><body><div id="root"></div><script>${js}</script></body></html>
`);
  console.log("built docs/" + g.file + ".html");
}
