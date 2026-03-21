import {
  ContainerSnapshot,
  DockerSnapshot,
  resolveImageDigest,
  resolveImageDigestByRef,
  resolveImageLabels,
  resolveImageLabelsByRef,
  guessImageRef
} from "./docker.js";
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

  if (composeRef.digest) {
    const containerDigest =
      cleanDigest(resolveImageDigest(snapshot, container.imageId)) ?? cleanDigest(containerRef.digest);
    const composeDigest = cleanDigest(composeRef.digest);
    if (!containerDigest || !composeDigest) return false;
    return containerDigest === composeDigest;
  }

  if (composeRef.tag && containerRef.tag && composeRef.tag !== containerRef.tag) return false;
  if (composeRef.tag && !containerRef.tag) return false;

  return true;
};

const matchByComposeLabels = (service: ComposeService, container: ContainerSnapshot) => {
  const serviceLabel = container.labels["com.docker.compose.service"];
  if (!serviceLabel || serviceLabel !== service.service) return false;

  const projectLabel = container.labels["com.docker.compose.project"];
  if (!projectLabel) return true;
  return projectLabel === service.stack;
};

const statusFromContainers = (containers: ContainerSnapshot[]) => {
  if (containers.some((c) => c.state === "running")) return "running" as const;
  if (containers.some((c) => c.state === "paused")) return "paused" as const;
  if (containers.length > 0) return "stopped" as const;
  return "unknown" as const;
};

const makeId = (repoKey: string, tag: string | null, stack: string | null, service: string | null) => {
  return [repoKey, tag ?? "", stack ?? "", service ?? ""].join("|");
};

const getLabelValue = (labels: Record<string, string>, key: string) => {
  const wanted = key.toLowerCase();
  for (const [labelKey, labelValue] of Object.entries(labels)) {
    if (labelKey.toLowerCase() === wanted) return labelValue;
  }
  return null;
};

export const buildInventory = (
  snapshot: DockerSnapshot,
  composeServices: ComposeService[]
): StoredImage[] => {
  const now = new Date().toISOString();
  const usedContainers = new Set<string>();
  const inventory: StoredImage[] = [];

  for (const service of composeServices) {
    const matches = snapshot.containers.filter((container) => {
      if (service.image) {
        return matchContainer(service.image, container, snapshot) || matchByComposeLabels(service, container);
      }
      return matchByComposeLabels(service, container);
    });
    matches.forEach((container) => usedContainers.add(container.id));
    const sourceRef = service.image
      ? parseImageRef(service.image)
      : matches[0]
        ? guessImageRef(snapshot, matches[0].imageId, matches[0].image)
        : null;
    if (!sourceRef) continue;

    const repoKey = normalizeRepoKey(sourceRef);
    const digest =
      (matches[0] ? resolveImageDigest(snapshot, matches[0].imageId) : null) ??
      resolveImageDigestByRef(snapshot, sourceRef.raw);
    const labels =
      (matches[0] ? resolveImageLabels(snapshot, matches[0].imageId) : null) ??
      resolveImageLabelsByRef(snapshot, sourceRef.raw);
    const id = makeId(repoKey, sourceRef.tag, service.stack, service.service);

    inventory.push({
      id,
      repo: sourceRef.repository,
      registry: sourceRef.registry ?? "docker.io",
      tag: sourceRef.tag,
      digest: digest,
      displayName: `${sourceRef.registry ? sourceRef.registry + "/" : ""}${sourceRef.repository}`,
      source: "compose",
      stack: service.stack,
      composeFile: service.composeFile,
      service: service.service,
      containerName: service.containerName,
      declaredDigest: sourceRef.digest ?? null,
      imageUrl: getLabelValue(labels, "org.opencontainers.image.url"),
      sourceUrl: getLabelValue(labels, "org.opencontainers.image.source"),
      webUpdateDisabled: false,
      status: statusFromContainers(matches),
      lastSeen: now,
      lastUpdateCheck: null,
      lastUpdatedAt: null,
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
    const labels = resolveImageLabels(snapshot, sample.imageId);
    const id = makeId(normalizeRepoKey(ref), ref.tag, null, null);
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
      containerName: null,
      declaredDigest: null,
      imageUrl: getLabelValue(labels, "org.opencontainers.image.url"),
      sourceUrl: getLabelValue(labels, "org.opencontainers.image.source"),
      webUpdateDisabled: false,
      status: statusFromContainers(containers),
      lastSeen: now,
      lastUpdateCheck: null,
      lastUpdatedAt: null,
      updateAvailable: null,
      updateMessage: null
    });
  }

  return inventory;
};
