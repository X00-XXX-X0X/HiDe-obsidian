import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide, type Simulation } from "d3-force";

export type StateDef = { id: string; name: string; color: string };

export type NodeData = { id: string; title: string; body: string; requires: string[]; usedBy: string[]; state: string };
export type GraphData = { nodes: NodeData[]; states: StateDef[]; layout: Record<string, [number, number]>; version: number };
export type Settings = { center: number; repel: number; link: number; distance: number; lineWidth: number; flow: number };
export const DEFAULTS: Settings = { center: 0.04, repel: 500, link: 0.35, distance: 90, lineWidth: 1, flow: 0 };

export type N = {
  id: string; title: string; x: number; y: number; vx: number; vy: number; r: number;
  vis: number; visT: number; dim: number; fx: number | null; fy: number | null; state: string; color: string | null; deg: number;
};
export type Cam = { x: number; y: number; k: number };

export type View = { arrows: boolean; labelZoom: number; nodeScale: number };
export const DEFAULT_VIEW = (): View => ({ arrows: true, labelZoom: 0.55, nodeScale: 1 });
type Mode = "free" | "focus" | "back";

export const MIN_REPEL = 20;
const COLLIDE_PAD = 4;
const NEIGH: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1]];
const GAP_X = 90;
const GAP_Y = 120;

export function focusLayout(rootId: string, requires: Map<string, string[]>, titles: Map<string, string>,
                            rootX: number, rootY: number): Map<string, [number, number]> {
  const kids = (id: string) => [...(requires.get(id) ?? [])].sort((a, b) => (titles.get(a) ?? "").localeCompare(titles.get(b) ?? ""));
  const set = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) for (const c of kids(queue.shift()!)) if (!set.has(c)) { set.add(c); queue.push(c); }

  const indeg = new Map<string, number>();
  for (const id of set) indeg.set(id, 0);
  for (const id of set) for (const c of kids(id)) indeg.set(c, indeg.get(c)! + 1);
  const level = new Map<string, number>([[rootId, 0]]);
  const ready = [rootId];
  while (ready.length) {
    const id = ready.shift()!;
    for (const c of kids(id)) {
      level.set(c, Math.max(level.get(c) ?? 0, level.get(id)! + 1));
      indeg.set(c, indeg.get(c)! - 1);
      if (indeg.get(c) === 0) ready.push(c);
    }
  }
  const ord = new Map<string, number>();
  const dfs = (id: string) => { if (ord.has(id)) return; ord.set(id, ord.size); kids(id).forEach(dfs); };
  dfs(rootId);

  const rows: string[][] = [];
  for (const id of set) (rows[level.get(id)!] ??= []).push(id);
  for (const row of rows) row.sort((p, q) => ord.get(p)! - ord.get(q)!);

  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    (down.get(from) ?? down.set(from, []).get(from)!).push(to);
    (up.get(to) ?? up.set(to, []).get(to)!).push(from);
  };
  for (const id of set) {
    for (const c of kids(id)) {
      let prev = id;
      for (let l = level.get(id)! + 1; l < level.get(c)!; l++) {
        const dummy = `\u0000${id}>${c}@${l}`;
        rows[l].push(dummy);
        link(prev, dummy);
        prev = dummy;
      }
      link(prev, c);
    }
  }

  const index = new Map<string, number>();
  const reindex = () => rows.forEach((row) => row.forEach((id, i) => index.set(id, i)));
  const crossings = () => {
    let total = 0;
    for (let l = 0; l + 1 < rows.length; l++) {
      const pairs: [number, number][] = [];
      for (const id of rows[l]) for (const c of down.get(id) ?? []) pairs.push([index.get(id)!, index.get(c)!]);
      for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
        if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) total++;
      }
    }
    return total;
  };
  const sweep = (l: number, neighbours: Map<string, string[]>) => {
    const row = rows[l];
    const key = new Map<string, number>();
    row.forEach((id, i) => {
      const n = neighbours.get(id);
      key.set(id, n && n.length ? n.reduce((sum, x) => sum + index.get(x)!, 0) / n.length : i);
    });
    row.sort((p, q) => key.get(p)! - key.get(q)! || index.get(p)! - index.get(q)!);
    row.forEach((id, i) => index.set(id, i));
  };

  const between = (u: string, v: string) => {
    let n = 0;
    for (const map of [up, down]) for (const a of map.get(u) ?? []) for (const b of map.get(v) ?? []) if (index.get(a)! > index.get(b)!) n++;
    return n;
  };
  const transpose = () => {
    let changed = true;
    for (let guard = 0; changed && guard < 12; guard++) {
      changed = false;
      for (const row of rows) for (let i = 0; i + 1 < row.length; i++) {
        const u = row[i], v = row[i + 1];
        const before = between(u, v);
        index.set(u, i + 1); index.set(v, i);
        const after = between(v, u);
        if (after < before) { row[i] = v; row[i + 1] = u; changed = true; } else { index.set(u, i); index.set(v, i + 1); }
      }
    }
  };

  reindex();
  let best = rows.map((r) => [...r]);
  let bestCross = crossings();
  for (let pass = 0; pass < 24 && bestCross > 0; pass++) {
    if (pass % 2 === 0) for (let l = 1; l < rows.length; l++) sweep(l, up);
    else for (let l = rows.length - 2; l >= 0; l--) sweep(l, down);
    transpose();
    const c = crossings();
    if (c < bestCross) { bestCross = c; best = rows.map((r) => [...r]); }
  }
  best.forEach((row, l) => { rows[l] = row; });
  reindex();

  const real = rows.map((row) => row.filter((id) => set.has(id)));
  const xs = new Map<string, number>();
  real.forEach((row) => row.forEach((id, i) => xs.set(id, (i - (row.length - 1) / 2) * GAP_X)));
  const near = (id: string, map: Map<string, string[]>) => {
    const out: string[] = [];
    for (const n of map.get(id) ?? []) {
      let cur = n;
      while (!set.has(cur)) cur = map.get(cur)![0];
      out.push(cur);
    }
    return out;
  };
  const settle = (l: number, map: Map<string, string[]>) => {
    const row = real[l];
    if (!row.length) return;
    const want = row.map((id, i) => {
      const n = near(id, map);
      return n.length ? n.reduce((sum, x) => sum + xs.get(x)!, 0) / n.length : xs.get(id)!;
    });
    const placed: number[] = [];
    row.forEach((_, i) => placed.push(i === 0 ? want[0] : Math.max(want[i], placed[i - 1] + GAP_X)));
    const shift = placed.reduce((sum, p, i) => sum + (want[i] - p), 0) / row.length;
    row.forEach((id, i) => xs.set(id, placed[i] + shift));
  };
  for (let pass = 0; pass < 6; pass++) {
    for (let l = 1; l < real.length; l++) settle(l, up);
    for (let l = real.length - 2; l >= 0; l--) settle(l, down);
  }
  const edgeList: [string, string][] = [];
  for (const id of set) for (const c of kids(id)) edgeList.push([id, c]);
  const linked = new Set(edgeList.map(([a, b]) => `${a}|${b}`));
  const SAFE = GAP_X * 0.5;
  const clutter = () => {
    let total = 0;
    for (const a of set) for (const b of set) {
      if (level.get(b)! !== level.get(a)! + 1) continue;
      if (linked.has(`${a}|${b}`) || linked.has(`${b}|${a}`)) continue;
      if (Math.abs(xs.get(a)! - xs.get(b)!) < SAFE) total++;
    }
    for (const [u, c] of edgeList) {
      const lu = level.get(u)!, lc = level.get(c)!;
      for (const n of set) {
        const ln = level.get(n)!;
        if (ln <= lu || ln >= lc || n === u || n === c) continue;
        const t = (ln - lu) / (lc - lu);
        if (Math.abs(xs.get(n)! - (xs.get(u)! + (xs.get(c)! - xs.get(u)!) * t)) < SAFE) total++;
      }
    }
    return total;
  };
  const tangled = () => {
    let total = 0;
    for (let i = 0; i < edgeList.length; i++) for (let j = i + 1; j < edgeList.length; j++) {
      const [a, b] = edgeList[i], [c, d] = edgeList[j];
      if (a === c || a === d || b === c || b === d) continue;
      const ax = xs.get(a)!, ay = level.get(a)!, bx = xs.get(b)!, by = level.get(b)!;
      const cx = xs.get(c)!, cy = level.get(c)!, dx = xs.get(d)!, dy = level.get(d)!;
      const o1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), o2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      const o3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), o4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
      if (o1 * o2 < 0 && o3 * o4 < 0) total++;
    }
    return total;
  };
  const score = () => clutter() + 3 * tangled();
  let cur = score();
  for (let pass = 0; pass < 8 && cur > 0 && set.size <= 120; pass++) {
    let improved = false;
    for (const row of real) for (let i = 0; i < row.length; i++) for (const d of [SAFE, -SAFE]) {
      const side = d > 0 ? row.slice(i) : row.slice(0, i + 1);
      side.forEach((id) => xs.set(id, xs.get(id)! + d));
      const after = score();
      if (after < cur) { cur = after; improved = true; } else side.forEach((id) => xs.set(id, xs.get(id)! - d));
    }
    if (!improved) break;
  }
  const offset = xs.get(rootId)!;
  const out = new Map<string, [number, number]>();
  for (const id of set) out.set(id, [rootX + xs.get(id)! - offset, rootY + level.get(id)! * GAP_Y]);
  return out;
}

export class Engine {
  nodes = new Map<string, N>();
  edges: [string, string][] = [];
  requires = new Map<string, string[]>();
  usedBy = new Map<string, string[]>();
  titles = new Map<string, string>();
  settings: Settings = { ...DEFAULTS };

  anim = 1;
  private stateColors = new Map<string, string>();
  ghosts = new Set<string>();

  plusFor: string | null = null;
  private idleFrames = 0;
  list: N[] = [];
  private all: N[] = [];
  view: View = DEFAULT_VIEW();

  focusOnClick = true;
  edgeRefs: [N, N][] = [];
  edgeDim: number[] = [];
  edgeHl: number[] = [];
  private maxR = 6;
  private redraw = true;
  private epoch = 0;

  wake(): void { this.redraw = true; }

  consumeRedraw(): boolean { if (this.epoch !== _epoch) { this.epoch = _epoch; this.redraw = true; } const r = this.redraw; this.redraw = false; return r; }
  cam: Cam = { x: 0, y: 0, k: 1 };
  camT: Cam | null = null;
  w = 800; h = 600;
  mode: Mode = "free";
  focusId: string | null = null;
  selected: string | null = null;
  hover: string | null = null;
  dragId: string | null = null;
  private snapshot = new Map<string, [number, number]>();
  private camBefore: Cam | null = null;
  private targets = new Map<string, [number, number]>();
  private alpha = 0;
  private topoKey = "";
  private dirtyLayout = false;
  private started = false;
  onSelect: (id: string | null) => void = () => {};
  onFocus: (focused: boolean) => void = () => {};
  onLayout: (pos: Record<string, [number, number]>) => void = () => {};

  setGraph(g: GraphData): void {
    const ids = new Set(g.nodes.map((n) => n.id));
    this.stateColors = new Map((g.states ?? []).map((x) => [x.id, x.color]));
    for (const id of [...this.nodes.keys()]) if (!ids.has(id)) { this.nodes.delete(id); this.snapshot.delete(id); }
    this.requires = new Map(g.nodes.map((n) => [n.id, n.requires]));
    this.usedBy = new Map(g.nodes.map((n) => [n.id, n.usedBy]));
    this.titles = new Map(g.nodes.map((n) => [n.id, n.title]));

    this.edges = g.nodes.flatMap((n) => n.requires.map((r) => [r, n.id] as [string, string]));
    const hadSaved = g.nodes.some((n) => g.layout[n.id]);
    for (const d of g.nodes) {
      let n = this.nodes.get(d.id);
      if (!n) {
        const saved = g.layout[d.id];
        let x: number, y: number;
        const par = d.usedBy.map((p) => this.nodes.get(p)).find(Boolean);
        if (saved) [x, y] = saved;
        else if (par) { x = par.x + (Math.random() - 0.5) * 60; y = par.y + 40 + Math.random() * 30; }
        else { const a = Math.random() * 6.28, rr = 40 + Math.random() * 120; x = Math.cos(a) * rr; y = Math.sin(a) * rr; }
        n = { id: d.id, title: d.title, x, y, vx: 0, vy: 0, r: 6, vis: this.started ? 0 : 1, visT: 1, dim: 1, fx: null, fy: null, state: "", color: null, deg: 0 };
        this.nodes.set(d.id, n);
      }
      n.title = d.title;
      n.state = d.state ?? "";
      n.color = this.stateColors.get(d.state) ?? null;
      n.deg = d.requires.length + d.usedBy.length;
      n.r = (6 + 2.6 * Math.sqrt(n.deg)) * this.view.nodeScale;
    }
    this.all = [...this.nodes.values()];
    this.rebuildActive();
    if (this.selected && !ids.has(this.selected)) this.select(null);
    const key = this.edges.map((e) => e.join(">")).join("|") + "#" + [...ids].sort().join(",");
    const topoChanged = key !== this.topoKey;
    this.topoKey = key;
    if (this.mode !== "free") {
      if (!this.focusId || !ids.has(this.focusId)) this.exitFocus();
      else this.focus(this.focusId, true);
    } else if (topoChanged) {
      this.alpha = Math.max(this.alpha, this.started ? 0.5 : 1);
      this.dirtyLayout = true;
    }
    if (!this.started && g.nodes.length) {
      this.started = true;
      if (!hadSaved) { for (let i = 0; i < 220; i++) this.tick(); this.alpha = 0.05; this.dirtyLayout = true; }
      this.fitAll(true);
    }
  }

  private rebuildActive(): void {
    this.list = this.all;
    this.maxR = this.list.reduce((m, n) => Math.max(m, n.r), 6);
    this.edgeRefs = this.edges.flatMap(([pa, ch]) => { const p = this.nodes.get(pa), q = this.nodes.get(ch); return p && q ? [[p, q] as [N, N]] : []; });
    this.edgeDim = this.edgeRefs.map(() => 1);
    this.edgeHl = this.edgeRefs.map(() => 0);
    this.sim = null;
    this.redraw = true;
  }

  setView(v: View): void {
    const resized = v.nodeScale !== this.view.nodeScale;
    this.view = v;
    for (const n of this.all) n.r = (6 + 2.6 * Math.sqrt(n.deg)) * v.nodeScale;
    this.maxR = this.list.reduce((m, n) => Math.max(m, n.r), 6);
    this.redraw = true;
    if (resized && this.mode === "free") this.reheat(0.3);
  }

  setStates(states: StateDef[]): void {
    this.stateColors = new Map(states.map((x) => [x.id, x.color]));
    for (const n of this.nodes.values()) n.color = this.stateColors.get(n.state) ?? null;
    this.redraw = true;
  }

  private select(id: string | null): void { this.redraw = true; this.selected = id; this.onSelect(id); }

  private sim: Simulation<N, undefined> | null = null;
  private applyForces(): void {
    const sim = this.sim; if (!sim) return;
    const { center, link, distance } = this.settings;
    const repel = Math.max(this.settings.repel, MIN_REPEL);
    const deg = new Map<N, number>();
    for (const [p, q] of this.edgeRefs) { deg.set(p, (deg.get(p) ?? 0) + 1); deg.set(q, (deg.get(q) ?? 0) + 1); }
    const lk = sim.force("link") as ReturnType<typeof forceLink<N, { source: N; target: N }>>;
    lk.distance(distance).strength((l) => (link / 0.35) / Math.min(deg.get(l.source) ?? 1, deg.get(l.target) ?? 1));
    (sim.force("charge") as ReturnType<typeof forceManyBody<N>>).strength(-repel);
    (sim.force("x") as ReturnType<typeof forceX<N>>).strength(center);
    (sim.force("y") as ReturnType<typeof forceY<N>>).strength(center);
  }
  private buildSim(): void {
    this.sim?.stop();
    const links = this.edgeRefs.map(([p, q]) => ({ source: p, target: q }));
    const sim = forceSimulation<N>(this.list).stop().velocityDecay(0.4)
      .force("link", forceLink<N, { source: N; target: N }>(links).distance(this.settings.distance))
      .force("charge", forceManyBody<N>().distanceMin(30).distanceMax(1200))
      .force("x", forceX<N>(0)).force("y", forceY<N>(0))
      .force("collide", forceCollide<N>((n) => n.r + COLLIDE_PAD / 2).strength(0.8).iterations(2))
      .force("flow", (alpha: number) => {
        const flow = this.settings.flow; if (flow <= 0) return;
        for (const [p, q] of this.edgeRefs) {
          const gap = this.settings.distance * 0.8 - (p.y - q.y);
          if (gap > 0) { const g = Math.min(gap, 200) * flow * alpha * 0.5; p.vy += g; q.vy -= g; }
        }
      });
    this.sim = sim;
    this.applyForces();
  }

  private tick(): void {
    if (!this.sim) this.buildSim();
    const sim = this.sim!;
    sim.alpha(this.alpha).alphaTarget(this.dragId ? 0.3 : 0).tick();
    this.alpha = sim.alpha();

    let worst = 0;
    for (let k = 0; k < 4; k++) { const w = this.resolveCollisions(this.list); if (k === 0) worst = w; if (w < 0.05) break; }
    if (worst > 0.5) this.alpha = Math.max(this.alpha, 0.03);
  }

  private eachPair(arr: N[], cell: number, fn: (p: N, q: N) => void): void {
    const grid = new Map<number, N[]>();
    for (const n of arr) {
      const key = Math.floor(n.x / cell) * 131072 + Math.floor(n.y / cell);
      const c = grid.get(key);
      if (c) c.push(n); else grid.set(key, [n]);
    }
    for (const [key, c] of grid) {
      for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) fn(c[i], c[j]);
      const cx = Math.round(key / 131072), cy = key - cx * 131072;
      for (const [ox, oy] of NEIGH) {
        const o = grid.get((cx + ox) * 131072 + (cy + oy));
        if (o) for (const p of c) for (const q of o) fn(p, q);
      }
    }
  }

  private resolveCollisions(arr: N[]): number {
    let worst = 0;
    this.eachPair(arr, this.maxR * 2 + COLLIDE_PAD, (p, q) => {
      const min = p.r + q.r + COLLIDE_PAD;
      let dx = q.x - p.x, dy = q.y - p.y;
      if (Math.abs(dx) >= min || Math.abs(dy) >= min) return;
      let d = Math.hypot(dx, dy);
      if (d >= min) return;
      if (d < 0.01) { const a = Math.random() * 6.2832; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
      const over = min - Math.hypot(q.x - p.x, q.y - p.y);
      const ux = dx / d, uy = dy / d;
      const pf = p.fx !== null || p.fy !== null, qf = q.fx !== null || q.fy !== null;
      if (pf && qf) return;
      const wp = pf ? 0 : qf ? 1 : 0.5, wq = 1 - wp;
      p.x -= ux * over * wp; p.y -= uy * over * wp; q.x += ux * over * wq; q.y += uy * over * wq;
      worst = Math.max(worst, over);
    });
    return worst;
  }

  private hasOverlap(): boolean {
    let found = false;
    this.eachPair(this.list, this.maxR * 2 + COLLIDE_PAD, (p, q) => {
      if (!found && Math.hypot(q.x - p.x, q.y - p.y) < p.r + q.r + COLLIDE_PAD - 0.5) found = true;
    });
    return found;
  }

  reheat(a = 0.5): void { if (this.mode === "free") { this.alpha = Math.max(this.alpha, a); this.dirtyLayout = true; } }

  private rate(r: number, dt: number): number { return this.anim <= 0 ? 1 : 1 - Math.exp(-dt * r * this.anim); }

  frame(dt: number): void {
    dt = Math.min(dt, 0.1);
    if (this.mode === "free" && (this.alpha > 0.002 || this.dragId)) {
      this.redraw = true;
      for (let i = 0, n = Math.min(3, Math.max(1, Math.round(dt * 60))); i < n; i++) this.tick();
      if (this.alpha <= 0.002 && !this.dragId && this.dirtyLayout) { this.dirtyLayout = false; this.onLayout(this.positions()); }
    } else if (this.dirtyLayout && this.mode === "free" && !this.dragId) {
      this.dirtyLayout = false;
      this.onLayout(this.positions());
    }

    if (this.mode === "free" && this.alpha <= 0.002 && !this.dragId && ++this.idleFrames % 30 === 0 && this.hasOverlap()) this.reheat(0.1);
    const kp = this.rate(7, dt), kv = this.rate(10, dt);
    if (this.mode === "focus" || this.mode === "back") {
      let moving = false;
      const tg = this.mode === "focus" ? this.targets : this.snapshot;
      for (const [id, [tx, ty]] of tg) {
        const n = this.nodes.get(id);
        if (!n) continue;
        n.x += (tx - n.x) * kp; n.y += (ty - n.y) * kp;
        if (Math.abs(tx - n.x) + Math.abs(ty - n.y) > 0.3) moving = true;
      }
      if (moving) this.redraw = true;
      if (this.mode === "back" && !moving) {
        for (const [id, [tx, ty]] of this.snapshot) { const n = this.nodes.get(id); if (n) { n.x = tx; n.y = ty; n.vx = n.vy = 0; } }
        this.mode = "free";
        this.alpha = 0;
        this.snapshot.clear();
      }
    }
    this.fadeHover(dt);
    for (const n of this.list) {
      if (n.vis === n.visT) continue;
      n.vis += (n.visT - n.vis) * kv;
      if (Math.abs(n.visT - n.vis) < 0.004) n.vis = n.visT;
      this.redraw = true;
    }
    if (this.camT) {
      this.redraw = true;
      const kc = this.rate(5, dt);
      this.cam.x += (this.camT.x - this.cam.x) * kc;
      this.cam.y += (this.camT.y - this.cam.y) * kc;
      this.cam.k *= Math.pow(this.camT.k / this.cam.k, kc);
      if (Math.abs(this.camT.x - this.cam.x) + Math.abs(this.camT.y - this.cam.y) < 0.3 && Math.abs(this.camT.k / this.cam.k - 1) < 0.003) {
        this.cam = { ...this.camT };
        this.camT = null;
      }
    }
  }

  private fadeHover(dt: number): void {
    const hot = this.hover ?? this.selected;
    const dimming = !!hot && this.mode === "free";
    const rel = new Set<string>(hot ? [hot, ...(this.requires.get(hot) ?? []), ...(this.usedBy.get(hot) ?? [])] : []);
    const k = this.rate(4.5, dt);
    let moving = false;
    for (const n of this.list) {
      const want = dimming && !rel.has(n.id) ? 0.3 : 1;
      if (n.dim === want) continue;
      n.dim += (want - n.dim) * k;
      if (Math.abs(want - n.dim) < 0.004) n.dim = want;
      moving = true;
    }
    for (let i = 0; i < this.edgeRefs.length; i++) {
      const [p, q] = this.edgeRefs[i];
      const touches = !!hot && (p.id === hot || q.id === hot);
      const wantDim = dimming && !touches ? 0.3 : 1, wantHl = touches ? 1 : 0;
      if (this.edgeDim[i] !== wantDim) { this.edgeDim[i] += (wantDim - this.edgeDim[i]) * k; if (Math.abs(wantDim - this.edgeDim[i]) < 0.004) this.edgeDim[i] = wantDim; moving = true; }
      if (this.edgeHl[i] !== wantHl) { this.edgeHl[i] += (wantHl - this.edgeHl[i]) * k; if (Math.abs(wantHl - this.edgeHl[i]) < 0.004) this.edgeHl[i] = wantHl; moving = true; }
    }
    if (moving) this.redraw = true;
  }

  overview(): void {
    if (this.mode === "focus") this.exitFocus();
    if (this.mode === "free") this.fitAll();
    else this.fitTo([...this.snapshot.values()], 1.4);
  }

  animate(): void {
    if (this.mode !== "free") return;
    for (const n of this.list) { n.x = (Math.random() - 0.5) * 10; n.y = (Math.random() - 0.5) * 10; n.vx = n.vy = 0; }
    this.alpha = 1;
    this.dirtyLayout = true;
    this.redraw = true;
  }

  positions(): Record<string, [number, number]> {
    const o: Record<string, [number, number]> = {};
    for (const n of this.nodes.values()) o[n.id] = [Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10];
    return o;
  }

  focus(id: string, relayout = false): void {
    const root = this.nodes.get(id);
    if (!root) return;
    if (this.mode === "free") {
      this.snapshot = new Map([...this.nodes.values()].map((n) => [n.id, [n.x, n.y] as [number, number]]));
      this.camBefore = { ...this.cam };
      this.alpha = 0;
      for (const n of this.nodes.values()) { n.fx = n.fy = null; }
    }
    this.mode = "focus";
    this.focusId = id;
    this.onFocus(true);
    this.select(id);
    const prevTargets = this.targets;
    this.targets = focusLayout(id, this.requires, this.titles, root.x, root.y);

    this.ghosts = new Set();
    const pars = [...(this.usedBy.get(id) ?? [])].sort((a, b) => (this.titles.get(a) ?? "").localeCompare(this.titles.get(b) ?? ""));
    pars.forEach((pid, i) => {
      this.ghosts.add(pid);
      this.targets.set(pid, [root.x + (i - (pars.length - 1) / 2) * GAP_X, root.y - GAP_Y]);
    });
    for (const n of this.nodes.values()) {
      const inTree = this.targets.has(n.id);
      if (inTree && !relayout && n.vis < 0.05 && n.id !== id) { n.x = root.x; n.y = root.y; }
      if (inTree && relayout && !prevTargets.has(n.id) && n.vis < 0.05) { n.x = root.x; n.y = root.y; }
      n.visT = this.ghosts.has(n.id) ? 0.4 : inTree ? 1 : 0;
    }
    this.fitTo([...this.targets.values()], 2.2);
  }

  exitFocus(): void {
    if (this.mode !== "focus") return;
    this.mode = "back";
    this.focusId = null;
    this.ghosts = new Set();
    this.onFocus(false);
    for (const n of this.nodes.values()) n.visT = 1;
    for (const n of this.nodes.values()) if (!this.snapshot.has(n.id)) this.snapshot.set(n.id, [n.x, n.y]);
    if (this.camBefore) this.camT = { ...this.camBefore };
  }

  private fitTo(pts: [number, number][], maxK: number): void {
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const k = Math.max(0.15, Math.min(this.w / (x1 - x0 + 220), this.h / (y1 - y0 + 220), maxK));
    this.camT = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, k };
  }

  fitAll(immediate = false): void {
    this.redraw = true;
    this.fitTo([...this.nodes.values()].map((n) => [n.x, n.y] as [number, number]), 1.4);
    if (immediate && this.camT) { this.cam = { ...this.camT }; this.camT = null; }
  }

  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.cam.x) * this.cam.k + this.w / 2, (wy - this.cam.y) * this.cam.k + this.h / 2];
  }

  plusNodeId(): string | null {
    if (this.mode === "focus") return this.selected;
    if (this.mode === "free") return this.plusFor ?? this.selected;
    return null;
  }

  plusScreen(): [number, number] | null {
    const id = this.plusNodeId();
    const n = id ? this.nodes.get(id) : null;
    if (!n || n.vis < 0.5 || this.dragId) return null;
    const [sx, sy] = this.toScreen(n.x, n.y);
    return [sx, sy + n.r * this.cam.k + 46];
  }

  hoverAt(sx: number, sy: number): void {
    const h0 = this.hover, p0 = this.plusHover, f0 = this.plusFor;
    try { this.hoverAt0(sx, sy); } finally { if (h0 !== this.hover || p0 !== this.plusHover || f0 !== this.plusFor) this.redraw = true; }
  }
  private hoverAt0(sx: number, sy: number): void {
    this.plusHover = this.hitPlus(sx, sy);
    this.hover = this.plusHover ? null : this.hit(sx, sy);
    if (this.mode !== "free") return;
    if (this.hover) this.plusFor = this.hover;
    else if (!this.plusHover && !this.inPlusZone(sx, sy)) this.plusFor = null;
  }

  private inPlusZone(sx: number, sy: number): boolean {
    const n = this.plusFor ? this.nodes.get(this.plusFor) : null;
    if (!n) return false;
    const [nx, ny] = this.toScreen(n.x, n.y);
    return Math.abs(sx - nx) <= Math.max(n.r * this.cam.k, 16) + 8 && sy >= ny && sy <= ny + n.r * this.cam.k + 62;
  }

  selectNode(id: string | null): void { this.select(id); }
  hitPlus(sx: number, sy: number): boolean {
    const p = this.plusScreen();
    return !!p && Math.hypot(sx - p[0], sy - p[1]) <= 14;
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.w / 2) / this.cam.k + this.cam.x, (sy - this.h / 2) / this.cam.k + this.cam.y];
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.camT = null; this.redraw = true;
    const [wx, wy] = this.toWorld(sx, sy);
    const k = Math.min(4, Math.max(0.08, this.cam.k * factor));
    this.cam.k = k;
    this.cam.x = wx - (sx - this.w / 2) / k;
    this.cam.y = wy - (sy - this.h / 2) / k;
  }

  pan(dsx: number, dsy: number): void {
    this.camT = null; this.redraw = true;
    this.cam.x -= dsx / this.cam.k;
    this.cam.y -= dsy / this.cam.k;
  }

  hit(sx: number, sy: number): string | null {
    const [wx, wy] = this.toWorld(sx, sy);
    let best: string | null = null, bd = Infinity;
    for (const n of this.list) {
      if (n.vis < 0.3) continue;
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d <= n.r + 4 / this.cam.k && d < bd) { best = n.id; bd = d; }
    }
    return best;
  }

  startDrag(id: string): void { this.redraw = true; if (this.mode === "free") this.dragId = id; }
  dragTo(sx: number, sy: number): void {
    const n = this.dragId ? this.nodes.get(this.dragId) : null;
    if (!n) return;
    [n.fx, n.fy] = this.toWorld(sx, sy);
    this.redraw = true;
    this.dirtyLayout = true;
  }
  endDrag(): void {
    const n = this.dragId ? this.nodes.get(this.dragId) : null;
    if (n) { n.fx = n.fy = null; }
    this.dragId = null;
    this.redraw = true;
  }

  click(id: string | null): void {
    if (!this.focusOnClick) { this.select(id); return; }
    if (id) this.focus(id);
    else if (this.mode === "focus") this.exitFocus();
    else this.select(null);
  }

  setSettings(s: Settings): void {
    const o = this.settings;
    const changed = o.center !== s.center || o.repel !== s.repel || o.link !== s.link || o.distance !== s.distance || o.flow !== s.flow;
    this.redraw = true;
    this.settings = s;
    this.applyForces();
    if (changed) this.reheat(0.4);
  }

  plusHover = false;
}

let _epoch = 0;
let _root: Element | null = null;

export function setCssRoot(el: Element | null): void { _root = el; _vars.clear(); _epoch++; }
export function resetCssCache(): void { _vars.clear(); _epoch++; }

const _vars = new Map<string, string>();
export function cssVar(name: string): string {
  let v = _vars.get(name);
  if (!v) { v = getComputedStyle(_root ?? document.body).getPropertyValue(name).trim() || "#888"; _vars.set(name, v); }
  return v;
}
