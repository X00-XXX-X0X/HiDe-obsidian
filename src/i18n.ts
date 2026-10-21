/** Язык интерфейса: русский, если Обсидиан запущен на русском; иначе английский. */
function isRu(): boolean {
  try {
    const l = window.localStorage.getItem("language") || (window as unknown as { moment?: { locale(): string } }).moment?.locale() || "";
    return l.toLowerCase().startsWith("ru");
  } catch { return false; }
}
export const tr = (en: string, ru: string): string => (isRu() ? ru : en);
