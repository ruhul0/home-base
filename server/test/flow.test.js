const crypto = require('node:crypto');
const http = require('node:http');
const mysql = require('mysql2/promise');

const base = 'http://localhost:3000';
const profiles = {
  'code-owner': { id: 1001, login: 'owner-user' },
  'code-owner-renamed': { id: 1001, login: 'owner-renamed' },
  'code-alice': { id: 2002, login: 'alice', email: 'Alice@Example.com' },
  'code-bob': { id: 3003, login: 'bob' },
  'code-u4': { id: 4004, login: 'user4' },
  'code-u5': { id: 5005, login: 'user5' },
  'code-u6': { id: 6006, login: 'user6' },
};

let failed = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` :: ${extra}`}`);
};

function startFakeGithub() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/login/oauth/access_token') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          const { code, client_secret: secret } = JSON.parse(body);
          if (secret !== 'test-secret' || !profiles[code]) return res.end(JSON.stringify({ error: 'bad_verification_code' }));
          res.end(JSON.stringify({ access_token: code }));
        });
        return;
      }
      if (req.url === '/user') {
        const profile = profiles[(req.headers.authorization || '').replace('Bearer ', '')];
        res.statusCode = profile ? 200 : 401;
        return res.end(JSON.stringify(profile || {}));
      }
      res.statusCode = 404;
      res.end('{}');
    });
    server.listen(4000, resolve);
  });
}

async function createLegacyDatabase() {
  let connection;
  for (let attempt = 0; attempt < 30 && !connection; attempt += 1) {
    try {
      connection = await mysql.createConnection({ host: 'db', user: 'test', password: 'throwaway', database: 'test' });
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await connection.query('CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, github_id BIGINT NOT NULL UNIQUE, login VARCHAR(100) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await connection.query('CREATE TABLE settings (name VARCHAR(64) PRIMARY KEY, value TEXT NOT NULL)');
  await connection.query("INSERT INTO settings VALUES ('seeded', '1')");
  await connection.query('CREATE TABLE sessions (token_hash CHAR(64) PRIMARY KEY, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL, INDEX sessions_expires_at (expires_at))');
  await connection.query(`INSERT INTO sessions (token_hash, expires_at) VALUES ('${'a'.repeat(64)}', NOW() + INTERVAL 1 DAY)`);
  await connection.query('CREATE TABLE link_groups (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, position INT NOT NULL)');
  await connection.query('CREATE TABLE links (id INT AUTO_INCREMENT PRIMARY KEY, group_id INT NOT NULL, name VARCHAR(100) NOT NULL, url VARCHAR(2048) NOT NULL, position INT NOT NULL, CONSTRAINT links_group FOREIGN KEY (group_id) REFERENCES link_groups (id) ON DELETE CASCADE)');
  await connection.query("INSERT INTO link_groups (id, name, position) VALUES (1, 'Business', 0)");
  await connection.query("INSERT INTO links (group_id, name, url, position) VALUES (1, 'UCC Webmail', 'https://mail.ucc.com.bd/', 0)");
  return connection;
}

const makeProof = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

let ipCounter = 0;
const nextIp = () => `10.0.0.${(ipCounter += 1)}`;
const get = (path, headers = {}) => fetch(base + path, { redirect: 'manual', headers: { 'x-real-ip': nextIp(), ...headers } });

async function startLogin(challenge) {
  const res = await get(`/auth/github/start?challenge=${challenge}`);
  const location = new URL(res.headers.get('location'));
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { res, location, state: location.searchParams.get('state'), cookie };
}

async function callback(code, state, cookie) {
  const res = await get(`/auth/github/callback?code=${code}&state=${state}`, cookie ? { cookie } : {});
  return new URL(res.headers.get('location'), base);
}

const exchange = async (code, verifier) => {
  const res = await fetch(`${base}/api/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, verifier }),
  });
  return { status: res.status, data: await res.json() };
};

async function signIn(githubCode) {
  const { verifier, challenge } = makeProof();
  const { state, cookie } = await startLogin(challenge);
  const location = await callback(githubCode, state, cookie);
  const code = location.searchParams.get('code');
  if (!code) return { error: location.searchParams.get('error') };
  const { data } = await exchange(code, verifier);
  return { token: data.token };
}

const apiCall = async (path, { token, method = 'GET', body } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}/api${path}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null), cookie: res.headers.get('set-cookie') };
};

(async () => {
  const connection = await createLegacyDatabase();
  await startFakeGithub();
  require('./index');
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  const extensionId = 'ckmmmpglhbeeeppgclggngmgdjogmlmh';
  const extensionTarget = `https://${extensionId}.chromiumapp.org/`;
  const extensionStart = (challenge, id = extensionId) => get(`/auth/github/start?client=extension&extension_id=${id}&challenge=${challenge}`);

  const [[{ oldSessions }]] = await connection.query('SELECT COUNT(*) AS oldSessions FROM sessions');
  check('old sessions cleared', oldSessions === 0, oldSessions);

  let r = await get('/auth/github/start');
  check('start without challenge refused', r.status === 400, r.status);

  const proof = makeProof();
  const started = await startLogin(proof.challenge);
  check('start redirects to GitHub', started.location.href.startsWith('http://localhost:4000/login/oauth/authorize'), started.location.href);
  check('no extra GitHub permissions requested', !started.location.searchParams.has('scope'));
  check('state cookie is HttpOnly, Secure, Lax', /HttpOnly/i.test(started.res.headers.get('set-cookie')) && /Secure/i.test(started.res.headers.get('set-cookie')) && /SameSite=Lax/i.test(started.res.headers.get('set-cookie')));

  let location = await callback('code-owner', started.state, 'oauth_state=wrong');
  check('wrong browser cookie refused', location.searchParams.get('error') === 'failed', location.href);
  location = await callback('code-owner', started.state, started.cookie);
  check('used state cannot be reused', location.searchParams.get('error') === 'failed', location.href);
  location = await callback('code-owner', 'made-up', 'oauth_state=made-up');
  check('made-up state refused', location.searchParams.get('error') === 'failed', location.href);

  const cancelled = await startLogin(makeProof().challenge);
  r = await get(`/auth/github/callback?error=access_denied&state=${cancelled.state}`, { cookie: cancelled.cookie });
  check('cancel on GitHub reported', new URL(r.headers.get('location')).searchParams.get('error') === 'denied', r.headers.get('location'));

  const badCode = await startLogin(makeProof().challenge);
  location = await callback('code-invalid', badCode.state, badCode.cookie);
  check('bad GitHub code refused', location.searchParams.get('error') === 'failed', location.href);

  const stolen = makeProof();
  const flow = await startLogin(stolen.challenge);
  location = await callback('code-alice', flow.state, flow.cookie);
  const aliceCode = location.searchParams.get('code');
  let ex = await exchange(aliceCode, makeProof().verifier);
  check('code useless without browser secret', ex.status === 400 && !ex.data.token, JSON.stringify(ex));
  ex = await exchange(aliceCode, stolen.verifier);
  check('failed code cannot be retried', ex.status === 400, JSON.stringify(ex));

  const flow2 = makeProof();
  const f2 = await startLogin(flow2.challenge);
  location = await callback('code-alice', f2.state, f2.cookie);
  const goodCode = location.searchParams.get('code');
  ex = await exchange(goodCode, flow2.verifier);
  check('valid sign-in returns a session', ex.status === 200 && /^[0-9a-f]{64}$/.test(ex.data.token), JSON.stringify(ex));
  const aliceToken = ex.data.token;
  ex = await exchange(goodCode, flow2.verifier);
  check('code works only once', ex.status === 400, JSON.stringify(ex));

  r = await apiCall('/groups', { token: aliceToken });
  check('alice gets starter sites', r.data.groups.length === 2 && r.data.groups[0].name === 'Everyday', JSON.stringify(r.data));
  check("alice can't see owner's business sites", !JSON.stringify(r.data).includes('UCC Webmail'));
  check('alice sees her name', r.data.user.login === 'alice', JSON.stringify(r.data.user));

  const owner = await signIn('code-owner');
  r = await apiCall('/groups', { token: owner.token });
  check('owner claims existing sites', r.data.groups.length === 1 && r.data.groups[0].links[0].name === 'UCC Webmail', JSON.stringify(r.data));

  const bob = await signIn('code-bob');
  const bobSites = [{ name: 'Bob', links: [{ name: 'Example', url: 'https://example.com/' }] }];
  r = await apiCall('/groups', { token: bob.token, method: 'PUT', body: { groups: bobSites } });
  check('bob saves his sites', r.status === 200, r.status);
  r = await apiCall('/groups', { token: bob.token });
  check('bob reads his sites back', JSON.stringify(r.data.groups) === JSON.stringify(bobSites), JSON.stringify(r.data));
  r = await apiCall('/groups', { token: aliceToken });
  check("bob's save leaves alice alone", r.data.groups.length === 2);
  r = await apiCall('/groups', { token: owner.token });
  check("bob's save leaves owner alone", r.data.groups[0].name === 'Business');
  r = await apiCall('/groups/reset', { token: bob.token, method: 'POST' });
  check('reset gives bob starter sites', r.data.groups.length === 2);
  r = await apiCall('/groups', { token: owner.token });
  check("bob's reset leaves owner alone", r.data.groups[0].name === 'Business');

  r = await apiCall('/groups', { token: bob.token, method: 'PUT', body: { groups: [{ name: 'Bad', links: [{ name: 'x', url: 'javascript:alert(1)' }] }] } });
  check('script link refused', r.status === 400, r.status);
  r = await apiCall('/groups');
  check('no session refused', r.status === 401, r.status);
  r = await apiCall('/groups', { token: 'a'.repeat(64) });
  check('fake session refused', r.status === 401, r.status);

  const renamed = await signIn('code-owner-renamed');
  r = await apiCall('/groups', { token: renamed.token });
  check('renamed GitHub user keeps account', r.data.user.login === 'owner-renamed' && r.data.groups[0].name === 'Business', JSON.stringify(r.data));

  r = await apiCall('/logout', { token: bob.token, method: 'POST' });
  check('sign out works', r.status === 200, r.status);
  r = await apiCall('/groups', { token: bob.token });
  check('session dead after sign out', r.status === 401, r.status);
  r = await apiCall('/groups', { token: aliceToken });
  check("bob's sign out leaves alice signed in", r.status === 200, r.status);

  r = await apiCall('/groups', { token: aliceToken });
  check('new users start with default design', JSON.stringify(r.data.preferences) === '{}', JSON.stringify(r.data.preferences));
  const aliceDesign = { theme: 'sunset', mode: 'dark', layout: 'list', showClock: false, showGreeting: true, showMostVisited: false, showBookmarks: true };
  r = await apiCall('/preferences', { token: aliceToken, method: 'PUT', body: { preferences: aliceDesign } });
  check('alice saves her design', r.status === 200, r.status);
  r = await apiCall('/groups', { token: aliceToken });
  check('alice reads her design back', JSON.stringify(r.data.preferences) === JSON.stringify(aliceDesign), JSON.stringify(r.data.preferences));
  r = await apiCall('/groups', { token: owner.token });
  check("alice's design doesn't affect owner", JSON.stringify(r.data.preferences) === '{}', JSON.stringify(r.data.preferences));
  r = await apiCall('/preferences', { token: aliceToken, method: 'PUT', body: { preferences: { theme: 'x;background:url(evil)' } } });
  check('made-up theme refused', r.status === 400, r.status);
  r = await apiCall('/preferences', { token: aliceToken, method: 'PUT', body: { preferences: { showClock: 'yes' } } });
  check('bad switch value refused', r.status === 400, r.status);
  r = await apiCall('/preferences', { token: aliceToken, method: 'PUT', body: { preferences: { theme: 'ocean', css: 'body{}' } } });
  r = await apiCall('/groups', { token: aliceToken });
  check('unknown design fields dropped', r.data.preferences.css === undefined && r.data.preferences.theme === 'ocean', JSON.stringify(r.data.preferences));
  r = await apiCall('/preferences', { method: 'PUT', body: { preferences: { theme: 'ocean' } } });
  check('design save needs sign-in', r.status === 401, r.status);

  r = await extensionStart(makeProof().challenge, 'aaaabbbbccccddddeeeeffffgggghhhh');
  check('unapproved extension refused', r.status === 400, r.status);
  r = await get(`/auth/github/start?client=extension&extension_id=evil.example.com%2F&challenge=${makeProof().challenge}`);
  check('made-up return address refused', r.status === 400, r.status);
  r = await get(`/auth/github/start?client=extension&challenge=${makeProof().challenge}`);
  check('extension without id refused', r.status === 400, r.status);

  const extProof = makeProof();
  r = await extensionStart(extProof.challenge);
  const extState = new URL(r.headers.get('location')).searchParams.get('state');
  const extCookie = r.headers.get('set-cookie').split(';')[0];
  location = await callback('code-alice', extState, extCookie);
  check('extension sign-in returns to the extension', location.href.startsWith(`${extensionTarget}?code=`), location.href);
  ex = await exchange(location.searchParams.get('code'), makeProof().verifier);
  check('extension code useless without its secret', ex.status === 400, JSON.stringify(ex));

  const extProof2 = makeProof();
  r = await extensionStart(extProof2.challenge);
  const ext2 = { state: new URL(r.headers.get('location')).searchParams.get('state'), cookie: r.headers.get('set-cookie').split(';')[0] };
  location = await callback('code-alice', ext2.state, ext2.cookie);
  ex = await exchange(location.searchParams.get('code'), extProof2.verifier);
  check('extension exchanges code for a session', ex.status === 200 && /^[0-9a-f]{64}$/.test(ex.data.token), JSON.stringify(ex));
  r = await apiCall('/groups', { token: ex.data.token });
  check('extension sees the same account', r.data.user.login === 'alice' && r.data.groups.length === 2, JSON.stringify(r.data));
  check('prompt hidden until a store address is set', r.data.extensionUrl === null, r.data.extensionUrl);
  process.env.EXTENSION_URL = 'https://chromewebstore.google.com/detail/test';
  r = await apiCall('/groups', { token: ex.data.token });
  check('store address reaches the page', r.data.extensionUrl === process.env.EXTENSION_URL, r.data.extensionUrl);

  const extCancel = await extensionStart(makeProof().challenge);
  const cancelState = new URL(extCancel.headers.get('location')).searchParams.get('state');
  r = await get(`/auth/github/callback?error=access_denied&state=${cancelState}`, { cookie: extCancel.headers.get('set-cookie').split(';')[0] });
  check('extension cancel returns to the extension', r.headers.get('location') === `${extensionTarget}?error=denied`, r.headers.get('location'));

  process.env.ALLOWED_GITHUB_LOGINS = 'alice, Owner-Renamed';
  let outcome = await signIn('code-u4');
  check('allowlist blocks others', outcome.error === 'not_allowed', JSON.stringify(outcome));
  outcome = await signIn('code-alice');
  check('allowlist lets alice in', Boolean(outcome.token), JSON.stringify(outcome));
  process.env.ALLOWED_GITHUB_LOGINS = '';

  await signIn('code-u4');
  await signIn('code-u5');
  outcome = await signIn('code-u6');
  check('user limit stops new accounts', outcome.error === 'full', JSON.stringify(outcome));
  outcome = await signIn('code-alice');
  check('existing users still sign in at the limit', Boolean(outcome.token), JSON.stringify(outcome));

  const fresh = {
    owner: (await signIn('code-owner-renamed')).token,
    alice: (await signIn('code-alice')).token,
    bob: (await signIn('code-bob')).token,
  };

  r = await apiCall('/admin/overview');
  check('admin needs sign-in', r.status === 401, r.status);
  r = await apiCall('/admin/overview', { token: fresh.alice });
  check('normal user refused admin', r.status === 403, r.status);
  r = await apiCall('/groups', { token: fresh.alice });
  check('normal user not told they are admin', r.data.user.isAdmin === false, JSON.stringify(r.data.user));

  r = await apiCall('/groups', { token: fresh.owner });
  check('admin found by GitHub ID', r.data.user.isAdmin === true, JSON.stringify(r.data.user));
  r = await apiCall('/admin/overview', { token: fresh.owner });
  check('admin sees overview', r.status === 200 && r.data.totals.users === 5 && r.data.users.length === 5, JSON.stringify(r.data.totals));
  const overviewText = JSON.stringify(r.data);
  check("admin overview hides saved sites", !overviewText.includes('UCC Webmail') && !overviewText.includes('mail.ucc.com.bd') && !overviewText.includes('youtube'));
  check('admin overview has no tokens', !overviewText.includes('token') && !overviewText.includes('github_id'));
  const adminId = r.data.currentUserId;
  const bobRow = r.data.users.find((user) => user.login === 'bob');
  check('admin sees per-user counts', bobRow.groups === 2 && bobRow.links === 8 && bobRow.sessions >= 1, JSON.stringify(bobRow));

  r = await apiCall(`/admin/users/${adminId}/disable`, { token: fresh.owner, method: 'POST' });
  check("admin can't disable self", r.status === 400, r.status);
  r = await apiCall(`/admin/users/${adminId}`, { token: fresh.owner, method: 'DELETE' });
  check("admin can't delete self", r.status === 400, r.status);
  r = await apiCall('/admin/users/abc/sign-out', { token: fresh.owner, method: 'POST' });
  check('bad user id refused', r.status === 400, r.status);
  r = await apiCall(`/admin/users/${bobRow.id}`, { token: fresh.alice, method: 'DELETE' });
  check('normal user cannot delete anyone', r.status === 403, r.status);

  r = await apiCall(`/admin/users/${bobRow.id}/sign-out`, { token: fresh.owner, method: 'POST' });
  check('admin can sign a user out', r.status === 200, r.status);
  r = await apiCall('/groups', { token: fresh.bob });
  check('signed-out user loses access', r.status === 401, r.status);

  const bobAgain = (await signIn('code-bob')).token;
  r = await apiCall(`/admin/users/${bobRow.id}/disable`, { token: fresh.owner, method: 'POST' });
  check('admin can disable a user', r.status === 200, r.status);
  r = await apiCall('/groups', { token: bobAgain });
  check('disabled user loses access', r.status === 401, r.status);
  outcome = await signIn('code-bob');
  check('disabled user cannot sign in', outcome.error === 'not_allowed', JSON.stringify(outcome));
  r = await apiCall(`/admin/users/${bobRow.id}/enable`, { token: fresh.owner, method: 'POST' });
  outcome = await signIn('code-bob');
  check('enabled user can sign in again', r.status === 200 && Boolean(outcome.token), JSON.stringify(outcome));

  process.env.ADMIN_EMAIL = 'alice@example.COM';
  const aliceAdmin = (await signIn('code-alice')).token;
  r = await apiCall('/admin/overview', { token: aliceAdmin });
  check('admin found by public email', r.status === 200, r.status);
  process.env.ADMIN_EMAIL = '';
  const aliceNormal = (await signIn('code-alice')).token;
  r = await apiCall('/admin/overview', { token: aliceNormal });
  check('admin removed at next sign-in', r.status === 403, r.status);

  r = await apiCall(`/admin/users/${bobRow.id}`, { token: fresh.owner, method: 'DELETE' });
  check('admin can delete a user', r.status === 200, r.status);
  const [[{ leftovers }]] = await connection.query('SELECT COUNT(*) AS leftovers FROM link_groups g LEFT JOIN users u ON u.id = g.user_id WHERE u.id IS NULL AND g.user_id IS NOT NULL');
  check('deleting a user removes their sites', leftovers === 0, leftovers);
  r = await apiCall('/groups', { token: outcome.token });
  check('deleted user loses access', r.status === 401, r.status);
  r = await apiCall(`/admin/users/${bobRow.id}`, { token: fresh.owner, method: 'DELETE' });
  check('deleting a missing user reported', r.status === 404, r.status);

  let limited = false;
  for (let i = 0; i < 31; i += 1) {
    const res = await fetch(`${base}/auth/github/start?challenge=${makeProof().challenge}`, { redirect: 'manual', headers: { 'x-real-ip': 'flood' } });
    limited = new URL(res.headers.get('location')).searchParams.get('error') === 'busy';
  }
  check('sign-in flood limited', limited);

  r = await fetch(`${base}/`);
  const page = await r.text();
  check('landing page served at the root', page.includes('Start every day from your own page') && page.includes('newtab.html?signin=1'));
  check('public page has no private sites', !page.includes('UCC'));
  r = await fetch(`${base}/newtab.html`);
  check('start page offers GitHub sign-in', (await r.text()).includes('Continue with GitHub'));
  r = await fetch(`${base}/admin.html`);
  const adminPage = await r.text();
  check('admin page has no data before sign-in', r.status === 200 && !adminPage.includes('@owner') && !adminPage.includes('alice'));
  r = await fetch(`${base}/screens/screenshot-1-tiles-1280x800.png`);
  check('landing screenshots served', r.status === 200 && r.headers.get('content-type') === 'image/png', r.status);
  r = await apiCall('/config');
  check('public config has only the store address', JSON.stringify(Object.keys(r.data)) === '["extensionUrl"]', JSON.stringify(r.data));
  r = await fetch(`${base}/server/index.js`);
  check('server code not served', r.status === 404, r.status);
  r = await fetch(`${base}/privacy.html`);
  check('privacy page is public', r.status === 200 && (await r.text()).includes('never sent to our server'), r.status);

  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error('CRASH', error);
  process.exit(2);
});
