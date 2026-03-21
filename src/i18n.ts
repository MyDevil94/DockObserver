import fs from "node:fs";
import path from "node:path";

export type Locale = string;

type LocaleFile = {
  label: string;
  messages: Record<string, string>;
};

const localesDir = path.join(process.cwd(), "public", "locales");
const fallbackLocale = "en";

const loadLocales = () => {
  const localeFiles = fs
    .readdirSync(localesDir)
    .filter((file) => file.endsWith(".json"))
    .sort();

  const entries = localeFiles.map((file) => {
    const locale = path.basename(file, ".json");
    const raw = fs.readFileSync(path.join(localesDir, file), "utf8");
    const parsed = JSON.parse(raw) as LocaleFile;
    return [locale, parsed] as const;
  });

  return Object.fromEntries(entries) as Record<string, LocaleFile>;
};

const LOCALES = loadLocales();

export const SUPPORTED_LOCALES: Locale[] = Object.keys(LOCALES);
export const LOCALE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(LOCALES).map(([locale, value]) => [locale, value.label])
);

export const isLocale = (value: string): value is Locale => value in LOCALES;

export const resolveLocale = (value: string | undefined): Locale => {
  if (!value) return fallbackLocale;
  const normalized = value.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(normalized) ? normalized : fallbackLocale;
};

export const t = (locale: Locale, key: string, vars: Record<string, string | number> = {}) => {
  const localeMessages = LOCALES[locale]?.messages ?? LOCALES[fallbackLocale]?.messages ?? {};
  const fallbackMessages = LOCALES[fallbackLocale]?.messages ?? {};
  const template = localeMessages[key] ?? fallbackMessages[key] ?? key;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, varName) => {
    const value = vars[varName];
    return value === undefined ? "" : String(value);
  });
};
