import { Config } from "./config.js";
import { StoredImage } from "./db.js";
import { Locale, t } from "./i18n.js";

const normalizeUrl = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("github.com/")) return `https://${trimmed}`;
  return null;
};

const getChangelogUrl = (image: StoredImage) => {
  const source = normalizeUrl(image.sourceUrl);
  if (!source || !source.includes("github.com/")) return null;
  const clean = source.endsWith("/") ? source.slice(0, -1) : source;
  const withoutGit = clean.endsWith(".git") ? clean.slice(0, -4) : clean;
  return `${withoutGit}/releases`;
};

const getMessage = (config: Config, locale: Locale, image: StoredImage) => {
  const imageName = image.containerName ?? image.service ?? image.displayName;
  const base = t(locale, "notificationUpdateAvailable", { image: imageName });
  const changelogUrl = getChangelogUrl(image);
  const prefix = config.dryRun ? `${t(locale, "notificationDryRunPrefix")} ` : "";
  if (!changelogUrl) return `${prefix}${base}`;
  return `${prefix}${base}\n${t(locale, "notificationChangelog")}: ${changelogUrl}`;
};

const sendGotify = async (config: Config, locale: Locale, image: StoredImage) => {
  if (!config.gotifyUrl || !config.gotifyToken) return;
  const baseUrl = config.gotifyUrl.endsWith("/") ? config.gotifyUrl : `${config.gotifyUrl}/`;
  const url = new URL("message", baseUrl);
  url.searchParams.set("token", config.gotifyToken);

  const form = new FormData();
  form.set("title", "DockObserver");
  form.set("message", getMessage(config, locale, image));
  form.set("priority", "5");

  const res = await fetch(url, {
    method: "POST",
    body: form
  });
  if (!res.ok) throw new Error(`gotify ${res.status}`);
  console.log(
    config.dryRun
      ? `${t(locale, "notificationGotifySent")} ${t(locale, "notificationPostUrl", { url: url.toString() })}`
      : t(locale, "notificationGotifySent")
  );
};

const sendNtfy = async (config: Config, locale: Locale, image: StoredImage) => {
  if (!config.ntfyUrl || !config.ntfyTopic) return;
  const baseUrl = config.ntfyUrl.endsWith("/") ? config.ntfyUrl : `${config.ntfyUrl}/`;
  const url = new URL(config.ntfyTopic, baseUrl);
  const res = await fetch(url, {
    method: "POST",
    body: getMessage(config, locale, image)
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
  console.log(
    config.dryRun
      ? `${t(locale, "notificationNtfySent")} ${t(locale, "notificationPostUrl", { url: url.toString() })}`
      : t(locale, "notificationNtfySent")
  );
};

export const sendUpdateNotifications = async (
  config: Config,
  locale: Locale,
  images: StoredImage[]
) => {
  if ((!config.gotifyUrl || !config.gotifyToken) && (!config.ntfyUrl || !config.ntfyTopic)) return;

  for (const image of images) {
    const tasks: Promise<void>[] = [];
    if (config.gotifyUrl && config.gotifyToken) tasks.push(sendGotify(config, locale, image));
    if (config.ntfyUrl && config.ntfyTopic) tasks.push(sendNtfy(config, locale, image));
    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("notification failed", result.reason);
      }
    }
  }
};
