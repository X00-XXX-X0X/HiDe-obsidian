import { tr } from "./i18n";
import { App, Notice, Plugin, TFile, debounce, normalizePath } from "obsidian";
import { Entry, PluginSettings, asList, buildGraph, reaches, safeName, sanitizeSettings, wikiTarget } from "./model";
import { HideSettingTab } from "./settingsTab";
import type { GraphData, StateDef } from "./sim";
import { AddBaseModal, StateModal } from "./modals";
import { HideView, VIEW_TYPE } from "./view";

export default class HidePlugin extends Plugin {
  settings!: PluginSettings;

  async onload(): Promise<void> {
    this.settings = sanitizeSettings(await this.loadData());
    this.registerView(VIEW_TYPE, (leaf) => new HideView(leaf, this));
    this.addRibbonIcon("network", "Hierarchical deconstruction", () => void this.openView());
    this.addSettingTab(new HideSettingTab(this.app, this));

    this.addCommand({ id: "open-graph", name: "Open hierarchical deconstruction", callback: () => void this.openView() });
    this.addCommand({ id: "open-local", name: tr("Local graph of the current note", "Локальный граф текущей заметки"), checkCallback: (check) => {
      const f = this.app.workspace.getActiveFile();
      if (!f || !this.isNode(f)) return false;
      if (!check) void this.openView(f.path);
      return true;
    } });
    this.addCommand({ id: "new-skill", name: tr("New skill", "Новый навык"), callback: () => new AddBaseModal(this.app, this, null, tr("Name of the new skill", "Название нового навыка")).open() });
    this.addCommand({ id: "add-foundation", name: tr("Add a foundation to the current skill (built from…)", "Добавить основу текущему навыку (строится из…)"), checkCallback: (check) => {
      const f = this.app.workspace.getActiveFile();
      if (!f) return false;
      if (!check) new AddBaseModal(this.app, this, f.path, tr(`Built from… (“${f.basename}”)`, `Из чего строится «${f.basename}»`)).open();
      return true;
    } });
    this.addCommand({ id: "set-state", name: tr("State of the current skill", "Состояние текущего навыка"), checkCallback: (check) => {
      const f = this.app.workspace.getActiveFile();
      if (!f) return false;
      if (!check) new StateModal(this.app, this, f.path).open();
      return true;
    } });

    const refresh = debounce(() => this.refreshViews(), 150, true);
    this.registerEvent(this.app.metadataCache.on("changed", refresh));
    this.registerEvent(this.app.metadataCache.on("resolved", refresh));
    this.registerEvent(this.app.vault.on("delete", (f) => { this.dropLayout(f.path); refresh(); }));
    this.registerEvent(this.app.vault.on("rename", (f, old) => { this.moveLayout(old, f.path); refresh(); }));
    this.registerEvent(this.app.workspace.on("css-change", () => this.views().forEach((v) => v.onTheme())));
    this.registerEvent(this.app.workspace.on("file-open", (f) => this.views().forEach((v) => v.onFileOpen(f))));
  }

  onunload(): void { /* вид закрывается Обсидианом сам */ }

  // ---------- виды ----------
  views(): HideView[] { return this.app.workspace.getLeavesOfType(VIEW_TYPE).map((l) => l.view).filter((v): v is HideView => v instanceof HideView); }
  refreshViews(): void { this.views().forEach((v) => v.refresh()); }

  async openView(local?: string): Promise<void> {
    const { workspace } = this.app;
    if (!local) { const ex = workspace.getLeavesOfType(VIEW_TYPE).find((l) => !(l.view as HideView).root); if (ex) { void workspace.revealLeaf(ex); return; } }
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { root: local ?? null, depth: 2 } });
    void workspace.revealLeaf(leaf);
  }

  // ---------- настройки ----------
  private saveLater = debounce(() => void this.saveData(this.settings), 400, true);
  save(): void { this.saveLater(); }
  async saveNow(): Promise<void> { await this.saveData(this.settings); }
  saveLayout(pos: Record<string, [number, number]>): void { this.settings.layout = pos; this.save(); }
  private dropLayout(path: string): void { if (path in this.settings.layout) { delete this.settings.layout[path]; this.save(); } }
  private moveLayout(from: string, to: string): void { const l = this.settings.layout; if (from in l) { l[to] = l[from]; delete l[from]; this.save(); } }

  // ---------- данные ----------
  /** Нода — заметка из папки навыков или любая заметка со свойством requires. */
  isNode(f: TFile): boolean {
    const folder = this.settings.folder;
    if (folder && (f.path === folder || f.path.startsWith(folder + "/"))) return true;
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
    return !!fm && "requires" in fm;
  }

  entries(): Entry[] {
    const mc = this.app.metadataCache;
    const out: Entry[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!this.isNode(f)) continue;
      const fm = mc.getFileCache(f)?.frontmatter;
      const requires: string[] = [];
      for (const s of asList(fm?.requires)) {
        const t = wikiTarget(s);
        const dest = t ? mc.getFirstLinkpathDest(t, f.path) : null;
        if (dest) requires.push(dest.path);
      }
      out.push({ path: f.path, title: f.basename, requires, state: typeof fm?.state === "string" ? fm.state : "" });
    }
    return out;
  }

  graph(): GraphData { return buildGraph(this.entries(), this.settings.states, this.settings.layout); }

  file(path: string): TFile | null { const f = this.app.vault.getAbstractFileByPath(path); return f instanceof TFile ? f : null; }

  findByTitle(title: string): Entry | undefined {
    const t = title.trim().toLowerCase();
    return this.entries().find((e) => e.title.toLowerCase() === t);
  }

  // ---------- действия ----------
  /** Создаёт заметку-навык в папке навыков (имя уникально). Возвращает путь. */
  async createNote(title: string): Promise<string> {
    const base = safeName(title);
    const folder = this.settings.folder;
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {});
    let path = normalizePath(`${folder ? folder + "/" : ""}${base}.md`), i = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${folder ? folder + "/" : ""}${base} ${i++}.md`);
    await this.app.vault.create(path, "---\nrequires: []\n---\n");
    return path;
  }

  /** Навык `skill` строится из `base`. Ссылка пишется в свойство requires как [[ссылка]], поэтому Обсидиан видит её в своих графе и обратных ссылках. */
  async link(skill: string, base: string): Promise<void> {
    const s = this.file(skill), b = this.file(base);
    if (!s || !b) throw new Error(tr("note not found", "заметка не найдена"));
    if (skill === base) throw new Error(tr("A skill cannot be built from itself", "Навык не может строиться сам из себя"));
    const g = new Map(this.entries().map((e) => [e.path, e.requires]));
    if (g.get(skill)?.includes(base)) return;
    if (reaches(g, base, skill)) throw new Error(tr(`cycle: “${b.basename}” is already built from “${s.basename}”`, `цикл: «${b.basename}» уже строится из «${s.basename}»`));
    const link = `[[${this.app.metadataCache.fileToLinktext(b, s.path, true)}]]`;
    await this.app.fileManager.processFrontMatter(s, (fm) => { const cur = asList(fm.requires); cur.push(link); fm.requires = cur; });
  }

  async unlink(skill: string, base: string): Promise<void> {
    const s = this.file(skill);
    if (!s) return;
    const mc = this.app.metadataCache;
    await this.app.fileManager.processFrontMatter(s, (fm) => {
      fm.requires = asList(fm.requires).filter((x) => { const t = wikiTarget(x); return !(t && mc.getFirstLinkpathDest(t, s.path)?.path === base); });
    });
  }

  async setState(path: string, state: string): Promise<void> {
    const f = this.file(path);
    if (!f) return;
    await this.app.fileManager.processFrontMatter(f, (fm) => { if (state) fm.state = state; else delete fm.state; });
  }

  /** Удаление в корзину; ссылки на неё у других навыков убираем, чтобы не оставлять битых. */
  async deleteNote(path: string): Promise<void> {
    const f = this.file(path);
    if (!f) return;
    for (const e of this.entries()) if (e.requires.includes(path)) await this.unlink(e.path, path);
    await this.app.fileManager.trashFile(f);
  }

  setStates(states: StateDef[]): void { this.settings.states = states; this.save(); this.refreshViews(); }
  notice(msg: string): void { new Notice(msg); }
  get appRef(): App { return this.app; }
}
