import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export type ComposeService = {
  stack: string;
  composeFile: string;
  service: string;
  image: string;
};

const COMPOSE_FILENAMES = new Set([
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml"
]);

const shouldSkipDir = (name: string) => {
  return name === "node_modules" || name.startsWith(".");
};

const scanDir = async (root: string, results: string[], depth: number) => {
  if (depth < 0) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        await scanDir(fullPath, results, depth - 1);
      }
    } else if (entry.isFile()) {
      if (COMPOSE_FILENAMES.has(entry.name)) {
        results.push(fullPath);
      }
    }
  }
};

export const findComposeFiles = async (mounts: string[]) => {
  const results: string[] = [];
  for (const mount of mounts) {
    await scanDir(mount, results, 6);
  }
  return results;
};

export const loadComposeServices = async (composeFile: string): Promise<ComposeService[]> => {
  const raw = await fs.readFile(composeFile, "utf8");
  const doc = YAML.parse(raw) as any;
  const services = doc?.services ?? {};
  const stack = path.basename(path.dirname(composeFile));
  return Object.entries(services)
    .map(([serviceName, serviceValue]) => {
      const image = (serviceValue as any)?.image as string | undefined;
      if (!image) return null;
      return {
        stack,
        composeFile,
        service: serviceName,
        image
      };
    })
    .filter((item): item is ComposeService => Boolean(item));
};
