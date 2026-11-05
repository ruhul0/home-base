'use strict';

const $ = (id) => document.getElementById(id);

// The website stores its session as JSON, so a missing or damaged value counts as signed out.
function readToken() {
  try {
    return JSON.parse(localStorage.getItem('token'));
  } catch {
    return null;
  }
}

class AdminError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function adminApi(path, method = 'GET') {
  const response = await fetch(`/api/admin${path}`, {
    method,
    headers: { Authorization: `Bearer ${readToken()}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AdminError(response.status, data.error || 'The server had a problem.');
  return data;
}

function showMessage(text) {
  $('admin-message').textContent = text || '';
  $('admin-message').hidden = !text;
}

function formatDate(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function makeCell(text, className) {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function makeTag(text, className) {
  const tag = document.createElement('span');
  tag.className = `tag ${className}`;
  tag.textContent = text;
  return tag;
}

async function runAction(path, method, doneText) {
  try {
    await adminApi(path, method);
    await load();
    showMessage(doneText);
  } catch (error) {
    showMessage(error.message);
  }
}

function makeButton(label, onClick, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener('click', onClick);
  return button;
}

// Deleting asks for a second click on the same button, which resets after a few seconds.
function makeDeleteButton(user) {
  const button = makeButton('Delete', () => {
    if (button.classList.contains('confirming')) {
      runAction(`/users/${user.id}`, 'DELETE', `Deleted @${user.login} and their saved sites.`);
      return;
    }
    button.classList.add('confirming');
    button.textContent = 'Really delete?';
    setTimeout(() => {
      button.classList.remove('confirming');
      button.textContent = 'Delete';
    }, 5000);
  }, 'danger');
  button.setAttribute('aria-label', `Delete ${user.login}`);
  return button;
}

function makeUserRow(user, currentUserId) {
  const row = document.createElement('tr');

  const nameCell = document.createElement('td');
  const profile = document.createElement('a');
  profile.href = `https://github.com/${encodeURIComponent(user.login)}`;
  profile.target = '_blank';
  profile.rel = 'noopener';
  profile.textContent = `@${user.login}`;
  nameCell.append(profile);

  const statusCell = document.createElement('td');
  if (user.isAdmin) statusCell.append(makeTag('Admin', 'admin'), ' ');
  statusCell.append(user.disabled ? makeTag('Disabled', 'disabled') : makeTag('Active', ''));

  const actionsCell = document.createElement('td');
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  actions.append(makeButton('Sign out', () => runAction(`/users/${user.id}/sign-out`, 'POST', `Signed out @${user.login} on all devices.`)));
  if (user.id !== currentUserId) {
    actions.append(user.disabled
      ? makeButton('Enable', () => runAction(`/users/${user.id}/enable`, 'POST', `Enabled @${user.login}.`))
      : makeButton('Disable', () => runAction(`/users/${user.id}/disable`, 'POST', `Disabled @${user.login} and signed them out.`)));
    actions.append(makeDeleteButton(user));
  }
  actionsCell.append(actions);

  row.append(
    nameCell,
    makeCell(formatDate(user.createdAt)),
    makeCell(formatDate(user.lastSeenAt)),
    makeCell(user.groups, 'number'),
    makeCell(user.links, 'number'),
    makeCell(user.sessions, 'number'),
    statusCell,
    actionsCell,
  );
  return row;
}

function renderStats(totals) {
  const items = [
    [totals.users, 'Users'],
    [totals.newUsers7Days, 'New in 7 days'],
    [totals.newUsers30Days, 'New in 30 days'],
    [totals.active7Days, 'Active in 7 days'],
    [totals.sessions, 'Active sessions'],
    [totals.links, 'Saved links'],
  ];
  $('stats').replaceChildren(...items.map(([value, label]) => {
    const stat = document.createElement('div');
    stat.className = 'stat';
    const number = document.createElement('strong');
    number.textContent = value;
    const name = document.createElement('span');
    name.textContent = label;
    stat.append(number, name);
    return stat;
  }));
}

async function load() {
  const data = await adminApi('/overview');
  renderStats(data.totals);
  $('users').replaceChildren(...data.users.map((user) => makeUserRow(user, data.currentUserId)));
  $('admin-content').hidden = false;
  showMessage('');
}

load().catch((error) => {
  $('admin-content').hidden = true;
  if (error.status === 401) location.replace('newtab.html?signin=1');
  else if (error.status === 403) showMessage("This account doesn't have admin access.");
  else showMessage(error.message);
});
