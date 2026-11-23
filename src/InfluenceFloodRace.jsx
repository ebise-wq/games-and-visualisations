import React, { useReducer, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { RefreshCw, Trophy, Brain, Paintbrush, HelpCircle, X, Flag, BarChart3, Home, Settings } from "lucide-react";

/*
 * Influence Flood Race
 * --------------------
 * Two players start near the centre of a hexagonal board. Every turn has two
 * steps: (1) paint a tile, then (2) pick a colour to flood with — your whole
 * territory flips to it and absorbs adjacent neutral tiles of that colour.
 *
 * Painting a NEUTRAL tile recolours it. Painting an OPPONENT'S tile (never a
 * start tile) NEUTRALISES it — knocking it loose so you can flood it away or
 * cut their territory. Any painted tile locks permanently. You can't flood with
 * your own current colour or your opponent's. The game ends once the board is
 * partitioned; remaining tiles go to whoever can still reach them. Most wins.
 *
 *   1. PURE GAME LOGIC  — no React, immutable updates, fully testable.
 *   2. AI               — paint-plan selection + alpha-beta minimax.
 *   3. REACT COMPONENT  — rendering + interaction only.
 */

/* ============================================================ *
 *  1. PURE GAME LOGIC
 * ============================================================ */

const PALETTE = ["#d96b5e", "#e3a05f", "#e6d182", "#82b07e", "#6f93c9", "#a382bf"];
const NUM_COLORS = PALETTE.length;
const MAX_CLUSTER = 4;          // no starting monochrome cluster larger than this
const SECOND_MOVER_BONUS = 0;   // extra starting tiles for whoever moves second (knob)
const DEPTH_BY_DIFFICULTY = { easy: 1, medium: 3, hard: 4 };

const STATS_KEY = "ifr:stats";
const DIFFICULTIES = ["easy", "medium", "hard", "expert"];
const blankSide = () => ({ wins: 0, losses: 0, ties: 0, diffSum: 0, games: 0 });
// `youFirst` / `aiFirst` split the same record by who opened — going first is
// worth roughly 11 percentage points, so the combined number alone is misleading.
const blankStat = () => ({ ...blankSide(), youFirst: blankSide(), aiFirst: blankSide() });
const emptyStats = () => ({ easy: blankStat(), medium: blankStat(), hard: blankStat(), expert: blankStat() });

const AXIAL_DIRECTIONS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

const keyOf = (q, r) => `${q},${r}`;
const opponentOf = (player) => (player === "P1" ? "P2" : "P1");
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateCells(radius) {
  const cells = [];
  for (let q = -radius; q <= radius; q++) {
    const rLow = Math.max(-radius, -q - radius);
    const rHigh = Math.min(radius, -q + radius);
    for (let r = rLow; r <= rHigh; r++) cells.push({ q, r });
  }
  return cells;
}

function buildNeighbors(cells, cellSet) {
  const neighbors = new Map();
  for (const { q, r } of cells) {
    const list = [];
    for (const [dq, dr] of AXIAL_DIRECTIONS) {
      const nk = keyOf(q + dq, r + dr);
      if (cellSet.has(nk)) list.push(nk);
    }
    neighbors.set(keyOf(q, r), list);
  }
  return neighbors;
}

/**
 * Random colouring with no monochrome connected cluster larger than `cap`.
 * Cells are assigned in random order; each takes the first colour (in random
 * order) that wouldn't grow a same-colour component past the cap, tracked with
 * a small union-find.
 */
function generateCappedColors(cells, neighbors, cap) {
  const parent = new Map(), size = new Map(), colorOf = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => {
    a = find(a); b = find(b);
    if (a === b) return;
    if (size.get(a) < size.get(b)) [a, b] = [b, a];
    parent.set(b, a); size.set(a, size.get(a) + size.get(b));
  };

  for (const { q, r } of shuffle([...cells])) {
    const k = keyOf(q, r);
    parent.set(k, k); size.set(k, 1);
    const assigned = neighbors.get(k).filter((nb) => colorOf.has(nb));

    let chosen = null, chosenComps = null, chosenTotal = Infinity;
    for (const color of shuffle([...Array(NUM_COLORS).keys()])) {
      const comps = new Set();
      for (const nb of assigned) if (colorOf.get(nb) === color) comps.add(find(nb));
      let total = 1;
      for (const c of comps) total += size.get(c);
      if (total <= cap) { chosen = color; chosenComps = comps; break; }
      if (total < chosenTotal) { chosenTotal = total; chosen = color; chosenComps = comps; }
    }
    colorOf.set(k, chosen);
    for (const c of chosenComps) union(k, c);
  }
  return colorOf;
}

const hexToPixel = (q, r, size) => ({
  x: size * Math.sqrt(3) * (q + r / 2),
  y: size * 1.5 * r,
});

function hexCornerList(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) });
  }
  return pts;
}
const cornersToPoints = (corners) => corners.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");

function countTiles(game) {
  let P1 = 0, P2 = 0, neutral = 0;
  for (const [k, owner] of game.owners) {
    if (game.destroyed.has(k)) continue;
    if (owner === "P1") P1++;
    else if (owner === "P2") P2++;
    else neutral++;
  }
  return { P1, P2, neutral };
}

function legalMoves(game, player) {
  const forbidden = new Set([game.current[player], game.current[opponentOf(player)]]);
  const moves = [];
  for (let c = 0; c < game.numColors; c++) if (!forbidden.has(c)) moves.push(c);
  return moves;
}

/** A tile a player may paint: not locked/destroyed, not a start tile, and neutral or enemy-owned. */
function isPaintTarget(game, player, key) {
  if (game.locked.has(key) || game.destroyed.has(key)) return false;
  if (key === game.homes.P1 || key === game.homes.P2) return false;
  const o = game.owners.get(key);
  return o === null || o === opponentOf(player);
}

/** Any hex can be bombed except the protected starting tiles (both homes, and
 *  the second mover's bonus flank tile), bottleneck-map bridge tiles, and
 *  already-destroyed tiles. */
const isBombTarget = (game, key) =>
  !game.destroyed.has(key) &&
  !(game.startTiles ? game.startTiles.has(key) : (key === game.homes.P1 || key === game.homes.P2)) &&
  !(game.bridgeTiles && game.bridgeTiles.has(key));

/** Paint a tile and lock it. Enemy tiles are neutralised (knocked to neutral). */
function applyPaint(game, key, color) {
  const colors = new Map(game.colors);
  colors.set(key, color);
  const locked = new Set(game.locked);
  locked.add(key);
  let owners = game.owners;
  if (game.owners.get(key) !== null) { // was owned → neutralise
    owners = new Map(game.owners);
    owners.set(key, null);
  }
  return { ...game, colors, locked, owners };
}

/** Flip a player's territory to `color` and flood-absorb matching neutral tiles. */
function applyMove(game, player, color) {
  const colors = new Map(game.colors);
  const owners = new Map(game.owners);
  const queue = [];
  for (const [k, o] of owners) {
    if (o === player) { colors.set(k, color); queue.push(k); }
  }
  while (queue.length > 0) {
    const cur = queue.pop();
    for (const nb of game.neighbors.get(cur)) {
      if (owners.get(nb) === null && !game.destroyed.has(nb) && colors.get(nb) === color) {
        owners.set(nb, player);
        queue.push(nb);
      }
    }
  }
  const current = { ...game.current, [player]: color };
  return { ...game, colors, owners, current };
}

/**
 * Tiles a player could still end up owning, accounting for painting: they can
 * flood through any neutral tile, and neutralise-then-take any enemy tile that
 * isn't a protected home or already locked. A wall of locked tiles (or homes,
 * or the board edge) is the only thing that permanently separates the sides.
 */
function reachableTiles(game, player) {
  const opp = opponentOf(player);
  const seen = new Set();
  const queue = [];
  const passable = (k) => {
    if (game.destroyed.has(k)) return false;        // bombed hole — impassable wall
    const o = game.owners.get(k);
    if (o === player || o === null) return true;   // own tile or neutral (floodable)
    if (k === game.homes[opp]) return false;        // protected enemy home
    return !game.locked.has(k);                      // enemy tile: takeable unless locked
  };
  for (const [k, o] of game.owners) {
    if (o === player && !seen.has(k)) { seen.add(k); queue.push(k); }
  }
  while (queue.length > 0) {
    for (const nb of game.neighbors.get(queue.pop())) {
      if (!seen.has(nb) && passable(nb)) { seen.add(nb); queue.push(nb); }
    }
  }
  return seen;
}

/**
 * The game locks only when no tile could still change hands — the two sides are
 * walled off by locked tiles, homes, or the edge. Then each remaining neutral
 * tile goes to whoever can still reach it.
 */
function resolveIfLocked(game) {
  const r1 = reachableTiles(game, "P1");
  const r2 = reachableTiles(game, "P2");
  for (const k of r1) if (r2.has(k)) return null; // a tile both could take → still contested

  const owners = new Map(game.owners);
  const colors = new Map(game.colors);
  for (const [k, o] of game.owners) {
    if (o !== null || game.destroyed.has(k)) continue;
    if (r1.has(k)) { owners.set(k, "P1"); colors.set(k, game.current.P1); }
    else if (r2.has(k)) { owners.set(k, "P2"); colors.set(k, game.current.P2); }
  }
  const finished = { ...game, owners, colors };
  finished.counts = countTiles(finished);
  return finished;
}

function buildGeometry(radius, carve) {
  let cells = generateCells(radius);
  if (carve) cells = carve(cells);
  const cellSet = new Set(cells.map(({ q, r }) => keyOf(q, r)));
  const neighbors = buildNeighbors(cells, cellSet);
  const size = 480 / (Math.sqrt(3) * (2 * radius + 1));

  const layout = new Map();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { q, r } of cells) {
    const { x, y } = hexToPixel(q, r, size);
    const corners = hexCornerList(x, y, size);
    layout.set(keyOf(q, r), { cx: x, cy: y, corners, points: cornersToPoints(corners) });
    minX = Math.min(minX, x - size); maxX = Math.max(maxX, x + size);
    minY = Math.min(minY, y - size); maxY = Math.max(maxY, y + size);
  }
  const pad = size * 0.5;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
  return { cells, cellSet, neighbors, size, layout, viewBox };
}

let gameSeq = 0;
const EMPTY_SET = new Set();
/**
 * Map variant: a solid wall down the vertical centre column (q=0) — which
 * fully separates the two home sides, since every hex step changes q by at
 * most 1 — pierced by a fixed number of one-tile gaps ("bridges") evenly
 * spaced along its height. Wall cells are simply absent from the board (a
 * void, like the edge), so all existing flood/paint/reachability logic just
 * treats them as impassable with zero extra bookkeeping.
 */
function carveBottleneckWall(bridgeCount) {
  return (cells) => {
    const colRs = cells.filter((c) => c.q === 0).map((c) => c.r).sort((a, b) => a - b);
    const n = colRs.length;
    if (n === 0 || bridgeCount >= n) return cells;
    const gapRs = new Set();
    for (let i = 0; i < bridgeCount; i++) {
      const t = (i + 1) / (bridgeCount + 1); // spread strictly inside the ends
      gapRs.add(colRs[Math.round(t * (n - 1))]);
    }
    return cells.filter((c) => c.q !== 0 || gapRs.has(c.r));
  };
}

const MAP_TYPES = {
  classic: { label: "Classic", carve: null },
  bridges2: { label: "2 Bridges", carve: carveBottleneckWall(2) },
  bridges3: { label: "3 Bridges", carve: carveBottleneckWall(3) },
};

function createGame(radius, mapType = "classic", paintsPerTurn = 1) {
  const carve = MAP_TYPES[mapType]?.carve || null;
  const { cells, cellSet, neighbors, size, layout, viewBox } = buildGeometry(radius, carve);
  const colors = generateCappedColors(cells, neighbors, MAX_CLUSTER);

  const homeP1 = keyOf(1, 0);
  const homeP2 = keyOf(-1, 0);
  if (colors.get(homeP1) === colors.get(homeP2)) {
    colors.set(homeP2, (colors.get(homeP2) + 1) % NUM_COLORS);
  }

  const owners = new Map();
  for (const k of cellSet) owners.set(k, null);
  owners.set(homeP1, "P1");
  owners.set(homeP2, "P2");

  const current = { P1: colors.get(homeP1), P2: colors.get(homeP2) };
  // Going first is a large advantage in this game, so the opening player is
  // chosen at random and their first turn is flood-only (see phase below).
  const firstMover = Math.random() < 0.5 ? "P1" : "P2";
  const secondMover = opponentOf(firstMover);

  // Compensate the second mover with extra tiles on their outer flank.
  const bonusCells = secondMover === "P1"
    ? [keyOf(2, 0), keyOf(2, -1)]
    : [keyOf(-2, 0), keyOf(-2, 1)];
  const startTiles = new Set([homeP1, homeP2]);
  for (let i = 0; i < SECOND_MOVER_BONUS; i++) {
    const k = bonusCells[i];
    if (cellSet.has(k)) { owners.set(k, secondMover); colors.set(k, current[secondMover]); startTiles.add(k); }
  }

  // On a bottleneck map, any surviving cell in the wall's q=0 column is one of
  // the deliberate gaps — protect those from bombing so a lucky blast can't
  // seal off (or newly open) a choke point the map was designed around.
  const bridgeTiles = carve
    ? new Set(cells.filter((c) => c.q === 0).map((c) => keyOf(c.q, c.r)))
    : new Set();

  const game = {
    radius, mapType, size, cells, cellSet, neighbors, layout, viewBox,
    gameId: ++gameSeq,
    colors, owners, current,
    homes: { P1: homeP1, P2: homeP2 },
    startTiles,
    bridgeTiles,
    locked: new Set(),
    destroyed: new Set(),
    bombs: { P1: 1, P2: 1 },
    numColors: NUM_COLORS,
    turn: firstMover,
    firstMover,
    phase: "move",   // opening turn skips the paint step (first-mover handicap)
    paintsPerTurn,
    paintsUsed: 0,
    finished: false,
    resignedBy: null,
    moveCount: 0,
    maxMoves: cells.length * 2,
    neutralMark: undefined,   // unclaimed count at the previous turn
    stall: 0,                 // consecutive turns without the unclaimed count falling
  };
  game.counts = countTiles(game);
  return game;
}

/* ---- Tutorial scenarios (tiny boards, scripted) ---- */

// A clear, distinct 4-colour subset for teaching (red / green / blue / purple).
const TUT_COLORS = [0, 3, 4, 5];

function tutRandomColors(geo) {
  const m = new Map();
  for (const { q, r } of geo.cells) m.set(keyOf(q, r), pickRandom(TUT_COLORS));
  return m;
}

/** Build a tutorial board with placeable homes; P2 optional and static. */
function makeTutorialBoard({ radius = 2, p1 = keyOf(0, 0), p2 = null, p2extra = [] } = {}) {
  const geo = buildGeometry(radius);
  const colors = tutRandomColors(geo);
  const owners = new Map();
  for (const k of geo.cellSet) owners.set(k, null);

  owners.set(p1, "P1");
  const homes = { P1: p1, P2: null };
  const current = { P1: colors.get(p1), P2: -1 };

  if (p2) {
    homes.P2 = p2;
    owners.set(p2, "P2");
    if (colors.get(p2) === colors.get(p1)) {
      colors.set(p2, TUT_COLORS[(TUT_COLORS.indexOf(colors.get(p2)) + 1) % TUT_COLORS.length]);
    }
    current.P2 = colors.get(p2);
    for (const k of p2extra) if (geo.cellSet.has(k)) { owners.set(k, "P2"); colors.set(k, current.P2); }
  }

  const board = {
    ...geo, colors, owners, current, homes,
    locked: new Set(), destroyed: new Set(), numColors: NUM_COLORS,
  };
  board.counts = countTiles(board);
  return board;
}

// Rival board: homes two apart on a radius-3 map — close enough to interact
// quickly, but with a neutral gap so the solid/dashed outlines stay distinct.
// Rival starts with 2 tiles.
const rivalBoard = () => makeTutorialBoard({
  radius: 3, p1: keyOf(-1, 0), p2: keyOf(1, 0), p2extra: [keyOf(1, -1)],
});

// A deliberately feeble rival for the tutorial: each turn it floods the legal
// colour that captures the *fewest* tiles while still taking at least one, so it
// visibly creeps forward but plays badly. (A pure min-gain move is usually a
// 0-tile recolour, which looks like it's doing nothing.)
function tutorialRivalMove(board) {
  if (!board.homes.P2) return board;
  const legal = legalMoves(board, "P2");
  if (legal.length === 0) return board;
  const before = countTiles(board).P2;
  let pick = legal[0], smallestGain = Infinity;
  for (const c of legal) {
    const gain = countTiles(applyMove(board, "P2", c)).P2 - before;
    if (gain > 0 && gain < smallestGain) { smallestGain = gain; pick = c; }
  }
  const nb = applyMove(board, "P2", pick);
  nb.counts = countTiles(nb);
  return nb;
}

const TUTORIAL_STEPS = [
  {
    title: "Flood",
    mode: "flood",
    build: () => makeTutorialBoard({ radius: 2 }),
    instruction: "Tap a colour to flood: your hex flips to it and swallows every touching hex of that colour. You can't pick your own current colour (it's marked ✕). Keep going — try to take the whole board.",
    goal: (b) => b.counts.P1 >= 6,
    success: "That's flooding. Keep grabbing colours to finish the board, or move on.",
  },
  {
    title: "Paint",
    mode: "turn",
    build: () => makeTutorialBoard({ radius: 2 }),
    instruction: "A full turn is two steps. First PAINT — pick a colour, then tap a highlighted hex to recolour it. Painting locks that hex (🔒): once locked, it can't be painted again by you or the rival, so it becomes a permanent wall (you can't undo it). Then FLOOD that colour to absorb it. Painting lets you bridge into clusters you couldn't otherwise reach — try to conquer everything.",
    goal: (b) => b.counts.P1 >= 6,
    success: "Paint-then-flood lets you take any hex eventually. Finish up or continue.",
  },
  {
    title: "Rival",
    mode: "turn",
    opponent: true,
    build: rivalBoard,
    instruction: "The dashed territory is the rival (yours is solid). You can't flood your own colour OR the rival's — both show ✕, so route around them. You can also paint a rival hex to knock it loose, then flood to steal it.",
    goal: (b) => b.counts.P1 >= 12,
    success: "Out-grow the rival by routing around their colour and stealing their edge.",
  },
  {
    title: "Bomb",
    mode: "turn",
    opponent: true,
    bomb: true,
    build: rivalBoard,
    instruction: "You get one 💣 per game — a FREE action, so you still paint and flood the same turn. Arm it in the paint step and tap any hex (not a home) to blow a permanent hole that blocks flooding. Great for walling the rival off.",
    goal: (b) => b.destroyed.size >= 1,
    success: "Holes cut the board in two. That's everything — go play a real game!",
  },
];

/* ============================================================ *
 *  2. AI
 * ============================================================ */

/** Rough board-control proxy: how many tiles this player could still ever
 *  reach, minus how many the opponent could. Independent of current tile
 *  tally, so it stays informative even when material is dead even — e.g. it
 *  drops sharply for a player getting walled into a shrinking pocket. */
function mobilityMargin(game, player) {
  return reachableTiles(game, player).size - reachableTiles(game, opponentOf(player)).size;
}

function minimax(game, player, depth, alpha, beta, aiPlayer) {
  const counts = countTiles(game);
  if (counts.neutral === 0 || depth === 0) {
    return aiPlayer === "P1" ? counts.P1 - counts.P2 : counts.P2 - counts.P1;
  }
  const next = opponentOf(player);
  if (player === aiPlayer) {
    let value = -Infinity;
    for (const m of legalMoves(game, player)) {
      value = Math.max(value, minimax(applyMove(game, player, m), next, depth - 1, alpha, beta, aiPlayer));
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }
  let value = Infinity;
  for (const m of legalMoves(game, player)) {
    value = Math.min(value, minimax(applyMove(game, player, m), next, depth - 1, alpha, beta, aiPlayer));
    beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return value;
}

function bestColorMove(game, player, depth, aiPlayer, positional) {
  let best = -Infinity;
  let moves = [];
  for (const m of legalMoves(game, player)) {
    const v = minimax(applyMove(game, player, m), opponentOf(player), depth - 1, -Infinity, Infinity, aiPlayer);
    if (v > best + 1e-9) { best = v; moves = [m]; }
    else if (Math.abs(v - best) <= 1e-9) moves.push(m);
  }
  // Material-tied floods happen constantly once a player is cordoned off —
  // every option nets ~0 tiles. Rather than pick uniformly at random (which
  // reads as aimless colour-shuffling), prefer whichever tied flood best
  // preserves/extends this player's reach into the rest of the board. This is
  // a strict tie-break only — it never overrides a materially better move,
  // by construction — since blending it into every leaf's raw score let a
  // large mobility swing outweigh a small but real material gain.
  if (positional && moves.length > 1) {
    let bestM = moves[0], bestMargin = -Infinity;
    for (const m of moves) {
      const margin = mobilityMargin(applyMove(game, player, m), aiPlayer);
      if (margin > bestMargin) { bestMargin = margin; bestM = m; }
    }
    moves = [bestM];
  }
  return { value: best, moves };
}

/** Paintable tiles touching either territory — bridge, capture, denial all live here. */
function activePaintTargets(game, player) {
  const set = new Set();
  for (const [k, o] of game.owners) {
    if (o === null) continue;
    for (const nb of game.neighbors.get(k)) if (isPaintTarget(game, player, nb)) set.add(nb);
  }
  return set;
}

/** Pick a single best paint (tile+colour) for `mover`, given the flood that
 *  would follow it — used once per paint slot in a turn. */
function bestSinglePaint(game, mover, depth, positional) {
  const targets = activePaintTargets(game, mover);
  if (targets.size === 0) return null;
  let bestVal = -Infinity, bestPaint = null, bestMoves = [], bestMargin = -Infinity, bestMatches = false;
  for (const tile of targets) {
    for (let color = 0; color < NUM_COLORS; color++) {
      const painted = applyPaint(game, tile, color);
      const r = bestColorMove(painted, mover, depth, mover, positional);
      // Does this candidate's paint colour match its own best flood colour?
      // If so, this turn actually captures the tile it just painted, rather
      // than knocking it neutral for denial and flooding a different colour
      // elsewhere — which is legal and often ties on raw material, but looks
      // (and often is) wasteful, since it leaves a stray locked neutral tile
      // that neither side may ever match colours with again.
      const matches = r.moves.includes(color);
      if (r.value > bestVal + 1e-9) {
        bestVal = r.value; bestPaint = { tile, color }; bestMoves = r.moves; bestMatches = matches;
        bestMargin = positional ? mobilityMargin(applyMove(painted, mover, r.moves[0]), mover) : -Infinity;
      } else if (positional && Math.abs(r.value - bestVal) <= 1e-9) {
        const margin = mobilityMargin(applyMove(painted, mover, r.moves[0]), mover);
        const better = (matches && !bestMatches) || (matches === bestMatches && margin > bestMargin);
        if (better) {
          bestVal = r.value; bestPaint = { tile, color }; bestMoves = r.moves;
          bestMatches = matches; bestMargin = margin;
        }
      }
    }
  }
  return bestPaint;
}


/** Best flood when the paint step is unavailable (the opening turn). */
function chooseFloodOnlyTurn(game, me, evalFn) {
  const legal = legalMoves(game, me);
  if (!legal.length) return { paints: [], move: 0 };
  let best = legal[0], bv = -Infinity;
  for (const col of legal) {
    const g = applyMove(game, me, col);
    const v = evalFn ? evalFn(g, me) : countTiles(g)[me];
    if (v > bv) { bv = v; best = col; }
  }
  return { paints: [], move: best };
}

/**
 * Easy AI: deliberately plays the SECOND-best line rather than the best.
 * Ties are collapsed first, so it always gives up real ground when a weaker
 * option exists — otherwise "second in a sorted list" would often be a move
 * of identical value and no easier to beat.
 */
function chooseEasyTurn(game, me) {
  const cands = allFullTurns(game, me);
  if (!cands.length) return { paints: [], move: 0 };
  const before = countTiles(game)[me];
  for (const cd of cands) cd.val = countTiles(cd.game)[me] - before;
  cands.sort((a, b) => b.val - a.val);
  const bestVal = cands[0].val;
  const weaker = cands.filter((cd) => cd.val < bestVal);
  const pool = weaker.length ? weaker.filter((cd) => cd.val === weaker[0].val) : cands;
  const pick = pickRandom(pool);
  return { paints: pick.paint ? [pick.paint] : [], move: pick.move };
}

/** Pick the AI's full turn: paintsPerTurn mandatory paints, then a flood move. */

/* ============================================================ *
 *  2b. EXPERT AI — paint-aware search + positional evaluation
 *
 *  Hard searches 4 plies but only ever simulates FLOOD choices, so it can
 *  neither build a multi-turn wall nor see one built against it. Expert
 *  searches only 2 plies, but each ply is a COMPLETE turn (paint + flood),
 *  and its leaf evaluation understands territory rather than just tile count.
 *  Neither ingredient helps alone — measured separately both landed at or
 *  below parity with Hard; together they win ~58% over 145 test games, with
 *  the biggest edge on chokepoint maps where walls decide the game.
 * ============================================================ */

// Weights fitted by self-play (cross-entropy method), then confirmed by a
// sweep to sit on a broad optimum:
// [material, frontier, tempo, colourFlexibility, contested, voronoi, exclusiveRegions]
const EXPERT_W = [0.897, 0.088, 0.349, 0.032, -0.179, 0.106, 0.148];

/** Neutral tiles touching a player, and how many distinct colours they span. */
function frontierInfo(game, player) {
  const seen = new Set(), cols = new Set();
  for (const [k, o] of game.owners) {
    if (o !== player) continue;
    for (const nb of game.neighbors.get(k)) {
      if (game.destroyed.has(nb) || game.owners.get(nb) !== null) continue;
      if (!seen.has(nb)) { seen.add(nb); cols.add(game.colors.get(nb)); }
    }
  }
  return { size: seen.size, colours: cols.size, set: seen };
}

/** Largest capture this player could make on their very next flood. */
function bestImmediateGain(game, player) {
  const before = countTiles(game)[player];
  let best = 0;
  for (const c of legalMoves(game, player)) {
    const g = countTiles(applyMove(game, player, c))[player] - before;
    if (g > best) best = g;
  }
  return best;
}

/** Multi-source BFS from both territories: who reaches each neutral tile first. */
function voronoiInfluence(game) {
  const dist = new Map(), owner = new Map();
  let queue = [];
  for (const [k, o] of game.owners) {
    if (o === null || game.destroyed.has(k)) continue;
    dist.set(k, 0); owner.set(k, o); queue.push(k);
  }
  let d = 0;
  while (queue.length) {
    const next = [];
    for (const k of queue) {
      for (const nb of game.neighbors.get(k)) {
        if (game.destroyed.has(nb) || game.owners.get(nb) !== null) continue;
        const nd = d + 1;
        if (!dist.has(nb)) { dist.set(nb, nd); owner.set(nb, owner.get(k)); next.push(nb); }
        else if (dist.get(nb) === nd && owner.get(nb) !== owner.get(k)) owner.set(nb, "tie");
      }
    }
    queue = next; d++;
  }
  let P1 = 0, P2 = 0, tie = 0;
  for (const [k, o] of game.owners) {
    if (o !== null || game.destroyed.has(k)) continue;
    const w = owner.get(k);
    if (w === "P1") P1++; else if (w === "P2") P2++; else tie++;
  }
  return { P1, P2, tie };
}

/** Open regions only one side can still touch — i.e. already walled off. */
function exclusiveRegions(game) {
  const seen = new Set();
  let exclP1 = 0, exclP2 = 0;
  for (const [start, o] of game.owners) {
    if (o !== null || game.destroyed.has(start) || seen.has(start)) continue;
    const comp = [start]; seen.add(start);
    const touch = new Set();
    let i = 0;
    while (i < comp.length) {
      const k = comp[i++];
      for (const nb of game.neighbors.get(k)) {
        if (game.destroyed.has(nb)) continue;
        const no = game.owners.get(nb);
        if (no === null) { if (!seen.has(nb)) { seen.add(nb); comp.push(nb); } }
        else touch.add(no);
      }
    }
    const t1 = touch.has("P1"), t2 = touch.has("P2");
    if (t1 && !t2) exclP1 += comp.length;
    else if (t2 && !t1) exclP2 += comp.length;
  }
  return { exclP1, exclP2 };
}

/** Positional score of a finished position from `me`'s point of view. */
function expertEval(game, me) {
  const opp = opponentOf(me);
  const N = game.cells.length;
  const c = countTiles(game);
  const fMe = frontierInfo(game, me), fOp = frontierInfo(game, opp);
  let contested = 0;
  for (const k of fMe.set) if (fOp.set.has(k)) contested++;
  const vor = voronoiInfluence(game);
  const reg = exclusiveRegions(game);
  const sign = me === "P1" ? 1 : -1;
  const f = [
    (c[me] - c[opp]) / N,
    (fMe.size - fOp.size) / N,
    (bestImmediateGain(game, me) - bestImmediateGain(game, opp)) / N,
    (fMe.colours - fOp.colours) / NUM_COLORS,
    contested / N,
    (sign * (vor.P1 - vor.P2)) / N,
    (sign * (reg.exclP1 - reg.exclP2)) / N,
  ];
  let s = 0;
  for (let i = 0; i < f.length; i++) s += EXPERT_W[i] * f[i];
  return s;
}

/** Every legal complete turn (paint + flood) for a player. */
function allFullTurns(game, mover) {
  const out = [];
  const push = (paint, painted) => {
    for (const col of legalMoves(painted, mover)) {
      out.push({ paint, move: col, game: applyMove(painted, mover, col) });
    }
  };
  const targets = activePaintTargets(game, mover);
  if (targets.size === 0) { push(null, game); return out; }
  for (const tile of targets) {
    for (let col = 0; col < NUM_COLORS; col++) push({ tile, color: col }, applyPaint(game, tile, col));
  }
  return out;
}

/** Best K turns by immediate tile gain — a prune that keeps strong moves. */
function topTurns(game, player, K) {
  const cands = allFullTurns(game, player);
  if (!cands.length) return [];
  const before = countTiles(game)[player];
  for (const cd of cands) cd.mat = countTiles(cd.game)[player] - before;
  cands.sort((a, b) => b.mat - a.mat);
  return cands.slice(0, K);
}

/** Expert turn: maximise the position after the opponent's best full reply. */
function chooseExpertTurn(game, me, K1 = 20, K2 = 8) {
  const mine = topTurns(game, me, K1);
  if (!mine.length) {
    const legal = legalMoves(game, me);
    return { paints: [], move: legal.length ? legal[0] : 0 };
  }
  const opp = opponentOf(me);
  let best = null, bestV = -Infinity;
  for (const cd of mine) {
    const theirs = topTurns(cd.game, opp, K2);
    let worst;
    if (!theirs.length) worst = expertEval(cd.game, me);
    else {
      worst = Infinity;
      for (const t of theirs) {
        const v = expertEval(t.game, me);
        if (v < worst) worst = v;
      }
    }
    if (worst > bestV) { bestV = worst; best = cd; }
  }
  return { paints: best.paint ? [best.paint] : [], move: best.move };
}

function chooseAITurn(game, aiPlayer, depth, positional, paintsPerTurn = 1) {
  let g = game;
  const paints = [];
  for (let i = 0; i < paintsPerTurn; i++) {
    const paint = bestSinglePaint(g, aiPlayer, depth, positional);
    if (!paint) break; // no legal paint targets left this turn — stop early
    paints.push(paint);
    g = applyPaint(g, paint.tile, paint.color);
  }
  const r = bestColorMove(g, aiPlayer, depth, aiPlayer, positional);
  return { paints, move: positional ? r.moves[0] : pickRandom(r.moves) };
}

/* ============================================================ *
 *  3. REACT COMPONENT
 * ============================================================ */

/* ---- Online play: room codes, storage helpers, game (de)serialization ---- */

// Excludes visually-ambiguous characters (0/O, 1/I) since people read these off a screen to a friend.
const ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function genRoomCode() {
  let s = "";
  for (let i = 0; i < 5; i++) s += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  return s;
}
const roomKey = (code) => `ifr-room:${code}`;

async function storageGetJSON(key, shared) {
  try {
    const r = await window.storage.get(key, shared);
    return r && r.value ? JSON.parse(r.value) : null;
  } catch (e) {
    return null; // per storage API: missing keys throw rather than return null
  }
}
// Deliberately does NOT swallow errors — a silent catch here was hiding the
// real cause behind a generic "couldn't create a room" message. Callers catch
// this themselves and show the actual error so it's diagnosable.
async function storageSetJSON(key, obj, shared) {
  return await window.storage.set(key, JSON.stringify(obj), shared);
}

/** Game state -> plain JSON-safe object (Maps/Sets have no JSON form). */
/** Wire payload = only what can't be regenerated locally (colours, ownership,
 *  turn/progress state). Geometry (cells/neighbors/layout/viewBox/size) is
 *  fully deterministic from radius+mapType, so it's rebuilt on receipt rather
 *  than shipped — keeps the payload small and avoids depending on any
 *  transport's tolerance for large, deeply-nested values. */
function serializeGame(game) {
  return {
    radius: game.radius,
    mapType: game.mapType,
    gameId: game.gameId,
    colors: Object.fromEntries(game.colors),
    owners: Object.fromEntries(game.owners),
    current: game.current,
    homes: game.homes,
    startTiles: [...(game.startTiles || [])],
    bridgeTiles: [...(game.bridgeTiles || [])],
    locked: [...game.locked],
    destroyed: [...game.destroyed],
    bombs: game.bombs,
    numColors: game.numColors,
    turn: game.turn,
    phase: game.phase,
    paintsPerTurn: game.paintsPerTurn,
    paintsUsed: game.paintsUsed,
    finished: game.finished,
    resignedBy: game.resignedBy,
    moveCount: game.moveCount,
    maxMoves: game.maxMoves,
    neutralMark: game.neutralMark,
    stall: game.stall,
  };
}

/** Inverse of serializeGame — rebuilds geometry deterministically from
 *  radius+mapType, then layers the synced tile/turn state on top. */
function deserializeGame(obj) {
  const carve = MAP_TYPES[obj.mapType]?.carve || null;
  const geo = buildGeometry(obj.radius, carve);
  const game = {
    ...geo,
    radius: obj.radius,
    mapType: obj.mapType,
    gameId: obj.gameId,
    colors: new Map(Object.entries(obj.colors)),
    owners: new Map(Object.entries(obj.owners)),
    current: obj.current,
    homes: obj.homes,
    startTiles: new Set(obj.startTiles || []),
    bridgeTiles: new Set(obj.bridgeTiles || []),
    locked: new Set(obj.locked),
    destroyed: new Set(obj.destroyed),
    bombs: obj.bombs,
    numColors: obj.numColors,
    turn: obj.turn,
    phase: obj.phase,
    paintsPerTurn: obj.paintsPerTurn,
    paintsUsed: obj.paintsUsed,
    finished: obj.finished,
    resignedBy: obj.resignedBy,
    moveCount: obj.moveCount,
    maxMoves: obj.maxMoves,
    neutralMark: obj.neutralMark,
    stall: obj.stall,
  };
  game.counts = countTiles(game);
  return game;
}

// If the unclaimed count stops falling, neither side is taking new ground and
// the game has degenerated into swapping single tiles back and forth. Painting
// an enemy tile makes it neutral and flooding takes it straight back, so the
// neutral count oscillates and never reaches zero — the old end condition could
// never fire, leaving a decided game to grind on to the move cap.
const STALL_LIMIT = 6;

function finishedAfterMove(game) {
  const counts = countTiles(game);
  // Track the LOWEST unclaimed count ever reached, not the previous turn's:
  // painting an enemy tile makes it neutral again, so the count oscillates
  // (2 -> 1 -> 2 -> 1) and a turn-on-turn comparison sees false progress.
  // Real progress means reaching a new low.
  const prevMin = game.neutralMark === undefined ? Infinity : game.neutralMark;
  const progressed = counts.neutral < prevMin;
  const stall = progressed ? 0 : (game.stall || 0) + 1;
  const tracked = { ...game, counts, neutralMark: Math.min(prevMin, counts.neutral), stall };
  if (counts.neutral === 0 || game.moveCount >= game.maxMoves || stall >= STALL_LIMIT) {
    return { game: tracked, finished: true };
  }
  const locked = resolveIfLocked(game);
  if (locked) return { game: { ...locked, neutralMark: Math.min(prevMin, counts.neutral), stall }, finished: true };
  return { game: tracked, finished: false };
}

function settleTurn(gameAfterMove, player) {
  const { game, finished } = finishedAfterMove(gameAfterMove);
  return { ...game, finished, turn: finished ? player : opponentOf(player), phase: "paint" };
}

function gameReducer(state, action) {
  switch (action.type) {
    case "NEW_GAME": {
      const g = createGame(action.radius, action.mapType, action.paintsPerTurn || 1);
      return action.noBombs ? { ...g, bombs: { P1: 0, P2: 0 } } : g;
    }

    case "SYNC_STATE":
      // Online play: adopt a game object wholesale, whether it's a freshly
      // created/joined room or a state pulled from the opponent's last move.
      return action.game;

    case "RESIGN":
      if (state.finished) return state;
      return { ...state, finished: true, resignedBy: action.player };

    case "PAINT": {
      if (state.finished || state.phase !== "paint") return state;
      if (!isPaintTarget(state, state.turn, action.key)) return state;
      const painted = applyPaint(state, action.key, action.color);
      const paintsUsed = (state.paintsUsed || 0) + 1;
      if (paintsUsed >= (state.paintsPerTurn || 1)) {
        return { ...painted, phase: "move", paintsUsed: 0 };
      }
      return { ...painted, paintsUsed };
    }

    case "SKIP_PAINT":
      if (state.finished || state.phase !== "paint") return state;
      return { ...state, phase: "move", paintsUsed: 0 };

    case "BOMB": {
      if (state.finished) return state;
      const player = state.turn;
      if (state.bombs[player] <= 0 || !isBombTarget(state, action.key)) return state;
      const destroyed = new Set(state.destroyed);
      destroyed.add(action.key);
      const owners = new Map(state.owners);
      owners.set(action.key, null);
      return {
        ...state, destroyed, owners,
        bombs: { ...state.bombs, [player]: state.bombs[player] - 1 },
      };
    }

    case "MOVE": {
      const player = state.turn;
      if (state.finished || state.phase !== "move") return state;
      if (!legalMoves(state, player).includes(action.color)) return state;
      const moved = { ...applyMove(state, player, action.color), moveCount: state.moveCount + 1 };
      return settleTurn(moved, player);
    }

    case "AI_TURN": {
      const player = state.turn;
      if (state.finished) return state;
      let g = state;
      const { paints, move } = action.plan;
      if (g.phase === "paint") {
        for (const p of paints || []) {
          if (p && isPaintTarget(g, player, p.tile)) g = applyPaint(g, p.tile, p.color);
        }
      }
      const legal = legalMoves(g, player);
      const chosen = legal.includes(move) ? move : legal[0];
      const moved = { ...applyMove(g, player, chosen), moveCount: g.moveCount + 1 };
      return settleTurn(moved, player);
    }

    default:
      return state;
  }
}

// Which two corner indices form the hex edge crossed by each axial direction.
const EDGE_BY_DIRECTION = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];

// Ownership is shown by the territory outline only — tiles keep their flood
// colour. Solid border = you (P1); dashed border = opponent (P2). No extra hues.
const OWNER_OUTLINE = { P1: { dash: null }, P2: { dash: 0.45 } };

/* ---- Sleep guard: the game is unavailable overnight ---- */

const QUIET_START = 23;   // 11pm
const QUIET_END = 8;      // 8am

function inQuietHours(d = new Date()) {
  const h = d.getHours();
  return h >= QUIET_START || h < QUIET_END;
}

/** Minutes until the gate lifts, for a concrete "come back at" message. */
function minutesUntilOpen(d = new Date()) {
  const open = new Date(d);
  open.setMinutes(0, 0, 0);
  open.setHours(QUIET_END);
  if (d.getHours() >= QUIET_START) open.setDate(open.getDate() + 1);
  return Math.max(0, Math.round((open - d) / 60000));
}

function QuietHoursScreen() {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);
  const mins = minutesUntilOpen();
  const h = Math.floor(mins / 60), m = mins % 60;
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6"
         style={{ backgroundColor: "#020617", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="w-full max-w-sm text-center text-slate-300">
        <div className="text-4xl mb-4">🌙</div>
        <h1 className="text-xl font-bold text-slate-100">Closed for the night</h1>
        <p className="text-sm mt-3 leading-relaxed">
          You asked to be kept out of this game between {QUIET_START}:00 and 0{QUIET_END}:00.
        </p>
        <p className="text-sm mt-4 text-slate-400">
          Opens again in <span className="font-semibold text-slate-200 tabular-nums">{h}h {m}m</span>.
        </p>
        <p className="text-xs mt-6 text-slate-600 leading-relaxed">
          No override in here — that's the point. Go to sleep.
        </p>
      </div>
    </div>
  );
}

export default function InfluenceFloodRace() {
  const [config, setConfig] = useState({ radius: 5, difficulty: "medium", mode: "ai", mapType: "classic", paintsPerTurn: 1 });
  const [state, dispatch] = useReducer(gameReducer, config.radius, (radius) => createGame(radius, config.mapType, config.paintsPerTurn));
  const newGameAction = () => ({
    type: "NEW_GAME",
    radius: config.radius,
    mapType: config.mapType,
    paintsPerTurn: config.paintsPerTurn,
    noBombs: config.mode === "ai" && (config.difficulty === "hard" || config.difficulty === "expert"),
  });
  const [thinking, setThinking] = useState(false);
  const [paintColor, setPaintColor] = useState(null);
  const [bombMode, setBombMode] = useState(false);
  const [bombTarget, setBombTarget] = useState(null);
  const [started, setStarted] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showOnlineLobby, setShowOnlineLobby] = useState(false);
  const [roomCode, setRoomCode] = useState(null);
  const [mySeat, setMySeat] = useState(null);
  const lastAppliedRef = useRef(0);
  const [resignConfirm, setResignConfirm] = useState(false);
  const [stats, setStats] = useState(emptyStats);
  const firstRender = useRef(true);
  const recordedRef = useRef(false);
  const [history, setHistory] = useState([]);   // one snapshot per completed move
  const [replayIndex, setReplayIndex] = useState(null); // null = live play
  const histMeta = useRef({ gameId: null, moveCount: -1 });
  // --- match logging (for offline analysis of real human play) ---
  const logRef = useRef({ meta: null, actions: [] });
  const cellIdxRef = useRef(new Map());
  const [sessionLog, setSessionLog] = useState([]);
  const loggedGameRef = useRef(null);
  // Snapshots taken before each paint this turn, so a paint can be taken back
  // before it is committed by flooding. Cleared whenever the turn advances.
  const [undoStack, setUndoStack] = useState([]);
  // Re-checked every 30s so the gate also closes mid-session at 23:00.
  const [quietHours, setQuietHours] = useState(() => inQuietHours());
  useEffect(() => {
    const id = setInterval(() => setQuietHours(inQuietHours()), 30000);
    return () => clearInterval(id);
  }, []);
  const logAction = useCallback((entry) => {
    if (logRef.current && logRef.current.meta) logRef.current.actions.push(entry);
  }, []);

  // Load saved stats once (storage may be unavailable — degrade gracefully).
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage?.get(STATS_KEY);
        if (r?.value) setStats({ ...emptyStats(), ...JSON.parse(r.value) });
      } catch (e) { /* no saved stats yet */ }
    })();
  }, []);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    dispatch(newGameAction());
  }, [config.radius, config.mode, config.mapType, config.difficulty, config.paintsPerTurn]);

  const isAITurn = config.mode === "ai" && state.turn === "P2" && !state.finished;
  const humanTurn = !state.finished && (
    config.mode === "hotseat" ? true :
    config.mode === "online" ? state.turn === mySeat :
    state.turn === "P1"
  );
  const paintPhase = humanTurn && state.phase === "paint";
  const movePhase = humanTurn && state.phase === "move";

  // Push my move to the shared room so my opponent's client can pick it up.
  const pushRoom = useCallback(async (nextGame) => {
    if (config.mode !== "online" || !roomCode) return;
    const room = await storageGetJSON(roomKey(roomCode), true);
    const now = Date.now();
    const payload = { ...(room || { seats: { P1: true, P2: true } }), game: serializeGame(nextGame), updatedAt: now };
    lastAppliedRef.current = now;
    storageSetJSON(roomKey(roomCode), payload, true);
  }, [config.mode, roomCode]);

  // Poll the room for the opponent's latest move while an online game is live.
  useEffect(() => {
    if (config.mode !== "online" || !roomCode || !started || state.finished) return;
    let cancelled = false;
    const tick = async () => {
      const room = await storageGetJSON(roomKey(roomCode), true);
      if (cancelled || !room || !room.updatedAt) return;
      if (room.updatedAt > lastAppliedRef.current) {
        lastAppliedRef.current = room.updatedAt;
        dispatch({ type: "SYNC_STATE", game: deserializeGame(room.game) });
      }
    };
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [config.mode, roomCode, started, state.finished]);

  useEffect(() => { setPaintColor(null); setBombMode(false); setBombTarget(null); }, [state.turn, state.phase]);

  // Build the move history for replay: frame 0 is the fresh board, then one
  // snapshot per completed turn (moveCount increments). Reset on a new game.
  useEffect(() => {
    const m = histMeta.current;
    if (state.gameId !== m.gameId) {
      histMeta.current = { gameId: state.gameId, moveCount: state.moveCount };
      setHistory([state]);
      setReplayIndex(null);
    } else if (state.moveCount > m.moveCount) {
      histMeta.current = { gameId: m.gameId, moveCount: state.moveCount };
      setHistory((h) => [...h, state]);
    }
  }, [state]);

  // Snapshot the starting board whenever a new game begins. Storing the initial
  // colour layout plus the full action list lets a game be replayed exactly
  // offline, which is what the analysis needs — far smaller than dumping a
  // board state per turn.
  useEffect(() => {
    const idx = new Map();
    state.cells.forEach(({ q, r }, i) => idx.set(keyOf(q, r), i));
    cellIdxRef.current = idx;
    logRef.current = {
      meta: {
        gameId: state.gameId,
        radius: state.radius,
        mapType: state.mapType || "classic",
        paintsPerTurn: state.paintsPerTurn || 1,
        mode: config.mode,
        difficulty: config.difficulty,
        first: state.turn,        // who moved first (now randomised)
        colors: state.cells.map(({ q, r }) => state.colors.get(keyOf(q, r))).join(""),
        startedAt: new Date().toISOString(),
      },
      actions: [],
    };
    loggedGameRef.current = null;
  }, [state.gameId]);

  // Commit a finished game to the session log exactly once.
  useEffect(() => {
    if (!state.finished || !started) return;
    if (!logRef.current || !logRef.current.meta) return;
    if (loggedGameRef.current === state.gameId) return;
    loggedGameRef.current = state.gameId;
    const m = logRef.current.meta;
    // Compact single-line encoding: cells are referenced by index and actions by
    // short tokens, which is ~4x smaller than JSON — small enough to paste on
    // mobile, where file downloads are blocked.
    const line = [
      "2", m.radius, m.mapType, m.paintsPerTurn, m.difficulty, m.first, m.colors,
      logRef.current.actions.join(","),
      `${state.counts.P1}-${state.counts.P2}${state.resignedBy ? (state.resignedBy === "P1" ? "r1" : "r2") : ""}`,
    ].join("|");
    setSessionLog((l) => [...l, line]);
  }, [state.finished, state.gameId, started]);

  // AI plays a whole turn at once.
  useEffect(() => {
    if (!started || !isAITurn || replayIndex !== null) return;
    setThinking(true);
    const id = setTimeout(() => {
      const aiPlan = state.phase === "move"
        ? chooseFloodOnlyTurn(state, "P2",
            config.difficulty === "expert" ? expertEval : null)
        : config.difficulty === "expert"
          ? chooseExpertTurn(state, "P2")
          : config.difficulty === "easy"
            ? chooseEasyTurn(state, "P2")
            : chooseAITurn(
                state, "P2", DEPTH_BY_DIFFICULTY[config.difficulty],
                config.difficulty === "hard",
                state.paintsPerTurn || 1
              );
      logAction(`A${(aiPlan.paints || []).map((p) => cellIdxRef.current.get(p.tile) + "." + p.color).join(";")}-${aiPlan.move}`);
      dispatch({ type: "AI_TURN", plan: aiPlan });
      setThinking(false);
    }, 420);
    return () => { clearTimeout(id); setThinking(false); };
  }, [started, isAITurn, state, config.difficulty, replayIndex]);

  const paintable = useMemo(() => {
    if (!paintPhase) return new Set();
    return allPaintTargets(state, state.turn);
  }, [paintPhase, state]);

  // If there's genuinely nothing to paint (rare, near game end), skip the step.
  useEffect(() => {
    if (paintPhase && paintable.size === 0) {
      logAction("S");
      dispatch({ type: "SKIP_PAINT" });
      if (config.mode === "online") pushRoom(gameReducer(state, { type: "SKIP_PAINT" }));
    }
  }, [paintPhase, paintable]);

  const legalForTurn = useMemo(
    () => (movePhase ? legalMoves(state, state.turn) : []),
    [movePhase, state]
  );

  const previews = useMemo(() => {
    if (!movePhase) return {};
    const before = state.counts[state.turn];
    const res = {};
    for (const c of legalForTurn) res[c] = countTiles(applyMove(state, state.turn, c))[state.turn] - before;
    return res;
  }, [movePhase, state, legalForTurn]);

  // Same idea, but computed on the *current* board before this turn's paint —
  // lets the player see what flooding would yield right now, to help decide
  // whether/where to paint at all.
  const prePaintLegal = useMemo(
    () => (paintPhase ? legalMoves(state, state.turn) : []),
    [paintPhase, state]
  );
  const prePaintPreviews = useMemo(() => {
    if (!paintPhase) return {};
    const before = state.counts[state.turn];
    const res = {};
    for (const c of prePaintLegal) res[c] = countTiles(applyMove(state, state.turn, c))[state.turn] - before;
    return res;
  }, [paintPhase, state, prePaintLegal]);

  // The two colours that can't be flooded this turn: your own and your rival's.
  const blockedFlood = useMemo(
    () => new Set(humanTurn ? [state.current[state.turn], state.current[opponentOf(state.turn)]] : []),
    [humanTurn, state]
  );

  const bombable = useMemo(() => {
    if (!bombMode) return new Set();
    const s = new Set();
    for (const k of state.cellSet) if (isBombTarget(state, k)) s.add(k);
    return s;
  }, [bombMode, state]);

  const inReplay = replayIndex !== null;
  const view = inReplay && history[replayIndex] ? history[replayIndex] : state;

  const selectable = inReplay || bombTarget ? EMPTY_SET : (bombMode ? bombable : paintable);
  const selectColor = bombMode ? "#f43f5e" : "#fbbf24";

  const onTileClick = useCallback((key) => {
    if (inReplay) return;
    if (bombMode) {
      // First tap just arms a pending target — detonation needs an explicit Confirm.
      if (!bombTarget && isBombTarget(state, key)) setBombTarget(key);
      return;
    }
    if (paintPhase && paintColor != null && paintable.has(key)) {
      const action = { type: "PAINT", key, color: paintColor };
      // Capture the log length NOW, not inside the updater: React runs updater
      // functions lazily, by which time logAction below has already appended the
      // paint token — making the snapshot one entry too long and leaving the
      // undone paint in the exported match log.
      const snapshot = { state, logLen: logRef.current.actions.length };
      setUndoStack((s) => [...s, snapshot]);
      logAction(`P${cellIdxRef.current.get(key)}.${paintColor}`);
      dispatch(action);
      if (config.mode === "online") pushRoom(gameReducer(state, action));
    }
  }, [inReplay, bombMode, bombTarget, state, paintPhase, paintColor, paintable, config.mode, pushRoom, logAction]);

  const undoPaint = useCallback(() => {
    if (!undoStack.length) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    // Keep the match log honest: drop the token(s) written by the undone paint.
    if (logRef.current && logRef.current.actions) logRef.current.actions.length = last.logLen;
    dispatch({ type: "SYNC_STATE", game: last.state });
    if (config.mode === "online") pushRoom(last.state);
    setPaintColor(null);
    setBombMode(false);
    setBombTarget(null);
  }, [undoStack, config.mode, pushRoom]);

  // A completed turn (or a new game) makes earlier paints permanent.
  useEffect(() => { setUndoStack([]); }, [state.moveCount, state.gameId]);

  const confirmBomb = useCallback(() => {
    if (!bombTarget) return;
    const action = { type: "BOMB", key: bombTarget };
    logAction(`B${cellIdxRef.current.get(bombTarget)}`);
    dispatch(action);
    if (config.mode === "online") pushRoom(gameReducer(state, action));
    setBombMode(false);
    setBombTarget(null);
  }, [bombTarget, state, config.mode, pushRoom, logAction]);

  const onPickColor = useCallback((color) => {
    if (movePhase && legalForTurn.includes(color)) {
      const action = { type: "MOVE", color };
      logAction(`F${color}`);
      dispatch(action);
      if (config.mode === "online") pushRoom(gameReducer(state, action));
    }
  }, [movePhase, legalForTurn, state, config.mode, pushRoom, logAction]);

  const seekReplay = useCallback((i) => {
    setReplayIndex((cur) => {
      const len = history.length;
      if (len === 0) return cur;
      return Math.max(0, Math.min(len - 1, i));
    });
  }, [history.length]);

  // Influence = which side is NEAREST to each unclaimed tile (Voronoi). Always
  // shown while reviewing a game; optional during live play.
  // Influence is an analysis aid, not a live HUD — shown only while reviewing.
  const showInf = inReplay;
  const influence = useMemo(() => (showInf ? voronoiInfluence(view) : null), [showInf, view]);
  const { P1, P2, neutral } = view.counts;
  const total = P1 + P2 + neutral;
  const winner = state.finished
    ? (state.resignedBy ? opponentOf(state.resignedBy) : (state.counts.P1 > state.counts.P2 ? "P1" : state.counts.P2 > state.counts.P1 ? "P2" : "tie"))
    : null;

  // Record one result per finished game (only vs AI, where difficulty applies).
  useEffect(() => {
    if (!state.finished) { recordedRef.current = false; setResignConfirm(false); return; }
    if (recordedRef.current || config.mode !== "ai") return;
    recordedRef.current = true;
    const fP1 = state.counts.P1, fP2 = state.counts.P2;
    const outcome = state.resignedBy
      ? (state.resignedBy === "P1" ? "loss" : "win")
      : (fP1 > fP2 ? "win" : fP2 > fP1 ? "loss" : "tie");
    const diff = fP1 - fP2;
    const youStarted = state.firstMover === "P1";
    setStats((prev) => {
      const d = prev[config.difficulty] || blankStat();
      const bump = (s) => ({
        wins: (s?.wins || 0) + (outcome === "win" ? 1 : 0),
        losses: (s?.losses || 0) + (outcome === "loss" ? 1 : 0),
        ties: (s?.ties || 0) + (outcome === "tie" ? 1 : 0),
        diffSum: (s?.diffSum || 0) + diff,
        games: (s?.games || 0) + 1,
      });
      const updated = {
        ...bump(d),
        youFirst: youStarted ? bump(d.youFirst) : (d.youFirst || blankSide()),
        aiFirst: youStarted ? (d.aiFirst || blankSide()) : bump(d.aiFirst),
      };
      const next = { ...prev, [config.difficulty]: updated };
      try { window.storage?.set(STATS_KEY, JSON.stringify(next)); } catch (e) { /* unavailable */ }
      return next;
    });
  }, [state.finished]);

  const resetStats = useCallback(() => {
    const cleared = emptyStats();
    setStats(cleared);
    try { window.storage?.set(STATS_KEY, JSON.stringify(cleared)); } catch (e) { /* unavailable */ }
  }, []);

  const turnName = config.mode === "hotseat"
    ? (state.turn === "P1" ? "Player 1" : "Player 2")
    : config.mode === "online"
    ? (state.turn === mySeat ? "Your turn" : "Opponent's turn")
    : (state.turn === "P1" ? "You" : "AI");

  // Every hook above runs unconditionally; only the output is gated, so the
  // hook order stays stable when the window opens or closes mid-session.
  if (quietHours) return <QuietHoursScreen />;

  return (
    <div className="min-h-screen w-full flex justify-center bg-slate-950 text-slate-100 p-4 sm:p-6"
         style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div className="w-full max-w-xl flex flex-col gap-4">

        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Influence Flood Race</h1>
            <p className="text-xs text-slate-400 mt-0.5">Paint, then flood. Most territory wins.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowStats(true)} title="Stats"
              className="flex items-center justify-center bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-lg p-2 transition-colors">
              <BarChart3 size={16} />
            </button>
            <button onClick={() => setShowHelp(true)} title="How to play"
              className="flex items-center justify-center bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-lg p-2 transition-colors">
              <HelpCircle size={16} />
            </button>
            {config.mode === "online" ? (
              <span className="flex items-center gap-1.5 text-xs font-medium bg-slate-800 rounded-lg px-3 py-2 tracking-wider">
                Room {roomCode}
              </span>
            ) : (
              <button onClick={() => dispatch(newGameAction())}
                className="flex items-center gap-1.5 text-sm font-medium bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-lg px-3 py-2 transition-colors">
                <RefreshCw size={15} /> New game
              </button>
            )}
          </div>
        </header>

        <Scoreboard P1={P1} P2={P2} neutral={neutral} total={total}
                    p1Color={view.current.P1} p2Color={view.current.P2}
                    mode={config.mode} mySeat={mySeat} turn={view.turn} finished={view.finished}
                    influence={influence} />

        <div className="relative rounded-2xl bg-slate-900 ring-1 ring-slate-800 p-3 sm:p-4">
          <Board state={view} selectable={selectable} selectColor={selectColor} onTileClick={onTileClick} pendingKey={inReplay ? null : bombTarget} pendingColor="#f43f5e" />
          {winner && !inReplay && (
            <WinnerOverlay winner={winner} P1={state.counts.P1} P2={state.counts.P2} mode={config.mode} mySeat={mySeat} resignedBy={state.resignedBy}
                           onPlayAgain={() => {
                             if (config.mode === "online") {
                               setRoomCode(null); setMySeat(null); setStarted(false); setShowSetup(true);
                             } else {
                               dispatch(newGameAction());
                             }
                           }}
                           onReplay={history.length > 1 ? () => seekReplay(0) : null} />
          )}
        </div>

        {inReplay ? (
          <ReplayBar
            index={replayIndex}
            total={history.length}
            finished={state.finished}
            onSeek={seekReplay}
            onExit={() => setReplayIndex(null)}
            onPlayAgain={() => { setReplayIndex(null); dispatch(newGameAction()); }} />
        ) : (
        <>
        {/* Turn + step indicator */}
        <div className="flex items-center justify-center gap-3 text-sm h-6">
          {thinking ? (
            <span className="flex items-center gap-1.5 text-slate-300"><Brain size={15} className="animate-pulse" /> AI is thinking…</span>
          ) : state.finished ? (
            <span className="text-slate-400">Game over</span>
          ) : (
            <>
              <span className="font-semibold text-slate-200">{turnName}</span>
              {state.moveCount === 0 ? (
                <Step n={1} label="Flood" active done={false} />
              ) : (
                <>
                  <Step n={1}
                    label={state.paintsPerTurn > 1 ? `Paint ${Math.min((state.paintsUsed || 0) + 1, state.paintsPerTurn)}/${state.paintsPerTurn}` : "Paint"}
                    active={state.phase === "paint"} done={state.phase === "move"} />
                  <Step n={2} label="Flood" active={state.phase === "move"} done={false} />
                </>
              )}
            </>
          )}
        </div>

        {humanTurn && !state.finished && (
          <div className="flex items-center justify-center gap-3 text-xs text-slate-400 -mt-2">
            <span>Can't flood:</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3.5 h-3.5 rounded"
                    style={{ backgroundColor: PALETTE[state.current[state.turn]], outline: "1px solid rgba(255,255,255,0.25)" }} />
              yours
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3.5 h-3.5 rounded"
                    style={{ backgroundColor: PALETTE[state.current[opponentOf(state.turn)]], outline: "1px solid rgba(255,255,255,0.25)" }} />
              rival
            </span>
          </div>
        )}

        {started && !state.finished && state.moveCount === 0 && !inReplay && (
          <p className="text-center text-xs rounded-lg px-3 py-2"
             style={{ backgroundColor: "#0b1220", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.35)" }}>
            Opening turn: flood only, no paint. Going first is a big advantage, so
            whoever starts skips their first paint. The starting player is random.
          </p>
        )}

        {/* Controls: bomb-armed overlay (either phase), else paint or flood */}
        {bombMode ? (
          <div className="flex flex-col items-center gap-2">
            {bombTarget ? (
              <>
                <div className="flex items-center justify-center gap-3 w-full rounded-xl bg-slate-900 ring-1 ring-rose-500/70 p-3">
                  <span className="flex items-center gap-1.5 text-sm text-rose-300 font-medium">💣 Destroy this tile?</span>
                  <button onClick={confirmBomb}
                    className="rounded-lg bg-rose-600 hover:bg-rose-500 px-3 py-1 text-xs font-semibold text-white">Confirm</button>
                  <button onClick={() => setBombTarget(null)}
                    className="rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1 text-xs text-slate-200">Cancel</button>
                </div>
                <span className="text-xs text-slate-400">This can't be undone — it becomes a permanent hole.</span>
              </>
            ) : (
              <>
                <div className="flex items-center justify-center gap-3 w-full rounded-xl bg-slate-900 ring-1 ring-rose-500/50 p-3">
                  <span className="flex items-center gap-1.5 text-sm text-rose-300 font-medium">💣 Bomb armed</span>
                  <button onClick={() => setBombMode(false)} className="flex items-center gap-1 text-xs text-slate-300 hover:text-white"><X size={14} /> Cancel</button>
                </div>
                <span className="text-xs text-slate-400">Tap any hex (except a home) to destroy it — your turn continues after.</span>
              </>
            )}
          </div>
        ) : paintPhase ? (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center justify-center gap-3 w-full rounded-xl bg-slate-900 ring-1 ring-amber-500/40 p-2">
              <span className="flex items-center gap-1 text-xs text-amber-300"><Paintbrush size={14} /> Paint:</span>
              <div className="flex gap-2.5">
                {PALETTE.map((hex, c) => {
                  const blocked = blockedFlood.has(c);
                  const gain = prePaintPreviews[c];
                  return (
                    <button key={c} onClick={() => setPaintColor(c)}
                      title={blocked ? "Paintable, but you can't flood this colour this turn" : `Flooding this now would capture ${gain ?? 0} tile(s)`}
                      className="relative w-7 h-7 rounded-lg transition-transform hover:scale-110"
                      style={{
                        backgroundColor: hex,
                        opacity: blocked ? 0.55 : 1,
                        outline: paintColor === c ? "2px solid #fff" : "1px solid rgba(255,255,255,0.15)",
                        outlineOffset: paintColor === c ? "1px" : "0",
                      }}>
                      {blocked && (
                        <span className="absolute inset-0 flex items-center justify-center text-slate-900 text-sm font-black">×</span>
                      )}
                      {!blocked && gain > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-slate-950 text-slate-100 text-[9px] font-bold flex items-center justify-center ring-2 ring-slate-900">
                          +{gain}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">
                {state.paintsPerTurn > 1
                  ? `Paint ${Math.min((state.paintsUsed || 0) + 1, state.paintsPerTurn)} of ${state.paintsPerTurn} this turn — ${paintColor == null ? "numbers show what flooding would capture right now, pick a colour then tap a tile" : "tap any neutral or enemy tile"}`
                  : (paintColor == null ? "Numbers show what flooding would capture right now — pick a paint colour, then tap any tile that isn't yours" : "Tap any neutral or enemy tile — enemy tiles break loose")}
              </span>
              {undoStack.length > 0 && (
                <button onClick={undoPaint}
                  className="flex items-center gap-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 transition-colors">
                  ↶ Undo paint
                </button>
              )}
              {state.bombs[state.turn] > 0 && (
                <button onClick={() => { setBombMode(true); setPaintColor(null); }}
                  className="flex items-center gap-1 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-2.5 py-1 transition-colors">
                  💣 Bomb
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="grid grid-cols-6 gap-2 w-full">
              {PALETTE.map((hex, c) => {
                const legal = legalForTurn.includes(c);
                const disabled = !movePhase || !legal;
                const gain = previews[c];
                const isBlocked = movePhase && blockedFlood.has(c);
                return (
                  <button key={c} onClick={() => onPickColor(c)} disabled={disabled}
                    title={isBlocked ? "Can't flood your own or your opponent's colour" : `Capture ${gain ?? 0} tile(s)`}
                    className="relative aspect-square rounded-xl transition-transform disabled:cursor-not-allowed enabled:hover:scale-105 enabled:active:scale-95"
                    style={{
                      backgroundColor: hex,
                      opacity: disabled ? 0.32 : 1,
                      boxShadow: !disabled ? "0 2px 8px rgba(0,0,0,0.35)" : "none",
                      outline: "1px solid rgba(255,255,255,0.12)",
                    }}>
                    {movePhase && legal && gain > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-slate-950 text-slate-100 text-xs font-bold flex items-center justify-center ring-2 ring-slate-900">
                        +{gain}
                      </span>
                    )}
                    {isBlocked && (
                      <span className="absolute inset-0 flex items-center justify-center text-slate-900 text-lg font-black">×</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              {undoStack.length > 0 && humanTurn && !inReplay && (
                <button onClick={undoPaint}
                  className="flex items-center gap-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 transition-colors">
                  ↶ Undo paint
                </button>
              )}
              {movePhase && state.bombs[state.turn] > 0 && (
                <button onClick={() => { setBombMode(true); setPaintColor(null); }}
                  className="flex items-center gap-1 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-2.5 py-1 transition-colors">
                  💣 Bomb
                </button>
              )}
            </div>
          </div>
        )}

        {started && !state.finished && (
          <div className="flex justify-center items-center gap-5 min-h-6">
            {resignConfirm ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400">Give up this game?</span>
                <button onClick={() => {
                    const player = config.mode === "ai" ? "P1" : config.mode === "online" ? mySeat : state.turn;
                    const action = { type: "RESIGN", player };
                    logAction(`R${player === "P1" ? 1 : 2}`);
                    dispatch(action);
                    if (config.mode === "online") pushRoom(gameReducer(state, action));
                    setResignConfirm(false);
                  }}
                  className="rounded-lg bg-rose-600 hover:bg-rose-500 px-3 py-1 text-xs font-medium">Yes, I give up</button>
                <button onClick={() => setResignConfirm(false)}
                  className="rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1 text-xs">Cancel</button>
              </div>
            ) : (
              <>
                {humanTurn && history.length > 1 && (
                  <button onClick={() => seekReplay(Math.max(0, history.length - 2))}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
                    <RefreshCw size={13} /> Review moves
                  </button>
                )}
                <button onClick={() => setResignConfirm(true)}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-rose-300 transition-colors">
                  <Flag size={13} /> Give up
                </button>
              </>
            )}
          </div>
        )}
        </>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-center gap-2 text-sm border-t border-slate-800 pt-3 mt-1">
          <button onClick={() => { setStarted(false); setShowSetup(false); setRoomCode(null); setMySeat(null); }}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-lg px-3 py-2 transition-colors">
            <Home size={15} /> Home
          </button>
          <button onClick={() => { setStarted(false); setShowSetup(true); setRoomCode(null); setMySeat(null); }}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-lg px-3 py-2 transition-colors">
            <Settings size={15} /> Settings
          </button>
        </div>
      </div>

      {!started && !showSetup && (
        <StartScreen
          onPlay={() => setShowSetup(true)}
          onTutorial={() => setShowTutorial(true)}
          onHelp={() => setShowHelp(true)}
          onStats={() => setShowStats(true)} />
      )}
      {!started && showSetup && (
        <SetupScreen
          config={config}
          setConfig={setConfig}
          onStart={() => {
            if (config.mode === "online") {
              setShowSetup(false);
              setShowOnlineLobby(true);
            } else {
              dispatch(newGameAction());
              setShowSetup(false);
              setStarted(true);
            }
          }}
          onBack={() => setShowSetup(false)} />
      )}
      {showOnlineLobby && (
        <OnlineLobby
          config={config}
          onBack={() => setShowOnlineLobby(false)}
          onReady={(code, seat, game) => {
            setRoomCode(code);
            setMySeat(seat);
            lastAppliedRef.current = Date.now();
            dispatch({ type: "SYNC_STATE", game });
            setShowOnlineLobby(false);
            setStarted(true);
          }} />
      )}
      {showTutorial && <Tutorial onExit={() => setShowTutorial(false)} />}
      {showHelp && <InstructionsModal onClose={() => setShowHelp(false)} />}
      {showStats && <StatsModal stats={stats} onClose={() => setShowStats(false)} onReset={resetStats} sessionLog={sessionLog} />}
    </div>
  );
}
function allPaintTargets(game, player) {
  const set = new Set();
  for (const k of game.cellSet) if (isPaintTarget(game, player, k)) set.add(k);
  return set;
}

/* ---- Opening screen + instructions ---- */

function StartScreen({ onPlay, onTutorial, onHelp, onStats }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6" style={{ backgroundColor: "#020617" }}>
      <div className="w-full max-w-sm flex flex-col items-center text-center gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Influence Flood Race</h1>
          <p className="text-sm text-slate-400 mt-2">Paint a tile, flood a colour, swallow the board. Most territory wins.</p>
        </div>
        <div className="flex flex-col gap-2 w-full">
          <button onClick={onPlay}
            className="w-full rounded-xl bg-amber-500 text-slate-950 font-semibold py-3 hover:bg-amber-400 transition-colors">
            Play
          </button>
          <button onClick={onTutorial}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-800 text-slate-100 font-medium py-3 hover:bg-slate-700 transition-colors">
            <Brain size={18} /> Tutorial
          </button>
          <button onClick={onHelp}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-800 text-slate-100 font-medium py-3 hover:bg-slate-700 transition-colors">
            <HelpCircle size={18} /> How to play
          </button>
          <button onClick={onStats}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-800 text-slate-100 font-medium py-3 hover:bg-slate-700 transition-colors">
            <BarChart3 size={18} /> Stats
          </button>
        </div>
      </div>
    </div>
  );
}

function OptionRow({ label, children }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      {children}
    </div>
  );
}

function Choices({ value, options, onChange }) {
  return (
    <div className="flex gap-2">
      {options.map(([val, text]) => {
        const active = value === val;
        return (
          <button key={val} onClick={() => onChange(val)}
            className="flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors"
            style={{ backgroundColor: active ? "#f1f5f9" : "#1e293b", color: active ? "#0f172a" : "#cbd5e1" }}>
            {text}
          </button>
        );
      })}
    </div>
  );
}

function OnlineLobby({ config, onReady, onBack }) {
  const [phase, setPhase] = useState("choose"); // choose | waiting | join
  const [code, setCode] = useState(null);
  const [joinInput, setJoinInput] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // While waiting on a just-created room, poll for the friend claiming seat P2.
  useEffect(() => {
    if (phase !== "waiting" || !code) return;
    let cancelled = false;
    const tick = async () => {
      const room = await storageGetJSON(roomKey(code), true);
      if (cancelled || !room) return;
      if (room.seats && room.seats.P2) onReadyRef.current(code, "P1", deserializeGame(room.game));
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [phase, code]);

  const create = async () => {
    setBusy(true); setError(null);
    if (typeof window.storage === "undefined") {
      setBusy(false); setError("Online play needs shared storage, which isn't available right now."); return;
    }
    // Two-stage probe: private (shared=false) write first, then shared
    // (shared=true). If private works but shared doesn't, the "shared" flag
    // itself is the problem in this context — a different diagnosis than
    // storage being broken outright.
    try {
      await storageSetJSON("ifr-diag-private", { t: Date.now() }, false);
    } catch (privErr) {
      setBusy(false);
      setError(`Storage doesn't work in this context at all, even privately (${privErr && privErr.message ? privErr.message : String(privErr)}). Online play needs this published, not just previewed here.`);
      return;
    }
    try {
      await storageSetJSON("ifr-diag-shared", { t: Date.now() }, true);
    } catch (sharedErr) {
      setBusy(false);
      setError(`Private storage works, but shared storage doesn't (${sharedErr && sharedErr.message ? sharedErr.message : String(sharedErr)}). Online play specifically needs shared storage, so this needs the artifact published first.`);
      return;
    }
    try {
      const g = createGame(config.radius, config.mapType, config.paintsPerTurn);
      const newCode = genRoomCode();
      const payload = { seats: { P1: true, P2: false }, game: serializeGame(g), updatedAt: Date.now() };
      await storageSetJSON(roomKey(newCode), payload, true);
      setBusy(false);
      setCode(newCode);
      setPhase("waiting");
    } catch (e) {
      setBusy(false);
      setError(`Basic shared storage works, but the room payload failed: ${e && e.message ? e.message : String(e)}. Likely the game state is too large/complex for one key.`);
    }
  };

  const cancelWaiting = async () => {
    if (code) { try { await window.storage.delete(roomKey(code), true); } catch (e) { /* best-effort */ } }
    setCode(null); setPhase("choose");
  };

  const join = async () => {
    const clean = joinInput.trim().toUpperCase();
    if (clean.length < 4) { setError("Enter the full room code."); return; }
    setBusy(true); setError(null);
    if (typeof window.storage === "undefined") {
      setBusy(false); setError("Online play needs shared storage, which isn't available right now."); return;
    }
    try {
      const room = await storageGetJSON(roomKey(clean), true);
      if (!room) { setBusy(false); setError("No room found with that code."); return; }
      if (room.seats && room.seats.P2) { setBusy(false); setError("That room already has two players."); return; }
      const updated = { ...room, seats: { ...room.seats, P2: true }, updatedAt: Date.now() };
      await storageSetJSON(roomKey(clean), updated, true);
      setBusy(false);
      onReady(clean, "P2", deserializeGame(room.game));
    } catch (e) {
      setBusy(false);
      setError(`Couldn't join: ${e && e.message ? e.message : String(e)}`);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6" style={{ backgroundColor: "#020617" }}>
      <div className="w-full max-w-sm flex flex-col items-center text-center gap-6 text-slate-100">

        {phase === "choose" && (
          <>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Play online</h2>
              <p className="text-sm text-slate-400 mt-1">Share a room code with a friend, or join theirs.</p>
            </div>
            <div className="flex flex-col gap-2 w-full">
              <button onClick={create} disabled={busy}
                className="w-full rounded-xl bg-amber-500 text-slate-950 font-semibold py-3 hover:bg-amber-400 transition-colors disabled:opacity-60">
                Create a room
              </button>
              <button onClick={() => { setPhase("join"); setError(null); }}
                className="w-full rounded-xl bg-slate-800 text-slate-100 font-medium py-3 hover:bg-slate-700 transition-colors">
                Join a room
              </button>
              <button onClick={onBack} className="text-sm text-slate-400 hover:text-white mt-2">Back</button>
            </div>
          </>
        )}

        {phase === "waiting" && (
          <>
            <div>
              <h2 className="text-xl font-bold">Room code</h2>
              <p className="text-sm text-slate-400 mt-1">Send this to your friend.</p>
            </div>
            <div className="text-5xl font-black tracking-[0.2em] text-amber-400 py-4">{code}</div>
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <Brain size={15} className="animate-pulse" /> Waiting for them to join…
            </p>
            <button onClick={cancelWaiting} className="text-sm text-slate-400 hover:text-white mt-2">Cancel</button>
          </>
        )}

        {phase === "join" && (
          <>
            <div>
              <h2 className="text-xl font-bold">Join a room</h2>
              <p className="text-sm text-slate-400 mt-1">Enter the code your friend sent you.</p>
            </div>
            <input value={joinInput} onChange={(e) => setJoinInput(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="ABCDE" maxLength={6}
              className="w-full text-center text-3xl font-black tracking-[0.2em] rounded-xl bg-slate-900 ring-1 ring-slate-700 py-3 text-slate-100 placeholder-slate-700 focus:outline-none focus:ring-amber-500"
              autoCapitalize="characters" />
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div className="flex gap-2 w-full">
              <button onClick={() => { setPhase("choose"); setError(null); }}
                className="rounded-xl bg-slate-800 text-slate-100 font-medium px-5 py-3 hover:bg-slate-700 transition-colors">
                Back
              </button>
              <button onClick={join} disabled={busy}
                className="flex-1 rounded-xl bg-amber-500 text-slate-950 font-semibold py-3 hover:bg-amber-400 transition-colors disabled:opacity-60">
                Join
              </button>
            </div>
          </>
        )}

        {phase === "choose" && error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </div>
  );
}

function SetupScreen({ config, setConfig, onStart, onBack }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6 overflow-y-auto" style={{ backgroundColor: "#020617" }}>
      <div className="w-full max-w-sm flex flex-col gap-6 text-slate-100">
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight">New game</h2>
          <p className="text-sm text-slate-400 mt-1">Set up the match, then start.</p>
        </div>

        <div className="flex flex-col gap-4">
          <OptionRow label="Board size">
            <Choices value={String(config.radius)}
              options={[["4", "Small"], ["5", "Medium"], ["6", "Large"]]}
              onChange={(v) => setConfig((c) => ({ ...c, radius: Number(v) }))} />
          </OptionRow>

          <OptionRow label="Opponent">
            <Choices value={config.mode}
              options={[["ai", "vs AI"], ["hotseat", "2 players"], ["online", "Online"]]}
              onChange={(mode) => setConfig((c) => ({ ...c, mode }))} />
            {config.mode === "online" && (
              <p className="text-[11px] text-slate-500 -mt-1">
                Play a friend remotely with a room code. Board size/map below only matter if you create the room.
              </p>
            )}
          </OptionRow>

          {config.mode === "ai" && (
            <OptionRow label="Difficulty">
              <Choices value={config.difficulty}
                options={[["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"], ["expert", "Expert"]]}
                onChange={(difficulty) => setConfig((c) => ({ ...c, difficulty }))} />
              {config.difficulty === "hard" && (
                <p className="text-[11px] text-slate-500 -mt-1">No bombs on Hard — for either side.</p>
              )}
              {config.difficulty === "expert" && (
                <p className="text-[11px] text-slate-500 -mt-1">Plans full turns ahead and plays for territory, not just tiles. No bombs either side. Thinks a little longer.</p>
              )}
            </OptionRow>
          )}

          <OptionRow label="Paints per turn">
            <Choices value={String(config.paintsPerTurn)}
              options={[["1", "1 (Classic)"], ["2", "2"]]}
              onChange={(v) => setConfig((c) => ({ ...c, paintsPerTurn: Number(v) }))} />
            {config.paintsPerTurn === 2 && (
              <p className="text-[11px] text-slate-500 -mt-1">Each turn, paint two tiles before flooding.</p>
            )}
          </OptionRow>

          <OptionRow label="Map type">
            <Choices value={config.mapType}
              options={[["classic", "Classic"], ["bridges2", "2 Bridges"], ["bridges3", "3 Bridges"]]}
              onChange={(mapType) => setConfig((c) => ({ ...c, mapType }))} />
            <p className="text-[11px] text-slate-500 -mt-1">
              {config.mapType === "classic" && "Open board, no chokepoints."}
              {config.mapType === "bridges2" && "A wall splits the board — only 2 gaps connect the two sides."}
              {config.mapType === "bridges3" && "A wall splits the board — 3 gaps connect the two sides."}
            </p>
          </OptionRow>
        </div>

        <div className="flex gap-2">
          <button onClick={onBack}
            className="rounded-xl bg-slate-800 text-slate-100 font-medium px-5 py-3 hover:bg-slate-700 transition-colors">
            Back
          </button>
          <button onClick={onStart}
            className="flex-1 rounded-xl bg-amber-500 text-slate-950 font-semibold py-3 hover:bg-amber-400 transition-colors">
            {config.mode === "online" ? "Continue" : "Start game"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InstructionsModal({ onClose }) {
  const H = ({ children }) => <p className="font-semibold text-slate-100 mb-1">{children}</p>;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ backgroundColor: "rgba(2,6,23,0.8)", backdropFilter: "blur(3px)" }}>
      <div className="w-full max-w-md rounded-2xl bg-slate-900 ring-1 ring-slate-700 p-5 overflow-y-auto"
           style={{ maxHeight: "85vh" }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">How to play</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
        </div>
        <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <p>Two territories grow on a hex board. Most tiles when the board fills wins.</p>

          <div>
            <H>Each turn: paint, then flood</H>
            <p><span className="text-amber-300 font-semibold">Paint</span> one tile — neutral tiles change colour, enemy tiles break loose to neutral. Painted tiles lock (🔒) and can never be repainted by anyone, so they make permanent walls.</p>
            <p className="mt-1"><span className="text-amber-300 font-semibold">Flood</span> a colour — your territory flips to it and swallows every touching neutral tile of that colour.</p>
          </div>

          <div>
            <H>Two rules to remember</H>
            <p>You can't flood your own colour or the rival's (both marked ×). The starting player is random, and their opening turn is flood-only — going first is a real advantage, so they skip one paint.</p>
          </div>

          <div>
            <H>Reading the board</H>
            <p>Your outline is <span className="text-slate-100">solid</span>, the rival's <span className="text-slate-100">dashed</span>. Owned tiles are slightly dimmed. Numbers on the palette show what each colour would capture.</p>
          </div>

          <div>
            <H>Tactics</H>
            <p>Paint to bridge into a big cluster, then flood it. Or knock an enemy border tile loose and flood to steal it. Walling the rival out of open space wins more games than grabbing tiles.</p>
          </div>

          <div>
            <H>Bomb</H>
            <p>One <span className="text-rose-300">💣</span> per game, free — you still paint and flood that turn. It destroys a hex permanently (not a starting tile or bridge), leaving a hole that blocks flooding. Hard and Expert play without bombs.</p>
          </div>

          <p className="text-slate-400">When neither side can reach the other, remaining tiles are assigned and the game ends.</p>
        </div>
        <button onClick={onClose}
          className="mt-5 w-full rounded-lg bg-slate-100 text-slate-900 font-semibold py-2 hover:bg-white transition-colors">
          Got it
        </button>
      </div>
    </div>
  );
}

/* ---- Guided tutorial ---- */

function Tutorial({ onExit }) {
  const [step, setStep] = useState(0);
  const cfg = TUTORIAL_STEPS[step];
  const [board, setBoard] = useState(() => TUTORIAL_STEPS[0].build());
  const [phase, setPhase] = useState(TUTORIAL_STEPS[0].mode === "turn" ? "paint" : "move");
  const [paintColor, setPaintColor] = useState(null);
  const [bombArmed, setBombArmed] = useState(false);
  const [bombLeft, setBombLeft] = useState(true);
  const [rivalThinking, setRivalThinking] = useState(false);
  const [done, setDone] = useState(false);
  const rivalTimer = useRef(null);

  // (Re)build the board whenever the step changes.
  useEffect(() => {
    const c = TUTORIAL_STEPS[step];
    clearTimeout(rivalTimer.current);
    setBoard(c.build());
    setPhase(c.mode === "turn" ? "paint" : "move");
    setPaintColor(null);
    setBombArmed(false);
    setBombLeft(true);
    setRivalThinking(false);
    setDone(false);
  }, [step]);

  useEffect(() => () => clearTimeout(rivalTimer.current), []);

  // Mark the step complete once its goal is met — but never lock the controls,
  // so the player can keep going and conquer the whole board if they like.
  useEffect(() => {
    if (!done && cfg.goal(board)) setDone(true);
  }, [board, done, cfg]);

  const withCounts = (b) => { b.counts = countTiles(b); return b; };

  // Colours you may NOT flood: your own current colour, and the rival's.
  const forbidden = useMemo(() => {
    const s = new Set([board.current.P1]);
    if (board.current.P2 >= 0) s.add(board.current.P2);
    return s;
  }, [board]);

  // Show every colour that's present as a neutral, plus the forbidden colours
  // (so the ✕ swatches are visible even when none of that colour is loose).
  const floodColors = useMemo(() => {
    const s = new Set();
    for (const [k, o] of board.owners) {
      if (o === null && !board.destroyed.has(k)) s.add(board.colors.get(k));
    }
    for (const c of forbidden) if (c >= 0) s.add(c);
    return [...s].sort((a, b) => a - b);
  }, [board, forbidden]);

  const doFlood = (c) => {
    if (forbidden.has(c) || rivalThinking) return;
    setBoard(withCounts(applyMove(board, "P1", c)));
    if (cfg.mode === "turn") setPhase("paint");
    setPaintColor(null);
    if (cfg.opponent) {
      // The learner finished a turn — let the (feeble) rival respond.
      setRivalThinking(true);
      rivalTimer.current = setTimeout(() => {
        setBoard((b) => tutorialRivalMove(b));
        setRivalThinking(false);
      }, 450);
    }
  };

  const onTileClick = (k) => {
    if (rivalThinking) return;
    if (bombArmed) {
      if (!isBombTarget(board, k)) return;
      const destroyed = new Set(board.destroyed); destroyed.add(k);
      const owners = new Map(board.owners); owners.set(k, null);
      setBoard(withCounts({ ...board, destroyed, owners }));
      setBombArmed(false);
      setBombLeft(false);
      return;
    }
    if (cfg.mode === "turn" && phase === "paint" && paintColor != null && isPaintTarget(board, "P1", k)) {
      setBoard(withCounts(applyPaint(board, k, paintColor)));
      setPhase("move");
      setPaintColor(null);
    }
  };

  const selectable = useMemo(() => {
    const s = new Set();
    if (bombArmed) {
      for (const k of board.cellSet) if (isBombTarget(board, k)) s.add(k);
      return s;
    }
    if (cfg.mode === "turn" && phase === "paint") {
      for (const k of board.cellSet) if (isPaintTarget(board, "P1", k)) s.add(k);
    }
    return s;
  }, [board, bombArmed, cfg, phase]);

  const showFlood = cfg.mode === "flood" || (cfg.mode === "turn" && phase === "move");
  const showPaint = cfg.mode === "turn" && phase === "paint";
  const canBomb = cfg.bomb && bombLeft && phase === "paint";
  const isLast = step === TUTORIAL_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col"
         style={{ backgroundColor: "#020617", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="flex-1 overflow-y-auto">
      <div className="w-full max-w-md mx-auto flex flex-col gap-3 p-4 text-slate-100">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {TUTORIAL_STEPS.map((s, i) => (
              <span key={i} className="w-2 h-2 rounded-full"
                style={{ backgroundColor: i === step ? "#fbbf24" : i < step ? "#64748b" : "#334155" }} />
            ))}
            <span className="text-sm font-semibold ml-1.5">{step + 1}. {cfg.title}</span>
          </div>
          <button onClick={onExit} className="text-xs text-slate-400 hover:text-white">Skip ✕</button>
        </div>

        <p className="text-sm text-slate-300 text-center leading-relaxed">
          {cfg.instruction}
        </p>

        <div className="rounded-2xl bg-slate-900 ring-1 ring-slate-800 p-3">
          <Board state={board} selectable={selectable} selectColor={bombArmed ? "#f43f5e" : "#fbbf24"} onTileClick={onTileClick} />
        </div>

        <div className="flex justify-center gap-5 text-sm">
          <span><span className="text-slate-400">You</span> <span className="font-semibold">{board.counts.P1}</span></span>
          {board.homes.P2 && <span><span className="text-slate-400">Rival</span> <span className="font-semibold">{board.counts.P2}</span></span>}
        </div>

        {showFlood && (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>{cfg.mode === "turn" ? "Step 2 — flood a colour" : "Flood a colour"}</span>
              <span className="text-slate-500">·</span>
              <span>Can't flood:</span>
              <span className="inline-block w-3.5 h-3.5 rounded-sm" style={{ backgroundColor: PALETTE[board.current.P1], outline: "1px solid rgba(255,255,255,0.25)" }} title="yours" />
              {board.current.P2 >= 0 && (
                <span className="inline-block w-3.5 h-3.5 rounded-sm" style={{ backgroundColor: PALETTE[board.current.P2], outline: "1px solid rgba(255,255,255,0.25)" }} title="rival" />
              )}
            </div>
            <div className="flex gap-2.5 flex-wrap justify-center">
              {floodColors.map((c) => {
                const blocked = forbidden.has(c);
                const gain = blocked ? 0 : countTiles(applyMove(board, "P1", c)).P1 - board.counts.P1;
                return (
                  <button key={c} onClick={() => doFlood(c)} disabled={blocked}
                    className="relative w-11 h-11 rounded-lg transition-transform"
                    style={{
                      backgroundColor: PALETTE[c],
                      outline: "1px solid rgba(255,255,255,0.18)",
                      opacity: blocked ? 0.4 : 1,
                      cursor: blocked ? "not-allowed" : "pointer",
                    }}>
                    {blocked && <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-white" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.7)" }}>✕</span>}
                    {!blocked && gain > 0 && (
                      <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full text-xs font-bold flex items-center justify-center"
                        style={{ backgroundColor: "#020617", boxShadow: "0 0 0 2px #020617" }}>+{gain}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {showPaint && (
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs text-slate-400">
              {bombArmed ? "Tap any hex (not a home) to destroy it"
                : paintColor == null ? "Step 1 — pick a paint colour, then tap a hex"
                : "Now tap a highlighted hex to paint it"}
            </span>
            <div className="flex items-center gap-2.5">
              {TUT_COLORS.map((c) => {
                const blocked = forbidden.has(c);
                return (
                  <button key={c} disabled={blocked}
                    onClick={() => { if (blocked) return; setPaintColor(c); setBombArmed(false); }}
                    className="relative w-10 h-10 rounded-lg transition-transform"
                    style={{
                      backgroundColor: PALETTE[c],
                      outline: paintColor === c && !bombArmed ? "2px solid #fff" : "1px solid rgba(255,255,255,0.18)",
                      opacity: blocked ? 0.4 : 1,
                      cursor: blocked ? "not-allowed" : "pointer",
                    }}>
                    {blocked && <span className="absolute inset-0 flex items-center justify-center text-base font-bold text-white" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.7)" }}>✕</span>}
                  </button>
                );
              })}
              {canBomb && (
                <button onClick={() => { setBombArmed((v) => !v); setPaintColor(null); }}
                  className="flex items-center gap-1 text-sm font-medium rounded-lg px-3 h-10 text-white"
                  style={{ backgroundColor: bombArmed ? "#9f1239" : "#e11d48" }}>💣 Bomb</button>
              )}
            </div>
            <span className="text-[11px] text-slate-500">
              {cfg.opponent
                ? "No point painting your colour or the rival's — you can't flood either."
                : "No point painting your own colour — you can't flood it."}
            </span>
          </div>
        )}

        {rivalThinking && (
          <p className="text-center text-xs text-slate-400">Rival is moving…</p>
        )}
      </div>
      </div>

      {done && (
        <div className="shrink-0 border-t border-slate-800" style={{ backgroundColor: "#0b1220" }}>
          <div className="w-full max-w-md mx-auto flex items-center gap-3 p-3 text-slate-100">
            <p className="text-sm flex-1" style={{ color: "#6ee7b7" }}>✓ {cfg.success}</p>
            <button onClick={() => (isLast ? onExit() : setStep(step + 1))}
              className="shrink-0 rounded-xl bg-amber-500 text-slate-950 font-semibold px-6 py-2.5 hover:bg-amber-400 transition-colors">
              {isLast ? "Finish" : "Next →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Presentational sub-components ---- */

function Step({ n, label, active, done }) {
  return (
    <span className={`flex items-center gap-1 text-xs ${active ? "text-amber-300" : done ? "text-slate-500" : "text-slate-500"}`}>
      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
        active ? "bg-amber-400 text-slate-950" : "bg-slate-800 text-slate-400"
      }`}>{n}</span>
      {label}
    </span>
  );
}

function Scoreboard({ P1, P2, neutral, total, p1Color, p2Color, mode, mySeat, turn, finished, influence }) {
  const pct = (n) => (total ? (n / total) * 100 : 0);
  const p1Name = mode === "hotseat" ? "Player 1" : mode === "online" ? (mySeat === "P1" ? "You" : "Opponent") : "You";
  const p2Name = mode === "hotseat" ? "Player 2" : mode === "online" ? (mySeat === "P2" ? "You" : "Opponent") : "AI";
  const active = (p) => !finished && turn === p;
  const p1Hex = PALETTE[p1Color];
  const p2Hex = PALETTE[p2Color];
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1.5">
        <Tally name={p1Name} count={P1} player="P1" active={active("P1")} alignRight={false} colorHex={p1Hex} />
        <span className="text-xs text-slate-500">{neutral} unclaimed</span>
        <Tally name={p2Name} count={P2} player="P2" active={active("P2")} alignRight colorHex={p2Hex} />
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full ring-1 ring-slate-800 bg-slate-800">
        <div style={{ width: `${pct(P1)}%`, backgroundColor: p1Hex, transition: "width 250ms ease, background-color 300ms ease" }} />
        <div style={{ width: `${pct(neutral)}%`, backgroundColor: "#334155", transition: "width 250ms ease" }} />
        <div style={{ width: `${pct(P2)}%`, backgroundColor: p2Hex, transition: "width 250ms ease, background-color 300ms ease" }} />
      </div>

      {/* Separate influence bar — reach over UNCLAIMED tiles, kept distinct from
          the tile-count bar above so the two aren't confused. */}
      {influence && (() => {
        const iTot = influence.P1 + influence.P2 + (influence.tie || 0);
        const ip = (n) => (iTot ? (n / iTot) * 100 : 0);
        return (
          <div className="mt-1.5">
            <div className="flex h-2 w-full overflow-hidden rounded-full ring-1 ring-slate-800 bg-slate-800">
              <div style={{ width: `${ip(influence.P1)}%`, backgroundColor: "#7dd3fc", transition: "width 250ms ease" }} />
              <div style={{ width: `${ip(influence.tie || 0)}%`, backgroundColor: "#1e293b", transition: "width 250ms ease" }} />
              <div style={{ width: `${ip(influence.P2)}%`, backgroundColor: "#818cf8", transition: "width 250ms ease" }} />
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500 mt-0.5">
              <span className="tabular-nums" style={{ color: "#7dd3fc" }}>◈ {influence.P1}</span>
              <span>influence — unclaimed tiles each side is nearest to</span>
              <span className="tabular-nums" style={{ color: "#818cf8" }}>{influence.P2} ◈</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Tally({ name, count, player, active, alignRight, colorHex }) {
  const dashed = player === "P2";
  return (
    <div className={`flex items-center gap-1.5 ${alignRight ? "flex-row-reverse" : ""}`}>
      <span className="inline-block w-4 h-4 rounded-sm"
            style={{ border: `2px ${dashed ? "dashed" : "solid"} #f1f5f9`, backgroundColor: colorHex || "transparent", transition: "background-color 300ms ease" }} />
      <span className={`font-semibold ${active ? "text-slate-100" : "text-slate-400"}`}>
        {name} <span className="tabular-nums">{count}</span>
      </span>
    </div>
  );
}

function Board({ state, selectable, selectColor, onTileClick, pendingKey, pendingColor }) {
  const [hovered, setHovered] = useState(null);
  const size = state.size;

  // Clear any lingering hover when the board context changes — otherwise a
  // touch tap (which never fires mouse-leave) leaves a stale highlight that can
  // reappear on the next game.
  useEffect(() => { setHovered(null); }, [selectable]);

  const boundaries = useMemo(() => {
    const segs = [];
    for (const { q, r } of state.cells) {
      const k = keyOf(q, r);
      const owner = state.owners.get(k);
      if (!owner) continue;
      const corners = state.layout.get(k).corners;
      for (let d = 0; d < 6; d++) {
        const [dq, dr] = AXIAL_DIRECTIONS[d];
        const nk = keyOf(q + dq, r + dr);
        const nOwner = state.cellSet.has(nk) ? state.owners.get(nk) : "EDGE";
        if (nOwner !== owner) {
          const [a, b] = EDGE_BY_DIRECTION[d];
          segs.push({ a: corners[a], b: corners[b], owner });
        }
      }
    }
    return segs;
  }, [state]);

  const dashFor = (owner) =>
    OWNER_OUTLINE[owner].dash ? `${size * OWNER_OUTLINE[owner].dash} ${size * 0.3}` : undefined;

  return (
    <svg viewBox={state.viewBox} style={{ width: "100%", height: "auto", maxHeight: 460, display: "block" }}>
      {/* Tile fills (destroyed tiles render as dark holes) */}
      {state.cells.map(({ q, r }) => {
        const k = keyOf(q, r);
        const { points, cx, cy } = state.layout.get(k);
        if (state.destroyed.has(k)) {
          return (
            <g key={k} pointerEvents="none">
              <polygon points={points} fill="#0a0e18" stroke="#1e293b" strokeWidth={0.7} />
              <circle cx={cx} cy={cy} r={size * 0.42} fill="#05070d" />
            </g>
          );
        }
        const canSelect = selectable.has(k);
        return (
          <polygon key={k} points={points} fill={PALETTE[state.colors.get(k)]}
                   stroke="#0b1220" strokeWidth={0.7}
                   onClick={canSelect ? () => { onTileClick(k); setHovered(null); } : undefined}
                   onMouseEnter={canSelect ? () => setHovered(k) : undefined}
                   onMouseLeave={canSelect ? () => setHovered(null) : undefined}
                   style={{ cursor: canSelect ? "pointer" : "default" }} />
        );
      })}

      {/* Subtle darkening marks owned tiles without changing their hue */}
      {state.cells.map(({ q, r }) => {
        const k = keyOf(q, r);
        if (!state.owners.get(k)) return null;
        return <polygon key={"own" + k} points={state.layout.get(k).points}
                        fill="#000000" fillOpacity={0.15} pointerEvents="none" />;
      })}

      {/* Territory outline: solid = you, dashed = opponent */}
      <g pointerEvents="none">
        {boundaries.map((s, i) => (
          <line key={"bk" + i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y}
                stroke="#0b1220" strokeWidth={size * 0.2} strokeLinecap="round" strokeDasharray={dashFor(s.owner)} />
        ))}
        {boundaries.map((s, i) => (
          <line key={"ln" + i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y}
                stroke="#ffffff" strokeWidth={size * 0.1} strokeLinecap="round" strokeDasharray={dashFor(s.owner)} />
        ))}
      </g>

      {/* Hover preview of the tile about to be selected (paint or bomb) */}
      {hovered && selectable.has(hovered) && (
        <polygon points={state.layout.get(hovered).points} fill={selectColor} fillOpacity={0.25}
                 stroke={selectColor} strokeWidth={size * 0.22} pointerEvents="none" />
      )}

      {/* Pending target awaiting explicit confirmation (e.g. a bomb) */}
      {pendingKey && state.layout.get(pendingKey) && (
        <polygon points={state.layout.get(pendingKey).points} fill={pendingColor || "#f43f5e"} fillOpacity={0.4}
                 stroke={pendingColor || "#f43f5e"} strokeWidth={size * 0.3} pointerEvents="none" />
      )}

      {/* Markers: start tiles (dot) and locked tiles (padlock) */}
      <g pointerEvents="none">
        {state.cells.map(({ q, r }) => {
          const k = keyOf(q, r);
          if (state.destroyed.has(k)) return null;
          const { cx, cy } = state.layout.get(k);
          const isHome = state.homes.P1 === k || state.homes.P2 === k;
          const isLocked = state.locked.has(k);
          if (isHome) {
            return (
              <g key={"hm" + k}>
                <circle cx={cx} cy={cy} r={size * 0.2} fill="#0b1220" />
                <circle cx={cx} cy={cy} r={size * 0.11} fill="#ffffff" />
              </g>
            );
          }
          if (isLocked) {
            const s = size * 0.5;
            const bodyW = s * 0.9, bodyH = s * 0.8;
            const bx = cx - bodyW / 2, byTop = cy - bodyH * 0.1;
            const rx = s * 0.16, shR = s * 0.3;
            const shTop = byTop - shR * 1.6; // how high the arch rises
            // Cubic arch (inverted U) — robust where a semicircle arc would collapse.
            const shackle = `M ${cx - shR} ${byTop} C ${cx - shR} ${shTop}, ${cx + shR} ${shTop}, ${cx + shR} ${byTop}`;
            return (
              <g key={"lk" + k}>
                {/* dark halo for contrast on any tile colour */}
                <path d={shackle} fill="none" stroke="#0f172a" strokeWidth={s * 0.42} strokeLinecap="round" />
                <rect x={bx - s * 0.09} y={byTop - s * 0.09} width={bodyW + s * 0.18} height={bodyH + s * 0.18} rx={rx + s * 0.06} fill="#0f172a" />
                {/* padlock face */}
                <path d={shackle} fill="none" stroke="#eef2f7" strokeWidth={s * 0.2} strokeLinecap="round" />
                <rect x={bx} y={byTop} width={bodyW} height={bodyH} rx={rx} fill="#eef2f7" />
                <circle cx={cx} cy={byTop + bodyH * 0.45} r={s * 0.1} fill="#0f172a" />
              </g>
            );
          }
          return null;
        })}
      </g>
    </svg>
  );
}

function ReplayBar({ index, total, finished, onSeek, onExit, onPlayAgain }) {
  const last = Math.max(0, total - 1);
  const label = index === 0 ? "Start" : `Move ${index} of ${last}`;
  const btn = "flex items-center justify-center rounded-lg bg-slate-800 enabled:hover:bg-slate-700 px-3 py-2 text-sm disabled:opacity-35 disabled:cursor-not-allowed transition-colors";
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-slate-900 ring-1 ring-slate-800 p-3">
      <span className="text-[11px] uppercase tracking-wide text-slate-400">Replay — stepping through each move</span>
      <div className="flex items-center gap-1.5">
        <button onClick={() => onSeek(0)} disabled={index === 0} className={btn} title="First">⏮</button>
        <button onClick={() => onSeek(index - 1)} disabled={index === 0} className={btn}>◀ Prev</button>
        <span className="text-sm tabular-nums text-center px-2" style={{ minWidth: "6.5rem" }}>{label}</span>
        <button onClick={() => onSeek(index + 1)} disabled={index >= last} className={btn}>Next ▶</button>
        <button onClick={() => onSeek(last)} disabled={index >= last} className={btn} title="Last">⏭</button>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onExit}
          className="flex items-center gap-1.5 text-sm font-medium rounded-lg bg-slate-800 hover:bg-slate-700 px-4 py-2 transition-colors">
          {finished ? "Back" : "Back to game"}
        </button>
        {finished && (
          <button onClick={onPlayAgain}
            className="flex items-center gap-1.5 text-sm font-semibold rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 px-4 py-2 transition-colors">
            <RefreshCw size={15} /> Play again
          </button>
        )}
      </div>
    </div>
  );
}

function WinnerOverlay({ winner, P1, P2, mode, mySeat, resignedBy, onPlayAgain, onReplay }) {
  const p1Name = mode === "hotseat" ? "Player 1" : mode === "online" ? (mySeat === "P1" ? "You" : "Opponent") : "You";
  const p2Name = mode === "hotseat" ? "Player 2" : mode === "online" ? (mySeat === "P2" ? "You" : "Opponent") : "AI";
  const winnerName = winner === "P1" ? p1Name : p2Name;
  const headline = winner === "tie" ? "Dead heat" : (winnerName === "You" ? "You win" : `${winnerName} wins`);
  const resignNote = resignedBy ? `${resignedBy === "P1" ? p1Name : p2Name} gave up` : null;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl"
         style={{ backgroundColor: "rgba(2,6,23,0.78)", backdropFilter: "blur(2px)" }}>
      <Trophy size={32} className="text-amber-300" />
      <div className="text-xl font-bold">{headline}</div>
      {resignNote && <div className="text-xs text-slate-400">{resignNote}</div>}
      <div className="text-sm text-slate-300 tabular-nums">{p1Name} {P1} · {p2Name} {P2}</div>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={onPlayAgain}
                className="flex items-center gap-1.5 text-sm font-semibold bg-slate-100 text-slate-900 hover:bg-white rounded-lg px-4 py-2 transition-colors">
          <RefreshCw size={15} /> Play again
        </button>
        {onReplay && (
          <button onClick={onReplay}
                  className="flex items-center gap-1.5 text-sm font-semibold bg-slate-800 text-slate-100 hover:bg-slate-700 rounded-lg px-4 py-2 transition-colors">
            <Trophy size={15} /> Replay
          </button>
        )}
      </div>
    </div>
  );
}

const DIFFICULTY_LABELS = { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert" };

function StatsModal({ stats, onClose, onReset, sessionLog }) {
  const [copied, setCopied] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [dlError, setDlError] = useState(null);
  const logText = (sessionLog || []).join("\n");
  const logKB = (logText.length / 1024).toFixed(1);
  // Chunked copy: mobile clipboards truncate long strings, so offer the log in
  // clipboard-sized pieces that can be pasted one at a time.
  const CHUNK = 1200;
  const chunks = [];
  for (let i = 0; i < logText.length; i += CHUNK) chunks.push(logText.slice(i, i + CHUNK));
  const [copiedPart, setCopiedPart] = useState(null);
  const copyPart = async (i) => {
    try {
      await navigator.clipboard.writeText(`[part ${i + 1}/${chunks.length}]\n` + chunks[i]);
      setCopiedPart(i); setTimeout(() => setCopiedPart(null), 1500);
    } catch (e) { setShowLog(true); }
  };

  // Download as a file rather than via clipboard — mobile clipboards truncate
  // long strings, and a full session's log runs to tens of KB.
  const downloadLog = () => {
    setDlError(null);
    try {
      const blob = new Blob([logText], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T-]/g, "");
      a.href = url;
      a.download = `ifr-log-${stamp}.json`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setDlError("Download blocked here — use Show and copy in parts instead.");
      setShowLog(true);
    }
  };
  const rows = DIFFICULTIES.map((d) => {
    const s = stats[d] || blankStat();
    const winRate = s.games ? Math.round((s.wins / s.games) * 100) : 0;
    const avgDiff = s.games ? s.diffSum / s.games : 0;
    return { d, s, winRate, avgDiff };
  });
  const totalGames = rows.reduce((n, r) => n + r.s.games, 0);
  const [splitStart, setSplitStart] = useState(false);
  const sub = (s, key) => {
    const x = (s && s[key]) || { wins: 0, losses: 0, ties: 0, diffSum: 0, games: 0 };
    return { ...x, winRate: x.games ? Math.round((x.wins / x.games) * 100) : 0, avgDiff: x.games ? x.diffSum / x.games : 0 };
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ backgroundColor: "rgba(2,6,23,0.8)", backdropFilter: "blur(3px)" }}>
      <div className="w-full max-w-md rounded-2xl bg-slate-900 ring-1 ring-slate-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Your record vs AI</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
        </div>
        {totalGames === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">No games yet — finish one vs the AI and it'll show up here.</p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2 text-xs text-slate-500 px-3">
              <span>Difficulty</span>
              <span className="text-center">W–L–T</span>
              <span className="text-center">Win&nbsp;%</span>
              <span className="text-right">Avg diff</span>
            </div>
            {rows.map(({ d, s, winRate, avgDiff }) => (
              <div key={d}>
                <div className="grid grid-cols-4 gap-2 items-center bg-slate-800 rounded-lg px-3 py-2 text-sm">
                  <span className="font-medium">{DIFFICULTY_LABELS[d] || d}</span>
                  <span className="text-center tabular-nums">{s.wins}–{s.losses}–{s.ties}</span>
                  <span className="text-center tabular-nums">{s.games ? `${winRate}%` : "—"}</span>
                  <span className="text-right tabular-nums">{s.games ? (avgDiff >= 0 ? "+" : "") + avgDiff.toFixed(1) : "—"}</span>
                </div>
                {splitStart && s.games > 0 && [["youFirst", "you started"], ["aiFirst", "AI started"]].map(([k, label]) => {
                  const x = sub(s, k);
                  return (
                    <div key={k} className="grid grid-cols-4 gap-2 items-center px-3 py-1 text-xs text-slate-400">
                      <span className="pl-2">↳ {label}</span>
                      <span className="text-center tabular-nums">{x.games ? `${x.wins}–${x.losses}–${x.ties}` : "—"}</span>
                      <span className="text-center tabular-nums">{x.games ? `${x.winRate}%` : "—"}</span>
                      <span className="text-right tabular-nums">{x.games ? (x.avgDiff >= 0 ? "+" : "") + x.avgDiff.toFixed(1) : "—"}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            <button onClick={() => setSplitStart((v) => !v)}
              className="w-full text-xs text-slate-400 hover:text-white py-1">
              {splitStart ? "Hide" : "Show"} split by who started
            </button>
          </div>
        )}
        <div className="flex justify-between items-center mt-4">
          <button onClick={onReset} className="text-xs text-slate-500 hover:text-rose-300 transition-colors">Reset stats</button>
          <button onClick={onClose}
            className="rounded-lg bg-slate-100 text-slate-900 font-semibold px-4 py-2 text-sm hover:bg-white transition-colors">Close</button>
        </div>
        <p className="text-xs text-slate-600 mt-3 leading-relaxed">
          Avg diff = your tiles minus the AI's, averaged per game. A resignation counts as a loss. Stats are saved on this device.
        </p>

        {/* Match log export — full move-by-move record of this session, for
            offline analysis. Kept in memory only, so export before reloading. */}
        <div className="mt-4 pt-3 border-t border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-400">
              Match log: <span className="font-semibold text-slate-200">{(sessionLog || []).length}</span> game{(sessionLog || []).length === 1 ? "" : "s"}
              {(sessionLog || []).length ? <span className="text-slate-500"> · {logKB} KB</span> : null}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setShowLog((v) => !v)}
                disabled={!(sessionLog || []).length}
                className="text-xs rounded-lg bg-slate-800 hover:bg-slate-700 px-2 py-1.5 disabled:opacity-40">
                {showLog ? "Hide" : "Show"}
              </button>
              <button
                onClick={async () => {
                  try { await navigator.clipboard.writeText(logText); setCopied(true); setTimeout(() => setCopied(false), 2000); }
                  catch (e) { setShowLog(true); }
                }}
                disabled={!(sessionLog || []).length}
                className="text-xs rounded-lg bg-slate-800 hover:bg-slate-700 px-2 py-1.5 disabled:opacity-40">
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                onClick={downloadLog}
                disabled={!(sessionLog || []).length}
                className="text-xs font-semibold rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 px-3 py-1.5 disabled:opacity-40">
                Download
              </button>
            </div>
          </div>
          {dlError && <p className="text-[11px] text-rose-400 mt-2">{dlError}</p>}
          {chunks.length > 1 && (
            <div className="mt-2">
              <p className="text-[11px] text-slate-500 mb-1">Or copy in {chunks.length} parts (paste each in order):</p>
              <div className="flex flex-wrap gap-1.5">
                {chunks.map((_, i) => (
                  <button key={i} onClick={() => copyPart(i)}
                    className="text-[11px] rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">
                    {copiedPart === i ? "✓" : `${i + 1}/${chunks.length}`}
                  </button>
                ))}
              </div>
            </div>
          )}
          {showLog && (
            <textarea readOnly value={logText} onFocus={(e) => e.target.select()}
              className="mt-2 w-full h-28 text-[10px] font-mono rounded-lg bg-slate-950 ring-1 ring-slate-800 p-2 text-slate-300" />
          )}
        </div>
      </div>
    </div>
  );
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="flex rounded-lg bg-slate-800 p-0.5">
        {options.map(([val, text]) => (
          <button key={val} onClick={() => onChange(val)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              value === val ? "bg-slate-100 text-slate-900" : "text-slate-300 hover:text-white"
            }`}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
