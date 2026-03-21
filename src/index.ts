import express from "express";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { Db, StoredImage } from "./db.js";
import { findComposeFiles, loadComposeServices } from "./compose.js";
import { guessImageRef, loadCurrentContainerMounts, loadDockerSnapshot } from "./docker.js";
import { buildInventory } from "./inventory.js";
import { checkImageUpdate, checkImagesDryRun, mergeUpdates, pickNextImages } from "./updater.js";
import { isLocale, Locale, t } from "./i18n.js";
import { normalizeRepoKey } from "./util/parseImage.js";

const config = loadConfig();
const db = new Db(config.dataDir);
const INTERNAL_API_HEADER = "x-dockobserver-internal";
const INTERNAL_API_HEADER_VALUE = "web-ui";

type JobStatus = "running" | "success" | "failed";
type UpdateJobKind = "group" | "image";

type UpdateJob = {
  id: string;
  kind: UpdateJobKind;
  title: string;
  imageIds: string[];
  startedAt: string;
  endedAt: string | null;
  status: JobStatus;
  logs: string[];
};

const jobs = new Map<string, UpdateJob>();
const MAX_JOB_LOG_LINES = 1000;
const MAX_JOB_HISTORY = 50;
let refreshInFlight: Promise<void> | null = null;
let updatesInFlight: Promise<void> | null = null;

const getComposeMounts = async () => {
  const mounts = await loadCurrentContainerMounts(config.dockerSocketPath, [
    config.dataDir,
    config.dockerSocketPath
  ]);
  return mounts.map((mount) => ({
    hostPath: mount.source,
    containerPath: mount.destination
  })).filter((mount) => mount.hostPath === mount.containerPath);
};

const pruneJobs = () => {
  if (jobs.size <= MAX_JOB_HISTORY) return;

  const oldestFirst = Array.from(jobs.values()).sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)
  );

  for (const job of oldestFirst) {
    if (jobs.size <= MAX_JOB_HISTORY) break;
    if (job.status !== "running") jobs.delete(job.id);
  }

  // Fallback: cap hard even if many jobs are still running.
  if (jobs.size > MAX_JOB_HISTORY) {
    for (const job of oldestFirst) {
      if (jobs.size <= MAX_JOB_HISTORY) break;
      jobs.delete(job.id);
    }
  }
};

const getLocale = (): Locale => {
  const locale = db.getState().settings?.locale;
  return isLocale(locale ?? "") ? locale : config.locale;
};

const listJobs = () =>
  Array.from(jobs.values())
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, MAX_JOB_HISTORY);

const createJob = (kind: UpdateJobKind, title: string, imageIds: string[]) => {
  const id = randomUUID();
  const job: UpdateJob = {
    id,
    kind,
    title,
    imageIds,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: "running",
    logs: []
  };
  jobs.set(id, job);
  pruneJobs();
  return job;
};

const appendJobLog = (jobId: string, line: string) => {
  const job = jobs.get(jobId);
  if (!job) return;
  const stamp = new Date().toISOString();
  job.logs.push(`[${stamp}] ${line}`);
  if (job.logs.length > MAX_JOB_LOG_LINES) {
    job.logs.splice(0, job.logs.length - MAX_JOB_LOG_LINES);
  }
};

const finishJob = (jobId: string, status: JobStatus) => {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  job.endedAt = new Date().toISOString();
  pruneJobs();
};

const runCommandStreaming = async (jobId: string, cmd: string, args: string[]) => {
  appendJobLog(jobId, `$ ${cmd} ${args.join(" ")}`);
  return new Promise<number>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let outBuffer = "";
    let errBuffer = "";

    const flushLines = (buffer: string, push: (line: string) => void) => {
      const normalized = buffer.replace(/\r/g, "\n");
      const lines = normalized.split("\n");
      const rest = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) push(line);
      }
      return rest;
    };

    proc.stdout.on("data", (chunk) => {
      outBuffer += String(chunk);
      outBuffer = flushLines(outBuffer, (line) => appendJobLog(jobId, line));
    });

    proc.stderr.on("data", (chunk) => {
      errBuffer += String(chunk);
      errBuffer = flushLines(errBuffer, (line) => appendJobLog(jobId, `[stderr] ${line}`));
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (outBuffer.trim()) appendJobLog(jobId, outBuffer.trim());
      if (errBuffer.trim()) appendJobLog(jobId, `[stderr] ${errBuffer.trim()}`);
      resolve(code ?? 1);
    });
  });
};

const applyUpdateSuccess = async (ids: string[], message: string) => {
  const idSet = new Set(ids);
  const now = new Date().toISOString();
  const state = db.getState();
  db.setState({
    ...state,
    images: state.images.map((image) =>
      idSet.has(image.id)
        ? {
            ...image,
            lastUpdateCheck: now,
            lastUpdatedAt: now,
            updateAvailable: false,
            updateMessage: message
          }
        : image
    )
  });
  await db.save();
};

const applyUpdateFailure = async (ids: string[], message: string) => {
  const idSet = new Set(ids);
  const now = new Date().toISOString();
  const state = db.getState();
  db.setState({
    ...state,
    images: state.images.map((image) =>
      idSet.has(image.id)
        ? {
            ...image,
            lastUpdateCheck: now,
            updateMessage: message
          }
        : image
    )
  });
  await db.save();
};

const runComposeUpdate = async (
  jobId: string,
  composeFile: string,
  serviceNames: string[],
  pruneAfterUpdate: boolean
) => {
  if (config.dryRun) {
    appendJobLog(jobId, "DRY_RUN=true, update simulated.");
    return;
  }

  const projectDir = path.dirname(composeFile);
  const composeArgs = [
    "compose",
    "--project-directory",
    projectDir,
    "-f",
    composeFile,
    "up",
    "--pull",
    "always",
    "-d",
    ...serviceNames
  ];

  const composeCode = await runCommandStreaming(jobId, "docker", composeArgs);
  if (composeCode !== 0) throw new Error("docker compose update failed");

  if (pruneAfterUpdate) {
    const pruneCode = await runCommandStreaming(jobId, "docker", ["image", "prune", "-af"]);
    if (pruneCode !== 0) throw new Error("docker image prune failed");
  }
};

const runUnmanagedUpdate = async (jobId: string, image: StoredImage, pruneAfterUpdate: boolean) => {
  if (config.dryRun) {
    appendJobLog(jobId, "DRY_RUN=true, update simulated.");
    return;
  }

  const repoPrefix = image.registry === "docker.io" ? "" : `${image.registry}/`;
  const tag = image.tag ?? "latest";
  const imageRef = `${repoPrefix}${image.repo}:${tag}`;

  const pullCode = await runCommandStreaming(jobId, "docker", ["pull", imageRef]);
  if (pullCode !== 0) throw new Error("docker pull failed");

  if (pruneAfterUpdate) {
    const pruneCode = await runCommandStreaming(jobId, "docker", ["image", "prune", "-af"]);
    if (pruneCode !== 0) throw new Error("docker image prune failed");
  }
};

const runComposeLifecycle = async (
  jobId: string,
  composeFile: string,
  serviceNames: string[],
  action: "start" | "stop"
) => {
  if (config.dryRun) {
    appendJobLog(jobId, `DRY_RUN=true, compose ${action} simulated.`);
    return;
  }

  const projectDir = path.dirname(composeFile);
  const composeArgs = [
    "compose",
    "--project-directory",
    projectDir,
    "-f",
    composeFile,
    action,
    ...serviceNames
  ];

  const composeCode = await runCommandStreaming(jobId, "docker", composeArgs);
  if (composeCode !== 0) throw new Error(`docker compose ${action} failed`);
};

const findContainerNamesForImage = async (image: StoredImage) => {
  const snapshot = await loadDockerSnapshot(config.dockerSocketPath);
  const wantedRepo = normalizeRepoKey({
    raw: image.displayName,
    registry: image.registry === "docker.io" ? null : image.registry,
    repository: image.repo,
    tag: image.tag,
    digest: image.declaredDigest
  });
  const wantedTag = image.tag ?? "latest";

  return snapshot.containers
    .filter((container) => {
      const ref = guessImageRef(snapshot, container.imageId, container.image);
      return normalizeRepoKey(ref) === wantedRepo && (ref.tag ?? "latest") === wantedTag;
    })
    .map((container) => container.name)
    .filter(Boolean);
};

const runImageLifecycle = async (jobId: string, image: StoredImage, action: "start" | "stop") => {
  if (image.composeFile && image.service) {
    await runComposeLifecycle(jobId, image.composeFile, [image.service], action);
    return;
  }

  const containerNames = await findContainerNamesForImage(image);
  if (containerNames.length === 0) throw new Error("no matching containers found");
  if (config.dryRun) {
    appendJobLog(jobId, `DRY_RUN=true, docker ${action} simulated for ${containerNames.join(", ")}.`);
    return;
  }

  const actionCode = await runCommandStreaming(jobId, "docker", [action, ...containerNames]);
  if (actionCode !== 0) throw new Error(`docker ${action} failed`);
};

const refreshAfterTask = async (jobId: string) => {
  if (config.dryRun) {
    appendJobLog(jobId, "DRY_RUN=true, inventory refresh skipped.");
    return;
  }
  await runRefreshExclusive();
};

const logUpdateCheck = (origin: "manual" | "automatic", line: string) => {
  const locale = getLocale();
  const originLabel =
    origin === "manual" ? t(locale, "originManual") : t(locale, "originAutomatic");
  console.log(`${t(locale, "updateCheckPrefix")}[${originLabel}] ${line}`);
};

const runUpdateChecks = async (targets: StoredImage[], origin: "manual" | "automatic") => {
  const locale = getLocale();
  if (targets.length === 0) return [];

  logUpdateCheck(origin, t(locale, "startChecks", { count: targets.length }));

  if (config.dryRun) {
    const updates = checkImagesDryRun(targets);
    for (const update of updates) {
      const tag = update.tag ?? "latest";
      const result = update.updateAvailable ? t(locale, "resultUpdate") : t(locale, "resultNoUpdate");
      logUpdateCheck(
        origin,
        t(locale, "resultLine", {
          image: `${update.displayName}:${tag}`,
          result,
          detail: t(locale, "dryRunSuffix")
        })
      );
    }
    return updates;
  }

  const updates: StoredImage[] = [];
  for (const image of targets) {
    const tag = image.tag ?? "latest";
    logUpdateCheck(origin, t(locale, "checkingImage", { image: `${image.displayName}:${tag}` }));
    const update = await checkImageUpdate(image);
    const result =
      update.updateAvailable === true
        ? t(locale, "resultUpdate")
        : update.updateAvailable === false
          ? t(locale, "resultNoUpdate")
          : t(locale, "resultUnknown");
    const detail = update.updateMessage ? ` (${update.updateMessage})` : "";
    logUpdateCheck(origin, t(locale, "resultLine", { image: `${update.displayName}:${tag}`, result, detail }));
    updates.push(update);
  }

  return updates;
};

const refreshInventory = async () => {
  const snapshot = await loadDockerSnapshot(config.dockerSocketPath);
  const composeFiles = await findComposeFiles(await getComposeMounts());
  const composeServices = (await Promise.all(composeFiles.map((file) => loadComposeServices(file)))).flat();

  const inventory = buildInventory(snapshot, composeServices);
  const now = new Date().toISOString();

  const previousState = db.getState();
  const previous = previousState.images;
  const previousById = new Map(previous.map((item) => [item.id, item]));

  const stableKey = (item: StoredImage) =>
    [
      item.source,
      item.registry,
      item.repo,
      item.tag ?? "",
      item.stack ?? "",
      item.composeFile ?? "",
      item.service ?? "",
      item.containerName ?? ""
    ].join("|");

  const previousByStable = new Map<string, StoredImage[]>();
  for (const item of previous) {
    const key = stableKey(item);
    const list = previousByStable.get(key) ?? [];
    list.push(item);
    previousByStable.set(key, list);
  }

  const merged = inventory.map((item) => {
    let old = previousById.get(item.id);
    if (!old) {
      const list = previousByStable.get(stableKey(item));
      if (list && list.length > 0) {
        old = list.shift();
        if (list.length === 0) previousByStable.delete(stableKey(item));
      }
    }
    if (!old) return item;
    return {
      ...item,
      lastUpdateCheck: old.lastUpdateCheck,
      lastUpdatedAt: old.lastUpdatedAt,
      declaredDigest: old.declaredDigest ?? item.declaredDigest,
      updateAvailable: old.updateAvailable,
      updateMessage: old.updateMessage
    };
  });

  db.setState({
    images: merged,
    lastRefresh: now,
    lastAutomaticCheck: previousState.lastAutomaticCheck,
    settings: previousState.settings
  });
  await db.save();
};

const runRefreshExclusive = async () => {
  if (refreshInFlight) return refreshInFlight;
  const run = (async () => {
    await refreshInventory();
  })();
  refreshInFlight = run;
  try {
    await run;
  } finally {
    if (refreshInFlight === run) refreshInFlight = null;
  }
};

const runUpdatesExclusive = async (fn: () => Promise<void>) => {
  while (updatesInFlight) {
    await updatesInFlight;
  }
  const run = fn();
  updatesInFlight = run;
  try {
    await run;
  } finally {
    if (updatesInFlight === run) updatesInFlight = null;
  }
};

const checkUpdatesBatch = async (limit: number, origin: "manual" | "automatic") => {
  const state = db.getState();
  const targets = pickNextImages(state.images, limit);
  const now = new Date().toISOString();

  if (targets.length === 0) {
    if (origin === "automatic") {
      db.setState({ ...state, lastAutomaticCheck: now });
      await db.save();
    }
    return;
  }

  const updates = await runUpdateChecks(targets, origin);
  db.setState({
    ...state,
    lastAutomaticCheck: origin === "automatic" ? now : state.lastAutomaticCheck,
    images: mergeUpdates(state.images, updates)
  });
  await db.save();
};

const checkUpdatesForIds = async (ids: string[], origin: "manual" | "automatic") => {
  const state = db.getState();
  const targets = state.images.filter((image) => ids.includes(image.id));
  const updates = await runUpdateChecks(targets, origin);
  db.setState({
    ...state,
    images: mergeUpdates(state.images, updates)
  });
  await db.save();
};

const start = async () => {
  await db.load();
  const loaded = db.getState();
  if (!loaded.settings?.locale) {
    db.setState({
      ...loaded,
      settings: {
        locale: config.locale
      }
    });
    await db.save();
  }

  await runRefreshExclusive();

  const stateForApi = () => ({ ...db.getState(), locale: getLocale() });

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), "public")));
  app.use("/api", (req, res, next) => {
    const internalHeader = req.header(INTERNAL_API_HEADER);
    if (internalHeader !== INTERNAL_API_HEADER_VALUE) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  });

  app.get("/api/state", (_req, res) => {
    res.json(stateForApi());
  });

  app.get("/api/update-jobs", (_req, res) => {
    res.json({ jobs: listJobs() });
  });

  app.post("/api/locale", async (req, res) => {
    const localeRaw = String(req.body?.locale ?? "").trim().toLowerCase();
    if (!isLocale(localeRaw)) {
      res.status(400).json({ error: "locale must be 'de' or 'en'" });
      return;
    }
    const state = db.getState();
    db.setState({
      ...state,
      settings: {
        ...state.settings,
        locale: localeRaw
      }
    });
    await db.save();
    res.json(stateForApi());
  });

  app.post("/api/refresh", async (_req, res) => {
    try {
      await runRefreshExclusive();
      res.json(stateForApi());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "refresh failed" });
    }
  });

  app.post("/api/check-updates", async (req, res) => {
    const limit = Number(req.body?.limit ?? config.updateBatchSize);
    try {
      await runUpdatesExclusive(() =>
        checkUpdatesBatch(Number.isFinite(limit) ? limit : config.updateBatchSize, "manual")
      );
      res.json(stateForApi());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "update check failed" });
    }
  });

  app.post("/api/check-update", async (req, res) => {
    const id = String(req.body?.id ?? "");
    if (!id) {
      res.status(400).json({ error: "id missing" });
      return;
    }
    try {
      await runUpdatesExclusive(() => checkUpdatesForIds([id], "manual"));
      res.json(stateForApi());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "update check failed" });
    }
  });

  app.post("/api/update-group", async (req, res) => {
    const composeFile = String(req.body?.composeFile ?? "");
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const pruneAfterUpdate = Boolean(req.body?.pruneAfterUpdate);

    if (!composeFile || ids.length === 0) {
      res.status(400).json({ error: "composeFile and ids are required" });
      return;
    }

    const state = db.getState();
    const targets = state.images.filter(
      (image) => ids.includes(image.id) && image.composeFile === composeFile
    );
    if (targets.length === 0) {
      res.status(404).json({ error: "no matching images found" });
      return;
    }

    const stackName = targets[0]?.stack ?? path.basename(path.dirname(composeFile));
    const serviceNames = Array.from(
      new Set(targets.map((image) => image.service).filter((name): name is string => Boolean(name)))
    );

    const job = createJob("group", `Group ${stackName}`, targets.map((item) => item.id));
    appendJobLog(job.id, `queued compose update for ${serviceNames.length} service(s)`);
    res.status(202).json({ jobId: job.id });

    void (async () => {
      try {
        await runComposeUpdate(job.id, composeFile, serviceNames, pruneAfterUpdate);
        await applyUpdateSuccess(
          targets.map((item) => item.id),
          config.dryRun ? "dry-run update simulated" : "update executed"
        );
        await refreshAfterTask(job.id);
        appendJobLog(job.id, "update finished successfully");
        finishJob(job.id, "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : "group update failed";
        appendJobLog(job.id, `failed: ${message}`);
        await applyUpdateFailure(targets.map((item) => item.id), message);
        finishJob(job.id, "failed");
      }
    })();
  });

  app.post("/api/start-group", async (req, res) => {
    const composeFile = String(req.body?.composeFile ?? "");
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];

    if (!composeFile || ids.length === 0) {
      res.status(400).json({ error: "composeFile and ids are required" });
      return;
    }

    const state = db.getState();
    const targets = state.images.filter(
      (image) => ids.includes(image.id) && image.composeFile === composeFile
    );
    if (targets.length === 0) {
      res.status(404).json({ error: "no matching images found" });
      return;
    }

    const stackName = targets[0]?.stack ?? path.basename(path.dirname(composeFile));
    const serviceNames = Array.from(
      new Set(targets.map((image) => image.service).filter((name): name is string => Boolean(name)))
    );

    const job = createJob("group", `Start ${stackName}`, targets.map((item) => item.id));
    appendJobLog(job.id, `queued compose start for ${serviceNames.length} service(s)`);
    res.status(202).json({ jobId: job.id });

    void (async () => {
      try {
        await runComposeLifecycle(job.id, composeFile, serviceNames, "start");
        await refreshAfterTask(job.id);
        appendJobLog(job.id, "start finished successfully");
        finishJob(job.id, "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : "group start failed";
        appendJobLog(job.id, `failed: ${message}`);
        finishJob(job.id, "failed");
      }
    })();
  });

  app.post("/api/stop-group", async (req, res) => {
    const composeFile = String(req.body?.composeFile ?? "");
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];

    if (!composeFile || ids.length === 0) {
      res.status(400).json({ error: "composeFile and ids are required" });
      return;
    }

    const state = db.getState();
    const targets = state.images.filter(
      (image) => ids.includes(image.id) && image.composeFile === composeFile
    );
    if (targets.length === 0) {
      res.status(404).json({ error: "no matching images found" });
      return;
    }

    const stackName = targets[0]?.stack ?? path.basename(path.dirname(composeFile));
    const serviceNames = Array.from(
      new Set(targets.map((image) => image.service).filter((name): name is string => Boolean(name)))
    );

    const job = createJob("group", `Stop ${stackName}`, targets.map((item) => item.id));
    appendJobLog(job.id, `queued compose stop for ${serviceNames.length} service(s)`);
    res.status(202).json({ jobId: job.id });

    void (async () => {
      try {
        await runComposeLifecycle(job.id, composeFile, serviceNames, "stop");
        await refreshAfterTask(job.id);
        appendJobLog(job.id, "stop finished successfully");
        finishJob(job.id, "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : "group stop failed";
        appendJobLog(job.id, `failed: ${message}`);
        finishJob(job.id, "failed");
      }
    })();
  });

  app.post("/api/update-image", async (req, res) => {
    const id = String(req.body?.id ?? "");
    const pruneAfterUpdate = Boolean(req.body?.pruneAfterUpdate);
    if (!id) {
      res.status(400).json({ error: "id required" });
      return;
    }

    const state = db.getState();
    const image = state.images.find((item) => item.id === id);
    if (!image) {
      res.status(404).json({ error: "image not found" });
      return;
    }

    const job = createJob("image", `Image ${image.displayName}:${image.tag ?? "latest"}`, [image.id]);
    appendJobLog(job.id, "queued image update");
    res.status(202).json({ jobId: job.id });

    void (async () => {
      try {
        await runUnmanagedUpdate(job.id, image, pruneAfterUpdate);
        await applyUpdateSuccess([id], config.dryRun ? "dry-run update simulated" : "update executed");
        await refreshAfterTask(job.id);
        appendJobLog(job.id, "update finished successfully");
        finishJob(job.id, "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : "image update failed";
        appendJobLog(job.id, `failed: ${message}`);
        await applyUpdateFailure([id], message);
        finishJob(job.id, "failed");
      }
    })();
  });

  app.post("/api/start-image", async (req, res) => {
    const id = String(req.body?.id ?? "");
    if (!id) {
      res.status(400).json({ error: "id required" });
      return;
    }

    const state = db.getState();
    const image = state.images.find((item) => item.id === id);
    if (!image) {
      res.status(404).json({ error: "image not found" });
      return;
    }

    const job = createJob("image", `Start ${image.displayName}:${image.tag ?? "latest"}`, [image.id]);
    appendJobLog(job.id, "queued start");
    res.status(202).json({ jobId: job.id });

    void (async () => {
      try {
        await runImageLifecycle(job.id, image, "start");
        await refreshAfterTask(job.id);
        appendJobLog(job.id, "start finished successfully");
        finishJob(job.id, "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : "image start failed";
        appendJobLog(job.id, `failed: ${message}`);
        finishJob(job.id, "failed");
      }
    })();
  });

  app.post("/api/stop-image", async (req, res) => {
    const id = String(req.body?.id ?? "");
    if (!id) {
      res.status(400).json({ error: "id required" });
      return;
    }

    const state = db.getState();
    const image = state.images.find((item) => item.id === id);
    if (!image) {
      res.status(404).json({ error: "image not found" });
      return;
    }

    const job = createJob("image", `Stop ${image.displayName}:${image.tag ?? "latest"}`, [image.id]);
    appendJobLog(job.id, "queued stop");
    res.status(202).json({ jobId: job.id });

    void (async () => {
      try {
        await runImageLifecycle(job.id, image, "stop");
        await refreshAfterTask(job.id);
        appendJobLog(job.id, "stop finished successfully");
        finishJob(job.id, "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : "image stop failed";
        appendJobLog(job.id, `failed: ${message}`);
        finishJob(job.id, "failed");
      }
    })();
  });

  app.listen(config.port, () => {
    console.log(t(getLocale(), "listening", { port: config.port }));
  });

  setInterval(() => {
    if (refreshInFlight) {
      console.log("refresh skipped: previous run still active");
      return;
    }
    runRefreshExclusive().catch((err) => console.error("refresh failed", err));
  }, config.localRefreshHours * 60 * 60 * 1000);

  setInterval(() => {
    if (updatesInFlight) {
      console.log("update check skipped: previous run still active");
      return;
    }
    runUpdatesExclusive(() => checkUpdatesBatch(config.updateBatchSize, "automatic")).catch((err) =>
      console.error("update check failed", err)
    );
  }, config.updateIntervalMinutes * 60 * 1000);
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
