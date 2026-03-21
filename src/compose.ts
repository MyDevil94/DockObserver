import fs from "node:fs/promises";
import { Dirent } from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type ComposeService = {
  stack: string;
  composeFile: string;
  service: string;
  image: string | null;
  containerName: string | null;
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

const parseDotEnv = (raw: string) => {
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
};

const loadComposeEnv = async (composeFile: string) => {
  const envPath = path.join(path.dirname(composeFile), ".env");
  try {
    const raw = await fs.readFile(envPath, "utf8");
    return {
      ...parseDotEnv(raw),
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
      )
    };
  } catch {
    return Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  }
};

const resolveComposeVariables = (value: string, env: Record<string, string>) => {
  return value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const withDefaultColon = expr.match(/^([A-Za-z_][A-Za-z0-9_]*):-([\s\S]*)$/);
    if (withDefaultColon) {
      const key = withDefaultColon[1];
      const defaultValue = withDefaultColon[2];
      const resolved = env[key];
      return resolved && resolved.length > 0 ? resolved : defaultValue;
    }
    const withDefault = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)-([\s\S]*)$/);
    if (withDefault) {
      const key = withDefault[1];
      const defaultValue = withDefault[2];
      const resolved = env[key];
      return resolved !== undefined ? resolved : defaultValue;
    }
    return env[expr] ?? _match;
  });
};

const scanDir = async (root: string, results: string[], depth: number) => {
  if (depth < 0) return;
  let entries: Dirent[] = [];
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

export const findComposeFiles = async (
  mounts: {
    hostPath: string;
    containerPath: string;
  }[]
) => {
  const results: string[] = [];
  for (const mount of mounts) {
    await scanDir(mount.containerPath, results, 6);
  }
  return results;
};

export const loadComposeServices = async (composeFile: string): Promise<ComposeService[]> => {
  const raw = await fs.readFile(composeFile, "utf8");
  const env = await loadComposeEnv(composeFile);
  const doc = YAML.parse(raw) as any;
  const services = doc?.services ?? {};
  const stack = path.basename(path.dirname(composeFile));
  return Object.entries(services)
    .map(([serviceName, serviceValue]) => {
      const imageRaw = (serviceValue as any)?.image as string | undefined;
      const image = imageRaw ? resolveComposeVariables(imageRaw, env) : null;
      const containerNameRaw = (serviceValue as any)?.container_name as string | undefined;
      const containerName = containerNameRaw
        ? resolveComposeVariables(containerNameRaw, env)
        : null;
      return {
        stack,
        composeFile,
        service: serviceName,
        image,
        containerName
      };
    })
    .filter((item): item is ComposeService => Boolean(item));
};
