import React, { useReducer, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { RefreshCw, Brain, Paintbrush, HelpCircle, X, Home, Compass, Undo2, Flag,
         Map as MapIcon, Globe2 as GlobeIcon, BarChart3, Zap, ChevronLeft } from "lucide-react";

/* ============================================================ *
 *  INFLUENCE FLOOD: GLOBE
 *
 *  Same paint-then-flood territory game, played on a sphere. A sphere cannot
 *  be tiled by hexagons alone — Euler's formula forces exactly 12 pentagons —
 *  so the board is a Goldberg polyhedron: an icosahedron subdivided, projected
 *  onto the sphere, then dualised. The result has no edges and no corners, so
 *  every territory can be outflanked from any direction.
 * ============================================================ */

const PALETTE = ["#d96b5e", "#e3a05f", "#e6d182", "#82b07e", "#6f93c9", "#a382bf", "#5fb3ac"];
const MAX_CLUSTER = 3;   // no starting same-colour cluster larger than this
const STALL_LIMIT = 6;
const PLAYER_IDS = ["P1", "P2", "P3"];
const OUTLINE = { P1: null, P2: "6 4", P3: "1.5 3" };   // solid / dashed / dotted
const SIZES = { 2: "Small", 3: "Medium", 4: "Large" };
const AI_NAMES = ["Robocopper", "Artifishy"];
const AI_NAMES_STRATEGIST = ["Robocopper II", "Artifishy II"];

/* ---------- vector helpers ---------- */
const PHI = (1 + Math.sqrt(5)) / 2;
const norm = (v) => { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/* ============================================================ *
 *  1. SPHERE GEOMETRY
 * ============================================================ */

function icosahedron() {
  const v = [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
  ].map(norm);
  const f = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { v, f };
}

/** Goldberg tiling at frequency m: 10m^2+2 cells, always 12 of them pentagons. */
function buildGlobe(m) {
  const { v: iv, f: iface } = icosahedron();
  const verts = [];
  const index = new Map();
  const addVert = (p) => {
    const q = norm(p);
    const k = q.map((x) => x.toFixed(6)).join(",");
    if (index.has(k)) return index.get(k);
    verts.push(q);
    index.set(k, verts.length - 1);
    return verts.length - 1;
  };

  const tris = [];
  for (const [ia, ib, ic] of iface) {
    const A = iv[ia], B = iv[ib], C = iv[ic];
    const grid = [];
    for (let i = 0; i <= m; i++) {
      const row = [];
      for (let j = 0; j <= m - i; j++) {
        row.push(addVert(add(add(A, mul(sub(B, A), i / m)), mul(sub(C, A), j / m))));
      }
      grid.push(row);
    }
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m - i; j++) {
        tris.push([grid[i][j], grid[i + 1][j], grid[i][j + 1]]);
        if (j < m - i - 1) tris.push([grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]);
      }
    }
  }

  const faceOf = verts.map(() => []);
  tris.forEach((t, ti) => t.forEach((vi) => faceOf[vi].push(ti)));
  const centroid = tris.map((t) => norm(add(add(verts[t[0]], verts[t[1]]), verts[t[2]])));

  const adj = verts.map(() => new Set());
  for (const [a, b, c] of tris) {
    adj[a].add(b); adj[a].add(c); adj[b].add(a);
    adj[b].add(c); adj[c].add(a); adj[c].add(b);
  }

  const cells = verts.map((centre, vi) => {
    const ref = Math.abs(centre[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm(cross(centre, ref));
    const w = cross(centre, u);
    const corners = faceOf[vi]
      .map((ti) => centroid[ti])
      .map((p) => ({ p, a: Math.atan2(dot3(p, w), dot3(p, u)) }))
      .sort((x, y) => x.a - y.a)
      .map((x) => x.p);
    return { centre, corners };
  });

  return { cells, neighbors: adj.map((s) => [...s]) };
}

const globeCache = new Map();
const getGlobe = (m) => {
  if (!globeCache.has(m)) globeCache.set(m, buildGlobe(m));
  return globeCache.get(m);
};

/* ============================================================ *
 *  2. GAME LOGIC
 * ============================================================ */

const coloursFor = (n) => (n >= 3 ? 7 : 6);

/** Random colours with no starting cluster larger than `cap`. */
/* A proper uniform shuffle. `sort(() => Math.random() - 0.5)` is not one:
   comparator-based shuffling favours elements near the front, which made
   colour 0 the first choice 25% of the time instead of 14% and left boards
   badly skewed toward the low-numbered colours. */
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cappedColours(count, neighbors, numColours, cap) {
  const parent = [...Array(count).keys()];
  const size = new Array(count).fill(1);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const colours = new Array(count).fill(-1);
  const used = new Array(numColours).fill(0);
  const order = shuffled([...Array(count).keys()]);
  for (const i of order) {
    // Try scarce colours first (ties broken randomly), so the palette stays
    // roughly even instead of drifting toward whichever colour got lucky early.
    const choices = shuffled([...Array(numColours).keys()]).sort((a, b) => used[a] - used[b]);
    let placed = false;
    for (const c of choices) {
      let total = 1;
      const roots = new Set();
      for (const j of neighbors[i]) {
        if (colours[j] !== c) continue;
        const r = find(j);
        if (!roots.has(r)) { roots.add(r); total += size[r]; }
      }
      if (total > cap) continue;
      colours[i] = c;
      used[c]++;
      for (const r of roots) { parent[r] = i; size[i] += size[r]; }
      placed = true;
      break;
    }
    if (!placed) {
      // No colour fits under the cluster cap — take the scarcest one.
      let best = 0;
      for (let c = 1; c < numColours; c++) if (used[c] < used[best]) best = c;
      colours[i] = best;
      used[best]++;
    }
  }
  return colours;
}

function bfsDist(neighbors, src) {
  const d = new Array(neighbors.length).fill(-1);
  d[src] = 0;
  const q = [src];
  for (let i = 0; i < q.length; i++) {
    for (const nb of neighbors[q[i]]) if (d[nb] < 0) { d[nb] = d[q[i]] + 1; q.push(nb); }
  }
  return d;
}

/** Maximally separated homes — everyone gets their own quiet corner. */
function pickHomesFar(cells, count) {
  // Randomise the whole configuration each game with a rigid rotation. Before
  // this, the target directions were fixed in world space and the sphere's
  // cell positions never change between games, so "nearest cell to a fixed
  // direction" always resolved to the identical three cells, every game —
  // only the colour layout ever varied. Rotating by a random basis keeps the
  // exact same maximal-separation angles between targets while landing on a
  // different triple of cells each time.
  const n = norm([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
  const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(n, ref));
  const w = cross(n, u);
  const local = count === 3
    ? [[1, 0, 0], [-0.5, 0, Math.sqrt(3) / 2], [-0.5, 0, -Math.sqrt(3) / 2]]
    : [[1, 0, 0], [-1, 0, 0]];
  const targets = local.map(([x, y, z]) => add(add(mul(u, x), mul(n, y)), mul(w, z)));
  const used = new Set();
  return targets.map((t) => {
    let best = -1, bv = -Infinity;
    cells.forEach((c, i) => {
      if (used.has(i)) return;
      const d = dot3(c.centre, t);
      if (d > bv) { bv = d; best = i; }
    });
    used.add(best);
    return best;
  });
}

/**
 * Homes a few cells apart, so territories collide immediately and the game is
 * about contact rather than each side quietly filling its own hemisphere.
 */
function pickHomesClose(cells, neighbors, count, sep = 3) {
  const n = cells.length;
  for (let attempt = 0; attempt < 300; attempt++) {
    const seed = Math.floor(Math.random() * n);
    const d0 = bfsDist(neighbors, seed);
    const ring = [];
    for (let i = 0; i < n; i++) if (d0[i] === sep) ring.push(i);
    if (!ring.length) continue;
    if (count === 2) return [seed, ring[Math.floor(Math.random() * ring.length)]];
    for (let k = ring.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [ring[k], ring[j]] = [ring[j], ring[k]];
    }
    for (const a of ring) {
      const da = bfsDist(neighbors, a);
      const third = ring.find((b) => b !== a && da[b] === sep);
      if (third !== undefined) return [seed, a, third];
    }
  }
  return pickHomesFar(cells, count);
}

/** Is every non-void cell still reachable from `from`? */
function stillConnected(neighbors, total, voids, from) {
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const x = q.pop();
    for (const nb of neighbors[x]) {
      if (voids.has(nb) || seen.has(nb)) continue;
      seen.add(nb); q.push(nb);
    }
  }
  return seen.size === total - voids.size;
}

/**
 * Punch small clusters of dead cells around the world. Without them a globe has
 * a uniform surface and an enormous perimeter to hold, so play collapses into
 * "grab the most cells this turn". Gaps create walls you don't have to build,
 * which turns the game back into contesting a handful of routes.
 */
function makeVoids(cells, neighbors, homeIdx, fraction) {
  if (fraction <= 0) return new Set();
  const n = cells.length;
  const target = Math.floor(n * fraction);
  const homeSet = new Set(homeIdx);
  // keep a clear ring around each home so nobody starts walled in
  const nearHome = new Set();
  for (const h of homeIdx) {
    nearHome.add(h);
    for (const nb of neighbors[h]) { nearHome.add(nb); for (const nb2 of neighbors[nb]) nearHome.add(nb2); }
  }
  const voids = new Set();
  let guard = 0;
  while (voids.size < target && guard++ < 600) {
    const seed = Math.floor(Math.random() * n);
    if (voids.has(seed) || nearHome.has(seed)) continue;
    const blob = [seed];
    const want = 2 + Math.floor(Math.random() * 3);   // 2-4 cells per gap
    while (blob.length < want) {
      const from = blob[Math.floor(Math.random() * blob.length)];
      const cand = neighbors[from].filter(
        (x) => !voids.has(x) && !nearHome.has(x) && !blob.includes(x)
      );
      if (!cand.length) break;
      blob.push(cand[Math.floor(Math.random() * cand.length)]);
    }
    const test = new Set([...voids, ...blob]);
    if (stillConnected(neighbors, n, test, homeIdx[0])) blob.forEach((b) => voids.add(b));
  }
  return voids;
}

const GAP_FRACTION = { none: 0, few: 0.12, many: 0.22 };

function createGame(freq, numPlayers, spread = "close", gaps = "few") {
  const geo = getGlobe(freq);
  const numColours = coloursFor(numPlayers);
  const colours = cappedColours(geo.cells.length, geo.neighbors, numColours, MAX_CLUSTER);
  const homeIdx = spread === "far"
    ? pickHomesFar(geo.cells, numPlayers)
    : pickHomesClose(geo.cells, geo.neighbors, numPlayers);
  const players = PLAYER_IDS.slice(0, numPlayers);

  const owners = new Array(geo.cells.length).fill(null);
  const current = {};
  homeIdx.forEach((h, i) => { owners[h] = players[i]; });
  homeIdx.forEach((h, i) => {
    let c = colours[h];
    const taken = players.slice(0, i).map((p) => current[p]);
    while (taken.includes(c)) c = (c + 1) % numColours;
    colours[h] = c;
    current[players[i]] = c;
  });

  const voids = makeVoids(geo.cells, geo.neighbors, homeIdx, GAP_FRACTION[gaps] ?? 0);

  const first = players[Math.floor(Math.random() * players.length)];
  const g = {
    freq, spread, gaps, voids,
    peak: Object.fromEntries(players.map((p) => [p, 1])),   // each starts owning 1 cell (home)
    cells: geo.cells, neighbors: geo.neighbors, colours, owners, current,
    homes: Object.fromEntries(players.map((p, i) => [p, homeIdx[i]])),
    homeSet: new Set(homeIdx),
    players, numColours, locked: new Set(),
    turn: first, firstPlayer: first,
    phase: "move",        // the opening turn is flood-only
    moveCount: 0, finished: false, resignedBy: null,
    neutralMark: undefined, stall: 0, maxMoves: geo.cells.length * 2,
    gameId: Math.random().toString(36).slice(2),
  };
  g.counts = countCells(g);
  return g;
}

function countCells(g) {
  const out = { neutral: 0 };
  for (const p of g.players) out[p] = 0;
  g.owners.forEach((o, i) => {
    if (g.voids.has(i)) return;
    if (o === null) out.neutral++; else out[o]++;
  });
  return out;
}

const nextPlayer = (g, p) => g.players[(g.players.indexOf(p) + 1) % g.players.length];

/** No colour currently held by any player may be flooded. */
function legalFloods(g) {
  const taken = new Set(g.players.map((p) => g.current[p]));
  const out = [];
  for (let c = 0; c < g.numColours; c++) if (!taken.has(c)) out.push(c);
  return out;
}

const isPaintable = (g, player, i) =>
  !g.voids.has(i) && !g.locked.has(i) && g.owners[i] !== player && !g.homeSet.has(i);

function applyPaint(g, i, colour) {
  const colours = g.colours.slice();
  const owners = g.owners.slice();
  const locked = new Set(g.locked);
  colours[i] = colour;
  owners[i] = null;
  locked.add(i);
  return { ...g, colours, owners, locked };
}

function applyFlood(g, player, colour) {
  const colours = g.colours.slice();
  const owners = g.owners.slice();
  const queue = [];
  owners.forEach((o, i) => { if (o === player) { colours[i] = colour; queue.push(i); } });
  while (queue.length) {
    const cur = queue.pop();
    for (const nb of g.neighbors[cur]) {
      if (g.voids.has(nb)) continue;
      if (owners[nb] === null && colours[nb] === colour) { owners[nb] = player; queue.push(nb); }
    }
  }
  // A player's tile count can only rise on their own flood — painting never
  // grants ownership, only strips it (see applyPaint) — so this is the one
  // place a new personal best can occur.
  const newCount = owners.filter((o) => o === player).length;
  const peak = { ...g.peak, [player]: Math.max(g.peak?.[player] || 0, newCount) };
  return { ...g, colours, owners, current: { ...g.current, [player]: colour }, peak };
}

/**
 * Can anyone still claim a neutral cell? A cell is winnable if it touches some
 * player's territory and either is unlocked (paint it, then flood that colour)
 * or carries a colour nobody currently holds. Counting idle turns instead was
 * wrong: it ended games where a capture was plainly still available, just
 * because the players happened to be trading cells for a few turns.
 */
function progressPossible(g) {
  const held = new Set(g.players.map((p) => g.current[p]));
  for (let i = 0; i < g.owners.length; i++) {
    if (g.owners[i] !== null || g.voids.has(i)) continue;
    const touchesSomeone = g.neighbors[i].some((nb) => g.owners[nb] !== null && !g.voids.has(nb));
    if (!touchesSomeone) continue;
    if (!g.locked.has(i)) return true;          // paintable, so reachable
    if (!held.has(g.colours[i])) return true;   // locked but floodable as-is
  }
  return false;
}

/** End when the board fills, or when nothing more can be claimed. */
function settle(g, player) {
  const counts = countCells(g);
  const prevMin = g.neutralMark === undefined ? Infinity : g.neutralMark;
  const stall = counts.neutral < prevMin ? 0 : (g.stall || 0) + 1;
  const finished =
    counts.neutral === 0 ||
    g.moveCount >= g.maxMoves ||
    !progressPossible({ ...g, counts });
  return {
    ...g, counts, neutralMark: Math.min(prevMin, counts.neutral), stall, finished,
    turn: finished ? player : nextPlayer(g, player),
    phase: "paint",
  };
}

/** Every cell the rules actually allow to be painted. */
function allPaintable(g, player) {
  const s = new Set();
  for (let i = 0; i < g.cells.length; i++) if (isPaintable(g, player, i)) s.add(i);
  return s;
}

/**
 * Cells touching somebody's territory. This is a SEARCH PRUNE for the AI only —
 * painting far from any border is legal but almost never its best move, and
 * enumerating the whole world would be far slower. Humans get allPaintable().
 */
function paintTargets(g, player) {
  const s = new Set();
  g.owners.forEach((o, i) => {
    if (o === null) return;
    for (const nb of g.neighbors[i]) if (isPaintable(g, player, nb)) s.add(nb);
  });
  return s;
}

/* ---------- AI ---------- */

/* Claiming neutral ground is permanent; taking a cell off a rival can be undone
   next turn. */
/* Must exceed 1.0: claiming a neutral cell shifts the differential by +1, while
   taking one off a rival shifts it by +2 (you gain, they lose). Below 1.0 the
   AIs always prefer raiding each other, and two of them will trade the same
   cell indefinitely while unclaimed ground sits untouched. */
const PROGRESS_BONUS = 1.2;

/** Score a position for `player`: own cells minus the strongest rival's. */
function evaluate(g, player) {
  const c = countCells(g);
  let best = -Infinity;
  for (const p of g.players) if (p !== player && c[p] > best) best = c[p];
  return c[player] - best - PROGRESS_BONUS * c.neutral;
}

/** Every legal complete turn (optional paint, then flood). */
function allTurns(g, player, floodOnly) {
  const out = [];
  for (const col of legalFloods(g)) {
    out.push({ paint: null, flood: col, next: applyFlood(g, player, col) });
  }
  if (floodOnly) return out;
  for (const t of paintTargets(g, player)) {
    for (let pc = 0; pc < g.numColours; pc++) {
      const painted = applyPaint(g, t, pc);
      for (const col of legalFloods(painted)) {
        out.push({ paint: { cell: t, colour: pc }, flood: col, next: applyFlood(painted, player, col) });
      }
    }
  }
  return out;
}

/* ---- Positional features (used by the Strategist difficulty) ---- */

/** Voronoi influence: which player is nearest to each unclaimed cell. */
function voronoiInfluence(g) {
  const dist = new Map(), owner = new Map();
  let q = [];
  g.owners.forEach((o, i) => { if (o !== null && !g.voids.has(i)) { dist.set(i, 0); owner.set(i, o); q.push(i); } });
  let d = 0;
  while (q.length) {
    const nx = [];
    for (const k of q) for (const nb of g.neighbors[k]) {
      if (g.voids.has(nb) || g.owners[nb] !== null) continue;
      if (!dist.has(nb)) { dist.set(nb, d + 1); owner.set(nb, owner.get(k)); nx.push(nb); }
      else if (dist.get(nb) === d + 1 && owner.get(nb) !== owner.get(k)) owner.set(nb, "tie");
    }
    q = nx; d++;
  }
  const out = {};
  for (const p of g.players) out[p] = 0;
  g.owners.forEach((o, i) => {
    if (o !== null || g.voids.has(i)) return;
    const w = owner.get(i);
    if (w && w !== "tie") out[w]++;
  });
  return out;
}

/** Open ground only one player can still touch — effectively already theirs. */
function exclusiveRegions(g) {
  const seen = new Set(), out = {};
  for (const p of g.players) out[p] = 0;
  for (let s = 0; s < g.owners.length; s++) {
    if (g.owners[s] !== null || g.voids.has(s) || seen.has(s)) continue;
    const comp = [s]; seen.add(s);
    const touch = new Set();
    let i = 0;
    while (i < comp.length) {
      const k = comp[i++];
      for (const nb of g.neighbors[k]) {
        if (g.voids.has(nb)) continue;
        if (g.owners[nb] === null) { if (!seen.has(nb)) { seen.add(nb); comp.push(nb); } }
        else touch.add(g.owners[nb]);
      }
    }
    if (touch.size === 1) out[[...touch][0]] += comp.length;
  }
  return out;
}

const STRATEGIST_W = [1, 0.4, 0.3];   // material, influence, walled-off ground

/**
 * Richer leaf score: cells, plus how much unclaimed ground you're nearest to
 * and how much is already walled off to you — each measured against the
 * strongest rival. Only applied to the handful of shortlisted turns, since a
 * Voronoi sweep per candidate would be far too slow across all of them.
 */
function strategistEval(g, player) {
  const c = countCells(g);
  const v = voronoiInfluence(g);
  const e = exclusiveRegions(g);
  const rivals = g.players.filter((p) => p !== player);
  const bestCells = Math.max(...rivals.map((p) => c[p]));
  const N = Math.max(1, g.cells.length - g.voids.size);
  return (
    STRATEGIST_W[0] * (c[player] - bestCells) / N +
    STRATEGIST_W[1] * (v[player] - Math.max(...rivals.map((p) => v[p]))) / N +
    STRATEGIST_W[2] * (e[player] - Math.max(...rivals.map((p) => e[p]))) / N -
    PROGRESS_BONUS * c.neutral / N
  );
}

/** Immediate best turn — used both on its own and as the rivals' reply model. */
function greedyTurn(g, player, floodOnly) {
  const cands = allTurns(g, player, floodOnly);
  let best = cands[0], bv = -Infinity;
  for (const c of cands) {
    const v = evaluate(c.next, player);
    if (v > bv) { bv = v; best = c; }
  }
  return best;
}

/**
 * Shortlist the best turns by immediate gain, then judge each by the position
 * after every rival has taken their own best reply. Measured on close starts
 * this beats plain greedy about 73% of the time; with homes far apart the edge
 * shrinks to ~62%, because separated territories interact far less.
 */
function chooseTurn(g, player, floodOnly, strategist = false, K = 14) {
  const cands = allTurns(g, player, floodOnly);
  if (cands.length === 1) return cands[0];
  for (const c of cands) c.mat = evaluate(c.next, player);
  cands.sort((a, b) => b.mat - a.mat);
  const short = cands.slice(0, Math.min(K, cands.length));
  const score = strategist ? strategistEval : evaluate;
  let best = short[0], bv = -Infinity;
  for (const c of short) {
    let sim = c.next;
    let cur = player;
    for (let r = 0; r < g.players.length - 1; r++) {
      cur = g.players[(g.players.indexOf(cur) + 1) % g.players.length];
      sim = greedyTurn({ ...sim, turn: cur, phase: "paint" }, cur, false).next;
    }
    const v = score(sim, player);
    if (v > bv) { bv = v; best = c; }
  }
  return best;
}

/* ---------- reducer ---------- */

function reducer(state, action) {
  switch (action.type) {
    case "NEW_GAME":
      return createGame(action.freq, action.numPlayers, action.spread, action.gaps);
    case "RESTORE":
      return action.game;
    case "PAINT": {
      if (state.finished || state.phase !== "paint") return state;
      if (!isPaintable(state, state.turn, action.cell)) return state;
      return { ...applyPaint(state, action.cell, action.colour), phase: "move" };
    }
    case "SKIP_PAINT":
      if (state.finished || state.phase !== "paint") return state;
      return { ...state, phase: "move" };
    case "FLOOD": {
      if (state.finished || state.phase !== "move") return state;
      if (!legalFloods(state).includes(action.colour)) return state;
      const moved = { ...applyFlood(state, state.turn, action.colour), moveCount: state.moveCount + 1 };
      return settle(moved, state.turn);
    }
    case "AI_TURN": {
      if (state.finished) return state;
      const player = state.turn;
      let g = state;
      if (g.phase === "paint" && action.plan.paint && isPaintable(g, player, action.plan.paint.cell)) {
        g = applyPaint(g, action.plan.paint.cell, action.plan.paint.colour);
      }
      const legal = legalFloods(g);
      const colour = legal.includes(action.plan.flood) ? action.plan.flood : legal[0];
      const moved = { ...applyFlood(g, player, colour), moveCount: g.moveCount + 1 };
      return settle(moved, player);
    }
    case "RESIGN":
      return state.finished ? state : { ...state, finished: true, resignedBy: action.player };
    default:
      return state;
  }
}

/* ============================================================ *
 *  3. RENDERING
 * ============================================================ */

/* Orientation is a full 3x3 rotation matrix rather than yaw/pitch angles.
   Euler angles rotate about fixed world axes, so a sideways drag produced the
   same spin wherever you grabbed the ball. A matrix carries roll too, which is
   what lets a drag near the pole behave differently from one across the middle. */
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const applyMat = (M, p) => [
  M[0] * p[0] + M[1] * p[1] + M[2] * p[2],
  M[3] * p[0] + M[4] * p[1] + M[5] * p[2],
  M[6] * p[0] + M[7] * p[1] + M[8] * p[2],
];

const matMul = (A, B) => {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let col = 0; col < 3; col++) {
      out[r * 3 + col] = A[r * 3] * B[col] + A[r * 3 + 1] * B[3 + col] + A[r * 3 + 2] * B[6 + col];
    }
  }
  return out;
};

/** Rotation matrix for `angle` about a unit `axis` (Rodrigues). */
function axisAngle(axis, angle) {
  const [x, y, z] = axis;
  const s = Math.sin(angle), co = Math.cos(angle), t = 1 - co;
  return [
    t * x * x + co,     t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z,  t * y * y + co,    t * y * z - s * x,
    t * x * z - s * y,  t * y * z + s * x, t * z * z + co,
  ];
}

/** Shortest rotation carrying unit vector `a` onto unit vector `b`. */
function rotateAtoB(a, b) {
  const axis = cross(a, b);
  const s = Math.hypot(axis[0], axis[1], axis[2]);
  const d = dot3(a, b);
  if (s < 1e-8) {
    if (d > 0) return IDENT.slice();
    const perp = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
    return axisAngle(norm(perp), Math.PI);
  }
  return axisAngle([axis[0] / s, axis[1] / s, axis[2] / s], Math.atan2(s, d));
}

/** Map a pointer position onto the virtual trackball (equator beyond the rim). */
function toBall(clientX, clientY, rect) {
  const scale = Math.min(rect.width, rect.height) / 350;
  const x = (clientX - (rect.left + rect.width / 2)) / (150 * scale);
  const y = -(clientY - (rect.top + rect.height / 2)) / (150 * scale);
  const d = x * x + y * y;
  if (d <= 1) return [x, y, Math.sqrt(1 - d)];
  const L = Math.sqrt(d);
  return [x / L, y / L, 0];
}

function Globe({ state, selectable, selectColour, onCellClick, rot, onRotate }) {
  const R = 150;
  const drag = useRef(null);
  const [hovered, setHovered] = useState(null);
  // Nearly every cell is paintable, so tinting them all would repaint the whole
  // globe. Mark only the one under the pointer instead.
  useEffect(() => { setHovered(null); }, [selectable]);

  const faces = useMemo(() => {
    const out = [];
    state.cells.forEach((cell, i) => {
      const c = applyMat(rot, cell.centre);
      if (c[2] <= 0.06) return;            // only the hemisphere facing us
      const pts = cell.corners
        .map((p) => applyMat(rot, p))
        .map((p) => `${(p[0] * R).toFixed(1)},${(-p[1] * R).toFixed(1)}`)
        .join(" ");
      out.push({ i, z: c[2], pts, cx: c[0] * R, cy: -c[1] * R });
    });
    return out.sort((a, b) => a.z - b.z);   // far cells first
  }, [state, rot]);

  const pointerDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = { rect, v0: toBall(e.clientX, e.clientY, rect), rot0: rot, x: e.clientX, y: e.clientY, moved: 0 };
    // Capture so the drag survives the pointer leaving this (short, wide)
    // element — without it a vertical drag died the moment it crossed the edge.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* unsupported */ }
  };
  const pointerMove = (e) => {
    if (!drag.current) return;
    const { rect, v0, rot0 } = drag.current;
    drag.current.moved = Math.max(drag.current.moved,
      Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y));
    // Trackball: spin by whatever rotation carries the grabbed surface point to
    // the pointer, so the cell under your finger genuinely follows it.
    const v1 = toBall(e.clientX, e.clientY, rect);
    onRotate(matMul(rotateAtoB(v0, v1), rot0));
  };
  const pointerUp = () => { drag.current = null; setHovered(null); };

  return (
    <svg viewBox="-175 -175 350 350" className="w-full select-none"
         onPointerDown={pointerDown} onPointerMove={pointerMove}
         onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}
         style={{ maxHeight: "52vh", touchAction: "none" }}>
      <defs>
        <radialGradient id="limb" cx="50%" cy="50%" r="50%">
          <stop offset="82%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
      </defs>
      <circle cx="0" cy="0" r={R * 1.02} fill="#0b1220" />

      {faces.map(({ i, pts, cx, cy }) => {
        const owner = state.owners[i];
        const canPick = selectable.has(i);
        if (state.voids.has(i)) {
          return <polygon key={i} points={pts} fill="#050912" stroke="#0b1220" strokeWidth="0.7" />;
        }
        return (
          <g key={i}>
            <polygon points={pts} fill={PALETTE[state.colours[i]]}
                     stroke="#0b1220" strokeWidth="0.7"
                     onClick={canPick ? (e) => { e.stopPropagation(); onCellClick(i); setHovered(null); } : undefined}
                     onPointerEnter={canPick ? () => { if (!drag.current) setHovered(i); } : undefined}
                     style={{ cursor: canPick ? "pointer" : "default" }} />
            {owner && <polygon points={pts} fill="#000" fillOpacity="0.16" pointerEvents="none" />}
            {owner && (
              <polygon points={pts} fill="none" stroke="#f8fafc" strokeWidth="2"
                       strokeDasharray={OUTLINE[owner] || undefined}
                       strokeLinejoin="round" pointerEvents="none" />
            )}
            {canPick && hovered === i && (
              <polygon points={pts} fill={selectColour} fillOpacity="0.35"
                       stroke={selectColour} strokeWidth="2.5" pointerEvents="none" />
            )}
            {state.homeSet.has(i) && (
              <circle cx={cx} cy={cy} r="4.5" fill="#0b1220" stroke="#fff" strokeWidth="1.8" pointerEvents="none" />
            )}
            {state.locked.has(i) && !state.homeSet.has(i) && (
              <circle cx={cx} cy={cy} r="2.4" fill="#f8fafc" stroke="#0f172a" strokeWidth="1" pointerEvents="none" />
            )}
          </g>
        );
      })}

      <circle cx="0" cy="0" r={R * 1.02} fill="url(#limb)" pointerEvents="none" />
    </svg>
  );
}


/**
 * Equirectangular projection of the globe.
 *
 * Longitude/latitude map straight to x/y. Two cells — the ones containing the
 * poles — genuinely wrap all the way round, so they're drawn as a full-width
 * band at the top and bottom, which is how atlases handle polar regions.
 * Cells crossing the antimeridian are drawn twice so they appear on both edges.
 */
function FlatMap({ state, selectable, selectColour, onCellClick }) {
  const [hovered, setHovered] = useState(null);
  useEffect(() => { setHovered(null); }, [selectable]);

  const D = 180 / Math.PI;
  const shapes = useMemo(() => {
    const out = [];
    state.cells.forEach((cell, i) => {
      const cLon = Math.atan2(cell.centre[0], cell.centre[2]);
      const cLat = Math.asin(Math.max(-1, Math.min(1, cell.centre[1])));
      const pts = cell.corners.map((p) => {
        let lon = Math.atan2(p[0], p[2]);
        while (lon - cLon > Math.PI) lon -= 2 * Math.PI;
        while (lon - cLon < -Math.PI) lon += 2 * Math.PI;
        return [lon, Math.asin(Math.max(-1, Math.min(1, p[1])))];
      });
      const lons = pts.map((q) => q[0]);
      const lats = pts.map((q) => q[1]);
      const span = Math.max(...lons) - Math.min(...lons);

      if (span > Math.PI) {
        // contains a pole: stretch it across the full width
        const poleLat = cLat > 0 ? Math.PI / 2 : -Math.PI / 2;
        const edge = cLat > 0 ? Math.min(...lats) : Math.max(...lats);
        const poly = [[-Math.PI, poleLat], [Math.PI, poleLat], [Math.PI, edge], [-Math.PI, edge]];
        out.push({ i, pts: poly.map(([lo, la]) => `${(lo * D).toFixed(1)},${(-la * D).toFixed(1)}`).join(" "),
                   cx: 0, cy: -((poleLat + edge) / 2) * D });
        return;
      }

      const draw = (shift) => pts.map(([lo, la]) => `${((lo + shift) * D).toFixed(1)},${(-la * D).toFixed(1)}`).join(" ");
      out.push({ i, pts: draw(0), cx: cLon * D, cy: -cLat * D });
      if (Math.min(...lons) < -Math.PI) out.push({ i, pts: draw(2 * Math.PI), cx: (cLon + 2 * Math.PI) * D, cy: -cLat * D, ghost: true });
      if (Math.max(...lons) > Math.PI) out.push({ i, pts: draw(-2 * Math.PI), cx: (cLon - 2 * Math.PI) * D, cy: -cLat * D, ghost: true });
    });
    return out;
  }, [state]);

  return (
    <svg viewBox="-182 -94 364 188" className="w-full touch-none select-none" style={{ maxHeight: "52vh" }}>
      <rect x="-182" y="-94" width="364" height="188" fill="#0b1220" />
      {shapes.map(({ i, pts, cx, cy, ghost }, k) => {
        const owner = state.owners[i];
        const canPick = selectable.has(i);
        if (state.voids.has(i)) {
          return <polygon key={k} points={pts} fill="#050912" stroke="#0b1220" strokeWidth="0.6" />;
        }
        return (
          <g key={k}>
            <polygon points={pts} fill={PALETTE[state.colours[i]]} stroke="#0b1220" strokeWidth="0.6"
                     onClick={canPick ? (e) => { e.stopPropagation(); onCellClick(i); setHovered(null); } : undefined}
                     onPointerEnter={canPick ? () => setHovered(i) : undefined}
                     onPointerLeave={() => setHovered(null)}
                     style={{ cursor: canPick ? "pointer" : "default" }} />
            {owner && <polygon points={pts} fill="#000" fillOpacity="0.16" pointerEvents="none" />}
            {owner && (
              <polygon points={pts} fill="none" stroke="#f8fafc" strokeWidth="1.6"
                       strokeDasharray={OUTLINE[owner] || undefined} strokeLinejoin="round" pointerEvents="none" />
            )}
            {canPick && hovered === i && (
              <polygon points={pts} fill={selectColour} fillOpacity="0.35"
                       stroke={selectColour} strokeWidth="2" pointerEvents="none" />
            )}
            {!ghost && state.homeSet.has(i) && (
              <circle cx={cx} cy={cy} r="3.2" fill="#0b1220" stroke="#fff" strokeWidth="1.4" pointerEvents="none" />
            )}
            {!ghost && state.locked.has(i) && !state.homeSet.has(i) && (
              <circle cx={cx} cy={cy} r="1.8" fill="#f8fafc" stroke="#0f172a" strokeWidth="0.8" pointerEvents="none" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ============================================================ *
 *  4. APP
 * ============================================================ */

// The most games you can commit to in one sitting. You pick a number up front
// (1..MAX) and it locks for the session -- there is no in-app way to raise it,
// deliberately, the same as the quiet-hours gate. Reviewing already-played
// games (Review moves, Replay, Stats) stays open past the cap, since that's
// reflection, not more play.
// Quick play always uses these, whatever was last chosen on the custom screen.
const QUICK_CONFIG = { freq: 4, numPlayers: 3, humans: 1, spread: "far", gaps: "many", difficulty: "strategist" };
const SESSION_GAME_MAX = 5;
const GOAL_LABELS = { 1: "just 1 game bro 🥺" };

const QUIET_START = 23, QUIET_END = 8;
const inQuietHours = (d = new Date()) => { const h = d.getHours(); return h >= QUIET_START || h < QUIET_END; };
function minutesUntilOpen(d = new Date()) {
  const o = new Date(d); o.setMinutes(0, 0, 0); o.setHours(QUIET_END);
  if (d.getHours() >= QUIET_START) o.setDate(o.getDate() + 1);
  return Math.max(0, Math.round((o - d) / 60000));
}

export default function InfluenceFloodGlobe() {
  const [config, setConfig] = useState(QUICK_CONFIG);
  const [screen, setScreen] = useState("home");        // home | custom (only while not in a game)
  const [showTutorial, setShowTutorial] = useState(false);
  const [rivalIdx, setRivalIdx] = useState(0);
  const [view, setView] = useState("globe");
  const [started, setStarted] = useState(false);
  const [state, dispatch] = useReducer(reducer, null, () => createGame(4, 3, "far", "many"));
  const [rot, setRot] = useState(IDENT);
  const [paintColour, setPaintColour] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [undoSnap, setUndoSnap] = useState(null);
  const [history, setHistory] = useState([]);
  const [replayIndex, setReplayIndex] = useState(null);
  const [resignConfirm, setResignConfirm] = useState(false);
  const histMeta = useRef({ id: null, moves: -1 });
  const [quiet, setQuiet] = useState(() => inQuietHours());
  const [sessionLog, setSessionLog] = useState([]);
  const [gamesThisSession, setGamesThisSession] = useState(0);
  const [sessionGoal, setSessionGoal] = useState(null);   // null until you commit
  const [stats, setStats] = useState({});
  const [showStats, setShowStats] = useState(false);
  const logRef = useRef({ meta: null, actions: [] });
  const loggedRef = useRef(null);
  const logAction = useCallback((tok) => {
    if (logRef.current && logRef.current.meta) logRef.current.actions.push(tok);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setQuiet(inQuietHours()), 30000);
    return () => clearInterval(id);
  }, []);

  const inReplay = replayIndex !== null;
  const humanPlayers = useMemo(
    () => new Set(state.players.slice(0, config.humans)),
    [state.players, config.humans]
  );
  const isHumanTurn = !state.finished && !inReplay && humanPlayers.has(state.turn);
  // Who "self" means: the player to move if they're human, else the first human.
  const myPlayer = humanPlayers.has(state.turn) ? state.turn : state.players[0];
  const openingTurn = state.moveCount === 0;
  const paintPhase = isHumanTurn && state.phase === "paint";
  const movePhase = isHumanTurn && state.phase === "move";

  useEffect(() => { setPaintColour(null); }, [state.turn, state.phase, state.gameId]);
  // Keep the undo snapshot for the whole turn — clearing it on phase change
  // destroyed it the instant a paint was made, so Undo never appeared.
  useEffect(() => { setUndoSnap(null); }, [state.turn, state.gameId]);

  /* AI turns */
  useEffect(() => {
    if (!started || state.finished || inReplay || humanPlayers.has(state.turn)) return;
    setThinking(true);
    const id = setTimeout(() => {
      const plan = chooseTurn(state, state.turn, state.phase === "move" && state.moveCount === 0,
                              config.difficulty === "strategist");
      logAction(`A${plan.paint ? `${plan.paint.cell}.${plan.paint.colour}` : ""}-${plan.flood}`);
      dispatch({ type: "AI_TURN", plan });
      setThinking(false);
    }, 450);
    return () => { clearTimeout(id); setThinking(false); };
  }, [started, state, humanPlayers, inReplay, config.difficulty]);

  /* nothing to paint -> skip straight to the flood step */
  const paintable = useMemo(
    () => (paintPhase ? allPaintable(state, state.turn) : new Set()),
    [paintPhase, state]
  );
  useEffect(() => {
    if (paintPhase && paintable.size === 0) { logAction("S"); dispatch({ type: "SKIP_PAINT" }); }
  }, [paintPhase, paintable]);

  const legal = useMemo(() => legalFloods(state), [state]);
  // What each colour would capture if flooded from the CURRENT board. Shown in
  // both steps, so the paint choice can be made against the same information.
  const gains = useMemo(() => {
    if (!isHumanTurn || state.finished) return {};
    const before = state.counts[state.turn];
    const out = {};
    for (const c of legal) out[c] = countCells(applyFlood(state, state.turn, c))[state.turn] - before;
    return out;
  }, [isHumanTurn, state, legal]);

  /**
   * Rotate so `cellIdx` faces the viewer.
   * Composes with the current orientation rather than replacing it, so the
   * globe turns to the target from wherever it happens to be pointing.
   */
  /** Bring a cell to face the viewer, keeping the current roll where possible. */
  const spinTo = useCallback((cellIdx) => {
    if (cellIdx == null) return;
    setRot((cur) => {
      const facing = applyMat(cur, state.cells[cellIdx].centre);
      return matMul(rotateAtoB(norm(facing), [0, 0, 1]), cur);
    });
  }, [state.cells]);

  // One snapshot per completed turn, so the game can be stepped through later.
  useEffect(() => {
    const m = histMeta.current;
    if (state.gameId !== m.id) {
      histMeta.current = { id: state.gameId, moves: state.moveCount };
      setHistory([state]);
      setReplayIndex(null);
    } else if (state.moveCount > m.moves) {
      histMeta.current = { id: m.id, moves: state.moveCount };
      setHistory((h) => [...h, state]);
    }
  }, [state]);

  // Capture the opening position; actions alone then reproduce the whole game.
  useEffect(() => {
    logRef.current = {
      meta: {
        freq: state.freq, players: state.players.length, spread: state.spread, gaps: state.gaps,
        difficulty: config.difficulty,
        humans: config.humans, first: state.firstPlayer,
        // Close starts pick homes at random, so they must be recorded — the
        // board cannot be regenerated from the seed alone.
        homes: state.players.map((pl) => state.homes[pl]).join("."),
        // Gaps are scattered at random too, so the cells themselves must be
        // recorded — the setting alone cannot reproduce the board.
        voids: [...state.voids].join("."),
        colours: state.colours.join(""),
      },
      actions: [],
    };
    loggedRef.current = null;
  }, [state.gameId]);

  // Record the finished game once, and fold it into the running stats.
  useEffect(() => {
    if (!state.finished || !started || !logRef.current.meta) return;
    if (loggedRef.current === state.gameId) return;
    loggedRef.current = state.gameId;
    setGamesThisSession((n) => n + 1);
    const m = logRef.current.meta;
    const line = ["G5", m.freq, m.players, m.spread, m.gaps, m.difficulty, m.humans, m.first, m.homes, m.voids, m.colours,
                  logRef.current.actions.join(","),
                  state.players.map((p) => state.counts[p]).join("-")].join("|");
    setSessionLog((l) => [...l, line]);

    const me = state.players[0];
    const mine = state.peak[me];
    const best = Math.max(...state.players.map((p) => state.peak[p]));
    const won = mine === best && state.players.filter((p) => state.peak[p] === best).length === 1;
    const tied = state.players.filter((p) => state.peak[p] === best).length > 1 && mine === best;
    const key = `${state.players.length}p-${state.gaps}-${config.difficulty === "strategist" ? "strat" : "std"}`;
    const seatKey = state.firstPlayer === me ? "youFirst" : "aiFirst";
    setStats((prev) => {
      const blank = { w: 0, l: 0, t: 0, n: 0, diff: 0 };
      const d = prev[key] || { ...blank, youFirst: { ...blank }, aiFirst: { ...blank } };
      const bump = (s) => ({
        w: s.w + (won ? 1 : 0), l: s.l + (!won && !tied ? 1 : 0), t: s.t + (tied ? 1 : 0),
        n: s.n + 1, diff: s.diff + (mine - Math.max(...state.players.filter((p) => p !== me).map((p) => state.peak[p]))),
      });
      return { ...prev, [key]: { ...bump(d), youFirst: seatKey === "youFirst" ? bump(d.youFirst) : d.youFirst,
                                 aiFirst: seatKey === "aiFirst" ? bump(d.aiFirst) : d.aiFirst } };
    });
  }, [state.finished, state.gameId, started]);

  // Open each game looking at your own territory rather than a random face.
  useEffect(() => {
    if (started && state.homes[myPlayer] != null) spinTo(state.homes[myPlayer]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.gameId, started]);

  const onCellClick = (i) => {
    if (!paintPhase || paintColour === null) return;
    setUndoSnap({ game: state, logLen: logRef.current.actions.length });
    logAction(`P${i}.${paintColour}`);
    dispatch({ type: "PAINT", cell: i, colour: paintColour });
  };

  // Winner is decided by each player's PEAK tile count, not their count at the
  // final whistle. Without this, whoever holds a cell or two back until the
  // unanswerable last move can snipe a lead built by someone who spent the
  // whole game ahead and only got raided down at the very end.
  const winner = useMemo(() => {
    if (!state.finished) return null;
    const eligible = state.players.filter((p) => p !== state.resignedBy);
    let best = null, bv = -Infinity, tie = false;
    for (const p of eligible) {
      const v = state.peak[p];
      if (v > bv) { bv = v; best = p; tie = false; }
      else if (v === bv) tie = true;
    }
    return tie ? "tie" : best;
  }, [state]);

  const newGame = () => {
    if (sessionGoal !== null && gamesThisSession >= sessionGoal) { setStarted(false); return; }
    dispatch({ type: "NEW_GAME", freq: config.freq, numPlayers: config.numPlayers, spread: config.spread, gaps: config.gaps });
  };
  const quickPlay = () => {
    setConfig(QUICK_CONFIG);
    dispatch({ type: "NEW_GAME", freq: QUICK_CONFIG.freq, numPlayers: QUICK_CONFIG.numPlayers, spread: QUICK_CONFIG.spread, gaps: QUICK_CONFIG.gaps });
    setStarted(true);
  };
  const label = useCallback((p) => {
    if (humanPlayers.has(p)) return config.humans > 1 ? `Player ${p.slice(1)}` : "You";
    const idx = state.players.slice(0, state.players.indexOf(p)).filter((q) => !humanPlayers.has(q)).length;
    const names = config.difficulty === "strategist" ? AI_NAMES_STRATEGIST : AI_NAMES;
    return names[idx] || `AI ${idx + 1}`;
  }, [humanPlayers, config.humans, config.difficulty, state.players]);

  if (quiet) {
    const mins = minutesUntilOpen();
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6"
           style={{ backgroundColor: "#020617", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <div className="w-full max-w-sm text-center text-slate-300">
          <div className="text-4xl mb-4">🌙</div>
          <h1 className="text-xl font-bold text-slate-100">Closed for the night</h1>
          <p className="text-sm mt-3">Opens again in{" "}
            <span className="font-semibold text-slate-200 tabular-nums">
              {Math.floor(mins / 60)}h {mins % 60}m
            </span>.
          </p>
        </div>
      </div>
    );
  }

  if (sessionGoal === null) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6"
           style={{ backgroundColor: "#020617", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <div className="w-full max-w-sm text-center text-slate-300">
          <h1 className="text-xl font-bold text-slate-100">How many games today?</h1>
          <p className="text-sm mt-2 text-slate-400">Pick before you start. It locks for this sitting.</p>
          <div className="flex flex-col gap-2.5 mt-6">
            {Array.from({ length: SESSION_GAME_MAX }, (_, i) => i + 1).map((n) => (
              <button key={n} onClick={() => setSessionGoal(n)}
                className="w-full rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 py-3.5 text-base font-medium text-slate-100 transition-colors">
                {GOAL_LABELS[n] || `${n} games`}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!started && gamesThisSession >= sessionGoal) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6"
           style={{ backgroundColor: "#020617", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <div className="w-full max-w-sm text-center text-slate-300">
          <div className="text-4xl mb-4">🌤️</div>
          <h1 className="text-xl font-bold text-slate-100">
            {sessionGoal === 1 ? "Just 1 — done" : `${sessionGoal} games — done`}
          </h1>
          <p className="text-sm mt-3 leading-relaxed">
            You said {sessionGoal}, and you stuck to it.
          </p>
          <button onClick={() => setShowStats(true)}
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium bg-slate-800 hover:bg-slate-700 rounded-lg px-4 py-2">
            <BarChart3 size={15} /> View stats
          </button>
          <p className="text-xs mt-6 text-slate-600 leading-relaxed">
            No override on starting a new game — that's the point. Closing and reopening starts a fresh sitting, and a fresh pick.
          </p>
        </div>
        {showStats && <Stats stats={stats} log={sessionLog} onClose={() => setShowStats(false)}
                             onReset={() => setStats({})} />}
      </div>
    );
  }

  if (!started && screen === "home") {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6 text-slate-100"
           style={{ backgroundColor: "#020617", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <div className="w-full max-w-sm flex flex-col items-center text-center gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Influence Flood: Globe</h1>
            <p className="text-sm text-slate-400 mt-2">Paint a cell, flood a colour, swallow the world. Peak score wins.</p>
          </div>
          <div className="flex flex-col gap-2 w-full">
            <button onClick={quickPlay}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500 text-slate-950 font-semibold py-3 hover:bg-amber-400 transition-colors">
              <Zap size={18} /> Quick play
            </button>
            <button onClick={() => setScreen("custom")}
              className="w-full rounded-xl bg-slate-800 text-slate-100 font-medium py-3 hover:bg-slate-700 transition-colors">
              Custom game
            </button>
            <button onClick={() => setShowTutorial(true)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-800 text-slate-100 font-medium py-3 hover:bg-slate-700 transition-colors">
              <Brain size={18} /> Tutorial
            </button>
            <button onClick={() => setShowHelp(true)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-800 text-slate-100 font-medium py-3 hover:bg-slate-700 transition-colors">
              <HelpCircle size={18} /> How to play
            </button>
            <button onClick={() => setShowStats(true)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-800 text-slate-100 font-medium py-3 hover:bg-slate-700 transition-colors">
              <BarChart3 size={18} /> Stats
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Quick play: Large · 3 players · you vs 2 Strategists · Far apart · Many gaps
          </p>
        </div>
        {showHelp && <Help onClose={() => setShowHelp(false)} threePlayers />}
        {showStats && <Stats stats={stats} log={sessionLog} onClose={() => setShowStats(false)}
                             onReset={() => setStats({})} />}
        {showTutorial && <Tutorial onExit={() => setShowTutorial(false)} />}
      </div>
    );
  }

  if (!started) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6 text-slate-100"
           style={{ backgroundColor: "#020617", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <div className="w-full max-w-sm flex flex-col gap-6">
          <button onClick={() => setScreen("home")}
            className="self-start flex items-center gap-1 text-sm text-slate-400 hover:text-white -mb-3">
            <ChevronLeft size={16} /> Back
          </button>
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">Custom game</h1>
            <p className="text-sm text-slate-400 mt-2">
              No edges, no corners. Every territory can be outflanked from any direction.
            </p>
          </div>

          <Row label="Players">
            <Choice value={String(config.numPlayers)} options={[["2", "2"], ["3", "3"]]}
              onChange={(v) => setConfig((c) => ({ ...c, numPlayers: +v, humans: Math.min(c.humans, +v) }))} />
          </Row>
          <Row label="Humans">
            <Choice value={String(config.humans)}
              options={[...Array(config.numPlayers).keys()].map((i) => [String(i + 1), i === 0 ? "1 (vs AI)" : `${i + 1}`])}
              onChange={(v) => setConfig((c) => ({ ...c, humans: +v }))} />
            {config.humans > 1 && (
              <p className="text-[11px] text-slate-500 -mt-1">Hotseat — pass the device between turns.</p>
            )}
          </Row>
          <Row label="Starting positions">
            <Choice value={config.spread}
              options={[["close", "Close"], ["far", "Far apart"]]}
              onChange={(v) => setConfig((c) => ({ ...c, spread: v }))} />
            <p className="text-[11px] text-slate-500 -mt-1">
              {config.spread === "close"
                ? "Homes a few cells apart — territories collide from the first turns."
                : "Homes as far apart as the world allows — a longer build-up before contact."}
            </p>
          </Row>

          <Row label="Opponent">
            <Choice value={config.difficulty}
              options={[["standard", "Standard"], ["strategist", "Strategist"]]}
              onChange={(v) => setConfig((cc) => ({ ...cc, difficulty: v }))} />
            <p className="text-[11px] text-slate-500 -mt-1">
              {config.difficulty === "standard"
                ? "Plans one round ahead, counting cells."
                : "Also weighs which open ground it is nearest to and what it has walled off. Thinks a little longer."}
            </p>
          </Row>

          <Row label="Gaps">
            <Choice value={config.gaps}
              options={[["none", "None"], ["few", "Scattered"], ["many", "Many"]]}
              onChange={(v) => setConfig((cc) => ({ ...cc, gaps: v }))} />
            <p className="text-[11px] text-slate-500 -mt-1">
              {config.gaps === "none"
                ? "An unbroken world — wide open, with a long border to hold."
                : "Dead cells scattered across the world act as ready-made walls and chokepoints."}
            </p>
          </Row>

          <Row label="World size">
            <Choice value={String(config.freq)}
              options={Object.entries(SIZES).map(([k, v]) => [k, `${v} · ${10 * k * k + 2}`])}
              onChange={(v) => setConfig((c) => ({ ...c, freq: +v }))} />
          </Row>

          <div className="flex flex-col gap-2">
            <button onClick={() => { dispatch({ type: "NEW_GAME", freq: config.freq, numPlayers: config.numPlayers, spread: config.spread, gaps: config.gaps }); setStarted(true); }}
              className="w-full rounded-xl bg-amber-500 text-slate-950 font-semibold py-3 hover:bg-amber-400 transition-colors">
              Play
            </button>
            <button onClick={() => setShowHelp(true)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-800 py-3 hover:bg-slate-700 transition-colors">
              <HelpCircle size={18} /> How to play
            </button>
          </div>
        </div>
        {showHelp && <Help onClose={() => setShowHelp(false)} threePlayers={config.numPlayers === 3} />}
      </div>
    );
  }

  const boardState = inReplay && history[replayIndex] ? history[replayIndex] : state;
  const total = state.cells.length - state.voids.size;

  return (
    <div className="min-h-screen w-full flex justify-center bg-slate-950 text-slate-100 p-4"
         style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="w-full max-w-md flex flex-col gap-3">

        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-lg font-bold leading-tight">Influence Flood: Globe</h1>
            <p className="text-xs text-slate-500">{view === "globe" ? "Drag to spin the world" : "Flat map — poles are stretched"}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowStats(true)} title="Stats"
              className="bg-slate-800 hover:bg-slate-700 rounded-lg p-2"><BarChart3 size={16} /></button>
            <button onClick={() => setShowHelp(true)} title="How to play"
              className="bg-slate-800 hover:bg-slate-700 rounded-lg p-2"><HelpCircle size={16} /></button>
            <button onClick={newGame} title="New game"
              className="bg-slate-800 hover:bg-slate-700 rounded-lg p-2"><RefreshCw size={16} /></button>
          </div>
        </header>

        {/* scoreboard */}
        <div>
          {/* flex-wrap + shrink-0 so three names, scores, and peak badges never
              get squeezed into overlapping text on a narrow phone — they now
              drop to a second line instead. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mb-1.5">
            {state.players.map((p) => (
              <span key={p} className="flex items-center gap-1.5 shrink-0">
                <span className="inline-block w-3.5 h-3.5 rounded-sm shrink-0"
                      style={{ backgroundColor: PALETTE[boardState.current[p]],
                               border: `2px ${p === "P1" ? "solid" : p === "P2" ? "dashed" : "dotted"} #f1f5f9` }} />
                <span className={boardState.turn === p && !boardState.finished ? "text-slate-100 font-semibold" : "text-slate-400"}>
                  {label(p)} <span className="tabular-nums">{boardState.counts[p]}</span>
                  {boardState.peak[p] > boardState.counts[p] && (
                    <span className="text-[9px] text-amber-400/80 tabular-nums align-top ml-0.5" title="peak reached">
                      ▲{boardState.peak[p]}
                    </span>
                  )}
                </span>
              </span>
            ))}
            <span className="text-slate-500 ml-auto shrink-0">{boardState.counts.neutral} free</span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full ring-1 ring-slate-800 bg-slate-800">
            {state.players.map((p) => (
              <div key={p} style={{ width: `${(boardState.counts[p] / total) * 100}%`,
                                    backgroundColor: PALETTE[boardState.current[p]], transition: "width 250ms ease" }} />
            ))}
          </div>
        </div>

        <div className="relative rounded-2xl bg-slate-900 ring-1 ring-slate-800 p-2">
          {view === "globe" ? (
            <Globe state={boardState} selectable={paintPhase && paintColour !== null ? paintable : new Set()}
                   selectColour="#fbbf24" onCellClick={onCellClick}
                   rot={rot} onRotate={setRot} />
          ) : (
            <FlatMap state={boardState} selectable={paintPhase && paintColour !== null ? paintable : new Set()}
                     selectColour="#fbbf24" onCellClick={onCellClick} />
          )}

          <button onClick={() => setView((v) => (v === "globe" ? "flat" : "globe"))}
            className="absolute top-3 left-3 flex items-center gap-1.5 text-xs bg-slate-800/90 hover:bg-slate-700 rounded-lg px-2.5 py-1.5">
            {view === "globe" ? <><MapIcon size={14} /> Flat map</> : <><GlobeIcon size={14} /> Globe</>}
          </button>

          <div className="absolute bottom-3 right-3 flex gap-1.5" style={{ display: view === "globe" ? undefined : "none" }}>
            <button onClick={() => spinTo(state.homes[myPlayer])}
              className="flex items-center gap-1.5 text-xs bg-slate-800/90 hover:bg-slate-700 rounded-lg px-2.5 py-1.5">
              <Compass size={14} /> Find self
            </button>
            <button onClick={() => {
                const rivals = state.players.filter((p) => p !== myPlayer);
                if (!rivals.length) return;
                const i = rivalIdx % rivals.length;
                spinTo(state.homes[rivals[i]]);
                setRivalIdx(i + 1);
              }}
              className="flex items-center gap-1.5 text-xs bg-slate-800/90 hover:bg-slate-700 rounded-lg px-2.5 py-1.5">
              <Compass size={14} /> Find {config.humans > 1 ? "rival" : "AI"}
            </button>
          </div>
          {winner && !inReplay && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl"
                 style={{ backgroundColor: "rgba(2,6,23,0.86)" }}>
              <div className="text-xl font-bold">
                {winner === "tie" ? "Dead heat" : `${label(winner)} ${label(winner) === "You" ? "win" : "wins"}`}
              </div>
              {state.resignedBy && (
                <div className="text-xs text-rose-300">{label(state.resignedBy)} gave up</div>
              )}
              <div className="text-sm text-slate-300 tabular-nums">
                {state.players.map((p) => `${label(p)} ${state.peak[p]}`).join(" · ")}
              </div>
              <p className="text-[11px] text-slate-500 -mt-1">Ranked by peak score</p>
              <div className="mt-1 flex items-center gap-2">
                <button onClick={newGame}
                  className="flex items-center gap-1.5 text-sm font-semibold bg-slate-100 text-slate-900 rounded-lg px-4 py-2">
                  <RefreshCw size={15} /> Play again
                </button>
                {history.length > 1 && (
                  <button onClick={() => setReplayIndex(0)}
                    className="flex items-center gap-1.5 text-sm font-semibold bg-slate-800 text-slate-100 rounded-lg px-4 py-2">
                    Replay
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {inReplay ? (
          <ReplayBar index={replayIndex} total={history.length} finished={state.finished}
            onSeek={(i) => setReplayIndex(Math.max(0, Math.min(history.length - 1, i)))}
            onExit={() => setReplayIndex(null)} />
        ) : (<>
        {/* turn indicator */}
        <div className="flex items-center justify-center gap-3 text-sm h-6">
          {thinking ? (
            <span className="flex items-center gap-1.5 text-slate-300">
              <Brain size={15} className="animate-pulse" /> {label(state.turn)} thinking…
            </span>
          ) : state.finished ? (
            <span className="text-slate-400">Game over</span>
          ) : (
            <>
              <span className="font-semibold">{label(state.turn)}</span>
              <span className="text-slate-500">
                {openingTurn ? "opening flood" : state.phase === "paint" ? "1 · paint" : "2 · flood"}
              </span>
            </>
          )}
        </div>

        {openingTurn && !state.finished && (
          <p className="text-center text-xs rounded-lg px-3 py-2"
             style={{ backgroundColor: "#0b1220", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.35)" }}>
            Opening turn is flood-only — going first is an advantage, so the starting player skips one paint.
            The starting player is random.
          </p>
        )}

        {/* controls */}
        {paintPhase && (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center justify-center gap-3 w-full rounded-xl bg-slate-900 ring-1 ring-amber-500/40 px-2 py-3">
              <span className="flex items-center gap-1 text-xs text-amber-300"><Paintbrush size={14} /> Paint:</span>
              <div className="flex gap-2.5">
                {PALETTE.slice(0, state.numColours).map((hex, c) => {
                  const held = !legal.includes(c);
                  return (
                    <button key={c} onClick={() => setPaintColour(c)}
                      title={held ? "You can paint this, but nobody can flood it right now"
                                  : `Flooding this now would capture ${gains[c] ?? 0}`}
                      className="relative w-7 h-7 rounded-lg transition-transform hover:scale-110"
                      style={{ backgroundColor: hex, opacity: held ? 0.55 : 1,
                               outline: paintColour === c ? "2px solid #fff" : "1px solid rgba(255,255,255,0.15)" }}>
                      {held && (
                        <span className="absolute inset-0 flex items-center justify-center text-slate-900 text-sm font-black">×</span>
                      )}
                      {!held && gains[c] > 0 && (
                        <span className="absolute flex items-center justify-center font-bold text-slate-100"
                              style={{ top: -6, right: -6, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 9,
                                       fontSize: 11, lineHeight: 1, backgroundColor: "#020617", boxShadow: "0 0 0 1px #0f172a" }}>
                          +{gains[c]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <span className="text-xs text-slate-400 text-center">
              {paintColour === null
                ? "Numbers show what flooding each colour would capture now — pick a colour, then tap a cell that isn't yours"
                : "Now tap any cell that isn't yours, a home, or already locked"}
            </span>
          </div>
        )}

        {movePhase && (
          <div className="flex flex-col items-center gap-2">
            <div className="grid grid-cols-7 gap-2 w-full">
              {PALETTE.slice(0, state.numColours).map((hex, c) => {
                const ok = legal.includes(c);
                return (
                  <button key={c} onClick={() => { if (!ok) return; logAction(`F${c}`); dispatch({ type: "FLOOD", colour: c }); }} disabled={!ok}
                    className="relative aspect-square rounded-xl disabled:cursor-not-allowed enabled:hover:scale-105 transition-transform"
                    style={{ backgroundColor: hex, opacity: ok ? 1 : 0.3,
                             outline: "1px solid rgba(255,255,255,0.12)" }}>
                    {ok && gains[c] > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-slate-950 text-xs font-bold flex items-center justify-center ring-2 ring-slate-900">
                        +{gains[c]}
                      </span>
                    )}
                    {!ok && (
                      <span className="absolute inset-0 flex items-center justify-center text-slate-900 text-lg font-black">×</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">Colours in play are locked out (×)</span>
              {undoSnap && (
                <button onClick={() => {
                    logRef.current.actions.length = undoSnap.logLen;
                    dispatch({ type: "RESTORE", game: undoSnap.game });
                    setUndoSnap(null);
                  }}
                  className="flex items-center gap-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 px-2.5 py-1">
                  <Undo2 size={13} /> Undo paint
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
                <button onClick={() => { logAction("R1"); dispatch({ type: "RESIGN", player: state.players[0] }); setResignConfirm(false); }}
                  className="rounded-lg bg-rose-600 hover:bg-rose-500 px-3 py-1 text-xs font-medium">Yes</button>
                <button onClick={() => setResignConfirm(false)}
                  className="rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1 text-xs">Cancel</button>
              </div>
            ) : (
              <>
                {history.length > 1 && (
                  <button onClick={() => setReplayIndex(Math.max(0, history.length - 2))}
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
        </>)}

        <div className="flex items-center justify-center gap-2 text-sm border-t border-slate-800 pt-3">
          <button onClick={() => { setStarted(false); setScreen("home"); }}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-2">
            <Home size={15} /> Menu
          </button>
        </div>
      </div>
      {showHelp && <Help onClose={() => setShowHelp(false)} threePlayers={state.players.length === 3} />}
      {showStats && <Stats stats={stats} log={sessionLog} onClose={() => setShowStats(false)}
                           onReset={() => setStats({})} />}
    </div>
  );
}

function Stats({ stats, log, onClose, onReset }) {
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(false);
  const [split, setSplit] = useState(false);
  const text = log.join("\n");
  const CHUNK = 1200;
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));
  const [part, setPart] = useState(null);
  const rows = Object.entries(stats).sort(([a], [b]) => a.localeCompare(b));
  const pct = (s) => (s.n ? `${Math.round((s.w / s.n) * 100)}%` : "—");
  const avg = (s) => (s.n ? (s.diff / s.n >= 0 ? "+" : "") + (s.diff / s.n).toFixed(1) : "—");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ backgroundColor: "rgba(2,6,23,0.8)", backdropFilter: "blur(3px)" }}>
      <div className="w-full max-w-md rounded-2xl bg-slate-900 ring-1 ring-slate-700 p-5 overflow-y-auto"
           style={{ maxHeight: "85vh" }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-slate-100">Your record</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">No finished games yet this session.</p>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="grid grid-cols-4 gap-2 text-xs text-slate-500 px-3">
              <span>Setup</span><span className="text-center">W–L–T</span>
              <span className="text-center">Win %</span><span className="text-right">Avg diff</span>
            </div>
            {rows.map(([k, s]) => (
              <div key={k}>
                <div className="grid grid-cols-4 gap-2 items-center bg-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100">
                  <span className="font-medium">{k}</span>
                  <span className="text-center tabular-nums">{s.w}–{s.l}–{s.t}</span>
                  <span className="text-center tabular-nums">{pct(s)}</span>
                  <span className="text-right tabular-nums">{avg(s)}</span>
                </div>
                {split && [["youFirst", "you started"], ["aiFirst", "AI started"]].map(([sk, lbl]) => {
                  const x = s[sk] || { w: 0, l: 0, t: 0, n: 0, diff: 0 };
                  return (
                    <div key={sk} className="grid grid-cols-4 gap-2 items-center px-3 py-1 text-xs text-slate-400">
                      <span className="pl-2">↳ {lbl}</span>
                      <span className="text-center tabular-nums">{x.n ? `${x.w}–${x.l}–${x.t}` : "—"}</span>
                      <span className="text-center tabular-nums">{pct(x)}</span>
                      <span className="text-right tabular-nums">{avg(x)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            <button onClick={() => setSplit((v) => !v)} className="w-full text-xs text-slate-400 hover:text-white py-1">
              {split ? "Hide" : "Show"} split by who started
            </button>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-400">
              Match log: <span className="font-semibold text-slate-200">{log.length}</span> game{log.length === 1 ? "" : "s"}
              {log.length ? <span className="text-slate-500"> · {(text.length / 1024).toFixed(1)} KB</span> : null}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setShow((v) => !v)} disabled={!log.length}
                className="text-xs rounded-lg bg-slate-800 hover:bg-slate-700 px-2 py-1.5 disabled:opacity-40">
                {show ? "Hide" : "Show"}
              </button>
              <button
                onClick={async () => {
                  try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
                  catch (e) { setShow(true); }
                }}
                disabled={!log.length}
                className="text-xs font-semibold rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 px-3 py-1.5 disabled:opacity-40">
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
          {chunks.length > 1 && (
            <div className="mt-2">
              <p className="text-[11px] text-slate-500 mb-1">Or copy in {chunks.length} parts:</p>
              <div className="flex flex-wrap gap-1.5">
                {chunks.map((_, i) => (
                  <button key={i}
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(`[part ${i + 1}/${chunks.length}]\n` + chunks[i]); setPart(i); setTimeout(() => setPart(null), 1500); }
                      catch (e) { setShow(true); }
                    }}
                    className="text-[11px] rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">
                    {part === i ? "✓" : `${i + 1}/${chunks.length}`}
                  </button>
                ))}
              </div>
            </div>
          )}
          {show && (
            <textarea readOnly value={text} onFocus={(e) => e.target.select()}
              className="mt-2 w-full h-28 text-[10px] font-mono rounded-lg bg-slate-950 ring-1 ring-slate-800 p-2 text-slate-300" />
          )}
          <p className="text-[11px] text-slate-600 mt-3">
            Kept in memory only — export before reloading. Stats reset with the page.
          </p>
          <button onClick={onReset} className="text-xs text-slate-500 hover:text-rose-300 mt-2">Reset stats</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- small UI pieces ---------- */

function ReplayBar({ index, total, finished, onSeek, onExit }) {
  const last = Math.max(0, total - 1);
  const btn = "rounded-lg bg-slate-800 enabled:hover:bg-slate-700 px-3 py-2 text-sm disabled:opacity-35 disabled:cursor-not-allowed";
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-slate-900 ring-1 ring-slate-800 p-3">
      <span className="text-[11px] uppercase tracking-wide text-slate-400">Reviewing — stepping through each move</span>
      <div className="flex items-center gap-1.5">
        <button onClick={() => onSeek(0)} disabled={index === 0} className={btn}>⏮</button>
        <button onClick={() => onSeek(index - 1)} disabled={index === 0} className={btn}>◀</button>
        <span className="text-sm tabular-nums text-center px-2" style={{ minWidth: "6.5rem" }}>
          {index === 0 ? "Start" : `Move ${index} of ${last}`}
        </span>
        <button onClick={() => onSeek(index + 1)} disabled={index >= last} className={btn}>▶</button>
        <button onClick={() => onSeek(last)} disabled={index >= last} className={btn}>⏭</button>
      </div>
      <button onClick={onExit}
        className="text-sm font-medium rounded-lg bg-slate-800 hover:bg-slate-700 px-4 py-2">
        {finished ? "Back" : "Back to game"}
      </button>
    </div>
  );
}


/* ============================================================ *
 *  GUIDED TUTORIAL  (ported from the flat game)
 *
 *  The tutorial runs on small flat hex boards with its own tiny engine, kept
 *  entirely separate from the globe engine above. Every name here starts with
 *  Tut / tut so nothing collides with the globe code. The one deliberate
 *  difference from the flat original: the Bomb step is gone (no bombs here).
 * ============================================================ */

const TUT_NUM_COLORS = 6;
const TUT_AXIAL = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const TUT_EDGE_BY_DIRECTION = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
const TUT_OUTLINE = { P1: { dash: null }, P2: { dash: 0.45 } };
const tutKey = (q, r) => `${q},${r}`;
const tutOpp = (p) => (p === "P1" ? "P2" : "P1");
const tutPick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function tutCells(radius) {
  const cells = [];
  for (let q = -radius; q <= radius; q++) {
    const rLow = Math.max(-radius, -q - radius);
    const rHigh = Math.min(radius, -q + radius);
    for (let r = rLow; r <= rHigh; r++) cells.push({ q, r });
  }
  return cells;
}

function tutGeometry(radius) {
  const cells = tutCells(radius);
  const cellSet = new Set(cells.map(({ q, r }) => tutKey(q, r)));
  const neighbors = new Map();
  for (const { q, r } of cells) {
    const list = [];
    for (const [dq, dr] of TUT_AXIAL) {
      const nk = tutKey(q + dq, r + dr);
      if (cellSet.has(nk)) list.push(nk);
    }
    neighbors.set(tutKey(q, r), list);
  }
  const size = 480 / (Math.sqrt(3) * (2 * radius + 1));
  const layout = new Map();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { q, r } of cells) {
    const x = size * Math.sqrt(3) * (q + r / 2), y = size * 1.5 * r;
    const corners = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      corners.push({ x: x + size * Math.cos(a), y: y + size * Math.sin(a) });
    }
    layout.set(tutKey(q, r), { cx: x, cy: y, corners, points: corners.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ") });
    minX = Math.min(minX, x - size); maxX = Math.max(maxX, x + size);
    minY = Math.min(minY, y - size); maxY = Math.max(maxY, y + size);
  }
  const pad = size * 0.5;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
  return { cells, cellSet, neighbors, size, layout, viewBox };
}

function tutCount(game) {
  let P1 = 0, P2 = 0, neutral = 0;
  for (const [, owner] of game.owners) {
    if (owner === "P1") P1++;
    else if (owner === "P2") P2++;
    else neutral++;
  }
  return { P1, P2, neutral };
}

function tutLegal(game, player) {
  const forbidden = new Set([game.current[player], game.current[tutOpp(player)]]);
  const moves = [];
  for (let c = 0; c < game.numColors; c++) if (!forbidden.has(c)) moves.push(c);
  return moves;
}

function tutIsPaintTarget(game, player, key) {
  if (game.locked.has(key)) return false;
  if (key === game.homes.P1 || key === game.homes.P2) return false;
  const o = game.owners.get(key);
  return o === null || o === tutOpp(player);
}

function tutApplyPaint(game, key, color) {
  const colors = new Map(game.colors);
  colors.set(key, color);
  const locked = new Set(game.locked);
  locked.add(key);
  let owners = game.owners;
  if (game.owners.get(key) !== null) { owners = new Map(game.owners); owners.set(key, null); }
  return { ...game, colors, locked, owners };
}

function tutApplyFlood(game, player, color) {
  const colors = new Map(game.colors);
  const owners = new Map(game.owners);
  const queue = [];
  for (const [k, o] of owners) if (o === player) { colors.set(k, color); queue.push(k); }
  while (queue.length > 0) {
    const cur = queue.pop();
    for (const nb of game.neighbors.get(cur)) {
      if (owners.get(nb) === null && colors.get(nb) === color) { owners.set(nb, player); queue.push(nb); }
    }
  }
  return { ...game, colors, owners, current: { ...game.current, [player]: color } };
}

// A clear, distinct 4-colour subset for teaching (red / green / blue / purple).
const TUT_COLORS = [0, 3, 4, 5];

function tutMakeBoard({ radius = 2, p1 = tutKey(0, 0), p2 = null, p2extra = [] } = {}) {
  const geo = tutGeometry(radius);
  const colors = new Map();
  for (const { q, r } of geo.cells) colors.set(tutKey(q, r), tutPick(TUT_COLORS));
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

  const board = { ...geo, colors, owners, current, homes, locked: new Set(), numColors: TUT_NUM_COLORS };
  board.counts = tutCount(board);
  return board;
}

// Rival board: homes two apart on a radius-3 map, close enough to interact
// quickly but with a neutral gap so the solid/dashed outlines stay distinct.
const tutRivalBoard = () => tutMakeBoard({
  radius: 3, p1: tutKey(-1, 0), p2: tutKey(1, 0), p2extra: [tutKey(1, -1)],
});

// A deliberately feeble rival: each turn it floods the legal colour that
// captures the FEWEST tiles while still taking at least one.
function tutRivalMove(board) {
  if (!board.homes.P2) return board;
  const legal = tutLegal(board, "P2");
  if (legal.length === 0) return board;
  const before = tutCount(board).P2;
  let pick = legal[0], smallestGain = Infinity;
  for (const c of legal) {
    const gain = tutCount(tutApplyFlood(board, "P2", c)).P2 - before;
    if (gain > 0 && gain < smallestGain) { smallestGain = gain; pick = c; }
  }
  const nb = tutApplyFlood(board, "P2", pick);
  nb.counts = tutCount(nb);
  return nb;
}

const TUTORIAL_STEPS = [
  {
    title: "Flood",
    mode: "flood",
    build: () => tutMakeBoard({ radius: 2 }),
    instruction: "Tap a colour to flood: your hex flips to it and swallows every touching hex of that colour. You can't pick your own current colour (it's marked ✕). Keep going — try to take the whole board.",
    goal: (b) => b.counts.P1 >= 6,
    success: "That's flooding. Keep grabbing colours to finish the board, or move on.",
  },
  {
    title: "Paint",
    mode: "turn",
    build: () => tutMakeBoard({ radius: 2 }),
    instruction: "A full turn is two steps. First PAINT — pick a colour, then tap a highlighted hex to recolour it. Painting locks that hex (🔒): once locked, it can't be painted again by you or the rival, so it becomes a permanent wall. Then FLOOD that colour to absorb it. Painting lets you bridge into clusters you couldn't otherwise reach — try to conquer everything.",
    goal: (b) => b.counts.P1 >= 6,
    success: "Paint-then-flood lets you take any hex eventually. Finish up or continue.",
  },
  {
    title: "Rival",
    mode: "turn",
    opponent: true,
    build: tutRivalBoard,
    instruction: "The dashed territory is the rival (yours is solid). You can't flood your own colour OR the rival's — both show ✕, so route around them. You can also paint a rival hex to knock it loose, then flood to steal it.",
    goal: (b) => b.counts.P1 >= 12,
    success: "Out-grow the rival by routing around their colour and stealing their edge. That's everything — go play a real game!",
  },
];

function TutBoard({ state, selectable, selectColor, onTileClick }) {
  const [hovered, setHovered] = useState(null);
  const size = state.size;

  // Clear any lingering hover when the board context changes — otherwise a
  // touch tap (which never fires mouse-leave) leaves a stale highlight that can
  // reappear on the next game.
  useEffect(() => { setHovered(null); }, [selectable]);

  const boundaries = useMemo(() => {
    const segs = [];
    for (const { q, r } of state.cells) {
      const k = tutKey(q, r);
      const owner = state.owners.get(k);
      if (!owner) continue;
      const corners = state.layout.get(k).corners;
      for (let d = 0; d < 6; d++) {
        const [dq, dr] = TUT_AXIAL[d];
        const nk = tutKey(q + dq, r + dr);
        const nOwner = state.cellSet.has(nk) ? state.owners.get(nk) : "EDGE";
        if (nOwner !== owner) {
          const [a, b] = TUT_EDGE_BY_DIRECTION[d];
          segs.push({ a: corners[a], b: corners[b], owner });
        }
      }
    }
    return segs;
  }, [state]);

  const dashFor = (owner) =>
    TUT_OUTLINE[owner].dash ? `${size * TUT_OUTLINE[owner].dash} ${size * 0.3}` : undefined;

  return (
    <svg viewBox={state.viewBox} style={{ width: "100%", height: "auto", maxHeight: 460, display: "block" }}>
      {/* Tile fills */}
      {state.cells.map(({ q, r }) => {
        const k = tutKey(q, r);
        const { points, cx, cy } = state.layout.get(k);
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
        const k = tutKey(q, r);
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

      {/* Hover preview of the tile about to be selected */}
      {hovered && selectable.has(hovered) && (
        <polygon points={state.layout.get(hovered).points} fill={selectColor} fillOpacity={0.25}
                 stroke={selectColor} strokeWidth={size * 0.22} pointerEvents="none" />
      )}


      {/* Markers: start tiles (dot) and locked tiles (padlock) */}
      <g pointerEvents="none">
        {state.cells.map(({ q, r }) => {
          const k = tutKey(q, r);
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

function Tutorial({ onExit }) {
  const [step, setStep] = useState(0);
  const cfg = TUTORIAL_STEPS[step];
  const [board, setBoard] = useState(() => TUTORIAL_STEPS[0].build());
  const [phase, setPhase] = useState(TUTORIAL_STEPS[0].mode === "turn" ? "paint" : "move");
  const [paintColor, setPaintColor] = useState(null);
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
    setRivalThinking(false);
    setDone(false);
  }, [step]);

  useEffect(() => () => clearTimeout(rivalTimer.current), []);

  // Mark the step complete once its goal is met — but never lock the controls,
  // so the player can keep going and conquer the whole board if they like.
  useEffect(() => {
    if (!done && cfg.goal(board)) setDone(true);
  }, [board, done, cfg]);

  const withCounts = (b) => { b.counts = tutCount(b); return b; };

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
      if (o === null) s.add(board.colors.get(k));
    }
    for (const c of forbidden) if (c >= 0) s.add(c);
    return [...s].sort((a, b) => a - b);
  }, [board, forbidden]);

  const doFlood = (c) => {
    if (forbidden.has(c) || rivalThinking) return;
    setBoard(withCounts(tutApplyFlood(board, "P1", c)));
    if (cfg.mode === "turn") setPhase("paint");
    setPaintColor(null);
    if (cfg.opponent) {
      // The learner finished a turn — let the (feeble) rival respond.
      setRivalThinking(true);
      rivalTimer.current = setTimeout(() => {
        setBoard((b) => tutRivalMove(b));
        setRivalThinking(false);
      }, 450);
    }
  };

  const onTileClick = (k) => {
    if (rivalThinking) return;
    if (cfg.mode === "turn" && phase === "paint" && paintColor != null && tutIsPaintTarget(board, "P1", k)) {
      setBoard(withCounts(tutApplyPaint(board, k, paintColor)));
      setPhase("move");
      setPaintColor(null);
    }
  };

  const selectable = useMemo(() => {
    const s = new Set();
    if (cfg.mode === "turn" && phase === "paint") {
      for (const k of board.cellSet) if (tutIsPaintTarget(board, "P1", k)) s.add(k);
    }
    return s;
  }, [board, cfg, phase]);

  const showFlood = cfg.mode === "flood" || (cfg.mode === "turn" && phase === "move");
  const showPaint = cfg.mode === "turn" && phase === "paint";
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
          <TutBoard state={board} selectable={selectable} selectColor="#fbbf24" onTileClick={onTileClick} />
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
                const gain = blocked ? 0 : tutCount(tutApplyFlood(board, "P1", c)).P1 - board.counts.P1;
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
              {paintColor == null ? "Step 1 — pick a paint colour, then tap a hex"
                : "Now tap a highlighted hex to paint it"}
            </span>
            <div className="flex items-center gap-2.5">
              {TUT_COLORS.map((c) => {
                const blocked = forbidden.has(c);
                return (
                  <button key={c} disabled={blocked}
                    onClick={() => { if (blocked) return; setPaintColor(c); }}
                    className="relative w-10 h-10 rounded-lg transition-transform"
                    style={{
                      backgroundColor: PALETTE[c],
                      outline: paintColor === c ? "2px solid #fff" : "1px solid rgba(255,255,255,0.18)",
                      opacity: blocked ? 0.4 : 1,
                      cursor: blocked ? "not-allowed" : "pointer",
                    }}>
                    {blocked && <span className="absolute inset-0 flex items-center justify-center text-base font-bold text-white" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.7)" }}>✕</span>}
                  </button>
                );
              })}
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

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      {children}
    </div>
  );
}

function Choice({ value, options, onChange }) {
  return (
    <div className="flex gap-2">
      {options.map(([val, text]) => (
        <button key={val} onClick={() => onChange(val)}
          className="flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors"
          style={{ backgroundColor: value === val ? "#f1f5f9" : "#1e293b",
                   color: value === val ? "#0f172a" : "#cbd5e1" }}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Help({ onClose, threePlayers }) {
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
          <p>Grow your territory across a whole world. Most cells when it fills wins.</p>
          <p><span className="font-semibold text-slate-100">Each turn:</span> paint one cell,
            then flood a colour. Painting recolours a neutral cell, or knocks a rival's cell loose to neutral —
            and locks it forever, making a permanent wall. Flooding turns your whole territory that colour and
            swallows every touching neutral cell of it.</p>
          <p><span className="font-semibold text-slate-100">The globe:</span> there are no edges to back onto.
            Every territory is surrounded, so a wall must be closed the whole way round to hold.
            A sphere can't be made of hexagons alone — 12 cells are pentagons, and those are natural
            chokepoints worth holding.</p>
          <p><span className="font-semibold text-slate-100">Colours:</span> you can't flood a colour anyone
            is currently holding{threePlayers ? " — with three players that rules out three of the seven" : ""}.
            Marked ×.</p>
          <p>Drag to spin the world. <span className="text-slate-100">Find home</span> re-centres on the
            player to move. Outlines mark ownership: solid, dashed, dotted.</p>
        </div>
        <button onClick={onClose}
          className="mt-5 w-full rounded-lg bg-slate-100 text-slate-900 font-semibold py-2 hover:bg-white">
          Got it
        </button>
      </div>
    </div>
  );
}
