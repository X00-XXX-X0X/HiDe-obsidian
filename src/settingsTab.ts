import { tr } from "./i18n";
import { App, PluginSettingTab, Setting } from "obsidian";
import type HidePlugin from "./main";

const SLIDERS: { key: keyof HidePlugin["settings"]["physics"]; name: string; min: number; max: number; step: number }[] = [
  { key: "center", name: tr("Center force", "Сила центра"), min: 0, max: 0.2, step: 0.005 },
  { key: "repel", name: tr("Repel force", "Сила отталкивания"), min: 20, max: 2000, step: 10 },
  { key: "link", name: tr("Link force", "Сила связи"), min: 0, max: 1, step: 0.01 },
  { key: "distance", name: tr("Link distance", "Длина связи"), min: 20, max: 300, step: 5 },
  { key: "flow", name: tr("Hierarchy pull (foundations down)", "Тяготение иерархии (основы вниз)"), min: 0, max: 1, step: 0.05 },
  { key: "lineWidth", name: tr("Line width", "Толщина линий"), min: 0.5, max: 4, step: 0.1 },
];

export class HideSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: HidePlugin) { super(app, plugin); }

  display(): void {
    const { containerEl: el } = this;
    el.empty();
    const s = this.plugin.settings;

    new Setting(el).setName(tr("Skills folder", "Папка навыков")).setDesc(tr("New skills are created here. A skill is any note in this folder or any note with a requires property.", "Здесь создаются новые навыки. Навыком считается любая заметка из этой папки или любая заметка со свойством requires."))
      .addText((t) => t.setPlaceholder("Hierarchical deconstruction").setValue(s.folder).onChange((v) => { s.folder = v.trim().replace(/^\/+|\/+$/g, ""); this.plugin.save(); this.plugin.refreshViews(); }));

    new Setting(el).setName(tr("Animation speed", "Скорость анимаций")).setDesc(tr("0 disables animations.", "0 — без анимаций."))
      .addSlider((sl) => sl.setLimits(0, 4, 0.25).setValue(s.anim).setDynamicTooltip().onChange((v) => { s.anim = v; this.plugin.save(); this.plugin.views().forEach((x) => x.applySettings()); }));

    new Setting(el).setName(tr("Graph forces", "Силы графа")).setHeading();
    for (const sl of SLIDERS) {
      new Setting(el).setName(sl.name).addSlider((c) => c.setLimits(sl.min, sl.max, sl.step).setValue(s.physics[sl.key]).setDynamicTooltip()
        .onChange((v) => { s.physics[sl.key] = v; this.plugin.save(); this.plugin.views().forEach((x) => x.applySettings()); }));
    }

    new Setting(el).setName(tr("States", "Состояния")).setHeading();
    el.createEl("p", { cls: "setting-item-description", text: tr("A state sets the node color and is stored in the note's state property. Nodes are gray by default.", "Состояние задаёт цвет ноды и хранится в свойстве state заметки. По умолчанию нода серая.") });
    s.states.forEach((st, i) => {
      new Setting(el)
        .addText((t) => t.setValue(st.name).onChange((v) => { st.name = v.trim() || tr("Untitled", "Без названия"); this.plugin.setStates(s.states); }))
        .addColorPicker((c) => c.setValue(st.color).onChange((v) => { st.color = v.toLowerCase(); this.plugin.setStates(s.states); }))
        .addExtraButton((b) => b.setIcon("trash").setTooltip(tr("Delete state", "Удалить состояние")).onClick(() => { s.states.splice(i, 1); this.plugin.setStates(s.states); this.display(); }));
    });
    new Setting(el).addButton((b) => b.setButtonText(tr("+ State", "+ Состояние")).onClick(() => {
      s.states.push({ id: "s" + Date.now().toString(36), name: tr("New state", "Новое состояние"), color: "#3fb950" });
      this.plugin.setStates(s.states); this.display();
    }));
  }
}
