// Bundles each game into one self-contained HTML file in docs/ (served by GitHub Pages).
import { build } from "esbuild";
import { writeFileSync } from "node:fs";

const BASE = "https://ebise-wq.github.io/games-and-visualisations/";
// `limited`: counts toward the daily game limit (docs/limit.js).
const games = [
  { file: "InfluenceFloodGlobe", title: "Influence Flood: Globe", desc: "Flood the world", img: "globe-2.jpg", limited: true },
  { file: "InfluenceFloodRace", title: "Influence Flood: Race", desc: "Paint, then flood", img: "race-2.jpg", limited: true },
  { file: "TruthOrDrink", title: "Truth or Dare or Drink or Toke", desc: "Answer, dare, or drink", img: "truth-2.jpg", bg: "#0a0a1a" },
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
${g.limited ? '<script src="limit.js" defer></script>\n' : ""}<meta property="og:type" content="website">
<meta property="og:site_name" content="Siebe's Arcade">
<meta property="og:title" content="${g.title}">
<meta property="og:description" content="${g.desc}">
<meta property="og:url" content="${BASE}${g.file}.html">
<meta property="og:image" content="${BASE}img/${g.img}">
<meta property="og:image:width" content="1120">
<meta property="og:image:height" content="840">
<meta name="twitter:card" content="summary_large_image">
<title>${g.title}</title>
<script src="https://cdn.tailwindcss.com/3.4.16"></script>
<style>html,body{margin:0;background:${g.bg || "#0f1420"}}</style>
</head><body><div id="root"></div><script>${js}</script></body></html>
`);
  console.log("built docs/" + g.file + ".html");
}
