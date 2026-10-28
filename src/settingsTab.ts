import { App, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import { tr } from "./i18n";
import type HidePlugin from "./main";

export class HideSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: HidePlugin) { super(app, plugin); }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: tr("Skills folder", "Папка навыков"),
        desc: tr("New skills are created here. Notes in this folder are shown as skills.", "Здесь создаются новые навыки. Заметки из этой папки показываются как навыки."),
        control: { type: "folder", key: "folder", placeholder: "Hierarchical deconstruction", includeRoot: true },
      },
      {
        name: tr("Ignored folders", "Игнорируемые папки"),
        desc: tr("One folder per line. Notes inside are never shown.", "По одной папке на строку. Заметки внутри не показываются."),
        control: { type: "textarea", key: "ignored", placeholder: "Templates\nArchive", rows: 3 },
      },
      {
        name: tr("Animation speed", "Скорость анимаций"),
        desc: tr("0 turns animations off.", "0 отключает анимации."),
        control: { type: "slider", key: "anim", min: 0, max: 4, step: 0.25 },
      },
    ];
  }

  getControlValue(key: string): unknown {
    if (key === "folder") return this.plugin.settings.folder;
    if (key === "ignored") return this.plugin.settings.ignored.join("\n");
    if (key === "anim") return this.plugin.settings.anim;
    return undefined;
  }

  setControlValue(key: string, value: unknown): void {
    const s = this.plugin.settings;
    if (key === "folder" && typeof value === "string") s.folder = value.trim().replace(/^\/+|\/+$/g, "");
    if (key === "ignored" && typeof value === "string") s.ignored = value.split("\n").map((x) => x.trim().replace(/^\/+|\/+$/g, "")).filter(Boolean);
    if (key === "anim" && typeof value === "number") s.anim = value;
    this.plugin.save();
    this.plugin.views().forEach((v) => v.applySettings());
    this.plugin.refreshViews();
  }
}
