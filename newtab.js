'use strict';

const MAX_RESULTS = 8;
const MAX_BOOKMARKS = 16;
const TILE_COLOURS = ['#4f46e5', '#0d9488', '#db2777', '#d97706', '#2563eb', '#7c3aed', '#059669', '#dc2626'];
const TOKEN_KEY = 'token';
const CACHE_KEY = 'groups-cache';
const PREFERENCES_KEY = 'preferences-cache';
const DEFAULT_PREFERENCES = {
  theme: 'aurora',
  mode: 'auto',
  layout: 'tiles',
  showClock: true,
  showGreeting: true,
  showMostVisited: true,
  showBookmarks: true,
};
const VERIFIER_KEY = 'login-verifier';
const PROMPT_DISMISSED_KEY = 'extension-prompt-dismissed';
const AUTO_LOGIN_KEY = 'auto-login';
const SILENT_ATTEMPT_KEY = 'silent-login-at';
const SILENT_ATTEMPT_INTERVAL_MS = 60 * 60 * 1000;
const SILENT_TIMEOUT_MS = 5000;
const LOGIN_ERRORS = {
  denied: 'GitHub sign-in was cancelled.',
  not_allowed: "This GitHub account doesn't have access.",
  full: "This site can't take any new users right now.",
  not_configured: "GitHub sign-in isn't set up yet.",
  busy: 'Too many sign-in attempts. Try again in 15 minutes.',
  failed: "GitHub sign-in didn't work. Try again.",
};

const hasChrome = typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);
// The extension runs from its own origin, so it needs the full server address. The website uses relative paths.
const API_BASE = hasChrome ? 'https://chrome.ruhul0.com' : '';

const $ = (id) => document.getElementById(id);

let token = null;
let groups = [];
let editing = false;
let autoLinks = [];
let results = [];
let activeResult = 0;
let saveQueue = Promise.resolve();
let userLogin = null;
let preferences = { ...DEFAULT_PREFERENCES };

const store = {
  async get(key) {
    if (hasChrome) return (await chrome.storage.local.get(key))[key] ?? null;
    const value = localStorage.getItem(key);
    return value === null ? null : JSON.parse(value);
  },
  async set(key, value) {
    if (hasChrome) return chrome.storage.local.set({ [key]: value });
    localStorage.setItem(key, JSON.stringify(value));
  },
  async remove(key) {
    if (hasChrome) return chrome.storage.local.remove(key);
    localStorage.removeItem(key);
  },
};

class SignedOutError extends Error {}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    await showLogin();
    throw new SignedOutError();
  }
  if (!response.ok) throw new Error(data.error || 'The server had a problem.');
  return data;
}

function showNotice(text) {
  $('notice').textContent = text || '';
  $('notice').hidden = !text;
}

function applyPreferences() {
  const root = document.documentElement;
  root.dataset.theme = preferences.theme;
  root.dataset.mode = preferences.mode;
  root.dataset.layout = preferences.layout;
  root.classList.toggle('is-extension', hasChrome);

  $('time').hidden = !preferences.showClock;
  $('greeting').hidden = !preferences.showGreeting;
  $('date').hidden = !preferences.showGreeting;
  $('top-section').hidden = !preferences.showMostVisited || $('top-sites').children.length === 0;
  $('bookmark-section').hidden = !preferences.showBookmarks || $('bookmarks').children.length === 0;

  for (const control of document.querySelectorAll('[data-preference]')) {
    const value = preferences[control.dataset.preference];
    if (control.type === 'checkbox') control.checked = value;
    else control.value = value;
  }
}

async function handlePreferenceChange(event) {
  const control = event.target;
  preferences[control.dataset.preference] = control.type === 'checkbox' ? control.checked : control.value;
  applyPreferences();
  await store.set(PREFERENCES_KEY, preferences);
  try {
    await api('/api/preferences', { method: 'PUT', body: { preferences } });
    showNotice('');
  } catch (error) {
    if (!(error instanceof SignedOutError)) showNotice("Your design change wasn't saved to your account. Check your connection and try again.");
  }
}

async function clearLocalSession() {
  token = null;
  groups = [];
  userLogin = null;
  preferences = { ...DEFAULT_PREFERENCES };
  applyPreferences();
  await Promise.all([store.remove(TOKEN_KEY), store.remove(CACHE_KEY), store.remove(PREFERENCES_KEY)]);
}

async function showLogin() {
  await clearLocalSession();
  editing = false;
  $('app').hidden = true;
  $('account-actions').hidden = true;
  $('login').hidden = false;
  $('github-login').focus();
}

async function showApp() {
  $('login').hidden = true;
  $('app').hidden = false;
  $('account-actions').hidden = false;
  $('query').focus();

  // Saved sites and design appear straight away, then the server's copy replaces them.
  const cachedPreferences = await store.get(PREFERENCES_KEY);
  if (cachedPreferences) {
    preferences = { ...DEFAULT_PREFERENCES, ...cachedPreferences };
    applyPreferences();
  }
  const cached = await store.get(CACHE_KEY);
  if (cached) {
    groups = cached;
    renderGroups();
  }
  loadBrowserLinks().catch(() => {});

  try {
    await refreshGroups();
    showNotice('');
  } catch (error) {
    if (!(error instanceof SignedOutError)) {
      showNotice(cached
        ? "Can't reach your server, so these sites may be out of date."
        : "Can't reach your server. Check your connection and reload this page.");
    }
  }
}

async function refreshGroups() {
  const data = await api('/api/groups');
  groups = data.groups;
  userLogin = data.user.login;
  $('user-name').textContent = `@${userLogin}`;
  $('admin-link').hidden = !data.user.isAdmin;
  $('admin-link').href = `${API_BASE}/admin.html`;
  updateClock();
  preferences = { ...DEFAULT_PREFERENCES, ...data.preferences };
  applyPreferences();
  await store.set(PREFERENCES_KEY, preferences);
  await store.set(CACHE_KEY, groups);
  renderGroups();
  showExtensionPrompt(data.extensionUrl);
}

// Saves run one at a time, so quick edits reach the server in the order they were made.
function saveGroups() {
  const snapshot = structuredClone(groups);
  saveQueue = saveQueue.then(async () => {
    try {
      await api('/api/groups', { method: 'PUT', body: { groups: snapshot } });
      await store.set(CACHE_KEY, snapshot);
      showNotice('');
    } catch (error) {
      if (!(error instanceof SignedOutError)) {
        showNotice(`Your last change wasn't saved. ${error.message} Reload the page and try again.`);
      }
    }
  });
  return saveQueue;
}

// Accepts only http and https addresses, so a saved link can never run script.
function normalizeUrl(value) {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function looksLikeAddress(text) {
  return /^(https?:\/\/)?(localhost|[^\s/]+\.[^\s/]{2,})(:\d+)?(\/\S*)?$/i.test(text);
}

// The same site always gets the same colour.
function tileColour(text) {
  let total = 0;
  for (const character of text) total = (total * 31 + character.codePointAt(0)) % 9973;
  return TILE_COLOURS[total % TILE_COLOURS.length];
}

function makeIcon(link) {
  const letter = () => {
    const tile = document.createElement('span');
    tile.className = 'icon letter';
    tile.textContent = (link.name || '?').charAt(0).toUpperCase();
    tile.style.setProperty('--tile', tileColour(link.name || '?'));
    return tile;
  };
  if (!hasChrome) return letter();

  const image = document.createElement('img');
  image.className = 'icon';
  image.alt = '';
  image.src = `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(link.url)}&size=32`;
  image.addEventListener('error', () => image.replaceWith(letter()));
  return image;
}

function makeLink(link) {
  const anchor = document.createElement('a');
  anchor.className = 'link';
  anchor.href = link.url;
  anchor.title = link.url;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = link.name;
  anchor.append(makeIcon(link), name);
  return anchor;
}

function makeAddForm(group) {
  const form = document.createElement('form');
  form.className = 'add-form';

  const name = document.createElement('input');
  name.className = 'field';
  name.placeholder = 'Name';
  name.maxLength = 100;
  name.setAttribute('aria-label', `Name of new link in ${group.name}`);

  const address = document.createElement('input');
  address.className = 'field';
  address.placeholder = 'Address, like example.com';
  address.setAttribute('aria-label', `Address of new link in ${group.name}`);

  const error = document.createElement('p');
  error.className = 'form-error';
  error.hidden = true;

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Add link';

  form.append(name, address, error, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = normalizeUrl(address.value);
    if (!url) {
      error.textContent = 'Enter a web address, like example.com.';
      error.hidden = false;
      address.focus();
      return;
    }
    group.links.push({ name: name.value.trim() || new URL(url).hostname.replace(/^www\./, ''), url });
    renderGroups();
    await saveGroups();
  });
  return form;
}

function makeGroupTitle(group, index) {
  const title = document.createElement('div');
  title.className = 'group-title';

  if (!editing) {
    const heading = document.createElement('h2');
    heading.textContent = group.name;
    title.append(heading);
    return title;
  }

  const name = document.createElement('input');
  name.className = 'field';
  name.value = group.name;
  name.maxLength = 100;
  name.setAttribute('aria-label', 'Group name');
  name.addEventListener('change', async () => {
    group.name = name.value.trim() || group.name;
    name.value = group.name;
    await saveGroups();
  });
  title.append(name);

  // A group can only be removed once empty, which prevents losing several links with one click.
  if (group.links.length === 0) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove group ${group.name}`);
    remove.addEventListener('click', async () => {
      groups.splice(index, 1);
      renderGroups();
      await saveGroups();
    });
    title.append(remove);
  }
  return title;
}

function renderGroups() {
  const container = $('groups');
  container.replaceChildren();

  groups.forEach((group, groupIndex) => {
    const section = document.createElement('div');
    section.className = 'card';
    section.append(makeGroupTitle(group, groupIndex));

    const links = document.createElement('div');
    links.className = 'links';
    section.append(links);

    group.links.forEach((link, linkIndex) => {
      const row = document.createElement('div');
      row.className = 'link-row';
      row.append(makeLink(link));
      if (editing) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${link.name}`);
        remove.addEventListener('click', async () => {
          group.links.splice(linkIndex, 1);
          renderGroups();
          await saveGroups();
        });
        row.append(remove);
      }
      links.append(row);
    });

    if (editing) section.append(makeAddForm(group));
    container.append(section);
  });

  $('edit-actions').hidden = !editing;
  $('edit').textContent = editing ? 'Done' : 'Edit';
  $('edit').setAttribute('aria-pressed', String(editing));
}

function fillAutoSection(sectionId, listId, links) {
  $(listId).replaceChildren(...links.map(makeLink));
  applyPreferences();
}

// Most visited and bookmarks come from this browser and are never sent to the server.
async function loadBrowserLinks() {
  if (!hasChrome) return;

  const topSites = await chrome.topSites.get();
  const top = topSites.slice(0, 8).map((site) => ({ name: site.title || site.url, url: site.url }));
  fillAutoSection('top-section', 'top-sites', top);

  const tree = await chrome.bookmarks.getTree();
  const bookmarks = [];
  const collect = (nodes) => {
    for (const node of nodes) {
      if (node.url && normalizeUrl(node.url)) bookmarks.push({ name: node.title || node.url, url: node.url });
      if (node.children) collect(node.children);
    }
  };
  collect(tree);
  fillAutoSection('bookmark-section', 'bookmarks', bookmarks.slice(0, MAX_BOOKMARKS));

  autoLinks = [
    ...top.map((link) => ({ ...link, kind: 'Most visited' })),
    ...bookmarks.map((link) => ({ ...link, kind: 'Bookmark' })),
  ];
}

function findMatches(text) {
  const needle = text.toLowerCase();
  const seen = new Set();
  const own = groups.flatMap((group) => group.links.map((link) => ({ ...link, kind: group.name })));
  return [...own, ...autoLinks].filter((link) => {
    const matches = link.name.toLowerCase().includes(needle) || link.url.toLowerCase().includes(needle);
    if (!matches || seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function renderResults() {
  const list = $('results');
  list.replaceChildren(...results.map((result, index) => {
    const item = document.createElement('li');
    if (index === activeResult) item.className = 'active';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = result.name;
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = result.kind;
    item.append(makeIcon(result), label, kind);
    // mousedown runs before the input loses focus, so the results list is still in place.
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      openResult(result, event.metaKey || event.ctrlKey);
    });
    return item;
  }));
  list.hidden = results.length === 0;
}

function updateResults() {
  const text = $('query').value.trim();
  if (!text) {
    results = [];
    renderResults();
    return;
  }

  const matches = findMatches(text).slice(0, MAX_RESULTS - 1);
  const web = looksLikeAddress(text)
    ? { name: `Go to ${text}`, url: normalizeUrl(text), kind: 'Address' }
    : { name: `Search the web for "${text}"`, query: text, kind: 'Web', url: 'https://www.google.com/' };

  // Site matches come first, so typing "you" and pressing Enter opens YouTube.
  results = web.kind === 'Address' ? [web, ...matches] : [...matches, web];
  activeResult = 0;
  renderResults();
}

function openResult(result, inNewTab) {
  if (result.query) {
    if (hasChrome) {
      chrome.search.query({ text: result.query, disposition: inNewTab ? 'NEW_TAB' : 'CURRENT_TAB' });
    } else {
      location.href = `https://www.google.com/search?q=${encodeURIComponent(result.query)}`;
    }
    return;
  }
  if (inNewTab) window.open(result.url, '_blank');
  else location.href = result.url;
}

function handleSearchKeys(event) {
  if (event.key === 'Escape') {
    $('query').value = '';
    updateResults();
  } else if (results.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    activeResult = (activeResult + step + results.length) % results.length;
    renderResults();
  } else if (event.key === 'Enter' && results[activeResult]) {
    event.preventDefault();
    openResult(results[activeResult], event.metaKey || event.ctrlKey);
  }
}

// Once the page has focus, pressing "/" jumps to the search box.
function handleGlobalKeys(event) {
  if (event.key === '/' && !$('app').hidden && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
    event.preventDefault();
    $('query').focus();
  }
}

function showLoginError(text) {
  $('login-error').textContent = text;
  $('login-error').hidden = false;
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function finishLogin(code, verifier) {
  const data = await api('/api/auth/exchange', { method: 'POST', body: { code, verifier } });
  token = data.token;
  await store.set(TOKEN_KEY, token);
  await store.set(AUTO_LOGIN_KEY, true);
  await showApp();
}

// The server only hands over a session to the browser holding the secret behind this challenge.
async function createLoginProof() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(digest) };
}

function extensionLoginUrl(challenge) {
  return `${API_BASE}/auth/github/start?client=extension&extension_id=${chrome.runtime.id}&challenge=${challenge}`;
}

// The extension signs in through Chrome's own sign-in window, which returns the result directly.
async function loginInExtension(verifier, challenge) {
  let redirected;
  try {
    redirected = await chrome.identity.launchWebAuthFlow({ url: extensionLoginUrl(challenge), interactive: true });
  } catch {
    showLoginError(LOGIN_ERRORS.denied);
    return;
  }
  const params = new URL(redirected).searchParams;
  if (params.get('error')) {
    showLoginError(LOGIN_ERRORS[params.get('error')] || LOGIN_ERRORS.failed);
    return;
  }
  await finishLogin(params.get('code'), verifier);
}

// If the browser is already signed in to GitHub and has approved Home Base, this finishes with
// no window at all. Otherwise it fails quietly and the sign-in button stays on the page.
// New tabs open often, so it runs at most once an hour and never after someone signs out.
async function trySilentExtensionLogin() {
  if ((await store.get(AUTO_LOGIN_KEY)) === false) return;
  const lastAttempt = await store.get(SILENT_ATTEMPT_KEY);
  if (lastAttempt && Date.now() - lastAttempt < SILENT_ATTEMPT_INTERVAL_MS) return;
  await store.set(SILENT_ATTEMPT_KEY, Date.now());

  try {
    const { verifier, challenge } = await createLoginProof();
    const redirected = await chrome.identity.launchWebAuthFlow({
      url: extensionLoginUrl(challenge),
      interactive: false,
      timeoutMsForNonInteractive: SILENT_TIMEOUT_MS,
    });
    const code = new URL(redirected).searchParams.get('code');
    if (code) await finishLogin(code, verifier);
  } catch {
    // Someone not signed in to GitHub simply sees the sign-in button.
  }
}

async function handleLogin() {
  $('login-error').hidden = true;
  $('github-login').disabled = true;
  try {
    const { verifier, challenge } = await createLoginProof();

    if (hasChrome) {
      await loginInExtension(verifier, challenge);
      return;
    }
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    location.href = `/auth/github/start?challenge=${challenge}`;
  } catch {
    showLoginError(LOGIN_ERRORS.failed);
  } finally {
    $('github-login').disabled = false;
  }
}

function isDesktopChrome() {
  const brands = navigator.userAgentData;
  return Boolean(brands && !brands.mobile && brands.brands.some((brand) => brand.brand === 'Google Chrome'));
}

// After signing in on the website, desktop Chrome users are offered the extension once per browser.
function showExtensionPrompt(url) {
  if (hasChrome || !url || !isDesktopChrome() || localStorage.getItem(PROMPT_DISMISSED_KEY)) return;
  const dismiss = () => {
    localStorage.setItem(PROMPT_DISMISSED_KEY, '1');
    $('extension-prompt').hidden = true;
  };
  $('extension-link').href = url;
  $('extension-link').onclick = dismiss;
  $('extension-dismiss').onclick = dismiss;
  $('extension-prompt').hidden = false;
}

// GitHub sign-in returns here with a one-time code in the address, which is removed straight away.
async function resumeLogin() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return false;

  history.replaceState(null, '', location.pathname);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);

  await showLogin();
  if (error || !verifier) {
    showLoginError(LOGIN_ERRORS[error] || LOGIN_ERRORS.failed);
    return true;
  }
  try {
    await finishLogin(code, verifier);
  } catch {
    showLoginError(LOGIN_ERRORS.failed);
  }
  return true;
}

async function handleSignOut() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    // The local session still ends if the server can't be reached.
  }
  // Signing out is a deliberate choice, so automatic sign-in stays off until the next manual sign-in.
  await store.set(AUTO_LOGIN_KEY, false);
  await showLogin();
  if (!hasChrome) location.replace('/');
}

function updateClock() {
  const now = new Date();
  $('time').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  const hour = now.getHours();
  const period = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('greeting').textContent = userLogin ? `${period}, ${userLogin}` : period;
}

function bindEvents() {
  $('github-login').addEventListener('click', handleLogin);
  $('sign-out').addEventListener('click', handleSignOut);

  $('query').addEventListener('input', updateResults);
  $('query').addEventListener('keydown', handleSearchKeys);
  $('query').addEventListener('blur', () => { $('results').hidden = true; });
  $('query').addEventListener('focus', () => { $('results').hidden = results.length === 0; });
  document.addEventListener('keydown', handleGlobalKeys);

  $('customize-toggle').addEventListener('click', () => {
    const opening = $('customize').hidden;
    $('customize').hidden = !opening;
    $('customize-toggle').setAttribute('aria-expanded', String(opening));
    $('customize-toggle').textContent = opening ? 'Close' : 'Customize';
  });
  for (const control of document.querySelectorAll('[data-preference]')) {
    control.addEventListener('change', handlePreferenceChange);
  }

  $('edit').addEventListener('click', () => {
    editing = !editing;
    renderGroups();
  });
  $('add-group').addEventListener('click', async () => {
    groups.push({ name: 'New group', links: [] });
    renderGroups();
    await saveGroups();
  });
  $('reset').addEventListener('click', async () => {
    try {
      await saveQueue;
      const data = await api('/api/groups/reset', { method: 'POST' });
      groups = data.groups;
      await store.set(CACHE_KEY, groups);
      renderGroups();
      showNotice('');
    } catch (error) {
      if (!(error instanceof SignedOutError)) showNotice(`Couldn't restore your sites. ${error.message}`);
    }
  });
}

async function start() {
  updateClock();
  setInterval(updateClock, 10000);
  bindEvents();
  applyPreferences();

  if (await resumeLogin()) return;

  token = await store.get(TOKEN_KEY);
  if (token) {
    await showApp();
    return;
  }

  if (hasChrome) {
    await showLogin();
    await trySilentExtensionLogin();
    return;
  }

  if (new URLSearchParams(location.search).has('signin')) {
    history.replaceState(null, '', location.pathname);
    await showLogin();
    await handleLogin();
    return;
  }
  location.replace('/');
}

start();
