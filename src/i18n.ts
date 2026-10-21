import { getLanguage } from "obsidian";

/** Язык интерфейса: русский, если Обсидиан запущен на русском; иначе английский. */
export const tr = (en: string, ru: string): string => (getLanguage().toLowerCase().startsWith("ru") ? ru : en);
