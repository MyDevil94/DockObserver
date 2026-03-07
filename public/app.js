const groupsEl = document.getElementById("groups");
const refreshBtn = document.getElementById("refreshBtn");
const batchBtn = document.getElementById("batchBtn");
const localeSelectEl = document.getElementById("localeSelect");
const lastRefreshEl = document.getElementById("lastRefresh");
const lastAutomaticCheckEl = document.getElementById("lastAutomaticCheck");
const countEl = document.getElementById("count");

const modalEl = document.getElementById("confirmModal");
const modalBackdropEl = document.getElementById("modalBackdrop");
const modalTitleEl = document.getElementById("modalTitle");
const modalTextEl = document.getElementById("modalText");
const modalItemsEl = document.getElementById("modalItems");
const modalPruneEl = document.getElementById("modalPrune");
const modalCancelEl = document.getElementById("modalCancel");
const modalConfirmEl = document.getElementById("modalConfirm");

const consoleModalEl = document.getElementById("consoleModal");
const consoleBackdropEl = document.getElementById("consoleBackdrop");
const consoleCloseEl = document.getElementById("consoleClose");
const consoleTabsEl = document.getElementById("consoleTabs");
const consoleOutputEl = document.getElementById("consoleOutput");
const heroTitleEl = document.getElementById("heroTitle");
const heroSubtitleEl = document.getElementById("heroSubtitle");
const modalPruneLabelEl = document.getElementById("modalPruneLabel");
const consoleTitleEl = document.getElementById("consoleTitle");

let appState = { images: [], lastRefresh: null, lastAutomaticCheck: null, locale: "de" };
let jobsState = [];
let modalState = null;
let consoleState = { open: false, selectedJobId: null };

const I18N = {
  de: {
    heroTitle: "Container Updates im Blick",
    heroSubtitle: "Socket + Compose scan, kompakte Status-Ansicht, gezielte Update-Checks.",
    refresh: "Lokal neu einlesen",
    batchCheck: "Batch Update-Check",
    lastLocalScan: "Letzter lokaler Scan: {value}",
    lastAutomaticCheck: "Letzter automatischer Check: {value}",
    imagesCount: "{count} Images",
    unmanaged: "Unmanaged",
    compose: "Compose",
    checkUpdates: "Auf Update pruefen",
    runUpdate: "Update ausfuehren",
    updateForGroup: "Update fuer Gruppe {name}",
    groupUpdateText: "Folgende Services haben ein Update. Auswahl optional anpassen.",
    updateChip: "Update",
    imageLabel: "Image: {name}",
    tagLabel: "Tag: {value}",
    digestLabel: "Digest: {value}",
    lastCheck: "Letzter Check: {value}",
    lastUpdated: "Zuletzt aktualisiert: {value}",
    chipLastCheck: "Letzter Check: {value}",
    chipLastUpdated: "Zuletzt aktualisiert: {value}",
    checkNow: "Jetzt pruefen",
    unmanagedUpdateTitle: "Unmanaged Image updaten",
    unmanagedUpdateText: "Das Image wird per docker pull aktualisiert.",
    url: "URL",
    code: "Code",
    changelog: "Changelog",
    chooseOne: "Bitte mindestens einen Eintrag auswaehlen.",
    updateFailed: "Update fehlgeschlagen",
    checkFailed: "Check fehlgeschlagen",
    confirmUpdate: "Update bestaetigen",
    pruneLabel: "Image prune nach Update ausfuehren (`docker image prune -af`)",
    cancel: "Abbrechen",
    startUpdate: "Update starten",
    updateConsole: "Update Konsole",
    close: "Schliessen",
    noJobs: "Keine Update-Jobs.",
    running: "running {seconds}s",
    job: "Job: {value}",
    status: "Status: {value}",
    start: "Start: {value}",
    end: "Ende: {value}",
    busyTitle: "Update laeuft ({scope}). Konsole oeffnen",
    scopeGroup: "Gruppe",
    scopeImage: "Image"
  },
  en: {
    heroTitle: "Container Updates at a Glance",
    heroSubtitle: "Socket + Compose scan, compact status view, targeted update checks.",
    refresh: "Rescan Local",
    batchCheck: "Batch Update Check",
    lastLocalScan: "Last local scan: {value}",
    lastAutomaticCheck: "Last automatic check: {value}",
    imagesCount: "{count} images",
    unmanaged: "Unmanaged",
    compose: "Compose",
    checkUpdates: "Check for updates",
    runUpdate: "Run update",
    updateForGroup: "Update group {name}",
    groupUpdateText: "The following services have updates. You can adjust selection.",
    updateChip: "Update",
    imageLabel: "Image: {name}",
    tagLabel: "Tag: {value}",
    digestLabel: "Digest: {value}",
    lastCheck: "Last check: {value}",
    lastUpdated: "Last updated: {value}",
    chipLastCheck: "Last check: {value}",
    chipLastUpdated: "Last updated: {value}",
    checkNow: "Check now",
    unmanagedUpdateTitle: "Update unmanaged image",
    unmanagedUpdateText: "The image will be updated via docker pull.",
    url: "URL",
    code: "Code",
    changelog: "Changelog",
    chooseOne: "Please select at least one entry.",
    updateFailed: "Update failed",
    checkFailed: "Check failed",
    confirmUpdate: "Confirm update",
    pruneLabel: "Run image prune after update (`docker image prune -af`)",
    cancel: "Cancel",
    startUpdate: "Start update",
    updateConsole: "Update Console",
    close: "Close",
    noJobs: "No update jobs.",
    running: "running {seconds}s",
    job: "Job: {value}",
    status: "Status: {value}",
    start: "Start: {value}",
    end: "End: {value}",
    busyTitle: "Update running ({scope}). Open console",
    scopeGroup: "group",
    scopeImage: "image"
  }
};

const currentLocale = () => (appState.locale === "en" ? "en" : "de");
const t = (key, vars = {}) => {
  const locale = currentLocale();
  const table = I18N[locale] ?? I18N.de;
  const fallback = I18N.de[key] ?? key;
  const template = table[key] ?? fallback;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name) => {
    const value = vars[name];
    return value === undefined ? "" : String(value);
  });
};

const shortDigest = (digest) => {
  if (!digest) return "-";
  const clean = digest.includes(":") ? digest.split(":")[1] : digest;
  if (clean.length <= 12) return clean;
  return `${clean.slice(0, 5)}...${clean.slice(-5)}`;
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(currentLocale());
};

const normalizeUrl = (value) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("github.com/")) return `https://${trimmed}`;
  return null;
};

const getChangelogUrl = (image) => {
  const explicit = normalizeUrl(image.changelogUrl);
  if (explicit) return explicit;
  const source = normalizeUrl(image.sourceUrl);
  if (!source || !source.includes("github.com/")) return null;
  const clean = source.endsWith("/") ? source.slice(0, -1) : source;
  const withoutGit = clean.endsWith(".git") ? clean.slice(0, -4) : clean;
  return `${withoutGit}/releases`;
};

const sameUrl = (a, b) => {
  if (!a || !b) return false;
  const normalize = (value) => {
    const noHash = value.split("#")[0];
    const noQuery = noHash.split("?")[0];
    return noQuery.endsWith("/") ? noQuery.slice(0, -1) : noQuery;
  };
  return normalize(a) === normalize(b);
};

const elapsedSeconds = (startedAt) => {
  const ms = Date.now() - Date.parse(startedAt);
  return Math.max(0, Math.floor(ms / 1000));
};

const runningJobs = () => jobsState.filter((job) => job.status === "running");

const jobsForImage = (imageId) => runningJobs().filter((job) => job.imageIds.includes(imageId));

const jobsForGroup = (images) => {
  const ids = new Set(images.map((item) => item.id));
  return runningJobs().filter((job) => job.imageIds.some((id) => ids.has(id)));
};

const groupImages = (images) => {
  const grouped = new Map();
  images.forEach((image) => {
    const key = image.composeFile ? `compose:${image.composeFile}` : "__unmanaged__";
    const list = grouped.get(key) ?? [];
    list.push(image);
    grouped.set(key, list);
  });
  return grouped;
};

const postJson = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

const fetchState = async () => {
  const res = await fetch("/api/state");
  appState = await res.json();
};

const fetchJobs = async () => {
  const res = await fetch("/api/update-jobs");
  const data = await res.json();
  jobsState = data.jobs ?? [];
};

const closeModal = () => {
  modalState = null;
  modalEl.classList.add("hidden");
  modalItemsEl.innerHTML = "";
  modalPruneEl.checked = false;
};

const openModal = (state) => {
  modalState = state;
  modalEl.classList.remove("hidden");
  modalTitleEl.textContent = state.title;
  modalTextEl.textContent = state.text;
  modalItemsEl.innerHTML = "";

  state.items.forEach((item) => {
    const label = document.createElement("label");
    label.className = "modal-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = item.id;
    checkbox.checked = item.checked ?? true;
    checkbox.dataset.modalItem = "1";
    const text = document.createElement("span");
    text.textContent = item.label;
    label.appendChild(checkbox);
    label.appendChild(text);
    modalItemsEl.appendChild(label);
  });
};

const closeConsole = () => {
  consoleState.open = false;
  consoleModalEl.classList.add("hidden");
};

const openConsole = (jobId) => {
  consoleState.open = true;
  consoleState.selectedJobId = jobId;
  consoleModalEl.classList.remove("hidden");
  renderConsole();
};

const renderConsole = () => {
  if (!consoleState.open) return;
  consoleModalEl.classList.remove("hidden");

  const sorted = [...jobsState].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const running = sorted.filter((job) => job.status === "running");
  const selectedHistory = sorted.find((job) => job.id === consoleState.selectedJobId);
  const jobs = selectedHistory && !running.some((job) => job.id === selectedHistory.id)
    ? [selectedHistory, ...running]
    : running;

  if (jobs.length === 0) {
    consoleTabsEl.innerHTML = "";
    consoleOutputEl.textContent = t("noJobs");
    return;
  }

  if (!jobs.some((job) => job.id === consoleState.selectedJobId)) {
    consoleState.selectedJobId = jobs[0].id;
  }

  consoleTabsEl.innerHTML = "";
  jobs.forEach((job) => {
    const tab = document.createElement("button");
    tab.className = `console-tab ${job.id === consoleState.selectedJobId ? "active" : ""}`;
    const elapsed = elapsedSeconds(job.startedAt);
    const status = job.status === "running" ? t("running", { seconds: elapsed }) : job.status;
    tab.textContent = `${job.title} (${status})`;
    tab.addEventListener("click", () => {
      consoleState.selectedJobId = job.id;
      renderConsole();
    });
    consoleTabsEl.appendChild(tab);
  });

  const selected = jobs.find((job) => job.id === consoleState.selectedJobId) ?? jobs[0];
  const head = [
    t("job", { value: selected.title }),
    t("status", { value: selected.status }),
    t("start", { value: formatDate(selected.startedAt) }),
    t("end", { value: formatDate(selected.endedAt) }),
    ""
  ].join("\n");
  const logs = selected.logs?.join("\n") ?? "";
  consoleOutputEl.textContent = `${head}${logs}`;
  consoleOutputEl.scrollTop = consoleOutputEl.scrollHeight;
};

const createBusyOverlay = (jobs, scopeLabel) => {
  if (jobs.length === 0) return null;
  const overlay = document.createElement("div");
  overlay.className = "busy-overlay";

  const first = jobs[0];
  const btn = document.createElement("button");
  btn.className = "busy-btn";
  btn.title = t("busyTitle", { scope: scopeLabel });
  btn.innerHTML = `<span class="busy-ring"></span><strong>${elapsedSeconds(first.startedAt)}s</strong><span>${jobs.length > 1 ? `+${jobs.length - 1}` : "..."}</span>`;
  btn.addEventListener("click", () => openConsole(first.id));

  overlay.appendChild(btn);
  return overlay;
};

const applyStaticTexts = () => {
  document.documentElement.lang = currentLocale();
  localeSelectEl.value = currentLocale();
  heroTitleEl.textContent = t("heroTitle");
  heroSubtitleEl.textContent = t("heroSubtitle");
  refreshBtn.textContent = t("refresh");
  batchBtn.textContent = t("batchCheck");
  modalPruneLabelEl.lastChild.textContent = ` ${t("pruneLabel")}`;
  modalCancelEl.textContent = t("cancel");
  modalConfirmEl.textContent = t("startUpdate");
  consoleTitleEl.textContent = t("updateConsole");
  consoleCloseEl.textContent = t("close");
};

const render = () => {
  applyStaticTexts();
  const images = appState.images ?? [];
  lastRefreshEl.textContent = t("lastLocalScan", { value: formatDate(appState.lastRefresh) });
  lastAutomaticCheckEl.textContent = t("lastAutomaticCheck", {
    value: formatDate(appState.lastAutomaticCheck)
  });
  countEl.textContent = t("imagesCount", { count: images.length });
  groupsEl.innerHTML = "";

  const grouped = groupImages(images);
  grouped.forEach((imagesInGroup, groupKey) => {
    const isUnmanaged = groupKey === "__unmanaged__";
    const groupEl = document.createElement("section");
    groupEl.className = "group";

    const groupHeader = document.createElement("header");
    const title = document.createElement("div");
    title.innerHTML = `<div class="group-title">${isUnmanaged ? t("unmanaged") : imagesInGroup[0]?.stack ?? t("compose")}</div>`;
    const sample = imagesInGroup[0];
    if (sample?.composeFile) {
      const pathEl = document.createElement("div");
      pathEl.className = "group-path";
      pathEl.textContent = sample.composeFile;
      title.appendChild(pathEl);
    }

    const actions = document.createElement("div");
    actions.className = "group-actions";
    const groupBusyJobs = jobsForGroup(imagesInGroup);
    const groupBusy = groupBusyJobs.length > 0;
    const groupHasUpdateJob = groupBusyJobs.some((job) => job.kind === "group" && job.status === "running");

    const groupCheckBtn = document.createElement("button");
    groupCheckBtn.textContent = t("checkUpdates");
    groupCheckBtn.disabled = groupBusy;
    groupCheckBtn.addEventListener("click", async () => {
      groupCheckBtn.disabled = true;
      try {
        for (const image of imagesInGroup) {
          await postJson("/api/check-update", { id: image.id });
        }
        await fetchState();
        render();
      } catch (err) {
        alert(err instanceof Error ? err.message : t("checkFailed"));
      } finally {
        groupCheckBtn.disabled = false;
      }
    });
    actions.appendChild(groupCheckBtn);

    const groupUpdates = imagesInGroup.filter((image) => image.updateAvailable && image.composeFile);
    if (!isUnmanaged && groupUpdates.length > 0 && sample?.composeFile) {
      const groupUpdateBtn = document.createElement("button");
      groupUpdateBtn.className = "update-btn";
      groupUpdateBtn.textContent = t("runUpdate");
      groupUpdateBtn.disabled = groupBusy;
      groupUpdateBtn.addEventListener("click", () => {
        openModal({
          title: t("updateForGroup", { name: sample.stack ?? t("compose") }),
          text: t("groupUpdateText"),
          items: imagesInGroup
            .filter((image) => image.composeFile)
            .map((image) => ({
            id: image.id,
            label: `${image.containerName ?? image.service ?? image.displayName} (${image.displayName}:${image.tag ?? "latest"})`,
            checked: Boolean(image.updateAvailable)
          })),
          onConfirm: async (selectedIds, pruneAfterUpdate) => {
            const result = await postJson("/api/update-group", {
              composeFile: sample.composeFile,
              ids: selectedIds,
              pruneAfterUpdate
            });
            if (result?.jobId) openConsole(result.jobId);
            await fetchJobs();
            await fetchState();
          }
        });
      });
      actions.appendChild(groupUpdateBtn);
    }

    groupHeader.appendChild(title);
    groupHeader.appendChild(actions);

    const list = document.createElement("div");
    list.className = "image-list";

    imagesInGroup.forEach((image) => {
      const card = document.createElement("div");
      card.className = `image-card ${image.updateAvailable ? "update" : ""}`;

      const top = document.createElement("div");
      top.className = "image-top";

      const nameWrap = document.createElement("div");
      nameWrap.className = "image-name-wrap";
      const name = document.createElement("div");
      name.className = "image-name";
      name.textContent = image.containerName ?? image.displayName;
      nameWrap.appendChild(name);

      const infoChips = document.createElement("div");
      infoChips.className = "image-info-chips";

      const lastCheckChip = document.createElement("span");
      lastCheckChip.className = "info-chip";
      lastCheckChip.textContent = t("chipLastCheck", { value: formatDate(image.lastUpdateCheck) });
      infoChips.appendChild(lastCheckChip);

      const lastUpdatedChip = document.createElement("span");
      lastUpdatedChip.className = "info-chip";
      lastUpdatedChip.textContent = t("chipLastUpdated", { value: formatDate(image.lastUpdatedAt) });
      infoChips.appendChild(lastUpdatedChip);

      nameWrap.appendChild(infoChips);
      top.appendChild(nameWrap);

      const status = document.createElement("div");
      status.className = "status";
      status.innerHTML = `${image.updateAvailable ? `<span class="update-chip">${t("updateChip")}</span>` : ""}<span class="status-dot ${image.status}"></span>${image.status}`;
      top.appendChild(status);

      const meta = document.createElement("div");
      meta.className = "image-meta";
      const imageNameLabel = image.containerName ? t("imageLabel", { name: image.displayName }) : "";
      const projectUrl = normalizeUrl(image.imageUrl);
      const sourceUrl = normalizeUrl(image.sourceUrl);
      meta.innerHTML = `
        ${imageNameLabel ? `<span>${imageNameLabel}</span>` : ""}
        <span class="tag">${t("tagLabel", { value: image.tag ?? "latest" })}</span>
        <span class="digest">${t("digestLabel", { value: shortDigest(image.digest) })}</span>
      `;

      const actionsEl = document.createElement("div");
      actionsEl.className = "image-actions";

      const imageBusyJobs = jobsForImage(image.id);
      const imageBusy = imageBusyJobs.length > 0;

      const checkBtn = document.createElement("button");
      checkBtn.textContent = t("checkNow");
      checkBtn.disabled = imageBusy;
      checkBtn.addEventListener("click", async () => {
        checkBtn.disabled = true;
        try {
          await postJson("/api/check-update", { id: image.id });
          await fetchState();
          render();
        } catch (err) {
          alert(err instanceof Error ? err.message : t("checkFailed"));
        } finally {
          checkBtn.disabled = false;
        }
      });
      actionsEl.appendChild(checkBtn);

      if (isUnmanaged && image.updateAvailable) {
        const updateBtn = document.createElement("button");
        updateBtn.className = "update-btn";
        updateBtn.textContent = t("runUpdate");
        updateBtn.disabled = imageBusy;
        updateBtn.addEventListener("click", () => {
          openModal({
            title: t("unmanagedUpdateTitle"),
            text: t("unmanagedUpdateText"),
            items: [
              {
                id: image.id,
                label: `${image.displayName}:${image.tag ?? "latest"}`
              }
            ],
            onConfirm: async (_selectedIds, pruneAfterUpdate) => {
              const result = await postJson("/api/update-image", {
                id: image.id,
                pruneAfterUpdate
              });
              if (result?.jobId) openConsole(result.jobId);
              await fetchJobs();
              await fetchState();
            }
          });
        });
        actionsEl.appendChild(updateBtn);
      }

      if (projectUrl) {
        const urlBtn = document.createElement("a");
        urlBtn.className = "update-btn";
        urlBtn.href = projectUrl;
        urlBtn.target = "_blank";
        urlBtn.rel = "noreferrer";
        urlBtn.textContent = t("url");
        actionsEl.appendChild(urlBtn);
      }

      const showCode = Boolean(sourceUrl && !sameUrl(projectUrl, sourceUrl));
      if (showCode && sourceUrl) {
        const codeBtn = document.createElement("a");
        codeBtn.className = "update-btn";
        codeBtn.href = sourceUrl;
        codeBtn.target = "_blank";
        codeBtn.rel = "noreferrer";
        codeBtn.textContent = t("code");
        actionsEl.appendChild(codeBtn);
      }

      const changelogUrl = getChangelogUrl(image);
      if (changelogUrl) {
        const changelogBtn = document.createElement("a");
        changelogBtn.className = "update-btn";
        changelogBtn.href = changelogUrl;
        changelogBtn.target = "_blank";
        changelogBtn.rel = "noreferrer";
        changelogBtn.textContent = t("changelog");
        actionsEl.appendChild(changelogBtn);
      }

      card.appendChild(top);
      card.appendChild(meta);
      card.appendChild(actionsEl);

      const imageOverlayJobs = groupHasUpdateJob
        ? imageBusyJobs.filter((job) => job.kind !== "group")
        : imageBusyJobs;
      const imageOverlay = createBusyOverlay(imageOverlayJobs, t("scopeImage"));
      if (imageOverlay) card.appendChild(imageOverlay);

      list.appendChild(card);
    });

    groupEl.appendChild(groupHeader);
    groupEl.appendChild(list);

    const groupOverlay = createBusyOverlay(groupBusyJobs, t("scopeGroup"));
    if (groupOverlay) groupEl.appendChild(groupOverlay);

    groupsEl.appendChild(groupEl);
  });
};

modalCancelEl.addEventListener("click", closeModal);
modalBackdropEl.addEventListener("click", closeModal);

modalConfirmEl.addEventListener("click", async () => {
  if (!modalState) return;
  const selected = Array.from(modalItemsEl.querySelectorAll('input[data-modal-item="1"]'))
    .filter((el) => el.checked)
    .map((el) => el.value);
  if (selected.length === 0) {
    alert(t("chooseOne"));
    return;
  }

  modalConfirmEl.disabled = true;
  try {
    await modalState.onConfirm(selected, modalPruneEl.checked);
    closeModal();
    render();
    renderConsole();
  } catch (err) {
    alert(err instanceof Error ? err.message : t("updateFailed"));
  } finally {
    modalConfirmEl.disabled = false;
  }
});

consoleCloseEl.addEventListener("click", closeConsole);
consoleBackdropEl.addEventListener("click", closeConsole);

const refreshAll = async () => {
  await Promise.all([fetchState(), fetchJobs()]);
  render();
  renderConsole();
};

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  try {
    await postJson("/api/refresh", {});
    await refreshAll();
  } finally {
    refreshBtn.disabled = false;
  }
});

localeSelectEl.addEventListener("change", async () => {
  const wanted = localeSelectEl.value;
  localeSelectEl.disabled = true;
  try {
    await postJson("/api/locale", { locale: wanted });
    await refreshAll();
  } finally {
    localeSelectEl.disabled = false;
  }
});

batchBtn.addEventListener("click", async () => {
  batchBtn.disabled = true;
  try {
    await postJson("/api/check-updates", {});
    await refreshAll();
  } finally {
    batchBtn.disabled = false;
  }
});

let pollTick = 0;
let lastStateDigest = "";
let lastJobsDigest = "";
const digestState = (state) =>
  JSON.stringify({
    locale: state.locale,
    lastRefresh: state.lastRefresh,
    lastAutomaticCheck: state.lastAutomaticCheck,
    images: (state.images ?? []).map((i) => [
      i.id,
      i.status,
      i.updateAvailable,
      i.lastUpdateCheck,
      i.lastUpdatedAt,
      i.digest
    ])
  });
const digestJobs = (jobs) =>
  JSON.stringify(
    (jobs ?? []).map((j) => [j.id, j.status, j.startedAt, j.endedAt, j.logs?.length ?? 0])
  );
const hasUserSelection = () => {
  const sel = window.getSelection();
  return Boolean(sel && sel.toString().trim());
};

setInterval(async () => {
  try {
    pollTick += 1;
    await fetchJobs();
    if (pollTick % 3 === 0) {
      await fetchState();
    }

    const nextStateDigest = digestState(appState);
    const nextJobsDigest = digestJobs(jobsState);
    const changed = nextStateDigest !== lastStateDigest || nextJobsDigest !== lastJobsDigest;
    const hasRunningJobs = jobsState.some((job) => job.status === "running");

    if ((changed || hasRunningJobs) && !hasUserSelection()) {
      lastStateDigest = nextStateDigest;
      lastJobsDigest = nextJobsDigest;
      render();
      renderConsole();
    }
  } catch {
    // no-op polling failure
  }
}, 1000);

refreshAll().catch((err) => {
  console.error(err);
});
