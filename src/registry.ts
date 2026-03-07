import { ImageRef, normalizeRepoKey } from "./util/parseImage.js";

export type RegistryCheckResult = {
  remoteDigest: string | null;
  error: string | null;
};

const DOCKER_HUB_REGISTRY = "registry-1.docker.io";

const ensureDockerHubRepo = (repository: string) => {
  if (repository.includes("/")) return repository;
  return `library/${repository}`;
};

const getDockerHubToken = async (repo: string) => {
  const url = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`auth ${res.status}`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("missing token");
  return data.token;
};

type BearerChallenge = {
  realm: string;
  service: string | null;
  scope: string | null;
};

const parseBearerChallenge = (header: string | null): BearerChallenge | null => {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const attrs = trimmed.slice(7);
  const matches = attrs.match(/([a-zA-Z]+)="([^"]*)"/g) ?? [];
  const values = new Map<string, string>();
  for (const match of matches) {
    const parts = match.match(/^([a-zA-Z]+)="([^"]*)"$/);
    if (!parts) continue;
    values.set(parts[1].toLowerCase(), parts[2]);
  }
  const realm = values.get("realm");
  if (!realm) return null;
  return {
    realm,
    service: values.get("service") ?? null,
    scope: values.get("scope") ?? null
  };
};

const getBearerToken = async (challenge: BearerChallenge, fallbackScope: string) => {
  const tokenUrl = new URL(challenge.realm);
  if (challenge.service) tokenUrl.searchParams.set("service", challenge.service);
  tokenUrl.searchParams.set("scope", challenge.scope ?? fallbackScope);
  const res = await fetch(tokenUrl.toString());
  if (!res.ok) {
    throw new Error(`auth ${res.status}`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("missing token");
  return data.token;
};

export const getRemoteDigest = async (image: ImageRef): Promise<RegistryCheckResult> => {
  const registry = image.registry ?? "docker.io";
  const tag = image.tag ?? "latest";
  let repo = image.repository;
  let registryHost = registry;
  const digestAccept =
    "application/vnd.docker.distribution.manifest.v2+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.oci.image.index.v1+json";
  let headers: Record<string, string> = {
    Accept: digestAccept
  };

  if (registry === "docker.io") {
    registryHost = DOCKER_HUB_REGISTRY;
    repo = ensureDockerHubRepo(repo);
    const token = await getDockerHubToken(repo);
    headers = {
      ...headers,
      Authorization: `Bearer ${token}`
    };
  }

  const url = `https://${registryHost}/v2/${repo}/manifests/${tag}`;
  let res = await fetch(url, { method: "HEAD", headers });

  if (res.status === 401 && registry !== "docker.io") {
    const challenge = parseBearerChallenge(res.headers.get("www-authenticate"));
    if (challenge) {
      try {
        const fallbackScope = `repository:${repo}:pull`;
        const token = await getBearerToken(challenge, fallbackScope);
        res = await fetch(url, {
          method: "HEAD",
          headers: {
            ...headers,
            Authorization: `Bearer ${token}`
          }
        });
      } catch (err) {
        return {
          remoteDigest: null,
          error: err instanceof Error ? err.message : "auth failed"
        };
      }
    }
  }

  if ((!res.ok || !res.headers.get("docker-content-digest")) && (res.status === 404 || res.status === 405 || res.ok)) {
    // Some registries/tags return digest only reliably on GET.
    res = await fetch(url, { method: "GET", headers });
  }

  if (!res.ok) {
    return { remoteDigest: null, error: `registry ${res.status} (${registryHost})` };
  }
  const digest = res.headers.get("docker-content-digest");
  return { remoteDigest: digest, error: digest ? null : "missing digest" };
};

export const buildRegistryUrl = (image: ImageRef) => {
  const registry = image.registry ?? "docker.io";
  const repoKey = normalizeRepoKey(image);
  if (registry === "docker.io") {
    const repoPath = image.repository.includes("/")
      ? image.repository
      : `library/${image.repository}`;
    return `https://hub.docker.com/r/${repoPath}`;
  }
  if (registry === "ghcr.io") {
    return `https://github.com/${image.repository}`;
  }
  return `https://${registry}/${image.repository}`;
};
