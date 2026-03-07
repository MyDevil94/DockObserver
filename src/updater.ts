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
  const refRaw = `${image.registry === "docker.io" ? "" : image.registry + "/"}${image.repo}:${image.tag ?? "latest"}`;
  const ref = parseImageRef(refRaw);
  const now = new Date().toISOString();
  const cleanStored = image.digest?.includes(":") ? image.digest.split(":")[1] : image.digest;
  const cleanDeclared = image.declaredDigest?.includes(":")
    ? image.declaredDigest.split(":")[1]
    : image.declaredDigest;

  // If compose pins a digest, mirror compose pull semantics:
  // no tag-tracking, only check whether pinned digest is present locally.
  if (cleanDeclared) {
    if (!cleanStored) {
      return {
        ...image,
        lastUpdateCheck: now,
        updateAvailable: true,
        updateMessage: "pinned digest missing locally"
      };
    }
    const updateAvailable = cleanStored !== cleanDeclared;
    return {
      ...image,
      lastUpdateCheck: now,
      updateAvailable,
      updateMessage: updateAvailable ? "pinned digest differs locally" : "pinned digest present"
    };
  }

  try {
    const { remoteDigest, error } = await getRemoteDigest(ref);
    if (!remoteDigest) {
      return {
        ...image,
        lastUpdateCheck: now,
        updateAvailable: null,
        updateMessage: error ?? "registry response missing digest"
      };
    }

    const cleanRemote = remoteDigest.includes(":") ? remoteDigest.split(":")[1] : remoteDigest;

    if (!cleanStored) {
      return {
        ...image,
        lastUpdateCheck: now,
        updateAvailable: true,
        updateMessage: "image missing locally"
      };
    }

    const updateAvailable = cleanStored !== cleanRemote;
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

const pickRandomUpdateIds = (images: StoredImage[]) => {
  const maxUpdates = Math.min(2, images.length);
  const updateCount = Math.floor(Math.random() * (maxUpdates + 1));
  const pool = [...images];
  const selected = new Set<string>();

  for (let i = 0; i < updateCount; i += 1) {
    const idx = Math.floor(Math.random() * pool.length);
    const chosen = pool.splice(idx, 1)[0];
    if (chosen) selected.add(chosen.id);
  }
  return selected;
};

export const checkImagesDryRun = (images: StoredImage[]): StoredImage[] => {
  const now = new Date().toISOString();
  const updateIds = pickRandomUpdateIds(images);
  return images.map((image) => {
    const updateAvailable = updateIds.has(image.id);
    return {
      ...image,
      lastUpdateCheck: now,
      updateAvailable,
      updateMessage: updateAvailable ? "dry-run dummy update" : "dry-run no update"
    };
  });
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
