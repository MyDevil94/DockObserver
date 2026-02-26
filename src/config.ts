export type Config = {
  dataDir: string;
  dockerSocketPath: string;
  composeMounts: string[];
  localRefreshHours: number;
  updateIntervalMinutes: number;
  updateBatchSize: number;
  port: number;
};

const parseNumber = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
};

const parseList = (value: string | undefined) => {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

export const loadConfig = (): Config => {
  return {
    dataDir: process.env.DATA_DIR ?? "/data",
    dockerSocketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock",
    composeMounts: parseList(process.env.COMPOSE_MOUNTS),
    localRefreshHours: parseNumber(process.env.LOCAL_REFRESH_HOURS, 6),
    updateIntervalMinutes: parseNumber(process.env.UPDATE_INTERVAL_MINUTES, 30),
    updateBatchSize: parseNumber(process.env.UPDATE_BATCH_SIZE, 5),
    port: parseNumber(process.env.PORT, 8080)
  };
};
