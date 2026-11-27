// Sudoku puzzle generator + technique grader.
// Usage: node gen.js <outFile> <perLevel> [seed]   -> writes puzzles.js format
//        node gen.js verify [count] [seed]       -> checks grader steps against solutions
'use strict';
const fs = require('fs');

// ---------- RNG ----------
let seed = (Number(process.argv[4]) || Date.now()) >>> 0;
function rand() {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Geometry ----------
const ROW = [], COL = [], BOX = [];
for (let i = 0; i < 81; i++) {
  ROW[i] = (i / 9) | 0;
  COL[i] = i % 9;
  BOX[i] = ((ROW[i] / 3) | 0) * 3 + ((COL[i] / 3) | 0);
}
const UNITS = [];
for (let u = 0; u < 9; u++) UNITS.push([...Array(81).keys()].filter(i => ROW[i] === u));
for (let u = 0; u < 9; u++) UNITS.push([...Array(81).keys()].filter(i => COL[i] === u));
for (let u = 0; u < 9; u++) UNITS.push([...Array(81).keys()].filter(i => BOX[i] === u));
const PEERS = [];
const IS_PEER = [];
for (let i = 0; i < 81; i++) {
  IS_PEER[i] = new Uint8Array(81);
  const s = new Set();
  for (let j = 0; j < 81; j++) {
    if (j !== i && (ROW[i] === ROW[j] || COL[i] === COL[j] || BOX[i] === BOX[j])) {
      s.add(j);
      IS_PEER[i][j] = 1;
    }
  }
  PEERS[i] = [...s];
}
const POP = new Uint8Array(512);
for (let m = 1; m < 512; m++) POP[m] = POP[m >> 1] + (m & 1);
const BITS = [];
for (let m = 0; m < 512; m++) {
  BITS[m] = [];
  for (let d = 0; d < 9; d++) if (m & (1 << d)) BITS[m].push(d);
}
function combos(arr, n) {
  const out = [];
  const rec = (start, cur) => {
    if (cur.length === n) { out.push(cur.slice()); return; }
    for (let k = start; k < arr.length; k++) { cur.push(arr[k]); rec(k + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return out;
}

// ---------- Brute-force solver (count solutions / fill) ----------
function solveCount(grid, limit, randomize) {
  const g = Int8Array.from(grid);
  const rm = new Int16Array(9), cm = new Int16Array(9), bm = new Int16Array(9);
  for (let i = 0; i < 81; i++) {
    if (g[i]) {
      const b = 1 << (g[i] - 1);
      if ((rm[ROW[i]] | cm[COL[i]] | bm[BOX[i]]) & b) return { count: 0 };
      rm[ROW[i]] |= b; cm[COL[i]] |= b; bm[BOX[i]] |= b;
    }
  }
  let count = 0, first = null;
  function rec() {
    let best = -1, bestMask = 0, bestPop = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = ~(rm[ROW[i]] | cm[COL[i]] | bm[BOX[i]]) & 511;
      const p = POP[m];
      if (p < bestPop) { best = i; bestMask = m; bestPop = p; if (p <= 1) break; }
    }
    if (best < 0) { count++; if (!first) first = Int8Array.from(g); return count >= limit; }
    if (bestPop === 0) return false;
    const ds = randomize ? shuffle(BITS[bestMask].slice()) : BITS[bestMask];
    const r = ROW[best], c = COL[best], x = BOX[best];
    for (const d of ds) {
      const b = 1 << d;
      g[best] = d + 1; rm[r] |= b; cm[c] |= b; bm[x] |= b;
      if (rec()) return true;
      rm[r] &= ~b; cm[c] &= ~b; bm[x] &= ~b;
    }
    g[best] = 0;
    return false;
  }
  rec();
  return { count, first };
}

// ---------- Logical grader ----------
// Levels: 1 Easy, 2 Medium, 3 Hard, 4 Expert. Returns 0 if unsolvable by these techniques.
function grade(grid, sol) {
  const v = Int8Array.from(grid);
  const c = new Int16Array(81);
  for (let i = 0; i < 81; i++) {
    if (v[i]) continue;
    let m = 511;
    for (const p of PEERS[i]) if (v[p]) m &= ~(1 << (v[p] - 1));
    c[i] = m;
  }
  let changed = false;
  function place(i, d) {
    v[i] = d + 1; c[i] = 0;
    const b = ~(1 << d);
    for (const p of PEERS[i]) c[p] &= b;
    changed = true;
  }
  function elim(i, mask) {
    if (c[i] & mask) { c[i] &= ~mask; changed = true; }
  }
  function cellsWith(unit, d) {
    const b = 1 << d, out = [];
    for (const i of unit) if (c[i] & b) out.push(i);
    return out;
  }

  // L1
  function nakedSingle() {
    for (let i = 0; i < 81; i++) if (!v[i] && POP[c[i]] === 1) { place(i, BITS[c[i]][0]); return true; }
    return false;
  }
  function hiddenSingle() {
    for (const u of UNITS) for (let d = 0; d < 9; d++) {
      const cs = cellsWith(u, d);
      if (cs.length === 1) { place(cs[0], d); return true; }
    }
    return false;
  }
  // L2
  function pointingClaiming() {
    changed = false;
    for (let u = 0; u < 27; u++) for (let d = 0; d < 9; d++) {
      const cs = cellsWith(UNITS[u], d);
      if (cs.length < 2) continue;
      const b = 1 << d;
      if (u >= 18) { // box -> line
        if (cs.every(i => ROW[i] === ROW[cs[0]])) for (const i of UNITS[ROW[cs[0]]]) if (BOX[i] !== u - 18) elim(i, b);
        if (cs.every(i => COL[i] === COL[cs[0]])) for (const i of UNITS[9 + COL[cs[0]]]) if (BOX[i] !== u - 18) elim(i, b);
      } else { // line -> box
        if (cs.every(i => BOX[i] === BOX[cs[0]])) for (const i of UNITS[18 + BOX[cs[0]]]) if (!UNITS[u].includes(i)) elim(i, b);
      }
      if (changed) return true;
    }
    return false;
  }
  function nakedSubset(n) {
    changed = false;
    for (const u of UNITS) {
      const empt = u.filter(i => !v[i] && POP[c[i]] <= n);
      if (empt.length < n) continue;
      for (const cmb of combos(empt, n)) {
        let m = 0;
        for (const i of cmb) m |= c[i];
        if (POP[m] !== n) continue;
        for (const i of u) if (!v[i] && !cmb.includes(i)) elim(i, m);
        if (changed) return true;
      }
    }
    return false;
  }
  function hiddenSubset(n) {
    changed = false;
    for (const u of UNITS) {
      const pos = [];
      const ds = [];
      for (let d = 0; d < 9; d++) {
        const cs = cellsWith(u, d);
        pos[d] = cs;
        if (cs.length >= 2 && cs.length <= n) ds.push(d);
      }
      if (ds.length < n) continue;
      for (const cmb of combos(ds, n)) {
        const cells = new Set();
        for (const d of cmb) for (const i of pos[d]) cells.add(i);
        if (cells.size !== n) continue;
        let keep = 0;
        for (const d of cmb) keep |= 1 << d;
        for (const i of cells) elim(i, 511 & ~keep);
        if (changed) return true;
      }
    }
    return false;
  }
  function fish(n) {
    changed = false;
    for (let d = 0; d < 9; d++) {
      const b = 1 << d;
      for (const rowsBase of [true, false]) {
        const lines = [];
        for (let l = 0; l < 9; l++) {
          let m = 0;
          for (const i of UNITS[rowsBase ? l : 9 + l]) if (c[i] & b) m |= 1 << (rowsBase ? COL[i] : ROW[i]);
          if (POP[m] >= 2 && POP[m] <= n) lines.push([l, m]);
        }
        if (lines.length < n) continue;
        for (const cmb of combos(lines, n)) {
          let m = 0;
          for (const [, lm] of cmb) m |= lm;
          if (POP[m] !== n) continue;
          const baseSet = cmb.map(x => x[0]);
          for (const cross of BITS[m]) {
            for (const i of UNITS[rowsBase ? 9 + cross : cross]) {
              const line = rowsBase ? ROW[i] : COL[i];
              if (!baseSet.includes(line)) elim(i, b);
            }
          }
          if (changed) return true;
        }
      }
    }
    return false;
  }
  // L4
  function xyWing() {
    changed = false;
    for (let p = 0; p < 81; p++) {
      if (v[p] || POP[c[p]] !== 2) continue;
      const [x, y] = BITS[c[p]];
      const wings = PEERS[p].filter(i => !v[i] && POP[c[i]] === 2);
      for (const a of wings) {
        if (!(c[a] & (1 << x)) || (c[a] & (1 << y))) continue;
        const z = BITS[c[a] & ~(1 << x)][0];
        const need = (1 << y) | (1 << z);
        for (const w of wings) {
          if (w === a || c[w] !== need) continue;
          for (let i = 0; i < 81; i++) {
            if (i !== a && i !== w && i !== p && IS_PEER[a][i] && IS_PEER[w][i]) elim(i, 1 << z);
          }
          if (changed) return true;
        }
      }
    }
    return false;
  }
  function xyzWing() {
    changed = false;
    for (let p = 0; p < 81; p++) {
      if (v[p] || POP[c[p]] !== 3) continue;
      const wings = PEERS[p].filter(i => !v[i] && POP[c[i]] === 2 && (c[i] & c[p]) === c[i]);
      for (let k = 0; k < wings.length; k++) for (let l = k + 1; l < wings.length; l++) {
        const a = wings[k], w = wings[l];
        if ((c[a] | c[w]) !== c[p] || c[a] === c[w]) continue;
        const zm = c[a] & c[w];
        for (let i = 0; i < 81; i++) {
          if (i !== a && i !== w && i !== p && IS_PEER[a][i] && IS_PEER[w][i] && IS_PEER[p][i]) elim(i, zm);
        }
        if (changed) return true;
      }
    }
    return false;
  }
  function simpleColoring() {
    changed = false;
    for (let d = 0; d < 9; d++) {
      const b = 1 << d;
      const adj = new Map();
      for (const u of UNITS) {
        const cs = cellsWith(u, d);
        if (cs.length !== 2) continue;
        for (const [s, t] of [[cs[0], cs[1]], [cs[1], cs[0]]]) {
          if (!adj.has(s)) adj.set(s, []);
          adj.get(s).push(t);
        }
      }
      const color = new Map();
      for (const start of adj.keys()) {
        if (color.has(start)) continue;
        const comp = [[], []];
        const stack = [start];
        color.set(start, 0);
        while (stack.length) {
          const s = stack.pop();
          comp[color.get(s)].push(s);
          for (const t of adj.get(s)) if (!color.has(t)) { color.set(t, 1 - color.get(s)); stack.push(t); }
        }
        if (comp[0].length + comp[1].length < 4) continue;
        // Color wrap
        for (let k = 0; k < 2; k++) {
          const g = comp[k];
          let bad = false;
          for (let x = 0; x < g.length && !bad; x++) for (let y = x + 1; y < g.length; y++) if (IS_PEER[g[x]][g[y]]) { bad = true; break; }
          if (bad) { for (const i of g) elim(i, b); return true; }
        }
        // Color trap
        for (let i = 0; i < 81; i++) {
          if (!(c[i] & b) || color.has(i)) continue;
          if (comp[0].some(x => IS_PEER[x][i]) && comp[1].some(x => IS_PEER[x][i])) elim(i, b);
        }
        if (changed) return true;
      }
    }
    return false;
  }

  const techniques = [
    [1, nakedSingle], [1, hiddenSingle],
    [2, pointingClaiming], [2, () => nakedSubset(2)], [2, () => hiddenSubset(2)],
    [3, () => nakedSubset(3)], [3, () => hiddenSubset(3)], [3, () => fish(2)],
    [3, () => nakedSubset(4)], [3, () => hiddenSubset(4)],
    [4, () => fish(3)], [4, xyWing], [4, xyzWing], [4, simpleColoring],
  ];
  let level = 1;
  for (;;) {
    let filled = true;
    for (let i = 0; i < 81; i++) {
      if (!v[i]) { filled = false; if (!c[i]) return 0; }
    }
    if (filled) return level;
    let progressed = false;
    for (const [lv, fn] of techniques) {
      if (fn()) {
        if (lv > level) level = lv; progressed = true;
        if (sol) for (let i = 0; i < 81; i++) {
          if (v[i] ? v[i] !== sol[i] : !(c[i] & (1 << (sol[i] - 1)))) throw new Error('bad step ' + fn.toString().slice(0, 40));
        }
        break;
      }
    }
    if (!progressed) return 0;
  }
}

// ---------- Generation ----------
function fullGrid() {
  return solveCount(new Int8Array(81), 1, true).first;
}
function makePuzzle(minClues) {
  const g = fullGrid();
  let clues = 81;
  for (const i of shuffle([...Array(81).keys()])) {
    if (clues <= minClues) break;
    const keep = g[i];
    g[i] = 0;
    if (solveCount(g, 2, false).count !== 1) g[i] = keep;
    else clues--;
  }
  return { g, clues };
}

if (process.argv[2] === 'verify') {
  const n = Number(process.argv[3]) || 3000;
  const cnt = {};
  for (let k = 0; k < n; k++) {
    const { g } = makePuzzle(0);
    const sol = solveCount(g, 1, false).first;
    const lv = grade(g, sol);
    cnt[lv] = (cnt[lv] || 0) + 1;
  }
  console.log('verified', JSON.stringify(cnt));
  process.exit(0);
}
const out = process.argv[2];
const per = Number(process.argv[3]) || 200;
const buckets = { 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set() };
const tried = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
const t0 = Date.now();
let attempts = 0;

// Easy: 36-40 clues, singles only
while (buckets[1].size < per) {
  const { g } = makePuzzle(36 + Math.floor(rand() * 5));
  if (grade(g) === 1) buckets[1].add(g.join(''));
}
const tEasy = Date.now() - t0;
// Others: minimal puzzles
while (buckets[2].size < per || buckets[3].size < per || buckets[4].size < per) {
  attempts++;
  const { g } = makePuzzle(0);
  const lv = grade(g);
  tried[lv]++;
  if (lv >= 2 && buckets[lv].size < per) buckets[lv].add(g.join(''));
  if (attempts % 500 === 0) {
    process.stderr.write(`${attempts} attempts, ${(Date.now() - t0) / 1000}s, sizes ${buckets[2].size}/${buckets[3].size}/${buckets[4].size}\n`);
  }
}
const lists = { easy: [...buckets[1]], medium: [...buckets[2]], hard: [...buckets[3]], expert: [...buckets[4]] };
let js = '// ' + per + ' puzzles per difficulty, 81 chars each (row by row, 0 = empty).\n' +
  '// Graded by the hardest technique needed:\n' +
  '// easy: singles | medium: + pairs, pointing/claiming | hard: + triples, quads, X-Wing\n' +
  '// expert: + Swordfish, XY-Wing, XYZ-Wing, simple coloring\n' +
  'const PUZZLES = {\n';
for (const k of Object.keys(lists)) {
  js += '  ' + k + ': [\n' + lists[k].map(p => "    '" + p + "'").join(',\n') + '\n  ],\n';
}
js += '};\n';
fs.writeFileSync(out, js);
console.log(JSON.stringify({ attempts, tried, ms: Date.now() - t0, easyMs: tEasy }));