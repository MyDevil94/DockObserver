export type Locale = "de" | "en";

export const isLocale = (value: string): value is Locale => value === "de" || value === "en";
export const SUPPORTED_LOCALES: Locale[] = ["de", "en"];

export const resolveLocale = (value: string | undefined): Locale => {
  if (!value) return "en";
  const normalized = value.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(normalized) ? normalized : "en";
};

const MESSAGES = {
  de: {
    updateCheckPrefix: "[update-check]",
    startChecks: "starte Prüfung für {count} image(s)",
    checkingImage: "prüfe image {image}...",
    originManual: "manuell",
    originAutomatic: "automatisch",
    resultUpdate: "update verfügbar",
    resultNoUpdate: "kein update",
    resultUnknown: "status unbekannt",
    resultLine: "{image} -> {result}{detail}",
    dryRunSuffix: " (dry-run)",
    listening: "DockObserver läuft auf Port {port}"
  },
  en: {
    updateCheckPrefix: "[update-check]",
    startChecks: "starting checks for {count} image(s)",
    checkingImage: "checking image {image}...",
    originManual: "manual",
    originAutomatic: "automatic",
    resultUpdate: "update available",
    resultNoUpdate: "no update",
    resultUnknown: "status unknown",
    resultLine: "{image} -> {result}{detail}",
    dryRunSuffix: " (dry-run)",
    listening: "DockObserver listening on port {port}"
  }
} as const;

type MessageKey = keyof (typeof MESSAGES)["de"];

export const t = (locale: Locale, key: MessageKey, vars: Record<string, string | number> = {}) => {
  const template = MESSAGES[locale][key] ?? MESSAGES.de[key];
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, varName) => {
    const value = vars[varName];
    return value === undefined ? "" : String(value);
  });
};
