import fs from "node:fs/promises";
import path from "node:path";
import { isLocale, Locale } from "./i18n.js";

export type StoredImage = {
  id: string;
  repo: string;
  registry: string;
  tag: string | null;
  digest: string | null;
  displayName: string;
  source: "compose" | "socket";
  stack: string | null;
  composeFile: string | null;
  service: string | null;
  containerName: string | null;
  declaredDigest: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  changelogUrl: string | null;
  status: "running" | "stopped" | "paused" | "unknown";
  lastSeen: string;
  lastUpdateCheck: string | null;
  lastUpdatedAt: string | null;
  updateAvailable: boolean | null;
  updateMessage: string | null;
};

export type DbState = {
  images: StoredImage[];
  lastRefresh: string | null;
  lastAutomaticCheck: string | null;
  settings: {
    locale: Locale;
  };
};

const defaultState: DbState = {
  images: [],
  lastRefresh: null,
  lastAutomaticCheck: null,
  settings: {
    locale: "en"
  }
};

export class Db {
  private filePath: string;
  private state: DbState = defaultState;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "db.json");
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as DbState;
      this.state = {
        images: parsed.images ?? [],
        lastRefresh: parsed.lastRefresh ?? null,
        lastAutomaticCheck: parsed.lastAutomaticCheck ?? null,
        settings: {
          locale: isLocale(parsed.settings?.locale ?? "") ? parsed.settings.locale : defaultState.settings.locale
        }
      };
    } catch (err) {
      this.state = defaultState;
      await this.save();
    }
  }

  getState() {
    return this.state;
  }

  setState(next: DbState) {
    this.state = next;
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2));
  }
}
