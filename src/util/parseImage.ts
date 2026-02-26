export type ImageRef = {
  raw: string;
  registry: string | null;
  repository: string;
  tag: string | null;
  digest: string | null;
};

const splitDigest = (value: string) => {
  const parts = value.split("@", 2);
  if (parts.length === 2) {
    return { name: parts[0], digest: parts[1] };
  }
  return { name: value, digest: null };
};

const splitTag = (value: string) => {
  const lastColon = value.lastIndexOf(":");
  const lastSlash = value.lastIndexOf("/");
  if (lastColon > lastSlash) {
    return { name: value.slice(0, lastColon), tag: value.slice(lastColon + 1) };
  }
  return { name: value, tag: null };
};

export const parseImageRef = (raw: string): ImageRef => {
  const trimmed = raw.trim();
  const { name: nameWithTag, digest } = splitDigest(trimmed);
  const { name, tag } = splitTag(nameWithTag);
  const firstSlash = name.indexOf("/");
  let registry: string | null = null;
  let repository = name;
  if (firstSlash > 0) {
    const firstPart = name.slice(0, firstSlash);
    if (firstPart.includes(".") || firstPart.includes(":")) {
      registry = firstPart;
      repository = name.slice(firstSlash + 1);
    }
  }
  if (!repository) {
    repository = name;
  }
  return { raw: trimmed, registry, repository, tag, digest };
};

export const formatDigestShort = (digest: string | null) => {
  if (!digest) return "";
  const clean = digest.includes(":") ? digest.split(":")[1] : digest;
  if (clean.length <= 12) return clean;
  return `${clean.slice(0, 5)}...${clean.slice(-5)}`;
};

export const normalizeRepoKey = (ref: ImageRef) => {
  const registry = ref.registry ?? "docker.io";
  return `${registry}/${ref.repository}`.toLowerCase();
};
