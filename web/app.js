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
  hideComposeImages: true,
  stackLayout: 'grouped',
  selected: new Set(),
  theme: 'dark',
  polling: new Map(),
  updating: new Map(),
  modalTitle: '',
  modalMessages: [],
  modalVisible: false,
  stackRefreshTimers: new Map(),
  modalSessions: new Map(),
  activeSession: null,
  updateTicker: null,
  lastToastMessage: '',
  toastTimer: null,
  toastPersistent: false,
};

const elements = {
  searchInput: document.getElementById('searchInput'),
  filtersToggle: document.getElementById('filtersToggle'),
  filtersPanel: document.getElementById('filtersPanel'),
  selectAll: document.getElementById('selectAll'),
  updatesOnly: document.getElementById('updatesOnly'),
  maturedOnly: document.getElementById('maturedOnly'),
  hideComposeImages: document.getElementById('hideComposeImages'),
  imagesOnlyFilter: document.getElementById('imagesOnlyFilter'),
  stackLayoutToggle: document.getElementById('stackLayoutToggle'),
  layoutGrouped: document.getElementById('layoutGrouped'),
  layoutGrid: document.getElementById('layoutGrid'),
  layoutCompact: document.getElementById('layoutCompact'),
  updateSelected: document.getElementById('updateSelected'),
  refreshLocal: document.getElementById('refreshLocal'),
  refreshUpdates: document.getElementById('refreshUpdates'),
  themeToggle: document.getElementById('themeToggle'),
  viewStacks: document.getElementById('viewStacks'),
  viewImages: document.getElementById('viewImages'),
  messagesToggle: document.getElementById('messagesToggle'),
  toastClose: document.getElementById('toastClose'),
  lastChecked: document.getElementById('lastChecked'),
  lastAutoChecked: document.getElementById('lastAutoChecked'),
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toastMessage'),
  cards: document.getElementById('cards'),
  emptyState: document.getElementById('emptyState'),
  versionTag: document.getElementById('versionTag'),
  appHeader: document.getElementById('appHeader'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modalTitle'),
  modalSessions: document.getElementById('modalSessions'),
  modalBody: document.getElementById('modalBody'),
  modalClose: document.getElementById('modalClose'),
  modalOpen: document.getElementById('openModal'),
  logo: document.getElementById('logo'),
};

const UPDATE_LOCK_TIMEOUT = 5 * 60 * 1000;

function init() {
  bindEvents();
  restoreTheme();
  elements.modal.classList.add('hidden');
  elements.modal.hidden = true;
  updateModalButton();
  if (elements.hideComposeImages) {
    state.hideComposeImages = elements.hideComposeImages.checked;
  }
  setStackLayout(state.stackLayout);
  updateFiltersVisibility();
  fetchSettings().then(async () => {
    await maybeAutoUpdateCheck();
    switchView('stacks');
  });
}

function isDryRun() {
  return Boolean(state.settings?.server?.dryrun);
}

async function fetchUpdateMeta() {
  const res = await fetch('/api/updates/last');
  const data = await res.json();
  const last = data?.lastCheck ? new Date(data.lastCheck) : null;
  const rateUntil = data?.rateLimitedUntil ? new Date(data.rateLimitedUntil) : null;
  const lastAuto = data?.lastAutoCheck ? new Date(data.lastAutoCheck) : null;
  return { last, rateUntil, lastAuto };
}

async function maybeAutoUpdateCheck() {
  const meta = await fetchUpdateMeta();
  const last = meta.last;
  const rateUntil = meta.rateUntil;
  if (last && !Number.isNaN(last.getTime())) {
    state.lastUpdateCheck = last;
    setLastUpdateCheck(state.lastUpdateCheck);
  }
  if (meta.lastAuto && !Number.isNaN(meta.lastAuto.getTime())) {
    setLastAutoCheck(meta.lastAuto);
  }
  if (rateUntil && rateUntil > new Date()) {
    setActionStatus('Rate limit active');
    setTimeout(() => setActionStatus(''), 1500);
    return;
  }
  const now = new Date();
  const shouldCheck = !last || (now.getTime() - last.getTime()) > 24 * 60 * 60 * 1000;
  if (shouldCheck) {
    if (isDryRun()) {
      setActionStatus('Dry run: simulating updates...');
      setActionButtonsDisabled(true);
      const action = state.viewMode === 'images'
        ? fetchImages(true, false, true)
        : fetchStacks(true, false, true);
      await Promise.resolve(action);
      const afterMeta = await fetchUpdateMeta();
      if (afterMeta.last && !Number.isNaN(afterMeta.last.getTime())) {
        state.lastUpdateCheck = afterMeta.last;
        setLastUpdateCheck(state.lastUpdateCheck);
      }
      if (afterMeta.lastAuto && !Number.isNaN(afterMeta.lastAuto.getTime())) {
        setLastAutoCheck(afterMeta.lastAuto);
      }
      setActionStatus('Dry run: update check done');
      setTimeout(() => setActionStatus(''), 1500);
      setActionButtonsDisabled(false);
      return;
    }
    setActionStatus('Checking updates...');
    setActionButtonsDisabled(true);
    const before = last ? last.getTime() : 0;
    await Promise.resolve(state.viewMode === 'images'
      ? fetchImages(true, false, true)
      : fetchStacks(true, false, true));
    const afterMeta = await fetchUpdateMeta();
    const after = afterMeta.last && !Number.isNaN(afterMeta.last.getTime()) ? afterMeta.last.getTime() : 0;
    if (after > before) {
      state.lastUpdateCheck = afterMeta.last;
      setLastUpdateCheck(state.lastUpdateCheck);
      if (afterMeta.lastAuto && !Number.isNaN(afterMeta.lastAuto.getTime())) {
        setLastAutoCheck(afterMeta.lastAuto);
      }
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
  updateFiltersVisibility();
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

  if (elements.hideComposeImages) {
    elements.hideComposeImages.addEventListener('change', (e) => {
      state.hideComposeImages = e.target.checked;
      render();
    });
  }

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
    if (isDryRun()) {
      setActionStatus('Dry run: simulating updates...');
      setActionButtonsDisabled(true);
      const action = state.viewMode === 'images' ? fetchImages(true, false) : fetchStacks(true, false);
      Promise.resolve(action).finally(async () => {
        const meta = await fetchUpdateMeta();
        if (meta.last && !Number.isNaN(meta.last.getTime())) {
          state.lastUpdateCheck = meta.last;
          setLastUpdateCheck(state.lastUpdateCheck);
        }
        setActionStatus('Dry run: update check done');
        setTimeout(() => setActionStatus(''), 1500);
        setActionButtonsDisabled(false);
      });
      return;
    }
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

  if (elements.layoutGrouped) {
    elements.layoutGrouped.addEventListener('click', () => setStackLayout('grouped'));
  }
  if (elements.layoutGrid) {
    elements.layoutGrid.addEventListener('click', () => setStackLayout('grid'));
  }
  if (elements.layoutCompact) {
    elements.layoutCompact.addEventListener('click', () => setStackLayout('compact'));
  }

  if (elements.messagesToggle) {
    elements.messagesToggle.addEventListener('click', () => showMessageHistory());
  }

  if (elements.toastClose) {
    elements.toastClose.addEventListener('click', hideToast);
  }

  if (elements.modalOpen) {
    elements.modalOpen.addEventListener('click', () => {
      if (!state.activeSession) return;
      openModal();
    });
  }

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
  const msg = text || '';
  state.lastToastMessage = msg;
  if (!msg) return;
  showToast(msg);
  postActionMessage(msg);
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

function setLastAutoCheck(date) {
  if (!elements.lastAutoChecked) return;
  if (!date) {
    elements.lastAutoChecked.textContent = '';
    return;
  }
  const formatted = date.toLocaleString();
  elements.lastAutoChecked.textContent = `Last auto-check: ${formatted}`;
}


function setActionButtonsDisabled(disabled) {
  elements.updateSelected.disabled = disabled;
  elements.refreshLocal.disabled = disabled;
  elements.refreshUpdates.disabled = disabled;
}

function showToast(message) {
  if (!elements.toast || !elements.toastMessage) return;
  if (!message) return;
  state.toastPersistent = false;
  elements.toastMessage.textContent = message;
  elements.toast.classList.remove('hidden');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    if (state.toastPersistent) return;
    elements.toast.classList.add('hidden');
  }, 7000);
}

function showToastList(messages) {
  if (!elements.toast || !elements.toastMessage) return;
  if (!messages.length) return;
  state.toastPersistent = true;
  const lines = messages.map((msg) => {
    const when = msg.at ? new Date(msg.at).toLocaleTimeString() : '';
    const prefix = when ? `[${when}] ` : '';
    return `<div>${escapeHtml(prefix + msg.message)}</div>`;
  });
  elements.toastMessage.innerHTML = lines.join('');
  elements.toast.classList.remove('hidden');
}

function hideToast() {
  if (!elements.toast) return;
  elements.toast.classList.add('hidden');
  state.toastPersistent = false;
  clearTimeout(state.toastTimer);
}

async function postActionMessage(message) {
  if (!message) return;
  try {
    await fetch('/api/updates/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  } catch {
    // ignore
  }
}

async function showMessageHistory() {
  try {
    const res = await fetch('/api/updates/messages');
    if (!res.ok) return;
    const messages = await res.json();
    if (!Array.isArray(messages) || messages.length === 0) return;
    showToastList(messages);
  } catch {
    // ignore
  }
}

function updateLogo() {
  if (!elements.logo) return;
  elements.logo.src = state.theme === 'dark' ? '/assets/dockobserver-solid-white.svg' : '/assets/dockobserver-solid-black.svg';
}

async function fetchSettings() {
  const res = await fetch('/api/settings');
  state.settings = await res.json();
}

async function fetchStacks(noCache = false, localOnly = false, autoCheck = false) {
  const params = new URLSearchParams();
  if (noCache) params.set('no_cache', 'true');
  if (localOnly) params.set('local_only', 'true');
  if (autoCheck) params.set('auto_check', 'true');
  const url = params.toString() ? `/api/stacks?${params.toString()}` : '/api/stacks';
  const res = await fetch(url);
  state.stacks = await res.json();
  state.services = state.stacks.flatMap((stack) => stack.services || []);
  render();
}

async function fetchImages(noCache = false, localOnly = false, autoCheck = false) {
  const params = new URLSearchParams();
  if (noCache) params.set('no_cache', 'true');
  if (localOnly) params.set('local_only', 'true');
  if (autoCheck) params.set('auto_check', 'true');
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
  cleanupStaleUpdates();
  if (state.viewMode === 'images') {
    renderImages();
  } else {
    renderStacks();
  }
}

function renderStacks() {
  const services = computeFilteredServices();
  elements.cards.innerHTML = '';
  elements.cards.classList.toggle('compact', state.stackLayout === 'compact');
  if (!services.length) {
    elements.emptyState.classList.remove('hidden');
    updateSelectAllIcon(services);
    return;
  }
  elements.emptyState.classList.add('hidden');
  if (state.stackLayout === 'grouped') {
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
  } else {
    services.forEach((svc) => elements.cards.appendChild(renderStackCard(svc)));
  }
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
  const updateKey = keyFor(service);
  const updateEntry = state.updating.get(updateKey);
  card.dataset.selected = state.selected.has(updateKey) ? 'true' : 'false';
  if (updateEntry) {
    card.classList.add('is-updating');
  }

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
    ${updateEntry ? `<div class="card-overlay"><div class="spinner"></div><span>${escapeHtml(formatUpdateLabel(updateEntry))}</span></div>` : ''}
  `;

  card.querySelector('.select').addEventListener('click', () => {
    toggleSelected(service);
    render();
  });
  const updateButton = card.querySelector('.update');
  if (updateButton) {
    updateButton.addEventListener('click', () => updateService(service));
  }
  card.querySelector('.refresh').addEventListener('click', () => refreshService(service));

  if (updateEntry) {
    card.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });
    card.querySelectorAll('a.icon-button').forEach((link) => {
      link.classList.add('disabled');
      link.setAttribute('aria-disabled', 'true');
    });
    const overlay = card.querySelector('.card-overlay');
    if (overlay) {
      overlay.addEventListener('click', () => {
        if (state.activeSession) {
          openModal();
        }
      });
    }
  }

  return card;
}

function renderImageCard(entry) {
  const card = document.createElement('div');
  card.className = 'card';
  const updateKey = imageKey(entry);
  const updateEntry = state.updating.get(updateKey);
  card.dataset.selected = state.selected.has(updateKey) ? 'true' : 'false';
  if (updateEntry) {
    card.classList.add('is-updating');
  }
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
    ${updateEntry ? `<div class="card-overlay"><div class="spinner"></div><span>${escapeHtml(formatUpdateLabel(updateEntry))}</span></div>` : ''}
  `;
  card.querySelector('.select').addEventListener('click', () => {
    toggleSelected(entry);
    render();
  });
  card.querySelector('.refresh').addEventListener('click', () => refreshImage(entry));
  card.querySelector('.update').addEventListener('click', () => updateImage(entry.repoTag));

  if (updateEntry) {
    card.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });
    card.querySelectorAll('a.icon-button').forEach((link) => {
      link.classList.add('disabled');
      link.setAttribute('aria-disabled', 'true');
    });
    const overlay = card.querySelector('.card-overlay');
    if (overlay) {
      overlay.addEventListener('click', () => {
        if (state.activeSession) {
          openModal();
        }
      });
    }
  }
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
  if (state.hideComposeImages) {
    const repoSet = new Set();
    state.services.forEach((svc) => {
      const repoTag = svc.image?.repoTag;
      if (!repoTag) return;
      const repo = formatImageDisplay(repoTag).repo;
      if (repo) {
        repoSet.add(repo);
      }
    });
    images = images.filter((entry) => {
      const repo = formatImageDisplay(entry.repoTag).repo;
      return !repoSet.has(repo);
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

function formatUpdateLabel(entry) {
  if (!entry) return '';
  const seconds = Math.floor((Date.now() - entry.startedAt) / 1000);
  return `${entry.label} · ${seconds}s`;
}

function startUpdate(key, label) {
  if (!key) return;
  const entry = { label: label || 'Updating...', startedAt: Date.now() };
  state.updating.set(key, entry);
  ensureUpdateTicker();
  setTimeout(() => {
    const current = state.updating.get(key);
    if (current && current.startedAt === entry.startedAt && Date.now() - current.startedAt >= UPDATE_LOCK_TIMEOUT) {
      state.updating.delete(key);
      render();
    }
  }, UPDATE_LOCK_TIMEOUT + 250);
}

function finishUpdate(key) {
  if (!key) return;
  state.updating.delete(key);
  stopUpdateTickerIfIdle();
}

function cleanupStaleUpdates() {
  const now = Date.now();
  for (const [key, entry] of state.updating.entries()) {
    if (now - entry.startedAt > UPDATE_LOCK_TIMEOUT) {
      state.updating.delete(key);
    }
  }
}

function updateModalButton() {
  if (!elements.modalOpen) return;
  const hasSession = state.modalSessions.size > 0;
  elements.modalOpen.classList.toggle('hidden', !hasSession);
  elements.modalOpen.disabled = !hasSession;
}

function updateFiltersVisibility() {
  if (elements.imagesOnlyFilter) {
    elements.imagesOnlyFilter.classList.toggle('hidden', state.viewMode !== 'images');
  }
  if (elements.stackLayoutToggle) {
    elements.stackLayoutToggle.classList.toggle('hidden', state.viewMode !== 'stacks');
  }
  if (elements.appHeader) {
    elements.appHeader.classList.toggle('images-view', state.viewMode === 'images');
  }
}

function setStackLayout(layout) {
  state.stackLayout = layout;
  if (elements.layoutGrouped) {
    elements.layoutGrouped.classList.toggle('active', layout === 'grouped');
  }
  if (elements.layoutGrid) {
    elements.layoutGrid.classList.toggle('active', layout === 'grid');
  }
  if (elements.layoutCompact) {
    elements.layoutCompact.classList.toggle('active', layout === 'compact');
  }
  render();
}

function renderModalMessages() {
  const session = state.modalSessions.get(state.activeSession);
  elements.modalBody.innerHTML = '';
  if (!session) return;
  session.messages.forEach((msg) => appendMessageToModal(msg));
  elements.modalBody.scrollTop = elements.modalBody.scrollHeight;
}

function appendMessageToModal(msg) {
  const pre = document.createElement('pre');
  pre.textContent = `[${msg.stage}] ${msg.message}`;
  elements.modalBody.appendChild(pre);
}

function ensureUpdateTicker() {
  if (state.updateTicker) return;
  state.updateTicker = setInterval(() => {
    if (state.updating.size === 0) {
      clearInterval(state.updateTicker);
      state.updateTicker = null;
      return;
    }
    render();
  }, 1000);
}

function stopUpdateTickerIfIdle() {
  if (state.updating.size !== 0) return;
  if (state.updateTicker) {
    clearInterval(state.updateTicker);
    state.updateTicker = null;
  }
}

function sessionKeyForStack(stackName) {
  return stackName ? `stack:${stackName}` : '';
}

function sessionKeyForImage(repoTag) {
  return repoTag ? `image:${repoTag}` : '';
}

function startModalSession(key, title) {
  if (!key) return;
  state.modalSessions.set(key, { title: title || 'Execution Details', messages: [] });
  state.activeSession = key;
  updateModalButton();
  renderModalSessions();
  updateModalTitle();
  renderModalMessages();
}

function ensureModalSession(key, title) {
  if (!key) return;
  if (!state.modalSessions.has(key)) {
    state.modalSessions.set(key, { title: title || 'Execution Details', messages: [] });
  } else if (title) {
    const session = state.modalSessions.get(key);
    session.title = title;
  }
  updateModalButton();
  renderModalSessions();
}

function setActiveSession(key) {
  if (!state.modalSessions.has(key)) return;
  state.activeSession = key;
  renderModalSessions();
  updateModalTitle();
  renderModalMessages();
}

function renderModalSessions() {
  if (!elements.modalSessions) return;
  elements.modalSessions.innerHTML = '';
  state.modalSessions.forEach((session, key) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `modal-session${key === state.activeSession ? ' active' : ''}`;
    btn.textContent = session.title;
    btn.addEventListener('click', () => setActiveSession(key));
    elements.modalSessions.appendChild(btn);
  });
}

function updateModalTitle() {
  const session = state.modalSessions.get(state.activeSession);
  elements.modalTitle.textContent = session?.title || 'Execution Details';
}

function appendMessagesFor(sessionKey, messages) {
  ensureModalSession(sessionKey);
  const session = state.modalSessions.get(sessionKey);
  messages.forEach((msg) => {
    if (!msg.message) return;
    session.messages.push(msg);
    if (state.modalVisible && sessionKey === state.activeSession) {
      appendMessageToModal(msg);
    }
  });
  if (state.modalVisible && sessionKey === state.activeSession) {
    elements.modalBody.scrollTop = elements.modalBody.scrollHeight;
  }
}

function updateServiceInState(service) {
  if (!service || !service.stackName || !service.serviceName) return;
  const key = keyFor(service);
  const idx = state.services.findIndex((svc) => keyFor(svc) === key);
  if (idx >= 0) {
    state.services[idx] = service;
  }
  const stack = state.stacks.find((s) => s.name === service.stackName);
  if (stack && Array.isArray(stack.services)) {
    const svcIdx = stack.services.findIndex((svc) => svc.serviceName === service.serviceName);
    if (svcIdx >= 0) {
      stack.services[svcIdx] = service;
    }
  }
}

async function refreshService(service) {
  if (!service?.stackName || !service?.serviceName) return;
  setActionStatus(isDryRun() ? 'Dry run: simulating updates...' : 'Checking updates...');
  setActionButtonsDisabled(true);
  try {
    const res = await fetch(`/api/stacks/${service.stackName}/${service.serviceName}?no_cache=true`);
    if (!res.ok) {
      return;
    }
    const updated = await res.json();
    updateServiceInState(updated);
    render();
  } finally {
    setActionStatus(isDryRun() ? 'Dry run: update check done' : 'Update check done');
    setTimeout(() => setActionStatus(''), 1500);
    setActionButtonsDisabled(false);
  }
}

async function refreshImage(entry) {
  if (!entry?.repoTag) return;
  setActionStatus(isDryRun() ? 'Dry run: simulating updates...' : 'Checking updates...');
  setActionButtonsDisabled(true);
  try {
    const res = await fetch(`/api/images/check?tag=${encodeURIComponent(entry.repoTag)}&no_cache=true`);
    if (!res.ok) {
      return;
    }
    const updated = await res.json();
    const idx = state.images.findIndex((img) => img.repoTag === entry.repoTag);
    if (idx >= 0) {
      state.images[idx] = updated;
    }
    render();
  } finally {
    setActionStatus(isDryRun() ? 'Dry run: update check done' : 'Update check done');
    setTimeout(() => setActionStatus(''), 1500);
    setActionButtonsDisabled(false);
  }
}

function scheduleStackRefresh(stackName) {
  if (!stackName) return;
  if (state.stackRefreshTimers.has(stackName)) {
    clearTimeout(state.stackRefreshTimers.get(stackName));
  }
  const timerId = setTimeout(() => {
    state.stackRefreshTimers.delete(stackName);
    fetchStacks(true, true);
  }, 300);
  state.stackRefreshTimers.set(stackName, timerId);
}

function startStackUpdate(stackName) {
  if (!stackName) return;
  const stackServices = state.services.filter((svc) => svc.stackName === stackName);
  stackServices.forEach((svc) => startUpdate(keyFor(svc), `Updating stack ${stackName}`));
}

function finishStackUpdate(stackName) {
  if (!stackName) return;
  const stackServices = state.services.filter((svc) => svc.stackName === stackName);
  stackServices.forEach((svc) => finishUpdate(keyFor(svc)));
}

async function updateService(service) {
  if (!confirm(`Update ${service.image?.repoTag || service.name}?`)) {
    return;
  }
  const updateKey = keyFor(service);
  const sessionKey = sessionKeyForStack(service.stackName);
  startStackUpdate(service.stackName);
  startUpdate(updateKey, `Updating ${service.serviceName}`);
  startModalSession(sessionKey, `Stack: ${service.stackName}`);
  openModal();
  appendMessagesFor(sessionKey, [{ stage: 'update', message: 'Update started.' }]);
  render();
  setActionStatus(`Updating ${service.serviceName}...`);
  setActionButtonsDisabled(true);
  await fetch(`/api/stacks/${service.stackName}/${service.serviceName}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inferEnvfile: true, pruneImages: true, restartContainers: true }),
  });
  pollTask(service.stackName, service.serviceName);
  if (isDryRun()) {
    scheduleStackRefresh(service.stackName);
  }
}

async function updateSelected() {
  if (state.viewMode === 'images') {
    if (state.selected.size === 0) {
      alert('No images selected.');
      return;
    }
    const selectedImages = state.images.filter((img) => state.selected.has(imageKey(img)));
    if (!confirm(`Pull ${selectedImages.length} images?`)) {
      return;
    }
    const first = selectedImages[0];
    const firstSession = first ? sessionKeyForImage(first.repoTag) : '';
    selectedImages.forEach((img) => {
      startUpdate(imageKey(img), `Pulling ${img.repoTag}`);
      ensureModalSession(sessionKeyForImage(img.repoTag), `Image: ${img.repoTag}`);
    });
    if (firstSession) {
      startModalSession(firstSession, `Image: ${first.repoTag}`);
      openModal();
      appendMessagesFor(firstSession, [{ stage: 'docker pull', message: 'Batch pull started.' }]);
    }
    render();
    setActionStatus(`Pulling ${selectedImages.length} images...`);
    setActionButtonsDisabled(true);
    for (const img of selectedImages) {
      await fetch('/api/images/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoTag: img.repoTag }),
      });
      appendMessagesFor(sessionKeyForImage(img.repoTag), [{ stage: 'docker pull', message: `Pull requested: ${img.repoTag}` }]);
      finishUpdate(imageKey(img));
    }
    setActionStatus('Pull finished');
    setTimeout(() => setActionStatus(''), 1500);
    setActionButtonsDisabled(false);
    if (isDryRun()) {
      await fetchImages(true, true);
    }
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
  const stacksToUpdate = new Set(withUpdates.map((svc) => svc.stackName).filter(Boolean));
  stacksToUpdate.forEach((stackName) => startStackUpdate(stackName));
  withUpdates.forEach((svc) => startUpdate(keyFor(svc), `Updating ${svc.serviceName}`));
  const stackNames = Array.from(stacksToUpdate);
  stackNames.forEach((stackName) => ensureModalSession(sessionKeyForStack(stackName), `Stack: ${stackName}`));
  if (stackNames.length) {
    startModalSession(sessionKeyForStack(stackNames[0]), `Stack: ${stackNames[0]}`);
    openModal();
    appendMessagesFor(sessionKeyForStack(stackNames[0]), [{ stage: 'update', message: 'Batch update started.' }]);
  }
  render();
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
    pollTask(withUpdates[0].stackName, withUpdates[0].serviceName);
  } else {
    const stackServiceMap = new Map();
    withUpdates.forEach((svc) => {
      if (!stackServiceMap.has(svc.stackName)) {
        stackServiceMap.set(svc.stackName, svc.serviceName);
      }
    });
    stackServiceMap.forEach((serviceName, stackName) => {
      pollTask(stackName, serviceName);
    });
    setActionStatus('Updates started');
    setTimeout(() => setActionStatus(''), 2000);
    setActionButtonsDisabled(false);
  }
  if (isDryRun()) {
    const stacksToRefresh = new Set(withUpdates.map((svc) => svc.stackName).filter(Boolean));
    stacksToRefresh.forEach((stackName) => scheduleStackRefresh(stackName));
  }
  state.selected.clear();
  render();
}

async function updateImage(repoTag) {
  if (!confirm(`Pull ${repoTag}?`)) {
    return;
  }
  const updateKey = imageKey({ repoTag });
  const sessionKey = sessionKeyForImage(repoTag);
  startUpdate(updateKey, `Pulling ${repoTag}`);
  startModalSession(sessionKey, `Image: ${repoTag}`);
  openModal();
  appendMessagesFor(sessionKey, [{ stage: 'docker pull', message: 'Pull started.' }]);
  render();
  setActionStatus(`Pulling ${repoTag}...`);
  setActionButtonsDisabled(true);
  const res = await fetch('/api/images/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoTag }),
  });
  const data = await res.json();
  if (Array.isArray(data?.output)) {
    appendMessagesFor(sessionKey, data.output.map((line) => ({ stage: 'docker pull', message: line })));
  } else if (data?.message) {
    appendMessagesFor(sessionKey, [{ stage: 'docker pull', message: data.message }]);
  }
  setActionStatus('Pull finished');
  setTimeout(() => setActionStatus(''), 1500);
  setActionButtonsDisabled(false);
  if (isDryRun()) {
    await fetchImages(true, true);
  }
  finishUpdate(updateKey);
  render();
}

function openModal() {
  updateModalTitle();
  renderModalMessages();
  elements.modal.classList.remove('hidden');
  elements.modal.hidden = false;
  state.modalVisible = true;
  updateModalButton();
}

function closeModal() {
  elements.modal.classList.add('hidden');
  elements.modal.hidden = true;
  state.modalVisible = false;
}

function pollTask(stack, service) {
  const pollingKey = `${stack}/${service}`;
  const sessionKey = sessionKeyForStack(stack);
  let offset = 0;
  if (state.polling.has(pollingKey)) {
    clearInterval(state.polling.get(pollingKey));
  }
  const intervalId = setInterval(async () => {
    const res = await fetch(`/api/stacks/${stack}/${service}/task?offset=${offset}`);
    if (!res.ok) {
      return;
    }
    const messages = await res.json();
    if (Array.isArray(messages) && messages.length) {
      offset += messages.length;
      ensureModalSession(sessionKey, `Stack: ${stack}`);
      appendMessagesFor(sessionKey, messages);
      const finished = messages.some((msg) => msg.stage === 'Finished');
      if (finished) {
        clearInterval(intervalId);
        state.polling.delete(pollingKey);
        if (isDryRun()) {
          fetchStacks(true, true);
        } else {
          fetchStacks(true, true);
        }
        setActionStatus('Update finished');
        setTimeout(() => setActionStatus(''), 1500);
        setActionButtonsDisabled(false);
        finishStackUpdate(stack);
        render();
      }
    }
  }, 800);
  state.polling.set(pollingKey, intervalId);
}

init();
