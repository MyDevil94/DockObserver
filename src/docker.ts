import Docker from "dockerode";
import { normalizeRepoKey, parseImageRef } from "./util/parseImage.js";

export type ContainerSnapshot = {
  id: string;
  name: string;
  image: string;
  imageId: string;
  labels: Record<string, string>;
  state: "running" | "stopped" | "paused" | "unknown";
};

export type ImageSnapshot = {
  id: string;
  repoTags: string[];
  repoDigests: string[];
  labels: Record<string, string>;
};

export type DockerSnapshot = {
  containers: ContainerSnapshot[];
  images: ImageSnapshot[];
};

export type ContainerMount = {
  type: string;
  source: string;
  destination: string;
  readOnly: boolean;
};

type RawContainer = {
  Id: string;
  Names?: string[];
  Image: string;
  ImageID: string;
  Labels?: Record<string, string>;
  State?: string;
};

type RawImage = {
  Id: string;
  RepoTags?: string[];
  RepoDigests?: string[];
  Labels?: Record<string, string>;
};

type RawMount = {
  Type?: string;
  Source?: string;
  Destination?: string;
  RW?: boolean;
};

const mapState = (state?: string): ContainerSnapshot["state"] => {
  if (!state) return "unknown";
  const lower = state.toLowerCase();
  if (lower === "running") return "running";
  if (lower === "paused") return "paused";
  return "stopped";
};

export const loadDockerSnapshot = async (socketPath: string): Promise<DockerSnapshot> => {
  const docker = new Docker({ socketPath });
  const containersRaw = (await docker.listContainers({ all: true })) as RawContainer[];
  const imagesRaw = (await docker.listImages()) as RawImage[];

  const containers: ContainerSnapshot[] = containersRaw.map((item: RawContainer) => ({
    id: item.Id,
    name: (item.Names?.[0] ?? "").replace(/^\//, ""),
    image: item.Image,
    imageId: item.ImageID,
    labels: item.Labels ?? {},
    state: mapState(item.State)
  }));

  const images: ImageSnapshot[] = imagesRaw.map((item: RawImage) => ({
    id: item.Id,
    repoTags: item.RepoTags ?? [],
    repoDigests: item.RepoDigests ?? [],
    labels: item.Labels ?? {}
  }));

  return { containers, images };
};

export const loadCurrentContainerMounts = async (
  socketPath: string,
  ignoredDestinations: string[]
): Promise<ContainerMount[]> => {
  const containerId = process.env.HOSTNAME?.trim();
  if (!containerId) return [];

  const docker = new Docker({ socketPath });
  try {
    const inspected = (await docker.getContainer(containerId).inspect()) as {
      Mounts?: RawMount[];
    };
    const ignored = new Set(ignoredDestinations);
    return (inspected.Mounts ?? [])
      .map((mount) => ({
        type: mount.Type ?? "",
        source: mount.Source ?? "",
        destination: mount.Destination ?? "",
        readOnly: mount.RW === false
      }))
      .filter(
        (mount) =>
          mount.type === "bind" &&
          mount.source &&
          mount.destination &&
          !ignored.has(mount.destination)
      );
  } catch {
    return [];
  }
};

export const resolveImageDigest = (snapshot: DockerSnapshot, imageId: string) => {
  const image = snapshot.images.find((item) => item.id === imageId);
  if (!image) return null;
  const digest = image.repoDigests[0];
  return digest ?? null;
};

const findImageByRef = (snapshot: DockerSnapshot, refRaw: string) => {
  const ref = parseImageRef(refRaw);
  const wantedRepo = normalizeRepoKey(ref);
  const wantedTag = ref.tag ?? "latest";

  return snapshot.images.find((image) =>
    image.repoTags.some((repoTag) => {
      const parsedTag = parseImageRef(repoTag);
      return normalizeRepoKey(parsedTag) === wantedRepo && (parsedTag.tag ?? "latest") === wantedTag;
    })
  );
};

export const resolveImageDigestByRef = (snapshot: DockerSnapshot, refRaw: string) => {
  const image = findImageByRef(snapshot, refRaw);
  if (!image) return null;
  const digest = image.repoDigests[0];
  return digest ?? null;
};

export const resolveImageLabels = (snapshot: DockerSnapshot, imageId: string) => {
  const image = snapshot.images.find((item) => item.id === imageId);
  if (!image) return {};
  return image.labels;
};

export const resolveImageLabelsByRef = (snapshot: DockerSnapshot, refRaw: string) => {
  const image = findImageByRef(snapshot, refRaw);
  if (!image) return {};
  return image.labels;
};

export const guessImageRef = (snapshot: DockerSnapshot, imageId: string, imageName: string) => {
  const image = snapshot.images.find((item) => item.id === imageId);
  const imageNameClean = imageName.trim();
  const hasNamedImage = imageNameClean.length > 0 && imageNameClean !== "<none>";
  const candidate = hasNamedImage ? imageNameClean : image?.repoTags?.[0] ?? imageName;
  return parseImageRef(candidate);
};

type PullCheckResult = {
  beforeDigest: string | null;
  afterDigest: string | null;
  pullOutput: string;
  pullFailed: boolean;
};

const normalizeDigest = (digest: string | null) => {
  if (!digest) return null;
  return digest.includes(":") ? digest.split(":")[1] : digest;
};

const findDigestForRef = (repoDigests: string[], refRaw: string) => {
  const parsed = parseImageRef(refRaw);
  const wantedRepo = normalizeRepoKey(parsed);
  const found = repoDigests.find((item) => {
    const digestRef = parseImageRef(item);
    return normalizeRepoKey(digestRef) === wantedRepo;
  });
  return found ? normalizeDigest(found.split("@")[1] ?? null) : null;
};

const inspectDigestByRef = async (docker: Docker, refRaw: string) => {
  try {
    const inspected = (await docker.getImage(refRaw).inspect()) as { RepoDigests?: string[] };
    return findDigestForRef(inspected.RepoDigests ?? [], refRaw);
  } catch {
    return null;
  }
};

export const pullImageLikeCompose = async (
  socketPath: string,
  refRaw: string
): Promise<PullCheckResult> => {
  const docker = new Docker({ socketPath });
  const beforeDigest = await inspectDigestByRef(docker, refRaw);

  const messages: string[] = [];
  try {
    const stream = await docker.pull(refRaw);
    await new Promise<void>((resolve, reject) => {
      (docker as any).modem.followProgress(
        stream,
        (err: unknown) => (err ? reject(err) : resolve()),
        (event: { status?: string; id?: string; error?: string }) => {
          if (!event) return;
          if (event.error) messages.push(event.error);
          else if (event.status) messages.push(event.id ? `${event.id}: ${event.status}` : event.status);
        }
      );
    });
  } catch (err) {
    messages.push(err instanceof Error ? err.message : "pull failed");
    return {
      beforeDigest,
      afterDigest: beforeDigest,
      pullOutput: messages.join(" | "),
      pullFailed: true
    };
  }

  const afterDigest = await inspectDigestByRef(docker, refRaw);
  return {
    beforeDigest,
    afterDigest,
    pullOutput: messages.join(" | "),
    pullFailed: false
  };
};
