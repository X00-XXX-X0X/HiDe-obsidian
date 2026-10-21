import { Application, Container, Graphics, Sprite, Text, Texture, type TextStyle } from "pixi.js";
import { cssVar, type Engine, type N } from "./sim";

/** CSS-цвет (hex, rgb, hsl, имя) → число для PIXI; разбор через canvas, чтобы понимать любые значения переменных темы. */
const probe = document.createElement("canvas").getContext("2d")!;
const colorCache = new Map<string, number>();
function toHex(css: string): number {
  let v = colorCache.get(css);
  if (v === undefined) {
    probe.fillStyle = "#888"; probe.fillStyle = css;
    const s = probe.fillStyle as string;
    if (s.startsWith("#")) v = parseInt(s.slice(1), 16);
    else { const m = s.match(/[\d.]+/g) ?? ["136", "136", "136"]; v = (Math.round(+m[0]) << 16) | (Math.round(+m[1]) << 8) | Math.round(+m[2]); }
    colorCache.set(css, v);
  }
  return v;
}

/** Отрисовка графа на WebGL (PIXI), как в графе Обсидиана. Логика, физика и попадание мышью — в Engine. */
export class GraphRenderer {
  private app: Application;
  private world = new Container();
  private edges = new Graphics();
  private nodeLayer = new Container();
  private rings = new Graphics();
  private labelLayer = new Container();
  private ui = new Graphics();
  private circle: Texture;
  private sprites = new Map<string, Sprite>();
  private labels = new Map<string, Text>();
  private labelFill = "";
  private themeKey = "";

  constructor(canvas: HTMLCanvasElement) {
    this.app = new Application({ view: canvas, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1, autoStart: false, width: 300, height: 200 });
    const g = new Graphics().beginFill(0xffffff).drawCircle(32, 32, 31).endFill();
    this.circle = this.app.renderer.generateTexture(g, { resolution: 2 });
    g.destroy();
    this.world.addChild(this.edges, this.nodeLayer, this.rings, this.labelLayer);
    this.app.stage.addChild(this.world, this.ui);
  }

  resize(w: number, h: number): void { this.app.renderer.resolution = window.devicePixelRatio || 1; this.app.renderer.resize(w, h); }
  destroy(): void { this.app.destroy(false, { children: true, texture: true, baseTexture: true }); }

  draw(e: Engine): void {
    const { w, h, cam } = e;
    this.world.position.set(w / 2 - cam.x * cam.k, h / 2 - cam.y * cam.k);
    this.world.scale.set(cam.k);
    const hot = e.hover ?? e.selected;
    const hotSet = new Set<string>(hot ? [hot, ...(e.requires.get(hot) ?? []), ...(e.usedBy.get(hot) ?? [])] : []);
    const cEdge = toHex(cssVar("--hide-edge")), cEdgeHl = toHex(cssVar("--hide-edge-hl"));
    const cNode = toHex(cssVar("--hide-node")), cHl = toHex(cssVar("--hide-node-hl")), cSel = toHex(cssVar("--hide-node-sel"));
    const vx0 = cam.x - w / 2 / cam.k - 60, vx1 = cam.x + w / 2 / cam.k + 60, vy0 = cam.y - h / 2 / cam.k - 60, vy1 = cam.y + h / 2 / cam.k + 60;

    // связи и стрелки
    const g = this.edges; g.clear();
    for (const [p, q] of e.edgeRefs) {
      const pa = p.id, ch = q.id;
      if ((p.x < vx0 && q.x < vx0) || (p.x > vx1 && q.x > vx1) || (p.y < vy0 && q.y < vy0) || (p.y > vy1 && q.y > vy1)) continue;
      const va = Math.min(p.vis, q.vis);
      if (va < 0.02) continue;
      if (e.ghosts.has(ch) && pa !== e.focusId) continue;
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      if (d < p.r + q.r + 2) continue;
      const ux = dx / d, uy = dy / d;
      const hl = hot !== null && (pa === hot || ch === hot);
      const alpha = va * (hot && !hl ? 0.35 : 1), color = hl ? cEdgeHl : cEdge;
      const width = ((hl ? 1.8 : 1.1) * e.settings.lineWidth) / Math.max(cam.k, 0.5);
      const ax = p.x + ux * p.r, ay = p.y + uy * p.r, bx = q.x - ux * (q.r + 1), by = q.y - uy * (q.r + 1);
      const s = 7 / Math.max(cam.k, 0.6);
      const ex = e.view.arrows ? bx - ux * s * 0.6 : bx, ey = e.view.arrows ? by - uy * s * 0.6 : by;
      g.lineStyle({ width, color, alpha });
      if (e.ghosts.has(ch)) {  // призраки — пунктиром
        const dash = 5 / cam.k, gap = 4 / cam.k, len = Math.hypot(ex - ax, ey - ay);
        for (let t = 0; t < len; t += dash + gap) {
          const t2 = Math.min(t + dash, len);
          g.moveTo(ax + ((ex - ax) * t) / len, ay + ((ey - ay) * t) / len).lineTo(ax + ((ex - ax) * t2) / len, ay + ((ey - ay) * t2) / len);
        }
      } else g.moveTo(ax, ay).lineTo(ex, ey);
      if (e.view.arrows) {
        g.lineStyle(0).beginFill(color, alpha)
          .moveTo(bx, by).lineTo(bx - ux * s - uy * s * 0.45, by - uy * s + ux * s * 0.45).lineTo(bx - ux * s + uy * s * 0.45, by - uy * s - ux * s * 0.45).closePath().endFill();
      }
    }

    // ноды, кольца, подписи
    const labelFill = cssVar("--hide-label");
    if (labelFill !== this.labelFill) { this.labelFill = labelFill; for (const t of this.labels.values()) t.style.fill = toHex(labelFill); }
    this.rings.clear();
    const live = new Set<string>();
    const lz = e.view.labelZoom, fs = 12 / cam.k;
    for (const n of e.list) {
      const on = n.vis >= 0.02 && n.x >= vx0 && n.x <= vx1 && n.y >= vy0 && n.y <= vy1;
      const sp = this.sprite(n.id), tx = this.label(n);
      sp.visible = on; tx.visible = false;
      if (!on) continue;
      live.add(n.id);
      const dim = hot && !hotSet.has(n.id) && e.mode === "free" ? 0.35 : 1;
      sp.position.set(n.x, n.y); sp.width = sp.height = n.r * 2;
      sp.tint = e.view.colors.get(n.id) ? toHex(e.view.colors.get(n.id)!) : n.color ? toHex(n.color) : cNode;
      sp.alpha = n.vis * dim;
      if (n.id === e.selected) this.rings.lineStyle({ width: 2 / cam.k, color: cSel, alpha: n.vis }).drawCircle(n.x, n.y, n.r + 4 / cam.k);
      else if (n.id === e.hover) this.rings.lineStyle({ width: 1.5 / cam.k, color: cHl, alpha: n.vis }).drawCircle(n.x, n.y, n.r + 3 / cam.k);
      const la = n.id === e.selected || n.id === e.hover || e.mode !== "free" ? 1 : Math.min(1, Math.max(0, (cam.k - lz * 0.7) / (lz * 0.5 + 1e-6)));
      if (la > 0.03) {
        tx.visible = true; tx.alpha = n.vis * dim * la;
        tx.scale.set(fs / 24);   // текст рисуется крупно и ужимается — чёткий на любом масштабе
        tx.position.set(n.x, n.y + n.r + fs * 1.15);
      }
    }
    for (const id of [...this.sprites.keys()]) if (!e.nodes.has(id)) { this.sprites.get(id)!.destroy(); this.sprites.delete(id); this.labels.get(id)?.destroy(); this.labels.delete(id); }

    // кнопка «+» под выбранной нодой — в экранных координатах, постоянного размера
    const u = this.ui; u.clear();
    const pl = e.addingFor ? null : e.plusScreen();
    if (pl) {
      const col = e.plusHover ? cHl : cSel;
      u.lineStyle({ width: 1.5, color: col }).beginFill(toHex(cssVar("--hide-surface"))).drawCircle(pl[0], pl[1], 11).endFill()
        .moveTo(pl[0] - 4.5, pl[1]).lineTo(pl[0] + 4.5, pl[1]).moveTo(pl[0], pl[1] - 4.5).lineTo(pl[0], pl[1] + 4.5);
    }
    this.app.renderer.render(this.app.stage);
  }

  private sprite(id: string): Sprite {
    let s = this.sprites.get(id);
    if (!s) { s = new Sprite(this.circle); s.anchor.set(0.5); this.nodeLayer.addChild(s); this.sprites.set(id, s); }
    return s;
  }
  private label(n: N): Text {
    let t = this.labels.get(n.id);
    if (!t) {
      t = new Text(n.title, { fontFamily: "system-ui, sans-serif", fontSize: 24, fill: toHex(this.labelFill || cssVar("--hide-label")) } as Partial<TextStyle>);
      t.anchor.set(0.5, 0); t.resolution = 2; this.labelLayer.addChild(t); this.labels.set(n.id, t);
    }
    if (t.text !== n.title) t.text = n.title;
    return t;
  }
}
