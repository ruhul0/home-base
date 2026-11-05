'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const github = require('./github');
const defaults = require('./defaults');

const PORT = 3000;
const LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_STARTS_PER_IP = 30;
const LOGIN_STATE_MS = 10 * 60 * 1000;
const LOGIN_CODE_MS = 60 * 1000;
const MAX_GROUPS = 50;
const MAX_LINKS_PER_GROUP = 200;
const DEFAULT_MAX_USERS = 200;
const STATE_COOKIE = 'oauth_state';

function publicUrl() {
  return process.env.PUBLIC_URL || 'https://chrome.ruhul0.com';
}

function redirectUri() {
  return `${publicUrl()}/auth/github/callback`;
}

function withParams(target, params) {
  return `${target}?${new URLSearchParams(params)}`;
}

function homePage() {
  return `${publicUrl()}/newtab.html`;
}

// The numeric GitHub ID never changes, unlike a username, which someone else could claim if it's released.
function isAdminProfile({ githubId, publicEmail }) {
  const adminId = process.env.ADMIN_GITHUB_ID;
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  if (adminId && String(githubId) === adminId) return true;
  return Boolean(adminEmail && publicEmail && publicEmail.toLowerCase() === adminEmail);
}

// Sign-in only ever returns to this website or to an approved extension, never to an address from the request.
function loginTarget(query) {
  if (query.client !== 'extension') return homePage();
  const approved = (process.env.EXTENSION_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
  const id = String(query.extension_id || '');
  return approved.includes(id) ? `https://${id}.chromiumapp.org/` : null;
}

function isOwner(login) {
  return login.toLowerCase() === (process.env.OWNER_GITHUB_LOGIN || '').toLowerCase();
}

// An empty list means anyone with a GitHub account can sign in, up to the user limit.
function isAllowed(login) {
  const allowed = (process.env.ALLOWED_GITHUB_LOGINS || '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return allowed.length === 0 || allowed.includes(login.toLowerCase());
}

function maxUsers() {
  return Number(process.env.MAX_USERS) || DEFAULT_MAX_USERS;
}

// Pending logins live in memory: a restart only means someone mid-sign-in has to try again.
const loginStates = new Map();
const loginCodes = new Map();
const startCounts = new Map();

function dropExpired(map) {
  const now = Date.now();
  for (const [key, entry] of map) {
    if (entry.expiresAt <= now) map.delete(key);
  }
}

function takeOnce(map, key) {
  const entry = map.get(key);
  map.delete(key);
  return entry && entry.expiresAt > Date.now() ? entry : null;
}

function isStartLimited(ip) {
  dropExpired(startCounts);
  const entry = startCounts.get(ip) || { count: 0, expiresAt: Date.now() + LIMIT_WINDOW_MS };
  entry.count += 1;
  startCounts.set(ip, entry);
  return entry.count > MAX_STARTS_PER_IP;
}

function readCookie(req, name) {
  for (const part of (req.get('cookie') || '').split(';')) {
    const [key, value] = part.trim().split('=');
    if (key === name) return value;
  }
  return null;
}

const stateCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/auth/github',
};

function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function sameText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

// Links render as clickable addresses, so only http and https are accepted.
function cleanUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function cleanGroups(input) {
  if (!Array.isArray(input) || input.length > MAX_GROUPS) return null;
  const groups = [];
  for (const group of input) {
    const name = cleanText(group?.name, 100);
    if (!name || !Array.isArray(group.links) || group.links.length > MAX_LINKS_PER_GROUP) return null;
    const links = [];
    for (const link of group.links) {
      const linkName = cleanText(link?.name, 100);
      const url = cleanUrl(link?.url);
      if (!linkName || !url) return null;
      links.push({ name: linkName, url });
    }
    groups.push({ name, links });
  }
  return groups;
}

const PREFERENCE_CHOICES = {
  theme: ['aurora', 'ocean', 'sunset', 'forest', 'mono'],
  mode: ['auto', 'light', 'dark'],
  layout: ['tiles', 'list'],
};
const PREFERENCE_SWITCHES = ['showClock', 'showGreeting', 'showMostVisited', 'showBookmarks'];

// Designs are fixed choices, never free text, so nothing a user saves can run as code or styling.
function cleanPreferences(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const preferences = {};
  for (const [key, choices] of Object.entries(PREFERENCE_CHOICES)) {
    if (input[key] === undefined) continue;
    if (!choices.includes(input[key])) return null;
    preferences[key] = input[key];
  }
  for (const key of PREFERENCE_SWITCHES) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') return null;
    preferences[key] = input[key];
  }
  return preferences;
}

function bearerToken(req) {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(req.get('authorization') || '');
  return match ? match[1] : null;
}

async function requireSession(req, res, next) {
  const token = bearerToken(req);
  const userId = token && (await auth.findSessionUser(token));
  if (!userId) return res.status(401).json({ error: 'Please sign in.' });
  req.sessionToken = token;
  req.userId = userId;
  next();
}

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});

const githubAuth = express.Router();
githubAuth.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

githubAuth.get('/start', (req, res) => {
  const challenge = String(req.query.challenge || '');
  const target = loginTarget(req.query);
  if (!target || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    return res.status(400).json({ error: 'That sign-in request was not valid.' });
  }
  // The app listens only on localhost, so this header can only come from nginx.
  if (isStartLimited(req.get('x-real-ip') || req.ip)) return res.redirect(withParams(target, { error: 'busy' }));
  if (!github.isConfigured()) return res.redirect(withParams(target, { error: 'not_configured' }));

  dropExpired(loginStates);
  const state = crypto.randomBytes(32).toString('hex');
  loginStates.set(state, { challenge, target, expiresAt: Date.now() + LOGIN_STATE_MS });

  // The cookie ties the GitHub response to this browser, which stops someone
  // tricking a visitor into signing in to the wrong account.
  res.cookie(STATE_COOKIE, state, { ...stateCookieOptions, maxAge: LOGIN_STATE_MS });
  res.redirect(github.authorizeUrl({ state, redirectUri: redirectUri() }));
});

githubAuth.get('/callback', async (req, res) => {
  const state = String(req.query.state || '');
  const cookieState = readCookie(req, STATE_COOKIE);
  const pending = takeOnce(loginStates, state);
  res.clearCookie(STATE_COOKIE, stateCookieOptions);

  if (!pending || !cookieState || !sameText(state, cookieState)) {
    return res.redirect(withParams(homePage(), { error: 'failed' }));
  }
  const { target } = pending;
  if (req.query.error) return res.redirect(withParams(target, { error: 'denied' }));

  try {
    const profile = await github.fetchUser({ code: String(req.query.code || ''), redirectUri: redirectUri() });
    if (!isAllowed(profile.login)) return res.redirect(withParams(target, { error: 'not_allowed' }));

    const user = await db.findOrCreateUser({
      githubId: profile.githubId,
      login: profile.login,
      isOwner: isOwner(profile.login),
      isAdmin: isAdminProfile(profile),
      maxUsers: maxUsers(),
    });
    if (!user) return res.redirect(withParams(target, { error: 'full' }));
    if (user.disabled) return res.redirect(withParams(target, { error: 'not_allowed' }));

    dropExpired(loginCodes);
    const code = crypto.randomBytes(32).toString('hex');
    loginCodes.set(code, { userId: user.id, challenge: pending.challenge, expiresAt: Date.now() + LOGIN_CODE_MS });
    res.redirect(withParams(target, { code }));
  } catch (error) {
    console.error(error.message);
    res.redirect(withParams(target, { error: 'failed' }));
  }
});

const api = express.Router();
api.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
api.use(express.json({ limit: '256kb' }));

api.get('/health', async (req, res) => {
  await db.pool.query('SELECT 1');
  res.json({ ok: true });
});

api.get('/config', (req, res) => {
  res.json({ extensionUrl: process.env.EXTENSION_URL || null });
});

api.post('/auth/exchange', async (req, res) => {
  const entry = takeOnce(loginCodes, String(req.body?.code || ''));
  const verifier = typeof req.body?.verifier === 'string' ? req.body.verifier : '';
  if (!entry || !verifier || !sameText(sha256Base64Url(verifier), entry.challenge)) {
    return res.status(400).json({ error: 'That sign-in has expired. Try again.' });
  }
  res.json({ token: await auth.createSession(entry.userId) });
});

api.post('/logout', requireSession, async (req, res) => {
  await auth.deleteSession(req.sessionToken);
  res.json({ ok: true });
});

api.get('/groups', requireSession, async (req, res) => {
  const [groups, user] = await Promise.all([db.getGroups(req.userId), db.getUser(req.userId)]);
  await db.touchUser(req.userId);
  res.json({
    groups,
    user: { login: user.login, isAdmin: user.isAdmin },
    preferences: user.preferences,
    extensionUrl: process.env.EXTENSION_URL || null,
  });
});

api.put('/preferences', requireSession, async (req, res) => {
  const preferences = cleanPreferences(req.body?.preferences);
  if (!preferences) return res.status(400).json({ error: 'Those design choices could not be saved.' });
  await db.setPreferences(req.userId, preferences);
  res.json({ ok: true });
});

api.put('/groups', requireSession, async (req, res) => {
  const groups = cleanGroups(req.body?.groups);
  if (!groups) return res.status(400).json({ error: 'Those sites could not be saved.' });
  await db.replaceGroups(req.userId, groups);
  res.json({ ok: true });
});

api.post('/groups/reset', requireSession, async (req, res) => {
  await db.replaceGroups(req.userId, defaults);
  res.json({ groups: await db.getGroups(req.userId) });
});

const admin = express.Router();
admin.use(requireSession);
admin.use(async (req, res, next) => {
  if (!(await db.isAdmin(req.userId))) return res.status(403).json({ error: "This account doesn't have admin access." });
  next();
});

function targetUserId(req, res) {
  const id = Number(req.params.id);
  if (Number.isSafeInteger(id) && id > 0) return id;
  res.status(400).json({ error: 'That user is not valid.' });
  return null;
}

// Admins can't disable or delete themselves, which would lock everyone out of this dashboard.
function targetOtherUserId(req, res) {
  const id = targetUserId(req, res);
  if (id === null) return null;
  if (id !== req.userId) return id;
  res.status(400).json({ error: "You can't do that to your own account." });
  return null;
}

admin.get('/overview', async (req, res) => {
  res.json({ ...(await db.getAdminOverview()), currentUserId: req.userId });
});

admin.post('/users/:id/sign-out', async (req, res) => {
  const id = targetUserId(req, res);
  if (id === null) return;
  await db.deleteUserSessions(id);
  res.json({ ok: true });
});

admin.post('/users/:id/disable', async (req, res) => {
  const id = targetOtherUserId(req, res);
  if (id === null) return;
  await db.setUserDisabled(id, true);
  console.log(`Admin ${req.userId} disabled user ${id}`);
  res.json({ ok: true });
});

admin.post('/users/:id/enable', async (req, res) => {
  const id = targetUserId(req, res);
  if (id === null) return;
  await db.setUserDisabled(id, false);
  console.log(`Admin ${req.userId} enabled user ${id}`);
  res.json({ ok: true });
});

admin.delete('/users/:id', async (req, res) => {
  const id = targetOtherUserId(req, res);
  if (id === null) return;
  if (!(await db.deleteUser(id))) return res.status(404).json({ error: 'That user no longer exists.' });
  console.log(`Admin ${req.userId} deleted user ${id}`);
  res.json({ ok: true });
});

api.use('/admin', admin);

api.use((req, res) => res.status(404).json({ error: 'Not found.' }));

app.use('/auth/github', githubAuth);
app.use('/api', api);
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
}));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status >= 400 && error.status < 500 ? error.status : 500;
  if (status === 500) console.error(error);
  res.status(status).json({ error: status === 500 ? 'The server had a problem.' : 'That request was not valid.' });
});

db.migrate()
  .then(() => app.listen(PORT, () => console.log(`Listening on ${PORT}`)))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
