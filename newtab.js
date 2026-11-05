'use strict';

const MAX_RESULTS = 8;
const MAX_BOOKMARKS = 16;
const TILE_COLOURS = ['#4f46e5', '#0d9488', '#db2777', '#d97706', '#2563eb', '#7c3aed', '#059669', '#dc2626'];
const TOKEN_KEY = 'token';
const CACHE_KEY = 'groups-cache';
const PREFERENCES_KEY = 'preferences-cache';
const BACKGROUND_CACHE_KEY = 'background-cache';
const SAVE_DELAY_MS = 500;
const MAX_BACKGROUND_BYTES = 450 * 1024;
const BACKGROUND_WIDTHS = [1920, 1600, 1280];
const BACKGROUND_QUALITIES = [0.82, 0.68, 0.55];

const DEFAULT_PREFERENCES = {
  theme: 'aurora',
  accentColor: '',
  mode: 'auto',
  backgroundType: 'theme',
  backgroundColor: '#1f2937',
  backgroundDim: 20,
  pattern: 'none',
  font: 'system',
  layout: 'tiles',
  tileSize: 'medium',
  iconShape: 'rounded',
  columns: 'auto',
  pageWidth: 'normal',
  cardStyle: 'glass',
  corners: 'round',
  heroAlign: 'center',
  clockFormat: 'auto',
  clockSize: 'medium',
  greetingText: '',
  searchEngine: 'default',
  showClock: true,
  showSeconds: false,
  showGreeting: true,
  showDate: true,
  showSearch: true,
  showLabels: true,
  showGroupTitles: true,
  showMostVisited: true,
  showBookmarks: true,
};

// Preferences that CSS reads directly from attributes on the page's root element.
const ROOT_ATTRIBUTES = [
  'theme', 'mode', 'backgroundType', 'pattern', 'font', 'layout', 'tileSize', 'iconShape',
  'columns', 'pageWidth', 'cardStyle', 'corners', 'heroAlign', 'clockSize',
];

const LOOKS = {
  Default: {},
  Minimal: { theme: 'mono', cardStyle: 'none', layout: 'compact', showGreeting: false, showDate: false, showGroupTitles: false, clockSize: 'small' },
  Focus: { theme: 'midnight', mode: 'dark', pageWidth: 'narrow', layout: 'list', clockSize: 'large', pattern: 'grid' },
  Cosy: { theme: 'amber', mode: 'light', font: 'serif', cardStyle: 'solid', corners: 'soft', iconShape: 'circle' },
  Terminal: { theme: 'forest', mode: 'dark', font: 'mono', cardStyle: 'outline', corners: 'sharp', iconShape: 'square', layout: 'list', pattern: 'lines', accentColor: '#16a34a' },
  Bold: { theme: 'sunset', mode: 'dark', tileSize: 'large', clockSize: 'large', font: 'rounded', cardStyle: 'solid' },
};

const options = (...pairs) => pairs.map(([value, label]) => ({ value, label }));

const CONTROL_SECTIONS = [
  {
    title: 'Colours',
    controls: [
      { key: 'theme', label: 'Theme', type: 'select', choices: options(['aurora', 'Aurora'], ['ocean', 'Ocean'], ['sunset', 'Sunset'], ['forest', 'Forest'], ['rose', 'Rose'], ['violet', 'Violet'], ['amber', 'Amber'], ['midnight', 'Midnight'], ['mono', 'Mono']) },
      { key: 'mode', label: 'Appearance', type: 'select', choices: options(['auto', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']) },
      { key: 'accentColor', label: 'Accent colour', type: 'color' },
    ],
  },
  {
    title: 'Background',
    custom: 'background',
    controls: [
      { key: 'backgroundType', label: 'Background', type: 'select', choices: options(['theme', 'Theme colours'], ['solid', 'Solid colour'], ['image', 'My own image']) },
      { key: 'backgroundColor', label: 'Solid colour', type: 'color', showWhen: { backgroundType: 'solid' } },
      { key: 'backgroundDim', label: 'Darken image', type: 'select', number: true, showWhen: { backgroundType: 'image' }, choices: options([0, 'None'], [20, 'A little'], [40, 'Medium'], [60, 'A lot']) },
      { key: 'pattern', label: 'Pattern', type: 'select', choices: options(['none', 'None'], ['dots', 'Dots'], ['grid', 'Grid'], ['lines', 'Lines']) },
    ],
  },
  {
    title: 'Sites',
    controls: [
      { key: 'layout', label: 'Layout', type: 'select', choices: options(['tiles', 'Tiles'], ['list', 'List'], ['compact', 'Icons only']) },
      { key: 'tileSize', label: 'Icon size', type: 'select', choices: options(['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']) },
      { key: 'iconShape', label: 'Icon shape', type: 'select', choices: options(['rounded', 'Rounded'], ['circle', 'Circle'], ['square', 'Square']) },
      { key: 'showLabels', label: 'Show site names', type: 'check' },
      { key: 'showGroupTitles', label: 'Show group names', type: 'check' },
    ],
  },
  {
    title: 'Page layout',
    controls: [
      { key: 'columns', label: 'Group columns', type: 'select', choices: options(['auto', 'Automatic'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']) },
      { key: 'pageWidth', label: 'Page width', type: 'select', choices: options(['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']) },
      { key: 'cardStyle', label: 'Group style', type: 'select', choices: options(['glass', 'Glass'], ['solid', 'Solid'], ['outline', 'Outline'], ['none', 'No boxes']) },
      { key: 'corners', label: 'Corners', type: 'select', choices: options(['round', 'Round'], ['soft', 'Soft'], ['sharp', 'Sharp']) },
      { key: 'heroAlign', label: 'Clock and search position', type: 'select', choices: options(['center', 'Centre'], ['left', 'Left']) },
    ],
  },
  {
    title: 'Text',
    controls: [
      { key: 'font', label: 'Font', type: 'select', choices: options(['system', 'System'], ['serif', 'Serif'], ['mono', 'Monospace'], ['rounded', 'Rounded']) },
      { key: 'greetingText', label: 'Custom greeting', type: 'text', placeholder: 'Leave empty for "Good morning"', maxLength: 60 },
      { key: 'showGreeting', label: 'Show greeting', type: 'check' },
      { key: 'showDate', label: 'Show date', type: 'check' },
    ],
  },
  {
    title: 'Clock',
    controls: [
      { key: 'showClock', label: 'Show clock', type: 'check' },
      { key: 'clockFormat', label: 'Format', type: 'select', choices: options(['auto', 'Match my device'], ['12', '12 hour'], ['24', '24 hour']) },
      { key: 'clockSize', label: 'Size', type: 'select', choices: options(['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']) },
      { key: 'showSeconds', label: 'Show seconds', type: 'check' },
    ],
  },
  {
    title: 'Search and sections',
    controls: [
      { key: 'searchEngine', label: 'Search engine', type: 'select', choices: options(['default', 'Default'], ['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['bing', 'Bing'], ['brave', 'Brave']) },
      { key: 'showSearch', label: 'Show search box', type: 'check' },
      { key: 'showMostVisited', label: 'Show most visited', type: 'check', extensionOnly: true },
      { key: 'showBookmarks', label: 'Show bookmarks', type: 'check', extensionOnly: true },
    ],
  },
];

const SEARCH_URLS = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
  brave: 'https://search.brave.com/search?q=',
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
let preferenceSaveTimer = null;
let editingLink = null;
let dragItem = null;

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

function relativeLuminance(hex) {
  const channel = (start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function applyColours() {
  const root = document.documentElement.style;
  if (preferences.accentColor) {
    root.setProperty('--accent', preferences.accentColor);
    root.setProperty('--on-accent', relativeLuminance(preferences.accentColor) > 0.4 ? '#14152a' : '#ffffff');
  } else {
    root.removeProperty('--accent');
    root.removeProperty('--on-accent');
  }

  // Clock and greeting sit directly on a solid background, so their colour must suit it.
  if (preferences.backgroundType === 'solid') {
    const isLight = relativeLuminance(preferences.backgroundColor) > 0.35;
    root.setProperty('--custom-background', preferences.backgroundColor);
    root.setProperty('--hero-text', isLight ? '#1c1c28' : '#ffffff');
    root.setProperty('--hero-muted', isLight ? '#4a4a5c' : 'rgb(255 255 255 / 0.8)');
  } else {
    root.removeProperty('--custom-background');
    root.removeProperty('--hero-text');
    root.removeProperty('--hero-muted');
  }
  root.setProperty('--background-dim', String(preferences.backgroundDim / 100));
}

function syncControls() {
  for (const control of document.querySelectorAll('[data-preference]')) {
    const key = control.dataset.preference;
    const value = preferences[key];
    if (control.type === 'checkbox') control.checked = value;
    // With no custom accent, the picker shows the colour the theme is actually using.
    else if (control.type === 'color') control.value = value || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    else control.value = value;
  }
  for (const wrapper of document.querySelectorAll('[data-show-key]')) {
    wrapper.hidden = String(preferences[wrapper.dataset.showKey]) !== wrapper.dataset.showValue;
  }
}

function applyPreferences() {
  const root = document.documentElement;
  for (const key of ROOT_ATTRIBUTES) root.dataset[key] = preferences[key];
  root.classList.toggle('is-extension', hasChrome);
  root.classList.toggle('hide-labels', !preferences.showLabels);
  root.classList.toggle('hide-group-titles', !preferences.showGroupTitles);
  applyColours();

  $('time').hidden = !preferences.showClock;
  $('greeting').hidden = !preferences.showGreeting;
  $('date').hidden = !preferences.showDate;
  document.querySelector('.search').hidden = !preferences.showSearch;
  $('top-section').hidden = !preferences.showMostVisited || $('top-sites').children.length === 0;
  $('bookmark-section').hidden = !preferences.showBookmarks || $('bookmarks').children.length === 0;

  syncControls();
  updateClock();
}

// Quick changes, like dragging across the colour picker, are saved together once they stop.
function schedulePreferenceSave() {
  clearTimeout(preferenceSaveTimer);
  store.set(PREFERENCES_KEY, preferences);
  preferenceSaveTimer = setTimeout(() => {
    const snapshot = { ...preferences };
    saveQueue = saveQueue.then(async () => {
      try {
        await api('/api/preferences', { method: 'PUT', body: { preferences: snapshot } });
        showNotice('');
      } catch (error) {
        if (!(error instanceof SignedOutError)) showNotice("Your design change wasn't saved to your account. Check your connection and try again.");
      }
    });
  }, SAVE_DELAY_MS);
}

function setPreference(key, value) {
  preferences[key] = value;
  applyPreferences();
  schedulePreferenceSave();
}

function applyLook(name) {
  preferences = { ...DEFAULT_PREFERENCES, greetingText: preferences.greetingText, ...LOOKS[name] };
  applyPreferences();
  schedulePreferenceSave();
}

function makeControl(control) {
  const wrapper = document.createElement('label');
  wrapper.className = control.type === 'check' ? 'control check' : 'control';
  if (control.extensionOnly) wrapper.classList.add('extension-only');
  if (control.showWhen) {
    const [showKey, showValue] = Object.entries(control.showWhen)[0];
    wrapper.dataset.showKey = showKey;
    wrapper.dataset.showValue = showValue;
  }

  let input;
  if (control.type === 'select') {
    input = document.createElement('select');
    input.className = 'field';
    for (const choice of control.choices) {
      const option = document.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      input.append(option);
    }
    input.addEventListener('change', () => setPreference(control.key, control.number ? Number(input.value) : input.value));
  } else if (control.type === 'check') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => setPreference(control.key, input.checked));
  } else if (control.type === 'color') {
    input = document.createElement('input');
    input.type = 'color';
    input.addEventListener('input', () => setPreference(control.key, input.value));
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.className = 'field';
    input.placeholder = control.placeholder;
    input.maxLength = control.maxLength;
    input.addEventListener('input', () => setPreference(control.key, input.value));
  }
  input.dataset.preference = control.key;

  if (control.type === 'check') wrapper.append(input, control.label);
  else wrapper.append(control.label, input);
  return wrapper;
}

function makeSmallButton(label, onClick, ariaLabel) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', onClick);
  return button;
}

function makeBackgroundUpload() {
  const wrapper = document.createElement('div');
  wrapper.dataset.showKey = 'backgroundType';
  wrapper.dataset.showValue = 'image';

  const label = document.createElement('label');
  label.className = 'control';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.className = 'upload-input';
  input.addEventListener('change', async () => {
    if (input.files[0]) await uploadBackground(input.files[0]);
    input.value = '';
  });
  label.append('Upload an image', input);

  const help = document.createElement('p');
  help.className = 'control-help';
  help.textContent = 'Resized automatically, and only used on your own page.';

  const buttons = document.createElement('div');
  buttons.className = 'control-buttons';
  buttons.append(makeSmallButton('Remove image', removeBackground));

  wrapper.append(label, help, buttons);
  return wrapper;
}

function buildCustomizePanel() {
  const body = $('customize-body');

  const looks = document.createElement('section');
  looks.className = 'control-section';
  const looksTitle = document.createElement('h3');
  looksTitle.textContent = 'Start from a look';
  const lookButtons = document.createElement('div');
  lookButtons.className = 'control-buttons';
  for (const name of Object.keys(LOOKS)) lookButtons.append(makeSmallButton(name, () => applyLook(name)));
  looks.append(looksTitle, lookButtons);
  body.append(looks);

  for (const section of CONTROL_SECTIONS) {
    const element = document.createElement('section');
    element.className = 'control-section';
    const title = document.createElement('h3');
    title.textContent = section.title;
    element.append(title);
    for (const control of section.controls) {
      element.append(makeControl(control));
      if (section.custom === 'background' && control.key === 'backgroundType') element.append(makeBackgroundUpload());
      if (control.key === 'accentColor') {
        const buttons = document.createElement('div');
        buttons.className = 'control-buttons';
        buttons.append(makeSmallButton('Use the theme\'s colour', () => setPreference('accentColor', '')));
        element.append(buttons);
      }
    }
    body.append(element);
  }
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function showBackgroundImage(dataUrl) {
  const style = document.documentElement.style;
  if (dataUrl) style.setProperty('--background-image', `url("${dataUrl}")`);
  else style.removeProperty('--background-image');
}

// Each user's image is kept locally, so new tabs don't download it again unless it changed.
async function syncBackground(version) {
  const cached = await store.get(BACKGROUND_CACHE_KEY);
  if (!version) {
    if (cached) await store.remove(BACKGROUND_CACHE_KEY);
    showBackgroundImage(null);
    return;
  }
  if (cached && cached.version === version) {
    showBackgroundImage(cached.dataUrl);
    return;
  }
  const response = await fetch(`${API_BASE}/api/background`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return;
  const dataUrl = await readAsDataUrl(await response.blob());
  showBackgroundImage(dataUrl);
  await store.set(BACKGROUND_CACHE_KEY, { version, dataUrl });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// Shrinks the image in the browser, so even large photos fit within the upload limit.
async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  for (const width of BACKGROUND_WIDTHS) {
    const scale = Math.min(1, width / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of BACKGROUND_QUALITIES) {
      const blob = await canvasToBlob(canvas, quality);
      if (blob && blob.size <= MAX_BACKGROUND_BYTES) return blob;
    }
  }
  throw new Error('too large');
}

async function uploadBackground(file) {
  showNotice('Uploading your image…');
  try {
    const blob = await compressImage(file);
    const response = await fetch(`${API_BASE}/api/background`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
      body: blob,
    });
    if (!response.ok) throw new Error('upload failed');
    const { version } = await response.json();
    const dataUrl = await readAsDataUrl(blob);
    showBackgroundImage(dataUrl);
    await store.set(BACKGROUND_CACHE_KEY, { version, dataUrl });
    setPreference('backgroundType', 'image');
    showNotice('');
  } catch {
    showNotice("That image couldn't be used. Try a different JPEG or PNG.");
  }
}

async function removeBackground() {
  try {
    await api('/api/background', { method: 'DELETE' });
    await store.remove(BACKGROUND_CACHE_KEY);
    showBackgroundImage(null);
    setPreference('backgroundType', 'theme');
  } catch (error) {
    if (!(error instanceof SignedOutError)) showNotice("Your image couldn't be removed. Try again.");
  }
}

async function clearLocalSession() {
  token = null;
  groups = [];
  userLogin = null;
  preferences = { ...DEFAULT_PREFERENCES };
  clearTimeout(preferenceSaveTimer);
  showBackgroundImage(null);
  applyPreferences();
  await Promise.all([
    store.remove(TOKEN_KEY),
    store.remove(CACHE_KEY),
    store.remove(PREFERENCES_KEY),
    store.remove(BACKGROUND_CACHE_KEY),
  ]);
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
  const cachedBackground = await store.get(BACKGROUND_CACHE_KEY);
  if (cachedBackground) showBackgroundImage(cachedBackground.dataUrl);
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
  syncBackground(data.backgroundVersion).catch(() => {});
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
  anchor.title = `${link.name}\n${link.url}`;
  anchor.setAttribute('aria-label', link.name);
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

  const moves = document.createElement('div');
  moves.className = 'group-moves';
  moves.append(
    makeSmallButton('←', () => moveGroup(index, index - 1), `Move ${group.name} earlier`),
    makeSmallButton('→', () => moveGroup(index, index + 1), `Move ${group.name} later`),
  );
  title.append(moves);

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

async function commitGroups() {
  renderGroups();
  await saveGroups();
}

function moveGroup(from, to) {
  if (to < 0 || to >= groups.length) return;
  const [group] = groups.splice(from, 1);
  groups.splice(to, 0, group);
  commitGroups();
}

// Moves a link to a position in any group. Later positions shift once the link leaves its old place.
function moveLink(fromGroup, fromIndex, toGroup, toIndex) {
  const [link] = groups[fromGroup].links.splice(fromIndex, 1);
  const sameGroupShift = fromGroup === toGroup && fromIndex < toIndex ? 1 : 0;
  const position = Math.max(0, Math.min(toIndex - sameGroupShift, groups[toGroup].links.length));
  groups[toGroup].links.splice(position, 0, link);
  commitGroups();
}

function clearDragMarks() {
  for (const element of document.querySelectorAll('.drag-over')) element.classList.remove('drag-over');
}

function makeDropTarget(element, onDrop) {
  element.addEventListener('dragover', (event) => {
    if (!dragItem) return;
    event.preventDefault();
    event.stopPropagation();
    clearDragMarks();
    element.classList.add('drag-over');
  });
  element.addEventListener('drop', (event) => {
    if (!dragItem) return;
    event.preventDefault();
    event.stopPropagation();
    clearDragMarks();
    const item = dragItem;
    dragItem = null;
    onDrop(item);
  });
}

function startDrag(element, item) {
  element.draggable = true;
  element.addEventListener('dragstart', (event) => {
    event.stopPropagation();
    dragItem = item;
    event.dataTransfer.effectAllowed = 'move';
  });
  element.addEventListener('dragend', () => {
    dragItem = null;
    clearDragMarks();
  });
}

function makeLabelledInput(labelText, input) {
  const label = document.createElement('label');
  label.append(labelText, input);
  return label;
}

function makeLinkEditor(link, groupIndex, linkIndex) {
  const form = document.createElement('form');
  form.className = 'link-editor';

  const name = document.createElement('input');
  name.className = 'field';
  name.value = link.name;
  name.maxLength = 100;
  name.required = true;

  const address = document.createElement('input');
  address.className = 'field';
  address.value = link.url;
  address.required = true;

  const groupChoice = document.createElement('select');
  groupChoice.className = 'field';
  groups.forEach((group, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = group.name;
    option.selected = index === groupIndex;
    groupChoice.append(option);
  });

  const error = document.createElement('p');
  error.className = 'form-error';
  error.hidden = true;

  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';

  const siblings = groups[groupIndex].links;
  const actions = document.createElement('div');
  actions.className = 'editor-actions';
  actions.append(
    save,
    makeSmallButton('Earlier', () => {
      if (linkIndex > 0) moveLink(groupIndex, linkIndex, groupIndex, linkIndex - 1);
    }),
    makeSmallButton('Later', () => {
      if (linkIndex < siblings.length - 1) moveLink(groupIndex, linkIndex, groupIndex, linkIndex + 2);
    }),
    makeSmallButton('Cancel', () => {
      editingLink = null;
      renderGroups();
    }),
  );

  form.append(
    makeLabelledInput('Name', name),
    makeLabelledInput('Address', address),
    makeLabelledInput('Group', groupChoice),
    error,
    actions,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = normalizeUrl(address.value);
    const newName = name.value.trim();
    if (!url || !newName) {
      error.textContent = 'Enter a name and a web address, like example.com.';
      error.hidden = false;
      return;
    }
    link.name = newName;
    link.url = url;
    editingLink = null;
    const targetGroup = Number(groupChoice.value);
    if (targetGroup !== groupIndex) moveLink(groupIndex, linkIndex, targetGroup, groups[targetGroup].links.length);
    else await commitGroups();
  });
  return form;
}

function makeLinkRow(link, group, groupIndex, linkIndex) {
  const row = document.createElement('div');
  row.className = 'link-row';
  row.append(makeLink(link));
  if (!editing) return row;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Remove ${link.name}`);
  remove.addEventListener('click', async () => {
    group.links.splice(linkIndex, 1);
    await commitGroups();
  });

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'edit-link';
  edit.textContent = '✎';
  edit.setAttribute('aria-label', `Edit ${link.name}`);
  edit.addEventListener('click', () => {
    editingLink = editingLink === link ? null : link;
    renderGroups();
  });

  row.append(edit, remove);
  startDrag(row, { type: 'link', groupIndex, linkIndex });
  makeDropTarget(row, (item) => {
    if (item.type === 'link') moveLink(item.groupIndex, item.linkIndex, groupIndex, linkIndex);
  });
  return row;
}

function renderGroups() {
  const container = $('groups');
  container.replaceChildren();
  document.documentElement.classList.toggle('is-editing', editing);

  groups.forEach((group, groupIndex) => {
    const section = document.createElement('div');
    section.className = 'card';
    const title = makeGroupTitle(group, groupIndex);
    section.append(title);

    const links = document.createElement('div');
    links.className = 'links';
    section.append(links);

    group.links.forEach((link, linkIndex) => {
      links.append(makeLinkRow(link, group, groupIndex, linkIndex));
      if (editing && editingLink === link) links.append(makeLinkEditor(link, groupIndex, linkIndex));
    });

    if (editing) {
      section.append(makeAddForm(group));
      startDrag(title, { type: 'group', groupIndex });
      makeDropTarget(section, (item) => {
        if (item.type === 'group') moveGroup(item.groupIndex, groupIndex);
        else moveLink(item.groupIndex, item.linkIndex, groupIndex, group.links.length);
      });
    }
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
    const engineUrl = SEARCH_URLS[preferences.searchEngine];
    if (!engineUrl && hasChrome) {
      chrome.search.query({ text: result.query, disposition: inNewTab ? 'NEW_TAB' : 'CURRENT_TAB' });
      return;
    }
    const url = `${engineUrl || SEARCH_URLS.google}${encodeURIComponent(result.query)}`;
    if (inNewTab) window.open(url, '_blank');
    else location.href = url;
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
  const timeFormat = { hour: 'numeric', minute: '2-digit' };
  if (preferences.showSeconds) timeFormat.second = '2-digit';
  if (preferences.clockFormat !== 'auto') timeFormat.hour12 = preferences.clockFormat === '12';
  $('time').textContent = now.toLocaleTimeString([], timeFormat);
  $('date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  const hour = now.getHours();
  const period = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('greeting').textContent = preferences.greetingText || (userLogin ? `${period}, ${userLogin}` : period);
}

function bindEvents() {
  $('github-login').addEventListener('click', handleLogin);
  $('sign-out').addEventListener('click', handleSignOut);

  $('query').addEventListener('input', updateResults);
  $('query').addEventListener('keydown', handleSearchKeys);
  $('query').addEventListener('blur', () => { $('results').hidden = true; });
  $('query').addEventListener('focus', () => { $('results').hidden = results.length === 0; });
  document.addEventListener('keydown', handleGlobalKeys);

  const setDrawerOpen = (open) => {
    $('customize').hidden = !open;
    document.documentElement.classList.toggle('drawer-open', open);
    $('customize-toggle').setAttribute('aria-expanded', String(open));
  };
  $('customize-toggle').addEventListener('click', () => setDrawerOpen($('customize').hidden));
  $('customize-close').addEventListener('click', () => setDrawerOpen(false));

  $('edit').addEventListener('click', () => {
    editingLink = null;
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
  buildCustomizePanel();
  applyPreferences();
  setInterval(updateClock, 1000);
  bindEvents();

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
