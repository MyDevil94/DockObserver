import express from "express";
import path from "node:path";
import { loadConfig } from "./config.js";
import { Db } from "./db.js";
import { findComposeFiles, loadComposeServices } from "./compose.js";
import { loadDockerSnapshot } from "./docker.js";
import { buildInventory } from "./inventory.js";
import { checkImageUpdate, mergeUpdates, pickNextImages } from "./updater.js";

const config = loadConfig();
const db = new Db(config.dataDir);

const refreshInventory = async () => {
  const snapshot = await loadDockerSnapshot(config.dockerSocketPath);
  const composeFiles = await findComposeFiles(config.composeMounts);
  const composeServices = (
    await Promise.all(composeFiles.map((file) => loadComposeServices(file)))
  ).flat();

  const inventory = buildInventory(snapshot, composeServices);
  const now = new Date().toISOString();

  const previous = db.getState().images;
  const previousMap = new Map(previous.map((item) => [item.id, item]));

  const merged = inventory.map((item) => {
    const old = previousMap.get(item.id);
    if (!old) return item;
    return {
      ...item,
      lastUpdateCheck: old.lastUpdateCheck,
      updateAvailable: old.updateAvailable,
      updateMessage: old.updateMessage
    };
  });

  db.setState({ images: merged, lastRefresh: now });
  await db.save();
};

const checkUpdatesBatch = async (limit: number) => {
  const state = db.getState();
  const targets = pickNextImages(state.images, limit);
  if (targets.length === 0) return;
  const updates = [];
  for (const image of targets) {
    updates.push(await checkImageUpdate(image));
  }
  db.setState({
    ...state,
    images: mergeUpdates(state.images, updates)
  });
  await db.save();
};

const checkUpdatesForIds = async (ids: string[]) => {
  const state = db.getState();
  const targets = state.images.filter((image) => ids.includes(image.id));
  const updates = [];
  for (const image of targets) {
    updates.push(await checkImageUpdate(image));
  }
  db.setState({
    ...state,
    images: mergeUpdates(state.images, updates)
  });
  await db.save();
};

const checkUpdatesForStack = async (stack: string) => {
  const state = db.getState();
  const targets = state.images.filter((image) => image.stack === stack);
  const updates = [];
  for (const image of targets) {
    updates.push(await checkImageUpdate(image));
  }
  db.setState({
    ...state,
    images: mergeUpdates(state.images, updates)
  });
  await db.save();
};

const start = async () => {
  await db.load();
  await refreshInventory();

  const app = express();
  app.use(express.json());

  const publicDir = path.join(process.cwd(), "public");
  app.use(express.static(publicDir));

  app.get("/api/state", (req, res) => {
    res.json(db.getState());
  });

  app.post("/api/refresh", async (req, res) => {
    try {
      await refreshInventory();
      res.json(db.getState());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "refresh failed" });
    }
  });

  app.post("/api/check-updates", async (req, res) => {
    const limit = Number(req.body?.limit ?? config.updateBatchSize);
    try {
      await checkUpdatesBatch(Number.isFinite(limit) ? limit : config.updateBatchSize);
      res.json(db.getState());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "update check failed" });
    }
  });

  app.post("/api/check-update/:id", async (req, res) => {
    try {
      await checkUpdatesForIds([req.params.id]);
      res.json(db.getState());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "update check failed" });
    }
  });

  app.post("/api/check-group", async (req, res) => {
    const stack = String(req.body?.stack ?? "");
    if (!stack) {
      res.status(400).json({ error: "stack missing" });
      return;
    }
    try {
      await checkUpdatesForStack(stack);
      res.json(db.getState());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "update check failed" });
    }
  });

  app.listen(config.port, () => {
    console.log(`DockObserver listening on ${config.port}`);
  });

  setInterval(() => {
    refreshInventory().catch((err) => console.error("refresh failed", err));
  }, config.localRefreshHours * 60 * 60 * 1000);

  setInterval(() => {
    checkUpdatesBatch(config.updateBatchSize).catch((err) => console.error("update check failed", err));
  }, config.updateIntervalMinutes * 60 * 1000);
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
