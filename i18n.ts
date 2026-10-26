import { getLanguage } from "obsidian";

export const tr = (en: string, ru: string): string => (getLanguage().toLowerCase().startsWith("ru") ? ru : en);
