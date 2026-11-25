// No-guess solver: plays a board from a start cell using logic only.
// Kept separate from index.html so the game file stays readable.
//
// mineSolve(rows, cols, mine, start, opts)
//   mine:  array of booleans, true = mine
//   start: index of the first cell to open
//   opts:  { nodeLimit } optional, limits the enumeration work per step
// returns { solved, state }
//   state: Uint8Array, 0 = still covered, 1 = opened, 2 = known mine

const nbCache = {};

function mineNeighbors(rows, cols) {
  const key = rows + 'x' + cols;
  if (nbCache[key]) return nbCache[key];
  const n = rows * cols, nb = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols, out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(rr * cols + cc);
      }
    }
    nb[i] = out;
  }
  nbCache[key] = nb;
  return nb;
}

function mineSolve(rows, cols, mine, start, opts = {}) {
  const NODE_LIMIT = opts.nodeLimit || 100000;
  const n = rows * cols;
  const NB = mineNeighbors(rows, cols);
  const count = new Uint8Array(n);
  let totalMines = 0;
  for (let i = 0; i < n; i++) {
    if (mine[i]) totalMines++;
    for (const x of NB[i]) if (mine[x]) count[i]++;
  }
  const state = new Uint8Array(n);   // 0 covered, 1 open, 2 known mine
  const safeTotal = n - totalMines;
  let openCount = 0, flagCount = 0;
  let broken = false;   // true if a deduction was wrong (should never happen)

  function openCell(i) {
    if (state[i] !== 0) return;
    if (mine[i]) { broken = true; return; }
    const stack = [i];
    while (stack.length) {
      const c = stack.pop();
      if (state[c] !== 0) continue;
      state[c] = 1;
      openCount++;
      if (count[c] === 0) for (const x of NB[c]) if (state[x] === 0) stack.push(x);
    }
  }

  function flagCell(i) {
    if (state[i] !== 0) return;
    if (!mine[i]) { broken = true; return; }
    state[i] = 2;
    flagCount++;
  }

  // constraints: for every open number with covered neighbors, "these cells hold m mines"
  function buildConstraints() {
    const list = [];
    for (let i = 0; i < n; i++) {
      if (state[i] !== 1 || count[i] === 0) continue;
      const cells = [];
      let f = 0;
      for (const x of NB[i]) {
        if (state[x] === 0) cells.push(x);
        else if (state[x] === 2) f++;
      }
      if (cells.length) list.push({ cells, m: count[i] - f });
    }
    return list;
  }

  // level 1: a single number decides its neighbors
  function simple() {
    let changed = false;
    for (const con of buildConstraints()) {
      if (con.m === 0) { con.cells.forEach(openCell); changed = true; }
      else if (con.m === con.cells.length) { con.cells.forEach(flagCell); changed = true; }
    }
    return changed;
  }

  // level 2: one number's covered neighbors lie completely inside another's
  function subsets() {
    const cons = buildConstraints();
    const sets = cons.map(c => new Set(c.cells));
    const byCell = new Map();
    cons.forEach((c, k) => c.cells.forEach(x => {
      if (!byCell.has(x)) byCell.set(x, []);
      byCell.get(x).push(k);
    }));
    for (let a = 0; a < cons.length; a++) {
      const partners = new Set();
      cons[a].cells.forEach(x => byCell.get(x).forEach(b => { if (b !== a) partners.add(b); }));
      for (const b of partners) {
        if (cons[a].cells.length >= cons[b].cells.length) continue;
        if (!cons[a].cells.every(x => sets[b].has(x))) continue;
        const diff = cons[b].cells.filter(x => !sets[a].has(x));
        const dm = cons[b].m - cons[a].m;
        if (dm === 0) { diff.forEach(openCell); return true; }
        if (dm === diff.length) { diff.forEach(flagCell); return true; }
      }
    }
    return false;
  }

  // level 3: try every valid mine layout along the border, including the total mine count
  function enumerate() {
    const cons = buildConstraints();
    if (!cons.length && openCount + flagCount === n) return false;
    const remaining = totalMines - flagCount;

    // group constraints that share cells into independent components
    const parent = cons.map((_, k) => k);
    const find = k => (parent[k] === k ? k : (parent[k] = find(parent[k])));
    const owner = new Map();
    cons.forEach((c, k) => c.cells.forEach(x => {
      if (owner.has(x)) parent[find(k)] = find(owner.get(x));
      else owner.set(x, k);
    }));
    const groups = new Map();
    cons.forEach((c, k) => {
      const root = find(k);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(c);
    });

    let interior = 0;   // covered cells next to no open number
    for (let i = 0; i < n; i++) if (state[i] === 0 && !owner.has(i)) interior++;

    const comps = [];
    for (const list of groups.values()) {
      const cells = [...new Set(list.flatMap(c => c.cells))];
      const idx = new Map(cells.map((x, j) => [x, j]));
      const lc = list.map(c => ({ cells: c.cells.map(x => idx.get(x)), m: c.m, as: 0, un: c.cells.length }));
      const cellCons = cells.map(() => []);
      lc.forEach((c, k) => c.cells.forEach(j => cellCons[j].push(k)));
      const L = cells.length;
      const kSet = new Set();
      const mineAt = cells.map(() => new Set());
      const safeAt = cells.map(() => new Set());
      const a = new Uint8Array(L);
      let nodes = 0, aborted = false;

      const rec = (j, k) => {
        if (++nodes > NODE_LIMIT) { aborted = true; return; }
        if (k > remaining) return;
        if (j === L) {
          kSet.add(k);
          for (let t = 0; t < L; t++) (a[t] ? mineAt[t] : safeAt[t]).add(k);
          return;
        }
        for (let v = 0; v <= 1; v++) {
          let ok = true;
          for (const ci of cellCons[j]) {
            const c = lc[ci];
            c.un--;
            c.as += v;
            if (c.as > c.m || c.as + c.un < c.m) ok = false;
          }
          if (ok) { a[j] = v; rec(j + 1, k + v); }
          for (const ci of cellCons[j]) { lc[ci].un++; lc[ci].as -= v; }
          if (aborted) return;
        }
      };
      rec(0, 0);
      if (aborted || !kSet.size) return false;   // too big to check, treat as stuck
      comps.push({ cells, kSet, mineAt, safeAt });
    }

    // which mine totals the components can reach together
    const sums = except => {
      let acc = new Uint8Array(remaining + 1);
      acc[0] = 1;
      comps.forEach((c, ci) => {
        if (ci === except) return;
        const next = new Uint8Array(remaining + 1);
        for (let s = 0; s <= remaining; s++) {
          if (!acc[s]) continue;
          for (const k of c.kSet) if (s + k <= remaining) next[s + k] = 1;
        }
        acc = next;
      });
      return acc;
    };
    // can a component using k mines be completed by the others plus the interior?
    const completes = (others, k) => {
      const rest = remaining - k;
      for (let s = 0; s <= rest; s++) if (others[s] && rest - s <= interior) return true;
      return false;
    };

    let changed = false;
    comps.forEach((c, ci) => {
      const others = sums(ci);
      c.cells.forEach((x, j) => {
        const canMine = [...c.mineAt[j]].some(k => completes(others, k));
        const canSafe = [...c.safeAt[j]].some(k => completes(others, k));
        if (!canMine && canSafe) { openCell(x); changed = true; }
        else if (canMine && !canSafe) { flagCell(x); changed = true; }
      });
    });

    if (interior > 0) {
      const all = sums(-1);
      let canMine = false, canSafe = false;
      for (let s = 0; s <= remaining; s++) {
        if (!all[s]) continue;
        const t = remaining - s;   // mines left for the interior
        if (t >= 1 && t <= interior) canMine = true;
        if (t <= interior - 1) canSafe = true;
      }
      if (!canMine || !canSafe) {
        for (let i = 0; i < n; i++) {
          if (state[i] === 0 && !owner.has(i)) { if (!canMine) openCell(i); else flagCell(i); }
        }
        changed = true;
      }
    }
    return changed;
  }

  openCell(start);
  while (openCount < safeTotal && !broken) {
    if (simple()) continue;
    if (subsets()) continue;
    if (enumerate()) continue;
    break;
  }
  return { solved: !broken && openCount === safeTotal, state };
}

// No-guess generator: random start cell (always a 0) and random mines,
// tried again until the solver can finish the board without guessing.
// returns { mine, start, attempts } or null if the mines don't fit
function mineGenerate(rows, cols, mines) {
  const n = rows * cols;
  const NB = mineNeighbors(rows, cols);
  for (let attempts = 1; ; attempts++) {
    const start = Math.floor(Math.random() * n);
    const banned = new Set([start, ...NB[start]]);   // start and its neighbors never get a mine
    const pool = [];
    for (let i = 0; i < n; i++) if (!banned.has(i)) pool.push(i);
    if (pool.length < mines) return null;
    const mine = new Array(n).fill(false);
    for (let j = 0; j < mines; j++) {
      const r = j + Math.floor(Math.random() * (pool.length - j));
      [pool[j], pool[r]] = [pool[r], pool[j]];
      mine[pool[j]] = true;
    }
    if (mineSolve(rows, cols, mine, start).solved) return { mine, start, attempts };
  }
}