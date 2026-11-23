// Bundles each game into one self-contained HTML file in docs/ (served by GitHub Pages).
import { build } from "esbuild";
import { writeFileSync } from "node:fs";

const games = [
  { file: "InfluenceFloodGlobe", title: "Influence Flood: Globe" },
  { file: "InfluenceFloodRace", title: "Influence Flood: Race" },
  { file: "TruthOrDrink", title: "Truth or Dare or Drink or Toke", bg: "#0a0a1a" },
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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${g.bg || "#0f1420"}">
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Arcade">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<script src="pwa.js" defer></script>
<title>${g.title}</title>
<script src="https://cdn.tailwindcss.com/3.4.16"></script>
<style>html,body{margin:0;background:${g.bg || "#0f1420"}}</style>
</head><body><div id="root"></div><script>${js}</script></body></html>
`);
  console.log("built docs/" + g.file + ".html");
}
