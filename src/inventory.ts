import { ContainerSnapshot, DockerSnapshot, resolveImageDigest, guessImageRef } from "./docker.js";
import { ComposeService } from "./compose.js";
import { StoredImage } from "./db.js";
import { normalizeRepoKey, parseImageRef } from "./util/parseImage.js";

const cleanDigest = (digest: string | null) => {
  if (!digest) return null;
  return digest.includes(":") ? digest.split(":")[1] : digest;
};

const matchContainer = (composeImage: string, container: ContainerSnapshot, snapshot: DockerSnapshot) => {
  const composeRef = parseImageRef(composeImage);
  const containerRef = guessImageRef(snapshot, container.imageId, container.image);

  if (normalizeRepoKey(composeRef) !== normalizeRepoKey(containerRef)) return false;

  if (composeRef.tag && containerRef.tag && composeRef.tag !== containerRef.tag) return false;
  if (composeRef.tag && !containerRef.tag) return false;

  if (composeRef.digest) {
    const containerDigest = cleanDigest(resolveImageDigest(snapshot, container.imageId));
    const composeDigest = cleanDigest(composeRef.digest);
    if (!containerDigest || !composeDigest) return false;
    if (!containerDigest.endsWith(composeDigest) && !composeDigest.endsWith(containerDigest)) return false;
  }

  return true;
};

const statusFromContainers = (containers: ContainerSnapshot[]) => {
  if (containers.some((c) => c.state === "running")) return "running" as const;
  if (containers.some((c) => c.state === "paused")) return "paused" as const;
  if (containers.length > 0) return "stopped" as const;
  return "unknown" as const;
};

const makeId = (repoKey: string, tag: string | null, digest: string | null, stack: string | null, service: string | null) => {
  return [repoKey, tag ?? "", digest ?? "", stack ?? "", service ?? ""].join("|");
};

export const buildInventory = (
  snapshot: DockerSnapshot,
  composeServices: ComposeService[]
): StoredImage[] => {
  const now = new Date().toISOString();
  const usedContainers = new Set<string>();
  const inventory: StoredImage[] = [];

  for (const service of composeServices) {
    const composeRef = parseImageRef(service.image);
    const repoKey = normalizeRepoKey(composeRef);
    const matches = snapshot.containers.filter((container) => matchContainer(service.image, container, snapshot));
    matches.forEach((container) => usedContainers.add(container.id));

    const digest = matches[0] ? resolveImageDigest(snapshot, matches[0].imageId) : composeRef.digest;
    const id = makeId(repoKey, composeRef.tag, digest, service.stack, service.service);

    inventory.push({
      id,
      repo: composeRef.repository,
      registry: composeRef.registry ?? "docker.io",
      tag: composeRef.tag,
      digest: digest,
      displayName: `${composeRef.registry ? composeRef.registry + "/" : ""}${composeRef.repository}`,
      source: "compose",
      stack: service.stack,
      composeFile: service.composeFile,
      service: service.service,
      status: statusFromContainers(matches),
      lastSeen: now,
      lastUpdateCheck: null,
      updateAvailable: null,
      updateMessage: null
    });
  }

  const remaining = snapshot.containers.filter((container) => !usedContainers.has(container.id));
  const byImageKey = new Map<string, ContainerSnapshot[]>();
  for (const container of remaining) {
    const ref = guessImageRef(snapshot, container.imageId, container.image);
    const key = `${normalizeRepoKey(ref)}|${ref.tag ?? ""}|${ref.digest ?? ""}`;
    const list = byImageKey.get(key) ?? [];
    list.push(container);
    byImageKey.set(key, list);
  }

  for (const [key, containers] of byImageKey.entries()) {
    const sample = containers[0];
    const ref = guessImageRef(snapshot, sample.imageId, sample.image);
    const digest = resolveImageDigest(snapshot, sample.imageId);
    const id = makeId(normalizeRepoKey(ref), ref.tag, digest, null, null);
    inventory.push({
      id,
      repo: ref.repository,
      registry: ref.registry ?? "docker.io",
      tag: ref.tag,
      digest,
      displayName: `${ref.registry ? ref.registry + "/" : ""}${ref.repository}`,
      source: "socket",
      stack: null,
      composeFile: null,
      service: null,
      status: statusFromContainers(containers),
      lastSeen: now,
      lastUpdateCheck: null,
      updateAvailable: null,
      updateMessage: null
    });
  }

  return inventory;
};
