import { tr } from "./i18n";
import { App, Modal, SuggestModal, TFile, prepareFuzzySearch } from "obsidian";
import type HidePlugin from "./main";
import type { Entry } from "./model";
import type { StateDef } from "./sim";

type Item = { kind: "existing"; e: Entry } | { kind: "create"; title: string };

/** Выбор существующего навыка или создание нового по названию. skill === null — просто новый навык; иначе выбранный/созданный становится основой для skill. */
export class AddBaseModal extends SuggestModal<Item> {
  constructor(app: App, private plugin: HidePlugin, private skill: string | null, placeholder: string) {
    super(app);
    this.setPlaceholder(placeholder);
    this.setInstructions([{ command: "↵", purpose: tr("select", "выбрать") }, { command: "esc", purpose: tr("cancel", "отмена") }]);
  }

  getSuggestions(q: string): Item[] {
    const query = q.trim(), fz = prepareFuzzySearch(query);
    const found = this.plugin.entries().filter((e) => e.path !== this.skill)
      .map((e) => ({ e, m: fz(e.title) })).filter((x) => x.m).sort((a, b) => b.m!.score - a.m!.score).slice(0, 40)
      .map((x): Item => ({ kind: "existing", e: x.e }));
    if (query && !found.some((i) => i.kind === "existing" && i.e.title.toLowerCase() === query.toLowerCase())) found.push({ kind: "create", title: query });
    return found;
  }

  renderSuggestion(item: Item, el: HTMLElement): void {
    el.setText(item.kind === "existing" ? item.e.title : tr(`Create “${item.title}”`, `Создать «${item.title}»`));
    if (item.kind === "create") el.addClass("hide-create");
  }

  async onChooseSuggestion(item: Item): Promise<void> {
    try {
      const path = item.kind === "existing" ? item.e.path : await this.plugin.createNote(item.title);
      if (this.skill) await this.plugin.link(this.skill, path);
      else { const f = this.plugin.file(path); if (f instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(f); }
    } catch (e) { this.plugin.notice(e instanceof Error ? e.message : String(e)); }
  }
}

type StateItem = StateDef | { id: ""; name: string; color: string };

/** Выбор состояния навыка (цвет ноды). */
export class StateModal extends SuggestModal<StateItem> {
  constructor(app: App, private plugin: HidePlugin, private path: string) {
    super(app);
    this.setPlaceholder(tr("Skill state", "Состояние навыка"));
  }
  getSuggestions(q: string): StateItem[] {
    const all: StateItem[] = [{ id: "", name: tr("No state", "Без состояния"), color: "" }, ...this.plugin.settings.states];
    const fz = prepareFuzzySearch(q.trim());
    return all.filter((s) => !q.trim() || fz(s.name));
  }
  renderSuggestion(s: StateItem, el: HTMLElement): void {
    const dot = el.createSpan({ cls: "hide-dot" });
    if (s.color) dot.style.background = s.color;
    el.createSpan({ text: " " + s.name });
  }
  async onChooseSuggestion(s: StateItem): Promise<void> { await this.plugin.setState(this.path, s.id); }
}

export class NameModal extends Modal {
  constructor(app: App, private onSubmit: (title: string) => void, private heading = tr("New node", "Новая нода"), private placeholder = tr("Name", "Название")) { super(app); }
  onOpen(): void {
    this.titleEl.setText(this.heading);
    const input = this.contentEl.createEl("input", { attr: { type: "text", placeholder: this.placeholder, style: "width:100%" } });
    const go = () => { const v = input.value.trim(); if (v) { this.close(); this.onSubmit(v); } };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const b = this.contentEl.createEl("button", { text: tr("Create", "Создать"), cls: "mod-cta", attr: { style: "margin-top:10px" } });
    b.onclick = go; input.focus();
  }
  onClose(): void { this.contentEl.empty(); }
}
