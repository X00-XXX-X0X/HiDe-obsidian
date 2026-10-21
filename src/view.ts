import { tr } from "./i18n";
import { ItemView, Menu, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type HidePlugin from "./main";
import { neighborhood, subgraph } from "./model";
import { Engine, MIN_REPEL, resetCssCache } from "./sim";
import { GraphRenderer } from "./render";
import { NameModal } from "./modals";

export const VIEW_TYPE = "hide-graph";

/** Hierarchical deconstruction: общий или локальный (root — заметка, вокруг которой строится окрестность). */
export class HideView extends ItemView {
  eng = new Engine();
  root: string | null = null;
  depth = 2;
  private canvas!: HTMLCanvasElement;
  private gfx!: GraphRenderer;
  private back!: HTMLButtonElement;
  private empty!: HTMLDivElement;
  private forces!: HTMLDivElement;
  private stepper!: HTMLDivElement;
  private raf = 0;
  private ro?: ResizeObserver;
  private focused = false;

  constructor(leaf: WorkspaceLeaf, private plugin: HidePlugin) { super(leaf); }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return this.root ? `${tr("Graph", "Граф")}: ${this.plugin.file(this.root)?.basename ?? "…"}` : "Hierarchical deconstruction"; }
  getIcon(): string { return "network"; }

  getState(): Record<string, unknown> { return { root: this.root, depth: this.depth }; }
  async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const s = (state ?? {}) as { root?: string | null; depth?: number };
    this.root = typeof s.root === "string" ? s.root : null;
    this.depth = Math.min(6, Math.max(1, Number(s.depth) || 2));
    if (this.canvas) { this.syncChrome(); this.refresh(); }
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    const el = this.contentEl;
    el.empty(); el.addClass("hide-view");
    const bar = el.createDiv({ cls: "hide-toolbar" });
    const add = bar.createEl("button", { text: tr("+ Node", "+ Нода") });
    add.onclick = () => this.createStandalone();
    const fit = bar.createEl("button", { cls: "hide-icon", attr: { "aria-label": tr("Show all nodes", "Показать все ноды") } });
    setIcon(fit, "maximize"); fit.onclick = () => this.eng.fitAll();
    this.back = bar.createEl("button", { text: tr("← Back", "← Назад") }); this.back.onclick = () => this.eng.exitFocus();
    this.stepper = bar.createDiv({ cls: "hide-stepper" });
    this.stepper.createSpan({ text: tr("Depth", "Глубина") });
    const minus = this.stepper.createEl("button", { text: "−" }), val = this.stepper.createEl("b"), plus = this.stepper.createEl("button", { text: "+" });
    const setDepth = (d: number) => { this.depth = Math.min(6, Math.max(1, d)); val.setText(String(this.depth)); this.refresh(); this.app.workspace.requestSaveLayout(); };
    minus.onclick = () => setDepth(this.depth - 1); plus.onclick = () => setDepth(this.depth + 1);
    this.stepper.dataset.sync = "1"; (this.stepper as unknown as { _val: HTMLElement })._val = val;
    const gear = bar.createEl("button", { cls: "hide-icon", attr: { "aria-label": tr("Forces", "Силы") } });
    setIcon(gear, "sliders-horizontal"); gear.onclick = () => this.forces.toggleClass("is-open", !this.forces.hasClass("is-open"));

    this.forces = el.createDiv({ cls: "hide-forces" });
    this.buildForces();
    this.canvas = el.createEl("canvas", { cls: "hide-canvas" });
    this.empty = el.createDiv({ cls: "hide-empty", text: tr("Nothing here yet. Press “+ Node” to create your first skill.", "Пока пусто. Нажми «+ Нода», чтобы создать первый навык.") });

    const e = this.eng;
    e.onFocus = (f) => { this.focused = f; this.back.toggle(f); };
    e.onLayout = (pos) => { if (!this.root) this.plugin.saveLayout(pos); };
    e.onSelect = () => {};
    this.applySettings();
    this.syncChrome();
    this.bindPointer();
    this.startLoop();
    this.refresh();
  }

  async onClose(): Promise<void> {
    window.cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.gfx?.destroy();
  }

  // ---------- данные ----------
  private syncChrome(): void {
    this.stepper.toggle(!!this.root);
    const v = (this.stepper as unknown as { _val?: HTMLElement })._val; v?.setText(String(this.depth));
    this.eng.focusOnClick = !this.root;
    this.back.toggle(this.focused);
  }

  refresh(): void {
    if (!this.canvas) return;
    const g = this.plugin.graph();
    if (this.root) {
      if (!g.nodes.some((n) => n.id === this.root)) { this.eng.setGraph({ ...g, nodes: [], layout: {} }); this.empty.setText(tr("This note is no longer a skill.", "Заметка больше не является навыком.")); this.empty.show(); return; }
      const ids = neighborhood(g.nodes, this.root, this.depth);
      this.eng.setGraph({ ...g, nodes: subgraph(g.nodes, ids), layout: {} });
      this.eng.selectNode(this.root);
      this.empty.hide();
    } else {
      this.eng.setGraph(g);
      this.empty.setText(tr("Nothing here yet. Press “+ Node” to create your first skill.", "Пока пусто. Нажми «+ Нода», чтобы создать первый навык."));
      this.empty.toggle(g.nodes.length === 0);
    }
  }

  applySettings(): void {
    const s = this.plugin.settings;
    this.eng.anim = s.anim;
    this.eng.setSettings({ ...s.physics, repel: Math.max(MIN_REPEL, s.physics.repel) });
    this.forces?.querySelectorAll<HTMLInputElement>("input[data-k]").forEach((i) => { i.value = String(s.physics[i.dataset.k as keyof typeof s.physics]); });
  }

  onTheme(): void { resetCssCache(); this.eng.wake(); }
  onFileOpen(f: TFile | null): void { if (f && this.eng.nodes.has(f.path) && this.eng.mode === "free") this.eng.selectNode(f.path); }

  private buildForces(): void {
    const defs = [
      ["center", tr("Center force", "Сила центра"), 0, 0.2, 0.005], ["repel", tr("Repel force", "Сила отталкивания"), MIN_REPEL, 2000, 10], ["link", tr("Link force", "Сила связи"), 0, 1, 0.01],
      ["distance", tr("Link distance", "Длина связи"), 20, 300, 5], ["flow", tr("Hierarchy pull", "Тяготение иерархии"), 0, 1, 0.05], ["lineWidth", tr("Line width", "Толщина линий"), 0.5, 4, 0.1],
    ] as const;
    for (const [k, name, min, max, step] of defs) {
      const row = this.forces.createEl("label");
      row.createSpan({ text: name });
      const r = row.createEl("input", { attr: { type: "range", min: String(min), max: String(max), step: String(step), "data-k": k } });
      r.oninput = () => {
        this.plugin.settings.physics[k] = +r.value; this.plugin.save();
        this.plugin.views().forEach((v) => v.applySettings());
      };
    }
  }

  // ---------- «+ Нода»: самостоятельная новая нода ----------
  private createStandalone(): void {
    new NameModal(this.app, (title) => void (async () => {
      try {
        if (this.plugin.findByTitle(title)) throw new Error(tr("A skill with this name already exists", "Навык с таким названием уже есть"));
        const path = await this.plugin.createNote(title);
        window.setTimeout(() => { this.refresh(); this.eng.selectNode(path); }, 300);
      } catch (e) { this.plugin.notice(e instanceof Error ? e.message : String(e)); }
    })()).open();
  }

  // ---------- «+» под нодой: то же окно, что у «+ Нода», но нода привязывается к выбранной ----------
  private addFoundation(id: string): void {
    this.eng.selectNode(id);
    const name = this.plugin.graph().nodes.find((n) => n.id === id)?.title ?? "";
    new NameModal(this.app, (title) => void this.submitAdd(id, title), tr(`New foundation for “${name}”`, `Новая основа для «${name}»`), tr("Name (or an existing skill)", "Название (или существующего навыка)")).open();
  }
  private startAdd(): void {
    const id = this.eng.plusNodeId();
    if (!id) { this.plugin.notice(tr("Select a node to add a foundation to.", "Выбери ноду, к которой добавить основу.")); return; }
    this.addFoundation(id);
  }
  private async submitAdd(skill: string, title: string): Promise<void> {
    try {
      const ex = this.plugin.findByTitle(title);
      if (ex?.path === skill) throw new Error(tr("A skill cannot be built from itself", "Навык не может строиться сам из себя"));
      const base = ex ? ex.path : await this.plugin.createNote(title);
      await this.plugin.link(skill, base);
      window.setTimeout(() => this.refresh(), 300);
    } catch (e) { this.plugin.notice(e instanceof Error ? e.message : String(e)); }
  }

  // ---------- рисование и мышь ----------
  private startLoop(): void {
    const cv = this.canvas;
    this.gfx = new GraphRenderer(cv);
    let last = performance.now();
    const resize = () => {
      const r = cv.getBoundingClientRect();
      this.eng.w = r.width; this.eng.h = r.height;
      this.gfx?.resize(Math.max(1, r.width), Math.max(1, r.height));
      this.eng.wake();
    };
    this.ro = new ResizeObserver(resize); this.ro.observe(cv); resize();
    const loop = (t: number) => {
      const dt = (t - last) / 1000; last = t;
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
      down.lx = x; down.ly = y;
    });
    cv.addEventListener("pointerup", () => {
      if (!down) return;
      if (down.plus) this.startAdd();
      else if (!down.moved) eng.click(down.id);
      eng.endDrag(); down = null;
    });
    cv.addEventListener("pointerleave", () => { if (!down) { eng.hover = null; eng.plusHover = false; if (!eng.addingFor) eng.plusFor = null; eng.wake(); } });
    cv.addEventListener("wheel", (e) => { e.preventDefault(); const [x, y] = pos(e); eng.zoomAt(x, y, Math.exp(-e.deltaY * 0.0012)); }, { passive: false });
    cv.addEventListener("dblclick", (e) => { const [x, y] = pos(e); const id = eng.hit(x, y); if (id) this.openNote(id, e.ctrlKey || e.metaKey); });
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
    m.addItem((i) => i.setTitle(tr("Add foundation…", "Добавить основу…")).setIcon("plus").onClick(() => { this.addFoundation(id); }));
    m.addSeparator();
    m.addItem((i) => i.setTitle(tr("No state", "Без состояния")).setIcon("circle").onClick(() => void p.setState(id, "")));
    for (const s of p.settings.states) m.addItem((i) => i.setTitle(tr("State: ", "Состояние: ") + s.name).setIcon("circle-dot").onClick(() => void p.setState(id, s.id)));
    m.addSeparator();
    m.addItem((i) => i.setTitle(tr("Delete skill", "Удалить навык")).setIcon("trash").setWarning(true).onClick(() => { if (f) void p.deleteNote(id); }));
    return m;
  }
}
