import { tr } from "./i18n";
import type { GraphData, NodeData, StateDef } from "./sim";

export type Entry = { path: string; title: string; requires: string[]; state: string };

const HEX = /^#[0-9a-fA-F]{6}$/;

export function wikiTarget(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const m = /^\s*!?\[\[([^\]|#^]+?)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/.exec(s);
  return m ? m[1].trim() : null;
}

export function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

export function buildGraph(entries: Entry[], states: StateDef[], layout: Record<string, [number, number]>): GraphData {
  const ids = new Set(entries.map((e) => e.path));
  const known = new Set(states.map((s) => s.id));
  const usedBy = new Map<string, string[]>(entries.map((e) => [e.path, []]));
  const req = new Map<string, string[]>();
  for (const e of entries) {
    const r = [...new Set(e.requires)].filter((x) => ids.has(x) && x !== e.path);
    req.set(e.path, r);
    for (const c of r) usedBy.get(c)!.push(e.path);
  }
  const nodes: NodeData[] = [...entries].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
    .map((e) => ({ id: e.path, title: e.title, body: "", requires: req.get(e.path)!, usedBy: usedBy.get(e.path)!, state: known.has(e.state) ? e.state : "" }));
  return { nodes, states, layout, version: 0 };
}

export function reaches(entries: Map<string, string[]>, start: string, target: string): boolean {
  const seen = new Set<string>(), st = [start];
  while (st.length) {
    const x = st.pop()!;
    if (x === target) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    st.push(...(entries.get(x) ?? []));
  }
  return false;
}

export function neighborhood(nodes: NodeData[], root: string, depth: number): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>([root]);
  let frontier = [root];
  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const x of [...(byId.get(id)?.requires ?? []), ...(byId.get(id)?.usedBy ?? [])]) if (!seen.has(x)) { seen.add(x); next.push(x); }
    frontier = next;
  }
  return seen;
}

export function subgraph(nodes: NodeData[], ids: Set<string>): NodeData[] {
  return nodes.filter((n) => ids.has(n.id)).map((n) => ({ ...n, requires: n.requires.filter((x) => ids.has(x)), usedBy: n.usedBy.filter((x) => ids.has(x)) }));
}

export function safeName(title: string): string {
  const s = title.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").slice(0, 100).trim();
  return s || tr("New skill", "Новый навык");
}

export type Physics = { center: number; repel: number; link: number; distance: number; flow: number };
export type Display = { arrows: boolean; textFade: number; nodeSize: number; lineWidth: number };
export type PluginSettings = {
  folder: string;
  ignored: string[];
  states: StateDef[];
  layout: Record<string, [number, number]>;
  physics: Physics;
  display: Display;
  anim: number;
};
export const DEFAULT_PHYSICS: Physics = { center: 0.04, repel: 500, link: 0.35, distance: 90, flow: 0 };
export const DEFAULT_DISPLAY: Display = { arrows: true, textFade: 0, nodeSize: 1, lineWidth: 1 };
export const DEFAULT_SETTINGS: PluginSettings = {
  folder: "Hierarchical deconstruction", ignored: [], states: [], layout: {}, anim: 1,
  physics: { ...DEFAULT_PHYSICS }, display: { ...DEFAULT_DISPLAY },
};

export function sanitizeSettings(raw: unknown): PluginSettings {
  const o = (raw ?? {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const num = (x: unknown, dv: number, lo: number, hi: number) => (typeof x === "number" && isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dv);
  const p = (o.physics ?? {}) as Record<string, unknown>;
  const v = (o.display ?? {}) as Record<string, unknown>;
  const states: StateDef[] = [];
  if (Array.isArray(o.states)) for (const s of o.states.slice(0, 200)) {
    const x = s as Record<string, unknown>;
    if (typeof x?.id === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(x.id) && typeof x.color === "string" && HEX.test(x.color) && !states.some((q) => q.id === x.id))
      states.push({ id: x.id, name: typeof x.name === "string" && x.name.trim() ? x.name.trim().slice(0, 60) : tr("Untitled", "Без названия"), color: x.color.toLowerCase() });
  }
  const layout: Record<string, [number, number]> = {};
  if (o.layout && typeof o.layout === "object") for (const [k, val] of Object.entries(o.layout as Record<string, unknown>)) {
    if (Array.isArray(val) && val.length === 2 && Number.isFinite(+val[0]) && Number.isFinite(+val[1])) layout[k] = [+val[0], +val[1]];
  }
  return {
    folder: typeof o.folder === "string" ? o.folder.replace(/^\/+|\/+$/g, "").slice(0, 200) : d.folder,
    ignored: Array.isArray(o.ignored) ? o.ignored.filter((x): x is string => typeof x === "string").map((x) => x.trim().replace(/^\/+|\/+$/g, "")).filter(Boolean).slice(0, 200) : [],
    states, layout, anim: num(o.anim, d.anim, 0, 4),
    physics: {
      center: num(p.center, d.physics.center, 0, 0.2), repel: num(p.repel, d.physics.repel, 20, 2000), link: num(p.link, d.physics.link, 0, 1),
      distance: num(p.distance, d.physics.distance, 20, 300), flow: num(p.flow, d.physics.flow, 0, 1),
    },
    display: {
      arrows: typeof v.arrows === "boolean" ? v.arrows : d.display.arrows,
      textFade: num(v.textFade, d.display.textFade, -3, 3),
      nodeSize: num(v.nodeSize, d.display.nodeSize, 0.4, 3),
      lineWidth: num(v.lineWidth ?? p.lineWidth, d.display.lineWidth, 0.5, 4),
    },
  };
}
