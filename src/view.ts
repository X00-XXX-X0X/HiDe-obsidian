import { ItemView, Menu, TFile, WorkspaceLeaf } from "obsidian";
import { tr } from "./i18n";
import type HidePlugin from "./main";
import { neighborhood, subgraph } from "./model";
import { Engine, MIN_REPEL, resetCssCache, type GraphData } from "./sim";
import { GraphRenderer } from "./render";
import { AddBaseModal, NameModal } from "./modals";
import { HidePanel, type Filters } from "./panel";

const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_PX = 24;

export const VIEW_TYPE = "hide-graph";

export class HideView extends ItemView {
  eng = new Engine();
  root: string | null = null;
  depth = 2;
  private canvas!: HTMLCanvasElement;
  private gfx!: GraphRenderer;
  private empty!: HTMLDivElement;
  private panel!: HidePanel;
  private raf = 0;
  private ro?: ResizeObserver;
  private lastClick: { id: string; t: number; x: number; y: number } | null = null;
  private filters: Filters = { query: "", orphans: true };

  constructor(leaf: WorkspaceLeaf, private plugin: HidePlugin) { super(leaf); }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return this.root ? `${tr("Graph", "Граф")}: ${this.plugin.file(this.root)?.basename ?? "…"}` : "Hierarchical deconstruction"; }
  getIcon(): string { return "network"; }

  getState(): Record<string, unknown> { return { root: this.root, depth: this.depth }; }
  async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const s = (state ?? {}) as { root?: string | null; depth?: number };
    this.root = typeof s.root === "string" ? s.root : null;
    this.depth = Math.min(6, Math.max(1, Number(s.depth) || 2));
    if (this.canvas) { this.eng.focusOnClick = !this.root; this.syncPanel(); this.refresh(); }
    await super.setState(state, result);
  }

  onOpen(): Promise<void> {
    const el = this.contentEl;
    el.empty();
    el.addClass("hide-view");
    this.canvas = el.createEl("canvas", { cls: "hide-canvas" });
    const bar = el.createDiv({ cls: "hide-toolbar" });
    bar.createEl("button", { text: tr("+ Node", "+ Нода") }).addEventListener("click", () => this.createStandalone());
    bar.createEl("button", { text: tr("Overview", "Общий план") }).addEventListener("click", () => this.eng.overview());
    this.empty = el.createDiv({ cls: "hide-empty" });
    this.panel = new HidePanel(el, this.plugin, {
      filters: this.filters,
      isLocal: () => !!this.root,
      getDepth: () => this.depth,
      setDepth: (d) => { this.depth = d; this.refresh(); this.app.workspace.requestSaveLayout(); },
      onFilter: () => this.refresh(),
      onAnimate: () => { this.eng.animate(); window.setTimeout(() => this.eng.fitAll(), 2200); },
    });

    const e = this.eng;
    e.focusOnClick = !this.root;
    e.onLayout = (pos) => { if (!this.root) this.plugin.saveLayout(pos); };
    this.applySettings();
    this.bindPointer();
    this.startLoop();
    this.refresh();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    window.cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.gfx?.destroy();
    return Promise.resolve();
  }

  syncPanel(): void { this.panel?.sync(); }

  private filtered(g: GraphData): GraphData {
    const q = this.filters.query.trim().toLowerCase();
    const keep = new Set<string>();
    for (const n of g.nodes) {
      if (n.id === this.root) { keep.add(n.id); continue; }
      if (q && !n.title.toLowerCase().includes(q)) continue;
      if (!this.filters.orphans && !n.requires.length && !n.usedBy.length) continue;
      keep.add(n.id);
    }
    return { ...g, nodes: subgraph(g.nodes, keep) };
  }

  refresh(): void {
    if (!this.canvas) return;
    const g = this.plugin.graph();
    if (this.root) {
      if (!g.nodes.some((n) => n.id === this.root)) {
        this.eng.setGraph({ ...g, nodes: [], layout: {} });
        this.empty.setText(tr("This note is no longer a skill.", "Заметка больше не является навыком."));
        this.empty.show();
        return;
      }
      const ids = neighborhood(g.nodes, this.root, this.depth);
      this.eng.setGraph({ ...this.filtered({ ...g, nodes: subgraph(g.nodes, ids) }), layout: {} });
      this.eng.selectNode(this.root);
      this.empty.hide();
      return;
    }
    const shown = this.filtered(g);
    this.eng.setGraph(shown);
    const none = shown.nodes.length === 0;
    this.empty.setText(g.nodes.length === 0
      ? tr("Nothing here yet. Press “+ Node” to create your first skill.", "Пока пусто. Нажми «+ Нода», чтобы создать первый навык.")
      : tr("No nodes match the filters.", "Нет нод, подходящих под фильтры."));
    this.empty.toggle(none);
  }

  applySettings(): void {
    const s = this.plugin.settings;
    this.eng.anim = s.anim;
    this.eng.setSettings({ ...s.physics, repel: Math.max(MIN_REPEL, s.physics.repel), lineWidth: s.display.lineWidth });
    this.eng.setView({ arrows: s.display.arrows, labelZoom: 0.55 * Math.pow(1.6, -s.display.textFade), nodeScale: s.display.nodeSize });
    this.panel?.sync();
  }

  onTheme(): void { resetCssCache(); this.eng.wake(); }
  onFileOpen(f: TFile | null): void { if (f && this.eng.nodes.has(f.path) && this.eng.mode === "free") this.eng.selectNode(f.path); }

  private createStandalone(): void {
    new NameModal(this.app, (title) => void (async () => {
      try {
        if (this.plugin.findByTitle(title)) throw new Error(tr("A skill with this name already exists", "Навык с таким названием уже есть"));
        const path = await this.plugin.createNote(title);
        window.setTimeout(() => { this.refresh(); this.eng.selectNode(path); }, 300);
      } catch (e) { this.plugin.notice(e instanceof Error ? e.message : String(e)); }
    })()).open();
  }

  private addFoundation(id: string): void {
    this.eng.selectNode(id);
    const name = this.plugin.graph().nodes.find((n) => n.id === id)?.title ?? "";
    new AddBaseModal(this.app, this.plugin, id, tr(`Foundation for “${name}”: pick a skill or type a new name`, `Основа для «${name}»: выбери навык или введи новое название`)).open();
  }

  private startAdd(): void {
    const id = this.eng.plusNodeId();
    if (!id) { this.plugin.notice(tr("Select a node to add a foundation to.", "Выбери ноду, к которой добавить основу.")); return; }
    this.addFoundation(id);
  }

  private startLoop(): void {
    const cv = this.canvas;
    this.gfx = new GraphRenderer(cv);
    let last = performance.now();
    const resize = () => {
      const r = cv.getBoundingClientRect();
      this.eng.w = r.width;
      this.eng.h = r.height;
      this.gfx.resize(Math.max(1, r.width), Math.max(1, r.height));
      this.eng.wake();
    };
    this.ro = new ResizeObserver(resize);
    this.ro.observe(cv);
    resize();
    const loop = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      if (cv.isShown()) {
        this.eng.frame(dt);
        if (this.eng.consumeRedraw()) this.gfx.draw(this.eng);
      }
      this.raf = window.requestAnimationFrame(loop);
    };
    this.raf = window.requestAnimationFrame(loop);
  }

  private bindPointer(): void {
    const cv = this.canvas, eng = this.eng;
    type Down = { id: string | null; plus: boolean; x: number; y: number; moved: boolean; lx: number; ly: number };
    let down: Down | null = null;
    const pos = (e: MouseEvent) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
    cv.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const [x, y] = pos(e), plus = eng.hitPlus(x, y);
      down = { id: plus ? null : eng.hit(x, y), plus, x, y, moved: false, lx: x, ly: y };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", (e) => {
      const [x, y] = pos(e);
      if (!down) { eng.hoverAt(x, y); cv.style.cursor = eng.hover || eng.plusHover ? "pointer" : "grab"; return; }
      if (down.plus) return;
      if (!down.moved && Math.hypot(x - down.x, y - down.y) > 4) { down.moved = true; if (down.id) eng.startDrag(down.id); }
      if (down.moved) { if (eng.dragId) eng.dragTo(x, y); else eng.pan(x - down.lx, y - down.ly); }
      down.lx = x;
      down.ly = y;
    });
    cv.addEventListener("pointerup", (e) => {
      if (!down) return;
      const d = down;
      down = null;
      eng.endDrag();
      if (d.plus) { this.startAdd(); return; }
      if (d.moved) return;
      const now = performance.now(), prev = this.lastClick;
      if (prev && now - prev.t < DOUBLE_CLICK_MS && Math.hypot(d.x - prev.x, d.y - prev.y) < DOUBLE_CLICK_PX) {
        this.lastClick = null;
        this.openNote(prev.id, e.ctrlKey || e.metaKey);
        return;
      }
      this.lastClick = d.id ? { id: d.id, t: now, x: d.x, y: d.y } : null;
      eng.click(d.id);
    });
    cv.addEventListener("pointerleave", () => { if (!down) { eng.hover = null; eng.plusHover = false; eng.plusFor = null; eng.wake(); } });
    cv.addEventListener("wheel", (e) => { e.preventDefault(); const [x, y] = pos(e); eng.zoomAt(x, y, Math.exp(-e.deltaY * 0.0012)); }, { passive: false });
    cv.addEventListener("contextmenu", (e) => {
      const [x, y] = pos(e), id = eng.hit(x, y);
      if (!id) return;
      e.preventDefault();
      this.nodeMenu(id).showAtMouseEvent(e);
    });
  }

  private openNote(path: string, newTab: boolean): void {
    const f = this.plugin.file(path);
    if (f) void (newTab ? this.app.workspace.getLeaf("tab") : this.app.workspace.getLeaf("split", "vertical")).openFile(f);
  }

  private nodeMenu(id: string): Menu {
    const m = new Menu(), p = this.plugin, f = p.file(id);
    m.addItem((i) => i.setTitle(tr("Open note", "Открыть заметку")).setIcon("file-text").onClick(() => this.openNote(id, false)));
    m.addItem((i) => i.setTitle(tr("Open in new tab", "Открыть в новой вкладке")).setIcon("file-plus").onClick(() => this.openNote(id, true)));
    m.addItem((i) => i.setTitle(tr("Local graph", "Локальный граф")).setIcon("network").onClick(() => void p.openView(id)));
    m.addSeparator();
    m.addItem((i) => i.setTitle(tr("Add foundation…", "Добавить основу…")).setIcon("plus").onClick(() => this.addFoundation(id)));
    m.addSeparator();
    m.addItem((i) => i.setTitle(tr("No state", "Без состояния")).setIcon("circle").onClick(() => void p.setState(id, "")));
    for (const s of p.settings.states) m.addItem((i) => i.setTitle(tr("State: ", "Состояние: ") + s.name).setIcon("circle-dot").onClick(() => void p.setState(id, s.id)));
    m.addSeparator();
    m.addItem((i) => i.setTitle(tr("Delete skill", "Удалить навык")).setIcon("trash").setWarning(true).onClick(() => { if (f) void p.deleteNote(id); }));
    return m;
  }
}
