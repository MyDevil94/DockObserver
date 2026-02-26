const groupsEl = document.getElementById("groups");
const refreshBtn = document.getElementById("refreshBtn");
const batchBtn = document.getElementById("batchBtn");
const lastRefreshEl = document.getElementById("lastRefresh");
const countEl = document.getElementById("count");

const shortDigest = (digest) => {
  if (!digest) return "–";
  const clean = digest.includes(":") ? digest.split(":")[1] : digest;
  if (clean.length <= 12) return clean;
  return `${clean.slice(0, 5)}...${clean.slice(-5)}`;
};

const formatDate = (value) => {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const registryUrl = (image) => {
  if (image.registry === "docker.io") {
    const repo = image.repo.includes("/") ? image.repo : `library/${image.repo}`;
    return `https://hub.docker.com/r/${repo}`;
  }
  if (image.registry === "ghcr.io") {
    return `https://github.com/${image.repo}`;
  }
  return `https://${image.registry}/${image.repo}`;
};

const groupImages = (images) => {
  const grouped = new Map();
  images.forEach((image) => {
    const key = image.stack ?? "__unmanaged__";
    const list = grouped.get(key) ?? [];
    list.push(image);
    grouped.set(key, list);
  });
  return grouped;
};

const render = (state) => {
  const images = state.images ?? [];
  lastRefreshEl.textContent = `Letzter Scan: ${formatDate(state.lastRefresh)}`;
  countEl.textContent = `${images.length} Images`;
  groupsEl.innerHTML = "";

  const grouped = groupImages(images);
  grouped.forEach((groupImages, key) => {
    const groupEl = document.createElement("section");
    groupEl.className = "group";

    const groupHeader = document.createElement("header");
    const title = document.createElement("div");
    title.innerHTML = `<div class="group-title">${key === "__unmanaged__" ? "Unmanaged" : key}</div>`;
    const sample = groupImages[0];
    if (sample?.composeFile) {
      const pathEl = document.createElement("div");
      pathEl.className = "group-path";
      pathEl.textContent = sample.composeFile;
      title.appendChild(pathEl);
    }

    const actions = document.createElement("div");
    actions.className = "group-actions";
    const groupBtn = document.createElement("button");
    groupBtn.textContent = "Auf Update prüfen";
    groupBtn.addEventListener("click", async () => {
      groupBtn.disabled = true;
      if (key === "__unmanaged__") {
        for (const image of groupImages) {
          await fetch(`/api/check-update/${image.id}`, { method: "POST" });
        }
      } else {
        await fetch("/api/check-group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stack: key })
        });
      }
      await loadState();
      groupBtn.disabled = false;
    });
    actions.appendChild(groupBtn);

    groupHeader.appendChild(title);
    groupHeader.appendChild(actions);

    const list = document.createElement("div");
    list.className = "image-list";

    groupImages.forEach((image) => {
      const card = document.createElement("div");
      card.className = `image-card ${image.updateAvailable ? "update" : ""}`;

      const top = document.createElement("div");
      top.className = "image-top";
      const name = document.createElement("div");
      name.className = "image-name";
      name.textContent = image.displayName;
      top.appendChild(name);

      const status = document.createElement("div");
      status.className = "status";
      status.innerHTML = `<span class="status-dot ${image.status}"></span>${image.status}`;
      top.appendChild(status);

      const meta = document.createElement("div");
      meta.className = "image-meta";
      meta.innerHTML = `
        <span class="tag">Tag: ${image.tag ?? "latest"}</span>
        <span class="digest">Digest: ${shortDigest(image.digest)}</span>
        <span>Letzter Check: ${formatDate(image.lastUpdateCheck)}</span>
        <span>${image.updateAvailable === null ? "Update: ?" : image.updateAvailable ? "Update: Ja" : "Update: Nein"}</span>
      `;

      const actions = document.createElement("div");
      actions.className = "image-actions";
      const link = document.createElement("a");
      link.href = registryUrl(image);
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Registry";

      const button = document.createElement("button");
      button.textContent = "Jetzt prüfen";
      button.addEventListener("click", async () => {
        button.disabled = true;
        await fetch(`/api/check-update/${image.id}`, { method: "POST" });
        await loadState();
        button.disabled = false;
      });

      actions.appendChild(button);
      actions.appendChild(link);

      card.appendChild(top);
      card.appendChild(meta);
      card.appendChild(actions);
      list.appendChild(card);
    });

    groupEl.appendChild(groupHeader);
    groupEl.appendChild(list);
    groupsEl.appendChild(groupEl);
  });
};

const loadState = async () => {
  const res = await fetch("/api/state");
  const data = await res.json();
  render(data);
};

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  await fetch("/api/refresh", { method: "POST" });
  await loadState();
  refreshBtn.disabled = false;
});

batchBtn.addEventListener("click", async () => {
  batchBtn.disabled = true;
  await fetch("/api/check-updates", { method: "POST" });
  await loadState();
  batchBtn.disabled = false;
});

loadState();
