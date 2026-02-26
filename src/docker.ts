import Docker from "dockerode";
import { parseImageRef } from "./util/parseImage.js";

export type ContainerSnapshot = {
  id: string;
  name: string;
  image: string;
  imageId: string;
  state: "running" | "stopped" | "paused" | "unknown";
};

export type ImageSnapshot = {
  id: string;
  repoTags: string[];
  repoDigests: string[];
};

export type DockerSnapshot = {
  containers: ContainerSnapshot[];
  images: ImageSnapshot[];
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
  const containersRaw = await docker.listContainers({ all: true });
  const imagesRaw = await docker.listImages();

  const containers: ContainerSnapshot[] = containersRaw.map((item) => ({
    id: item.Id,
    name: (item.Names?.[0] ?? "").replace(/^\//, ""),
    image: item.Image,
    imageId: item.ImageID,
    state: mapState(item.State)
  }));

  const images: ImageSnapshot[] = imagesRaw.map((item) => ({
    id: item.Id,
    repoTags: item.RepoTags ?? [],
    repoDigests: item.RepoDigests ?? []
  }));

  return { containers, images };
};

export const resolveImageDigest = (snapshot: DockerSnapshot, imageId: string) => {
  const image = snapshot.images.find((item) => item.id === imageId);
  if (!image) return null;
  const digest = image.repoDigests[0];
  return digest ?? null;
};

export const guessImageRef = (snapshot: DockerSnapshot, imageId: string, imageName: string) => {
  const image = snapshot.images.find((item) => item.id === imageId);
  const candidate = image?.repoTags?.[0] ?? imageName;
  return parseImageRef(candidate);
};
