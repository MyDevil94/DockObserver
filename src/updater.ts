import { StoredImage } from "./db.js";
import { getRemoteDigest } from "./registry.js";
import { parseImageRef, normalizeRepoKey } from "./util/parseImage.js";

export const pickNextImages = (images: StoredImage[], limit: number) => {
  const sorted = [...images].sort((a, b) => {
    const aTime = a.lastUpdateCheck ? Date.parse(a.lastUpdateCheck) : 0;
    const bTime = b.lastUpdateCheck ? Date.parse(b.lastUpdateCheck) : 0;
    return aTime - bTime;
  });
  return sorted.slice(0, limit);
};

export const checkImageUpdate = async (image: StoredImage): Promise<StoredImage> => {
  const ref = parseImageRef(`${image.registry === "docker.io" ? "" : image.registry + "/"}${image.repo}${image.tag ? `:${image.tag}` : ""}${image.digest ? `@${image.digest}` : ""}`);
  const now = new Date().toISOString();

  try {
    const { remoteDigest, error } = await getRemoteDigest(ref);
    if (!remoteDigest) {
      return {
        ...image,
        lastUpdateCheck: now,
        updateAvailable: null,
        updateMessage: error ?? "unknown"
      };
    }

    const localDigest = image.digest;
    const cleanLocal = localDigest?.includes(":") ? localDigest.split(":")[1] : localDigest;
    const cleanRemote = remoteDigest.includes(":") ? remoteDigest.split(":")[1] : remoteDigest;

    if (!cleanLocal) {
      return {
        ...image,
        lastUpdateCheck: now,
        updateAvailable: null,
        updateMessage: "local digest missing"
      };
    }

    const updateAvailable = cleanLocal !== cleanRemote;
    return {
      ...image,
      lastUpdateCheck: now,
      updateAvailable,
      updateMessage: updateAvailable ? "digest changed" : "up to date"
    };
  } catch (err) {
    return {
      ...image,
      lastUpdateCheck: now,
      updateAvailable: null,
      updateMessage: err instanceof Error ? err.message : "registry error"
    };
  }
};

export const mergeUpdates = (images: StoredImage[], updates: StoredImage[]) => {
  const map = new Map(images.map((image) => [image.id, image]));
  for (const update of updates) {
    map.set(update.id, update);
  }
  return Array.from(map.values());
};

export const getRegistryKey = (image: StoredImage) => {
  return normalizeRepoKey(parseImageRef(`${image.registry}/${image.repo}`));
};
