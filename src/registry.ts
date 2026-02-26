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

export const getRemoteDigest = async (image: ImageRef): Promise<RegistryCheckResult> => {
  const registry = image.registry ?? "docker.io";
  const tag = image.tag ?? "latest";
  let repo = image.repository;
  let registryHost = registry;
  let headers: Record<string, string> = {
    Accept: "application/vnd.docker.distribution.manifest.v2+json"
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
  const res = await fetch(url, { method: "HEAD", headers });
  if (!res.ok) {
    return { remoteDigest: null, error: `registry ${res.status}` };
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
