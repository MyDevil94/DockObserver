const state = {
  settings: null,
  stacks: [],
  services: [],
  images: [],
  viewMode: 'stacks',
  lastUpdateCheck: null,
  search: '',
  updatesOnly: false,
  maturedOnly: false,
  selected: new Set(),
  theme: 'dark',
  polling: null,
};

const elements = {
  searchInput: document.getElementById('searchInput'),
  filtersToggle: document.getElementById('filtersToggle'),
  filtersPanel: document.getElementById('filtersPanel'),
  selectAll: document.getElementById('selectAll'),
  updatesOnly: document.getElementById('updatesOnly'),
  maturedOnly: document.getElementById('maturedOnly'),
  updateSelected: document.getElementById('updateSelected'),
  refreshLocal: document.getElementById('refreshLocal'),
  refreshUpdates: document.getElementById('refreshUpdates'),
  themeToggle: document.getElementById('themeToggle'),
  viewStacks: document.getElementById('viewStacks'),
  viewImages: document.getElementById('viewImages'),
  actionStatus: document.getElementById('actionStatus'),
  lastChecked: document.getElementById('lastChecked'),
  cards: document.getElementById('cards'),
  emptyState: document.getElementById('emptyState'),
  versionTag: document.getElementById('versionTag'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
  modalClose: document.getElementById('modalClose'),
  logo: document.getElementById('logo'),
};

function init() {
  bindEvents();
  restoreTheme();
  elements.modal.classList.add('hidden');
  elements.modal.hidden = true;
  fetchSettings().then(async () => {
    await maybeAutoUpdateCheck();
    switchView('stacks');
  });
}

async function fetchUpdateMeta() {
  const res = await fetch('/api/updates/last');
  const data = await res.json();
  const last = data?.lastCheck ? new Date(data.lastCheck) : null;
  const rateUntil = data?.rateLimitedUntil ? new Date(data.rateLimitedUntil) : null;
  return { last, rateUntil };
}

async function maybeAutoUpdateCheck() {
  const meta = await fetchUpdateMeta();
  const last = meta.last;
  const rateUntil = meta.rateUntil;
  if (last && !Number.isNaN(last.getTime())) {
    state.lastUpdateCheck = last;
    setLastUpdateCheck(state.lastUpdateCheck);
  }
  if (rateUntil && rateUntil > new Date()) {
    setActionStatus('Rate limit active');
    setTimeout(() => setActionStatus(''), 1500);
    return;
  }
  const now = new Date();
  const shouldCheck = !last || (now.getTime() - last.getTime()) > 24 * 60 * 60 * 1000;
  if (shouldCheck) {
    setActionStatus('Checking updates...');
    setActionButtonsDisabled(true);
    const before = last ? last.getTime() : 0;
    await Promise.resolve(state.viewMode === 'images' ? fetchImages(true, false) : fetchStacks(true, false));
    const afterMeta = await fetchUpdateMeta();
    const after = afterMeta.last && !Number.isNaN(afterMeta.last.getTime()) ? afterMeta.last.getTime() : 0;
    if (after > before) {
      state.lastUpdateCheck = afterMeta.last;
      setLastUpdateCheck(state.lastUpdateCheck);
      setActionStatus('Update check done');
    } else {
      setActionStatus('Update check skipped');
    }
    setTimeout(() => setActionStatus(''), 1500);
    setActionButtonsDisabled(false);
  }
}

function switchView(mode) {
  state.viewMode = mode;
  elements.viewStacks.classList.toggle('active', mode === 'stacks');
  elements.viewImages.classList.toggle('active', mode === 'images');
  elements.selectAll.disabled = false;
  elements.updateSelected.disabled = false;
  if (mode === 'images') {
    if (state.images.length) {
      render();
    } else {
      fetchImages(false, true);
    }
  } else {
    if (state.stacks.length) {
      render();
    } else {
      fetchStacks(false, true);
    }
  }
}

function bindEvents() {
  elements.searchInput.addEventListener('input', (e) => {
    state.search = e.target.value.trim().toLowerCase();
    state.selected.clear();
    render();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/') {
      elements.searchInput.focus();
      event.preventDefault();
    }
  });

  elements.filtersToggle.addEventListener('click', () => {
    elements.filtersPanel.classList.toggle('hidden');
  });

  elements.updatesOnly.addEventListener('change', (e) => {
    state.updatesOnly = e.target.checked;
    state.selected.clear();
    render();
  });

  elements.maturedOnly.addEventListener('change', (e) => {
    state.maturedOnly = e.target.checked;
    state.selected.clear();
    render();
  });

  elements.selectAll.addEventListener('click', () => {
    const items = state.viewMode === 'images' ? computeFilteredImages() : computeFilteredServices();
    if (!items.length) return;
    const allSelected = items.every((item) => state.selected.has(selectionKey(item)));
    state.selected.clear();
    if (!allSelected) {
      items.forEach((item) => state.selected.add(selectionKey(item)));
    }
    render();
  });

  elements.updateSelected.addEventListener('click', () => updateSelected());
  elements.refreshLocal.addEventListener('click', () => {
    setActionStatus('Refreshing local...');
    setActionButtonsDisabled(true);
    const action = state.viewMode === 'images' ? fetchImages(true, true) : fetchStacks(true, true);
    Promise.resolve(action).finally(() => {
      setActionStatus('Local refresh done');
      setTimeout(() => setActionStatus(''), 1500);
      setActionButtonsDisabled(false);
    });
  });
  elements.refreshUpdates.addEventListener('click', () => {
    setActionStatus('Checking updates...');
    setActionButtonsDisabled(true);
    const before = state.lastUpdateCheck ? state.lastUpdateCheck.getTime() : 0;
    const action = state.viewMode === 'images' ? fetchImages(true, false) : fetchStacks(true, false);
    Promise.resolve(action).finally(async () => {
      const meta = await fetchUpdateMeta();
      const after = meta.last && !Number.isNaN(meta.last.getTime()) ? meta.last.getTime() : 0;
      if (meta.rateUntil && meta.rateUntil > new Date()) {
        setActionStatus('Rate limit active');
      } else if (after > before) {
        state.lastUpdateCheck = meta.last;
        setLastUpdateCheck(state.lastUpdateCheck);
        setActionStatus('Update check done');
      } else {
        setActionStatus('Update check skipped');
      }
      setTimeout(() => setActionStatus(''), 1500);
      setActionButtonsDisabled(false);
    });
  });

  elements.themeToggle.addEventListener('click', toggleTheme);
  elements.viewStacks.addEventListener('click', () => switchView('stacks'));
  elements.viewImages.addEventListener('click', () => switchView('images'));

  elements.modalClose.addEventListener('click', closeModal);
  elements.modal.addEventListener('click', (e) => {
    if (e.target === elements.modal) {
      closeModal();
    }
  });
}

function restoreTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    state.theme = saved;
  } else {
    state.theme = 'dark';
  }
  document.documentElement.setAttribute('data-theme', state.theme);
  updateLogo();
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('theme', state.theme);
  updateLogo();
}

function setActionStatus(text) {
  if (!elements.actionStatus) return;
  elements.actionStatus.textContent = text || '';
}

function setLastUpdateCheck(date) {
  if (!elements.lastChecked) return;
  if (!date) {
    elements.lastChecked.textContent = '';
    return;
  }
  const formatted = date.toLocaleString();
  elements.lastChecked.textContent = `Last check: ${formatted}`;
}

function setActionButtonsDisabled(disabled) {
  elements.updateSelected.disabled = disabled;
  elements.refreshLocal.disabled = disabled;
  elements.refreshUpdates.disabled = disabled;
}

function updateLogo() {
  if (!elements.logo) return;
  elements.logo.src = state.theme === 'dark' ? '/assets/dockobserver-solid-white.svg' : '/assets/dockobserver-solid-black.svg';
}

async function fetchSettings() {
  const res = await fetch('/api/settings');
  state.settings = await res.json();
}

async function fetchStacks(noCache = false, localOnly = false) {
  const params = new URLSearchParams();
  if (noCache) params.set('no_cache', 'true');
  if (localOnly) params.set('local_only', 'true');
  const url = params.toString() ? `/api/stacks?${params.toString()}` : '/api/stacks';
  const res = await fetch(url);
  state.stacks = await res.json();
  state.services = state.stacks.flatMap((stack) => stack.services || []);
  render();
}

async function fetchImages(noCache = false, localOnly = false) {
  const params = new URLSearchParams();
  if (noCache) params.set('no_cache', 'true');
  if (localOnly) params.set('local_only', 'true');
  const url = params.toString() ? `/api/images?${params.toString()}` : '/api/images';
  const res = await fetch(url);
  state.images = await res.json();
  render();
}

function computeFilteredServices() {
  let services = state.services;
  if (state.search) {
    services = services.filter((svc) => {
      const hay = [
        svc.name,
        svc.containerName,
        svc.stackName,
        svc.serviceName,
        svc.image?.repoTag,
        svc.image?.version,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(state.search);
    });
  }
  if (state.updatesOnly) {
    services = services.filter((svc) => svc.hasUpdates);
  }
  if (state.maturedOnly) {
    services = services.filter((svc) => isReleaseMature(svc));
  }
  return services;
}

function render() {
  if (state.viewMode === 'images') {
    renderImages();
  } else {
    renderStacks();
  }
}

function renderStacks() {
  const services = computeFilteredServices();
  elements.cards.innerHTML = '';
  if (!services.length) {
    elements.emptyState.classList.remove('hidden');
    updateSelectAllIcon(services);
    return;
  }
  elements.emptyState.classList.add('hidden');
  const stacks = groupByStack(services);
  Object.keys(stacks).sort().forEach((stackName) => {
    const stack = stacks[stackName];
    const section = document.createElement('section');
    section.className = 'stack-section';
    const header = document.createElement('div');
    header.className = 'stack-header';
    header.textContent = stackName;

    const badge = document.createElement('span');
    badge.className = `stack-badge ${stackStatus(stack.services)}`;
    badge.textContent = stackStatusLabel(stack.services);
    header.appendChild(badge);
    const cards = document.createElement('div');
    cards.className = 'stack-cards';
    stack.services.forEach((svc) => cards.appendChild(renderStackCard(svc)));
    section.appendChild(header);
    section.appendChild(cards);
    elements.cards.appendChild(section);
  });
  updateSelectAllIcon(services);
}

function renderImages() {
  const images = computeFilteredImages();
  elements.cards.innerHTML = '';
  if (!images.length) {
    elements.emptyState.classList.remove('hidden');
    return;
  }
  elements.emptyState.classList.add('hidden');
  images.forEach((entry) => {
    elements.cards.appendChild(renderImageCard(entry));
  });
  updateSelectAllIcon(images);
}

function renderStackCard(service) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.selected = state.selected.has(keyFor(service)) ? 'true' : 'false';

  const isLoaded = Boolean(service.image) && service.status !== 'not-loaded';
  const statusClass = service.hasUpdates
    ? (isReleaseMature(service) ? 'update' : 'warn')
    : service.status === 'running'
      ? ''
      : service.status === 'stopped'
        ? 'warn'
        : 'unknown';
  const statusText = !isLoaded || service.status === 'not-loaded'
    ? 'Stack exists but not loaded'
    : service.hasUpdates
      ? `Updates available (${releaseStatus(service)})`
      : service.status === 'running'
        ? 'Running'
        : service.status === 'stopped'
          ? 'Stopped'
          : 'Unknown';

  card.innerHTML = `
    <div class="card-header">
      <div class="status ${statusClass}">
        <span class="dot"></span>
        <span>${statusText}</span>
      </div>
      <button class="icon-button select" title="Select">${state.selected.has(keyFor(service)) ? '▣' : '▢'}</button>
    </div>
    <div>
      <h3 class="card-title">${escapeHtml(service.containerName || service.name || 'Unknown')}</h3>
      <div class="card-meta">
        <span>Stack: ${escapeHtml(service.stackName || '')}</span>
        <span>Image: ${escapeHtml(formatImageDisplay(service.image?.repoTag).repo)}</span>
        ${formatImageDisplay(service.image?.repoTag).tag ? `<span>Tag: ${escapeHtml(formatImageDisplay(service.image?.repoTag).tag)}</span>` : ''}
        ${formatImageDisplay(service.image?.repoTag).digest ? `<span class="wrap-text">Digest: ${escapeHtml(formatImageDisplay(service.image?.repoTag).digest)}</span>` : ''}
        ${service.image?.version ? `<span class="wrap-text">Version: ${escapeHtml(service.image.version)}</span>` : ''}
        <span>Uptime: ${escapeHtml(service.uptime || '')}</span>
        <span>Local image date: ${formatDate(service.image?.createdAt)}</span>
      </div>
    </div>
    <div class="card-actions">
      <div class="left">
        ${service.hasUpdates ? '<span class="badge">Update ready</span>' : ''}
        ${isLoaded ? '<button class="icon-button update" title="Update">⬇︎</button>' : ''}
        <button class="icon-button refresh" title="Refresh">⟳</button>
      </div>
      ${service.homepageUrl ? `<a class="icon-button" href="${service.homepageUrl}" target="_blank" rel="noreferrer">↗</a>` : '<span></span>'}
    </div>
  `;

  card.querySelector('.select').addEventListener('click', () => {
    toggleSelected(service);
    render();
  });
  const updateButton = card.querySelector('.update');
  if (updateButton) {
    updateButton.addEventListener('click', () => updateService(service));
  }
  card.querySelector('.refresh').addEventListener('click', () => fetchStacks(true));

  return card;
}

function renderImageCard(entry) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.selected = state.selected.has(imageKey(entry)) ? 'true' : 'false';
  const statusClass = entry.hasUpdates
    ? (isReleaseMatureImage(entry) ? 'update' : 'warn')
    : entry.status === 'running'
      ? ''
      : entry.status === 'stopped'
        ? 'warn'
        : 'unknown';
  const statusText = entry.hasUpdates
    ? `Updates available (${releaseStatusImage(entry)})`
    : entry.status === 'running'
      ? 'Running'
      : entry.status === 'stopped'
        ? 'Stopped'
        : 'Unknown';

  card.innerHTML = `
    <div class="card-header">
      <div class="status ${statusClass}">
        <span class="dot"></span>
        <span>${statusText}</span>
      </div>
      <button class="icon-button select" title="Select">${state.selected.has(imageKey(entry)) ? '▣' : '▢'}</button>
    </div>
    <div>
      <h3 class="card-title">${escapeHtml(formatImageDisplay(entry.repoTag).repo)}</h3>
      <div class="card-meta">
        <span>Image: ${escapeHtml(formatImageDisplay(entry.repoTag).repo)}</span>
        ${formatImageDisplay(entry.repoTag).tag ? `<span>Tag: ${escapeHtml(formatImageDisplay(entry.repoTag).tag)}</span>` : ''}
        ${formatImageDisplay(entry.repoTag).digest ? `<span class="wrap-text">Digest: ${escapeHtml(formatImageDisplay(entry.repoTag).digest)}</span>` : ''}
        ${entry.image?.version ? `<span class="wrap-text">Version: ${escapeHtml(entry.image.version)}</span>` : ''}
        <span>Containers running: ${entry.containersRunning || 0}</span>
        <span>Containers stopped: ${entry.containersStopped || 0}</span>
        <span>Local image date: ${formatDate(entry.image?.createdAt)}</span>
      </div>
    </div>
    <div class="card-actions">
      <div class="left">
        ${entry.hasUpdates ? '<span class="badge">Update ready</span>' : ''}
        <button class="icon-button update" title="Pull image">⬇︎</button>
        <button class="icon-button refresh" title="Refresh">⟳</button>
      </div>
      ${entry.homepageUrl ? `<a class="icon-button" href="${entry.homepageUrl}" target="_blank" rel="noreferrer">↗</a>` : '<span></span>'}
    </div>
  `;
  card.querySelector('.select').addEventListener('click', () => {
    toggleSelected(entry);
    render();
  });
  card.querySelector('.refresh').addEventListener('click', () => {
    setActionStatus('Checking updates...');
    setActionButtonsDisabled(true);
    fetchImages(true, false).finally(() => {
      setActionStatus('Update check done');
      setTimeout(() => setActionStatus(''), 1500);
      setActionButtonsDisabled(false);
    });
  });
  card.querySelector('.update').addEventListener('click', () => updateImage(entry.repoTag));
  return card;
}

function groupByStack(services) {
  const map = {};
  services.forEach((svc) => {
    const name = svc.stackName || 'unknown';
    if (!map[name]) {
      const stackMeta = state.stacks.find((s) => s.name === name);
      map[name] = { services: [], folderName: stackMeta?.folderName };
    }
    map[name].services.push(svc);
  });
  return map;
}

function computeFilteredImages() {
  let images = state.images || [];
  if (state.search) {
    images = images.filter((entry) => {
      const hay = [entry.repoTag, entry.image?.version].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(state.search);
    });
  }
  if (state.updatesOnly) {
    images = images.filter((entry) => entry.hasUpdates);
  }
  if (state.maturedOnly) {
    images = images.filter((entry) => isReleaseMatureImage(entry));
  }
  return images;
}

function updateSelectAllIcon(items) {
  if (!elements.selectAll) return;
  if (!items.length || state.selected.size === 0) {
    elements.selectAll.textContent = '▢';
    return;
  }
  const allSelected = items.every((item) => state.selected.has(selectionKey(item)));
  elements.selectAll.textContent = allSelected ? '▣' : '▤';
}

function toggleSelected(item) {
  const key = selectionKey(item);
  if (state.selected.has(key)) {
    state.selected.delete(key);
  } else {
    state.selected.add(key);
  }
}

function keyFor(service) {
  return `${service.stackName}/${service.serviceName}`;
}

function imageKey(entry) {
  return `image:${entry.repoTag}`;
}

function selectionKey(item) {
  if (state.viewMode === 'images') {
    return imageKey(item);
  }
  return keyFor(item);
}

function releaseStatus(service) {
  const latestUpdate = new Date(service.image?.latestUpdate || service.image?.createdAt || 0);
  const daysAgo = Math.floor((Date.now() - latestUpdate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return '1 day ago';
  return `${daysAgo} days ago`;
}

function releaseStatusImage(entry) {
  const latestUpdate = new Date(entry.image?.latestUpdate || entry.image?.createdAt || 0);
  const daysAgo = Math.floor((Date.now() - latestUpdate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return '1 day ago';
  return `${daysAgo} days ago`;
}

function formatImageDisplay(repoTag) {
  if (!repoTag) return { repo: '', tag: '', digest: '' };
  let ref = repoTag;
  let digest = '';
  if (ref.includes('@sha256:')) {
    const parts = ref.split('@sha256:');
    ref = parts[0];
    digest = `sha256:${parts[1]}`;
  }
  let repo = ref;
  let tag = '';
  if (ref.includes(':')) {
    const parts = ref.split(':');
    repo = parts[0];
    tag = parts.slice(1).join(':');
  }
  return { repo, tag, digest };
}

function isReleaseMature(service) {
  if (!state.settings?.server?.timeUntilUpdateIsMature) return false;
  if (!service.hasUpdates) return false;
  const latestUpdate = new Date(service.image?.latestUpdate || 0);
  const delta = (Date.now() - latestUpdate.getTime()) / 1000;
  return delta >= state.settings.server.timeUntilUpdateIsMature;
}

function isReleaseMatureImage(entry) {
  if (!state.settings?.server?.timeUntilUpdateIsMature) return false;
  if (!entry.hasUpdates) return false;
  const latestUpdate = new Date(entry.image?.latestUpdate || 0);
  const delta = (Date.now() - latestUpdate.getTime()) / 1000;
  return delta >= state.settings.server.timeUntilUpdateIsMature;
}

function stackStatus(services) {
  let hasLoaded = false;
  let hasRunning = false;
  let hasStopped = false;
  services.forEach((svc) => {
    if (svc.status === 'not-loaded') return;
    hasLoaded = true;
    if (svc.status === 'running') hasRunning = true;
    if (svc.status === 'stopped') hasStopped = true;
  });
  if (!hasLoaded) return 'not-loaded';
  if (hasRunning) return 'running';
  if (hasStopped) return 'stopped';
  return 'not-loaded';
}

function stackStatusLabel(services) {
  const status = stackStatus(services);
  if (status === 'running') return 'Running';
  if (status === 'stopped') return 'Stopped';
  return 'Not loaded';
}

// homepage url for images is provided by the backend

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

async function updateService(service) {
  if (!confirm(`Update ${service.image?.repoTag || service.name}?`)) {
    return;
  }
  setActionStatus(`Updating ${service.serviceName}...`);
  setActionButtonsDisabled(true);
  await fetch(`/api/stacks/${service.stackName}/${service.serviceName}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inferEnvfile: true, pruneImages: true, restartContainers: true }),
  });
  openModal(`Execution Details: ${service.serviceName}`);
  pollTask(service.stackName, service.serviceName);
}

async function updateSelected() {
  if (state.viewMode === 'images') {
    const selectedImages = state.images.filter((img) => state.selected.has(imageKey(img)) || state.selected.size === 0);
    if (!selectedImages.length) {
      alert('No images selected.');
      return;
    }
    if (!confirm(`Pull ${selectedImages.length} images?`)) {
      return;
    }
    setActionStatus(`Pulling ${selectedImages.length} images...`);
    setActionButtonsDisabled(true);
    for (const img of selectedImages) {
      await fetch('/api/images/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoTag: img.repoTag }),
      });
    }
    setActionStatus('Pull finished');
    setTimeout(() => setActionStatus(''), 1500);
    setActionButtonsDisabled(false);
    state.selected.clear();
    render();
    return;
  }

  const selectedServices = state.services.filter((svc) => state.selected.has(keyFor(svc)) || state.selected.size === 0);
  const withUpdates = selectedServices.filter((svc) => svc.hasUpdates);
  if (!withUpdates.length) {
    alert('No services with updates selected.');
    return;
  }
  if (!confirm(`Update ${withUpdates.length} services?`)) {
    return;
  }
  setActionStatus(`Updating ${withUpdates.length} services...`);
  setActionButtonsDisabled(true);
  const payload = {
    services: withUpdates.map((svc) => keyFor(svc)),
    inferEnvfile: true,
    pruneImages: true,
    restartContainers: true,
  };
  await fetch('/api/stacks/batch_update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (withUpdates.length === 1) {
    openModal(`Execution Details: ${withUpdates[0].serviceName}`);
    pollTask(withUpdates[0].stackName, withUpdates[0].serviceName);
  } else {
    setActionStatus('Updates started');
    setTimeout(() => setActionStatus(''), 2000);
    setActionButtonsDisabled(false);
  }
  state.selected.clear();
  render();
}

async function updateImage(repoTag) {
  if (!confirm(`Pull ${repoTag}?`)) {
    return;
  }
  setActionStatus(`Pulling ${repoTag}...`);
  setActionButtonsDisabled(true);
  const res = await fetch('/api/images/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoTag }),
  });
  const data = await res.json();
  openModal(`Execution Details: ${repoTag}`);
  if (Array.isArray(data?.output)) {
    appendMessages(data.output.map((line) => ({ stage: 'docker pull', message: line })));
  } else if (data?.message) {
    appendMessages([{ stage: 'docker pull', message: data.message }]);
  }
  setActionStatus('Pull finished');
  setTimeout(() => setActionStatus(''), 1500);
  setActionButtonsDisabled(false);
}

function openModal(title) {
  elements.modalTitle.textContent = title;
  elements.modalBody.innerHTML = '';
  elements.modal.classList.remove('hidden');
  elements.modal.hidden = false;
}

function closeModal() {
  elements.modal.classList.add('hidden');
  elements.modal.hidden = true;
  if (state.polling) {
    clearInterval(state.polling);
    state.polling = null;
  }
}

function pollTask(stack, service) {
  let offset = 0;
  if (state.polling) {
    clearInterval(state.polling);
  }
  state.polling = setInterval(async () => {
    const res = await fetch(`/api/stacks/${stack}/${service}/task?offset=${offset}`);
    if (!res.ok) {
      return;
    }
    const messages = await res.json();
    if (Array.isArray(messages) && messages.length) {
      offset += messages.length;
      appendMessages(messages);
      const finished = messages.some((msg) => msg.stage === 'Finished');
      if (finished) {
        clearInterval(state.polling);
        state.polling = null;
        fetchStacks(true, true);
        setActionStatus('Update finished');
        setTimeout(() => setActionStatus(''), 1500);
        setActionButtonsDisabled(false);
      }
    }
  }, 800);
}

function appendMessages(messages) {
  messages.forEach((msg) => {
    if (msg.message) {
      const pre = document.createElement('pre');
      pre.textContent = `[${msg.stage}] ${msg.message}`;
      elements.modalBody.appendChild(pre);
      elements.modalBody.scrollTop = elements.modalBody.scrollHeight;
    }
  });
}

init();
