import { Locale, resolveLocale } from "./i18n.js";

export type Config = {
  dataDir: string;
  dockerSocketPath: string;
  noWebUpdateStackPaths: string[];
  gotifyUrl: string | null;
  gotifyToken: string | null;
  ntfyUrl: string | null;
  ntfyTopic: string | null;
  localRefreshHours: number;
  updateIntervalMinutes: number;
  updateBatchSize: number;
  dryRun: boolean;
  locale: Locale;
  port: number;
};

const parseNumber = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
};

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const parseList = (value: string | undefined) => {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseString = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const loadConfig = (): Config => {
  return {
    dataDir: process.env.DATA_DIR ?? "/data",
    dockerSocketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock",
    noWebUpdateStackPaths: parseList(process.env.NO_WEB_UPDATE_STACK_PATHS),
    gotifyUrl: parseString(process.env.GOTIFY_URL),
    gotifyToken: parseString(process.env.GOTIFY_TOKEN),
    ntfyUrl: parseString(process.env.NTFY_URL),
    ntfyTopic: parseString(process.env.NTFY_TOPIC),
    localRefreshHours: parseNumber(process.env.LOCAL_REFRESH_HOURS, 6),
    updateIntervalMinutes: parseNumber(process.env.UPDATE_INTERVAL_MINUTES, 30),
    updateBatchSize: parseNumber(process.env.UPDATE_BATCH_SIZE, 5),
    dryRun: parseBoolean(process.env.DRY_RUN, false),
    locale: resolveLocale(process.env.APP_LOCALE ?? process.env.LOCALE),
    port: parseNumber(process.env.PORT, 8080)
  };
};
