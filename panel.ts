import { ColorComponent, Setting, TextComponent, setIcon } from "obsidian";
import { tr } from "./i18n";
import type HidePlugin from "./main";
import type { Display, Physics } from "./model";

export type Filters = { query: string; orphans: boolean };

export type PanelHooks = {
  filters: Filters;
  isLocal: () => boolean;
  getDepth: () => number;
  setDepth: (depth: number) => void;
  onFilter: () => void;
  onAnimate: () => void;
};

export class HidePanel {
  private el: HTMLElement;
  private syncers: (() => void)[] = [];
  private depthSetting!: Setting;
  private stateList!: HTMLElement;
  private stateKey = "";

  constructor(parent: HTMLElement, private plugin: HidePlugin, private hooks: PanelHooks) {
    this.el = parent.createDiv({ cls: "graph-controls is-close" });
    this.button("mod-close", "x", tr("Close", "Закрыть"), () => this.el.addClass("is-close"));
    this.button("mod-open", "settings", tr("Open graph settings", "Открыть настройки графа"), () => this.el.removeClass("is-close"));
    this.button("mod-animate", "wand-sparkles", tr("Start animation", "Запустить анимацию"), () => hooks.onAnimate());
    this.button("mod-reset", "rotate-ccw", tr("Restore default settings", "Восстановить настройки по умолчанию"), () => plugin.resetView());
    this.buildFilters();
    this.buildStates();
    this.buildDisplay();
    this.buildForces();
    this.sync();
  }

  sync(): void {
    this.syncers.forEach((fn) => fn());
    this.depthSetting.settingEl.toggle(this.hooks.isLocal());
    this.renderStates();
  }

  private button(cls: string, icon: string, label: string, fn: () => void): void {
    const b = this.el.createDiv({ cls: `clickable-icon graph-controls-button ${cls}`, attr: { "aria-label": label } });
    setIcon(b, icon);
    b.addEventListener("click", fn);
  }

  private section(key: string, title: string): HTMLElement {
    const el = this.el.createDiv({ cls: `tree-item graph-control-section mod-${key} is-collapsed` });
    const self = el.createDiv({ cls: "tree-item-self mod-collapsible" });
    const icon = self.createDiv({ cls: "tree-item-icon collapse-icon is-collapsed" });
    setIcon(icon, "right-triangle");
    self.createDiv({ cls: "tree-item-inner" }).createEl("header", { cls: "graph-control-section-header", text: title });
    const body = el.createDiv({ cls: "tree-item-children" });
    self.addEventListener("click", () => {
      const closed = !el.hasClass("is-collapsed");
      el.toggleClass("is-collapsed", closed);
      icon.toggleClass("is-collapsed", closed);
    });
    return body;
  }

  private slider(body: HTMLElement, name: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void): Setting {
    return new Setting(body).setName(name).setClass("mod-slider").addSlider((c) => {
      c.setLimits(min, max, step).setInstant(true).setValue(get()).onChange(set);
      this.syncers.push(() => c.setValue(get()));
    });
  }

  private toggle(body: HTMLElement, name: string, get: () => boolean, set: (v: boolean) => void): Setting {
    return new Setting(body).setName(name).setClass("mod-toggle").addToggle((c) => {
      c.setValue(get()).onChange(set);
      this.syncers.push(() => c.setValue(get()));
    });
  }

  private buildFilters(): void {
    const body = this.section("filter", tr("Filters", "Фильтры"));
    const f = this.hooks.filters;
    new Setting(body).setClass("mod-search-setting").addSearch((c) => {
      c.setPlaceholder(tr("Search nodes...", "Поиск нод...")).setValue(f.query).onChange((v) => { f.query = v; this.hooks.onFilter(); });
    });
    this.toggle(body, tr("Orphans", "Одиночные ноды"), () => f.orphans, (v) => { f.orphans = v; this.hooks.onFilter(); });
    this.depthSetting = this.slider(body, tr("Depth", "Глубина"), 1, 6, 1, () => this.hooks.getDepth(), (v) => this.hooks.setDepth(v));
  }

  private buildStates(): void {
    const body = this.section("states", tr("States", "Состояния"));
    this.stateList = body.createDiv({ cls: "graph-color-groups-container" });
    const add = body.createDiv({ cls: "graph-color-button-container" });
    add.createEl("button", { cls: "mod-cta", text: tr("New state", "Новое состояние") }).addEventListener("click", () => {
      const states = this.plugin.settings.states;
      states.push({ id: "s" + Date.now().toString(36), name: tr("New state", "Новое состояние"), color: "#3fb950" });
      this.plugin.setStates(states);
    });
  }

  renderStates(): void {
    const states = this.plugin.settings.states;
    const key = states.map((s) => s.id).join("|");
    if (key === this.stateKey) return;
    this.stateKey = key;
    this.stateList.empty();
    states.forEach((st, i) => {
      const row = this.stateList.createDiv({ cls: "graph-color-group" });
      new TextComponent(row).setValue(st.name).onChange((v) => { st.name = v.trim() || tr("Untitled", "Без названия"); this.plugin.setStates(states, false); });
      new ColorComponent(row).setValue(st.color).onChange((v) => { st.color = v.toLowerCase(); this.plugin.setStates(states, false); });
      const del = row.createDiv({ cls: "clickable-icon", attr: { "aria-label": tr("Delete state", "Удалить состояние") } });
      setIcon(del, "x");
      del.addEventListener("click", () => { states.splice(i, 1); this.plugin.setStates(states); });
    });
  }

  private buildDisplay(): void {
    const body = this.section("display", tr("Display", "Отображение"));
    const d = this.plugin.settings.display;
    const put = <K extends keyof Display>(k: K, v: Display[K]) => this.plugin.updateDisplay(k, v);
    this.toggle(body, tr("Arrows", "Стрелки"), () => d.arrows, (v) => put("arrows", v));
    this.slider(body, tr("Text fade threshold", "Порог исчезновения текста"), -3, 3, 0.1, () => d.textFade, (v) => put("textFade", v));
    this.slider(body, tr("Node size", "Размер нод"), 0.4, 3, 0.05, () => d.nodeSize, (v) => put("nodeSize", v));
    this.slider(body, tr("Link thickness", "Толщина связей"), 0.5, 4, 0.1, () => d.lineWidth, (v) => put("lineWidth", v));
  }

  private buildForces(): void {
    const body = this.section("forces", tr("Forces", "Силы"));
    const p = this.plugin.settings.physics;
    const put = <K extends keyof Physics>(k: K, v: Physics[K]) => this.plugin.updatePhysics(k, v);
    this.slider(body, tr("Center force", "Сила центра"), 0, 0.2, 0.005, () => p.center, (v) => put("center", v));
    this.slider(body, tr("Repel force", "Сила отталкивания"), 20, 2000, 10, () => p.repel, (v) => put("repel", v));
    this.slider(body, tr("Link force", "Сила связи"), 0, 1, 0.01, () => p.link, (v) => put("link", v));
    this.slider(body, tr("Link distance", "Длина связи"), 20, 300, 5, () => p.distance, (v) => put("distance", v));
    this.slider(body, tr("Hierarchy pull", "Тяготение иерархии"), 0, 1, 0.05, () => p.flow, (v) => put("flow", v));
  }
}
