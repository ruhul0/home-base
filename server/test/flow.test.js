'use strict';

// End-to-end tests of the running server. See stack.yml for how the services fit together.
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

const MAIN = 'http://app:3000';
const ALLOWLIST = 'http://app-allowlist:3000';
const ADMIN_EMAIL = 'http://app-admin-email:3000';
const STORE_LINK = 'http://app-store-link:3000';
const MONITORS = 'http://app-monitors:3000';
const RATE_LIMIT = 'http://app-rate-limit:3000';
let base = MAIN;

let failed = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` :: ${extra}`}`);
};

async function waitForServer(address) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${address}/api/health`)).ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${address} never became healthy.`);
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
  for (const address of [MAIN, ALLOWLIST, ADMIN_EMAIL, STORE_LINK, MONITORS, RATE_LIMIT]) await waitForServer(address);
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const extensionId = 'ckmmmpglhbeeeppgclggngmgdjogmlmh';
  const extensionTarget = `https://${extensionId}.chromiumapp.org/`;
  const extensionStart = (challenge, id = extensionId) => get(`/auth/github/start?client=extension&extension_id=${id}&challenge=${challenge}`);

  const [[{ oldSessions }]] = await connection.query('SELECT COUNT(*) AS oldSessions FROM sessions');
  check('old sessions cleared', oldSessions === 0, oldSessions);

  let r = await get('/auth/github/start');
  check('start without challenge refused', r.status === 400, r.status);

  const proof = makeProof();
  const started = await startLogin(proof.challenge);
  check('start redirects to GitHub', started.location.href.startsWith('http://fake-github:4000/login/oauth/authorize'), started.location.href);
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

  const iconImage = (bytes, type = 'image/png') => `image:data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
  const smallPng = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4];
  const customSites = [
    {
      name: 'Colourful',
      color: '#ff8800',
      links: [
        { name: 'Emoji', url: 'https://example.com/a', icon: 'emoji:🎵', iconColor: '#112233' },
        { name: 'Symbol', url: 'https://example.com/b', icon: 'lucide:music' },
        { name: 'Picture', url: 'https://example.com/c', icon: iconImage(smallPng), iconColor: '#aabbcc' },
        { name: 'Plain', url: 'https://example.com/d' },
      ],
    },
    { name: 'No colour', links: [] },
  ];
  r = await apiCall('/groups', { token: bob.token, method: 'PUT', body: { groups: customSites } });
  check('custom icons and group colours save', r.status === 200, JSON.stringify(r.data));
  r = await apiCall('/groups', { token: bob.token });
  check('custom icons and group colours persist in MySQL', JSON.stringify(r.data.groups) === JSON.stringify(customSites), JSON.stringify(r.data.groups).slice(0, 300));
  r = await apiCall('/groups', { token: aliceToken });
  check("bob's icons don't reach alice", !JSON.stringify(r.data.groups).includes('Colourful'));

  const withLink = (extra) => ({ groups: [{ name: 'Bad', links: [{ name: 'x', url: 'https://example.com/', ...extra }] }] });
  for (const [label, body] of [
    ['script as icon', withLink({ icon: 'javascript:alert(1)' })],
    ['remote image as icon', withLink({ icon: 'https://evil.example/track.png' })],
    ['SVG icon', withLink({ icon: iconImage(Buffer.from('<svg onload="alert(1)"/>xxxx'), 'image/svg+xml') })],
    ['text pretending to be an image', withLink({ icon: iconImage(Buffer.from('<script>alert(1)</script>')) })],
    ['image with the wrong declared type', withLink({ icon: iconImage(smallPng, 'image/jpeg') })],
    ['broken image data', withLink({ icon: 'image:data:image/png;base64,@@@@' })],
    ['oversized icon image', withLink({ icon: iconImage([...smallPng, ...new Array(20000).fill(0)]) })],
    ['symbol name with code', withLink({ icon: 'lucide:<img src=x>' })],
    ['long emoji text', withLink({ icon: `emoji:${'x'.repeat(9)}` })],
    ['empty emoji', withLink({ icon: 'emoji:' })],
    ['icon colour with code', withLink({ iconColor: 'red;background:url(x)' })],
    ['group colour with code', { groups: [{ name: 'Bad', color: 'url(javascript:alert(1))', links: [] }] }],
  ]) {
    r = await apiCall('/groups', { token: bob.token, method: 'PUT', body });
    check(`${label} refused`, r.status === 400, r.status);
  }
  r = await apiCall('/groups', { token: bob.token });
  check('refused icons changed nothing', JSON.stringify(r.data.groups) === JSON.stringify(customSites));

  const legalIcon = iconImage([...smallPng, ...new Array(11000).fill(0)]);
  const manyIcons = { groups: [{ name: 'Many', links: new Array(50).fill(0).map((_, index) => ({ name: `Site ${index}`, url: `https://example.com/${index}`, icon: legalIcon })) }] };
  r = await apiCall('/groups', { token: bob.token, method: 'PUT', body: manyIcons });
  check('too many image icons at once refused clearly', r.status === 413, r.status);
  r = await apiCall('/groups/reset', { token: bob.token, method: 'POST' });

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
  check('alice reads her design back', Object.entries(aliceDesign).every(([key, value]) => r.data.preferences[key] === value), JSON.stringify(r.data.preferences));
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

  const fullDesign = { theme: 'rose', accentColor: '#ff0088', backgroundType: 'solid', backgroundColor: '#112233', backgroundDim: 40, pattern: 'dots', font: 'serif', layout: 'compact', tileSize: 'large', iconShape: 'circle', columns: '4', pageWidth: 'wide', cardStyle: 'outline', corners: 'sharp', heroAlign: 'left', clockFormat: '24', clockSize: 'large', greetingText: 'Assalamu alaikum <b>', searchEngine: 'duckduckgo', showSeconds: true, showDate: false, showSearch: false, showLabels: false, showGroupTitles: false };
  r = await apiCall('/preferences', { token: aliceToken, method: 'PUT', body: { preferences: fullDesign } });
  check('full design saves', r.status === 200, JSON.stringify(r.data));
  r = await apiCall('/groups', { token: aliceToken });
  check('full design persists in MySQL', Object.entries(fullDesign).every(([key, value]) => r.data.preferences[key] === value), JSON.stringify(r.data.preferences));
  r = await apiCall('/preferences', { token: aliceToken, method: 'PUT', body: { preferences: { theme: 'ocean' } } });
  r = await apiCall('/groups', { token: aliceToken });
  check('saving one setting keeps the others', r.data.preferences.theme === 'ocean' && r.data.preferences.font === 'serif' && r.data.preferences.tileSize === 'large', JSON.stringify(r.data.preferences));
  const aliceRelogin = await signIn('code-alice');
  r = await apiCall('/groups', { token: aliceRelogin.token });
  check('design survives signing in again', r.data.preferences.font === 'serif', JSON.stringify(r.data.preferences));
  for (const [label, bad] of [
    ['colour with code', { accentColor: 'red;background:url(x)' }],
    ['background colour with code', { backgroundColor: 'url(javascript:alert(1))' }],
    ['empty background colour', { backgroundColor: '' }],
    ['too long greeting', { greetingText: 'x'.repeat(61) }],
    ['non-text greeting', { greetingText: { a: 1 } }],
    ['made-up dim', { backgroundDim: 7 }],
    ['made-up engine', { searchEngine: 'https://evil.example/?q=' }],
  ]) {
    r = await apiCall('/preferences', { token: aliceToken, method: 'PUT', body: { preferences: bad } });
    check(`${label} refused`, r.status === 400, r.status);
  }

  const uploadImage = async (authToken, body, contentType = 'image/jpeg') => {
    const res = await fetch(`${base}/api/background`, { method: 'PUT', headers: { ...(authToken ? { authorization: `Bearer ${authToken}` } : {}), 'content-type': contentType }, body });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(2000)]);
  r = await uploadImage(null, jpeg);
  check('image upload needs sign-in', r.status === 401, r.status);
  r = await uploadImage(aliceToken, jpeg);
  check('JPEG upload accepted', r.status === 200 && /^\d+$/.test(r.data.version), JSON.stringify(r.data));
  const uploadedVersion = r.data.version;
  r = await uploadImage(aliceToken, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'), 'image/svg+xml');
  check('SVG refused', r.status === 400, r.status);
  r = await uploadImage(aliceToken, Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg');
  check('fake image refused', r.status === 400, r.status);
  r = await uploadImage(aliceToken, Buffer.concat([jpeg, Buffer.alloc(490 * 1024)]));
  check('oversized image refused', r.status === 413, r.status);
  r = await apiCall('/groups', { token: aliceToken });
  check('image version reaches the page', r.data.backgroundVersion === uploadedVersion, r.data.backgroundVersion);
  let res = await fetch(`${base}/api/background`, { headers: { authorization: `Bearer ${aliceToken}` } });
  const downloaded = Buffer.from(await res.arrayBuffer());
  check('image downloads unchanged as JPEG', res.status === 200 && res.headers.get('content-type').startsWith('image/jpeg') && downloaded.equals(jpeg), res.status);
  check('image stays out of caches', res.headers.get('cache-control') === 'no-store', res.headers.get('cache-control'));
  res = await fetch(`${base}/api/background`);
  check('image needs sign-in to view', res.status === 401, res.status);
  res = await fetch(`${base}/api/background`, { headers: { authorization: `Bearer ${owner.token}` } });
  check("other users can't get alice's image", res.status === 404, res.status);
  r = await apiCall('/groups', { token: owner.token });
  check("alice's image doesn't affect owner", r.data.backgroundVersion === null, r.data.backgroundVersion);
  r = await apiCall('/background', { token: aliceToken, method: 'DELETE' });
  res = await fetch(`${base}/api/background`, { headers: { authorization: `Bearer ${aliceToken}` } });
  check('image can be removed', r.status === 200 && res.status === 404, res.status);
  await uploadImage(aliceToken, jpeg);

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
  base = STORE_LINK;
  r = await apiCall('/groups', { token: ex.data.token });
  check('store address reaches the page', r.data.extensionUrl === 'https://chromewebstore.google.com/detail/test', r.data.extensionUrl);
  r = await apiCall('/config');
  check('store address reaches the landing page', r.data.extensionUrl === 'https://chromewebstore.google.com/detail/test', r.data.extensionUrl);
  base = MAIN;

  const extCancel = await extensionStart(makeProof().challenge);
  const cancelState = new URL(extCancel.headers.get('location')).searchParams.get('state');
  r = await get(`/auth/github/callback?error=access_denied&state=${cancelState}`, { cookie: extCancel.headers.get('set-cookie').split(';')[0] });
  check('extension cancel returns to the extension', r.headers.get('location') === `${extensionTarget}?error=denied`, r.headers.get('location'));

  base = ALLOWLIST;
  let outcome = await signIn('code-u4');
  check('allowlist blocks others', outcome.error === 'not_allowed', JSON.stringify(outcome));
  outcome = await signIn('code-alice');
  check('allowlist lets alice in', Boolean(outcome.token), JSON.stringify(outcome));
  base = MAIN;

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

  base = ADMIN_EMAIL;
  const aliceAdmin = (await signIn('code-alice')).token;
  r = await apiCall('/admin/overview', { token: aliceAdmin });
  check('admin found by public email', r.status === 200, r.status);
  base = MAIN;
  const aliceNormal = (await signIn('code-alice')).token;
  r = await apiCall('/admin/overview', { token: aliceNormal });
  check('admin removed at next sign-in', r.status === 403, r.status);

  r = await apiCall(`/admin/users/${bobRow.id}`, { token: fresh.owner, method: 'DELETE' });
  check('admin can delete a user', r.status === 200, r.status);
  const [[{ leftovers }]] = await connection.query('SELECT COUNT(*) AS leftovers FROM link_groups g LEFT JOIN users u ON u.id = g.user_id WHERE u.id IS NULL AND g.user_id IS NOT NULL');
  check('deleting a user removes their sites', leftovers === 0, leftovers);
  const [[{ orphanImages }]] = await connection.query('SELECT COUNT(*) AS orphanImages FROM user_backgrounds b LEFT JOIN users u ON u.id = b.user_id WHERE u.id IS NULL');
  check('deleting a user removes their image', orphanImages === 0, orphanImages);
  r = await apiCall('/groups', { token: outcome.token });
  check('deleted user loses access', r.status === 401, r.status);
  r = await apiCall(`/admin/users/${bobRow.id}`, { token: fresh.owner, method: 'DELETE' });
  check('deleting a missing user reported', r.status === 404, r.status);

  const withoutVersion = ({ version, ...rest }) => rest;
  const dev = { alice: (await signIn('code-alice')).token, owner: (await signIn('code-owner-renamed')).token };
  for (const path of ['/dev/github', '/dev/news', '/dev/workspace', '/dev/monitors']) {
    r = await apiCall(path);
    check(`${path} needs sign-in`, r.status === 401, r.status);
  }

  r = await apiCall('/dev/github', { token: dev.alice });
  check('GitHub panel shows the signed-in user', r.status === 200 && r.data.data.login === 'alice' && r.data.data.publicRepos === 3 && r.data.data.repos[0].name === 'alice/app', JSON.stringify(r.data).slice(0, 300));
  check('GitHub panel shows open PRs and issues', r.data.data.pullRequests.length === 1 && r.data.data.issues.length === 1 && r.data.data.pullRequests[0].repo === 'alice/app', JSON.stringify(r.data.data.pullRequests));
  check('GitHub panel drops unsafe links', !JSON.stringify(r.data).includes('javascript:'));
  check('GitHub panel shows activity', r.data.data.events[0].type === 'PushEvent' && !r.data.data.partial, JSON.stringify(r.data.data.events));
  r = await apiCall('/dev/github', { token: dev.owner });
  check("one user's GitHub data isn't shown to another", r.status !== 200 || !JSON.stringify(r.data).includes('alice/app'), JSON.stringify(r.data).slice(0, 200));

  const unsearchable = await signIn('code-u4');
  r = await apiCall('/dev/github', { token: unsearchable.token });
  check('GitHub panel survives an account search refuses', r.status === 200 && r.data.data.fromRecentRepos === true && r.data.data.partial === false, JSON.stringify(r.data).slice(0, 300));
  check('open items come from recent repositories instead', r.data.data.pullRequests[0]?.title === 'A pull request' && r.data.data.issues[0]?.title === 'An issue' && r.data.data.issues.length === 1, JSON.stringify(r.data.data.issues));
  check('repository items drop unsafe links', !JSON.stringify(r.data).includes('javascript:'));
  r = await apiCall('/dev/github', { token: dev.alice });
  check('searchable accounts still use search', r.data.data.fromRecentRepos === false, r.data.data.fromRecentRepos);

  r = await apiCall('/dev/news', { token: dev.alice });
  check('news loads', r.status === 200 && r.data.stories[0].title === 'A real story' && r.data.stories[0].comments === 7, JSON.stringify(r.data).slice(0, 200));
  check('news replaces unsafe links with the discussion', r.data.stories[1].url === 'https://news.ycombinator.com/item?id=102', r.data.stories[1]?.url);

  r = await apiCall('/dev/workspace', { token: dev.alice });
  check('workspace starts empty', JSON.stringify(withoutVersion(r.data)) === JSON.stringify({ monitors: [], todos: [], notes: '' }), JSON.stringify(r.data));
  const aliceWorkspace = {
    monitors: [{ name: 'Up', url: 'http://fake-github:4000/up' }, { name: 'Down', url: 'http://fake-github:4000/down' }],
    todos: [{ text: 'Ship it', done: false }, { text: 'Done thing', done: true }],
    notes: 'kubectl get pods\n<script>alert(1)</script>',
  };
  r = await apiCall('/dev/workspace', { token: dev.alice, method: 'PUT', body: aliceWorkspace });
  check('workspace saves', r.status === 200, JSON.stringify(r.data));
  r = await apiCall('/dev/workspace', { token: dev.alice });
  check('workspace persists in MySQL', JSON.stringify(withoutVersion(r.data)) === JSON.stringify(aliceWorkspace) && r.data.version === 1, JSON.stringify(r.data));
  r = await apiCall('/dev/workspace', { token: dev.alice, method: 'PUT', body: { ...aliceWorkspace, notes: 'stale edit', version: 0 } });
  check('a stale workspace save is refused', r.status === 409, r.status);
  r = await apiCall('/dev/workspace', { token: dev.alice });
  check('a refused save changes nothing', r.data.notes === aliceWorkspace.notes && r.data.version === 1, JSON.stringify(r.data));
  r = await apiCall('/dev/workspace', { token: dev.owner });
  check("workspaces are private to each user", JSON.stringify(withoutVersion(r.data)) === JSON.stringify({ monitors: [], todos: [], notes: '' }), JSON.stringify(r.data));
  for (const [label, body] of [
    ['script monitor', { monitors: [{ name: 'x', url: 'javascript:alert(1)' }], todos: [], notes: '' }],
    ['file monitor', { monitors: [{ name: 'x', url: 'file:///etc/passwd' }], todos: [], notes: '' }],
    ['too many monitors', { monitors: new Array(11).fill({ name: 'x', url: 'https://example.com/' }), todos: [], notes: '' }],
    ['too many todos', { monitors: [], todos: new Array(101).fill({ text: 'x', done: false }), notes: '' }],
    ['empty todo', { monitors: [], todos: [{ text: '  ', done: false }], notes: '' }],
    ['oversized notes', { monitors: [], todos: [], notes: 'x'.repeat(20001) }],
  ]) {
    r = await apiCall('/dev/workspace', { token: dev.alice, method: 'PUT', body });
    check(`${label} refused`, r.status === 400, r.status);
  }

  r = await apiCall('/dev/monitors', { token: dev.alice });
  check('monitors refuse private addresses', r.status === 200 && r.data.results.every((result) => !result.up && result.status === 0 && result.problem.includes('Private')), JSON.stringify(r.data));

  base = MONITORS;
  r = await apiCall('/dev/monitors', { token: dev.alice });
  const monitorUp = r.data.results?.find((result) => result.name === 'Up');
  const monitorDown = r.data.results?.find((result) => result.name === 'Down');
  check('monitors report a working site', monitorUp?.up === true && monitorUp.status === 200 && monitorUp.ms >= 0, JSON.stringify(monitorUp));
  check('monitors report a failing site', monitorDown?.up === false && monitorDown.status === 500 && monitorDown.problem === 'Returned HTTP 500.', JSON.stringify(monitorDown));
  let history;
  for (let attempt = 0; attempt < 20 && !(history?.up?.points.length && history?.down?.points.length); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    r = await apiCall('/dev/monitors', { token: dev.alice });
    history = { up: r.data.results.find((result) => result.name === 'Up').history, down: r.data.results.find((result) => result.name === 'Down').history };
  }
  check('background checks build history without the page asking', history.up.points.length > 0 && history.down.points.length > 0, JSON.stringify(history));
  check('history reports uptime', history.up.uptime24h === 100 && history.down.uptime24h === 0, JSON.stringify(history));
  check('history reports when an outage began', history.up.downSince === null && Boolean(history.down.downSince), JSON.stringify(history));
  check('a site that is up shows no problem', history.up.points.every((point) => point.up));
  base = MAIN;

  const rateLimitUser = { token: null };
  base = RATE_LIMIT;
  rateLimitUser.token = (await signIn('code-alice')).token;
  const statuses = [];
  for (let attempt = 0; attempt < 7; attempt += 1) statuses.push((await apiCall('/groups', { token: rateLimitUser.token })).status);
  check('each user is rate limited', statuses.slice(0, 5).every((status) => status === 200) && statuses[6] === 429, statuses.join(','));
  r = await apiCall('/groups', { token: (await signIn('code-owner-renamed')).token });
  check("one user's limit doesn't affect another", r.status === 200, r.status);
  base = MAIN;

  r = await apiCall('/dev/github', { token: dev.alice });
  check('CI status shows the latest run', r.data.data.ci[0]?.repo === 'alice/app' && r.data.data.ci[0].conclusion === 'failure' && r.data.data.ci[0].workflow === 'CI', JSON.stringify(r.data.data.ci));

  const styled = [{ name: 'Styled', color: '#ff0000', links: [{ name: 'Site', url: 'https://example.com/', icon: 'emoji:🎵', iconColor: '#00ff00' }] }];
  r = await apiCall('/groups', { token: dev.alice, method: 'PUT', body: { groups: styled, schema: 2 } });
  check('new clients save customization', r.status === 200, r.status);
  r = await apiCall('/groups', { token: dev.alice, method: 'PUT', body: { groups: [{ name: 'Styled', links: [{ name: 'Renamed', url: 'https://example.com/' }] }] } });
  r = await apiCall('/groups', { token: dev.alice });
  check('an old client keeps icons and colours', r.data.groups[0].color === '#ff0000' && r.data.groups[0].links[0].icon === 'emoji:🎵' && r.data.groups[0].links[0].iconColor === '#00ff00' && r.data.groups[0].links[0].name === 'Renamed', JSON.stringify(r.data.groups));
  await apiCall('/groups', { token: dev.alice, method: 'PUT', body: { groups: [{ name: 'Styled', links: [{ name: 'Renamed', url: 'https://example.com/' }] }], schema: 2 } });
  r = await apiCall('/groups', { token: dev.alice });
  check('new clients can remove icons and colours', r.data.groups[0].color === undefined && r.data.groups[0].links[0].icon === undefined, JSON.stringify(r.data.groups));
  await apiCall('/groups/reset', { token: dev.alice, method: 'POST' });

  const secondDevice = (await signIn('code-alice')).token;
  r = await apiCall('/sessions', { token: dev.alice });
  const sessionList = r.data.sessions ?? [];
  check('users can see their sessions', r.status === 200 && sessionList.length >= 2 && sessionList.filter((item) => item.current).length === 1, JSON.stringify(r.data).slice(0, 300));
  check('session lists contain no tokens', !JSON.stringify(r.data).includes(dev.alice) && sessionList.every((item) => item.id.length === 16));
  const other = sessionList.find((item) => !item.current);
  r = await apiCall(`/sessions/${other.id}`, { token: dev.owner, method: 'DELETE' });
  check("users can't remove someone else's session", r.status === 404, r.status);
  r = await apiCall('/sessions/sign-out-others', { token: dev.alice, method: 'POST' });
  check('sign out everywhere else works', r.status === 200, r.status);
  r = await apiCall('/groups', { token: secondDevice });
  check('other devices are signed out', r.status === 401, r.status);
  r = await apiCall('/groups', { token: dev.alice });
  check('this device stays signed in', r.status === 200, r.status);
  const removable = (await signIn('code-alice')).token;
  r = await apiCall('/sessions', { token: dev.alice });
  r = await apiCall(`/sessions/${r.data.sessions.find((item) => !item.current).id}`, { token: dev.alice, method: 'DELETE' });
  r = await apiCall('/groups', { token: removable });
  check('one session can be removed', r.status === 401, r.status);

  r = await apiCall('/admin/servers', { token: dev.alice });
  check('the server panel is admin only', r.status === 403, r.status);
  r = await apiCall('/admin/servers', { token: dev.owner, method: 'POST', body: { name: 'prod-1' } });
  const agent = r.data;
  check('adding a server gives a token once', r.status === 200 && /^[0-9a-f]{64}$/.test(agent.token), JSON.stringify(r.data).slice(0, 100));
  const sendReport = (token, body) => fetch(`${base}/api/server-report`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const goodReport = { diskPercent: 74, memoryPercent: 45.5, load: 0.8, cores: 4, uptimeSeconds: 3600, containersRunning: 13, containersTotal: 14, unhealthy: ['db-1'] };
  check('reports need a valid token', (await sendReport('a'.repeat(64), goodReport)).status === 401);
  check('a session token can\'t report', (await sendReport(dev.owner, goodReport)).status === 401);
  check('reports are validated', (await sendReport(agent.token, { ...goodReport, diskPercent: 500 })).status === 400);
  check('an agent can report', (await sendReport(agent.token, goodReport)).status === 200);
  check('an agent can report twice in one second', (await sendReport(agent.token, goodReport)).status === 200);
  r = await apiCall('/admin/servers', { token: dev.owner });
  const listed = r.data.servers.find((server) => server.name === 'prod-1');
  check('admins see server health', listed?.report?.diskPercent === 74 && listed.report.unhealthy[0] === 'db-1' && Boolean(listed.reportedAt), JSON.stringify(listed));
  check('agent tokens are never shown again', !JSON.stringify(r.data).includes(agent.token));
  r = await fetch(`${base}/api/admin/servers`, { headers: { authorization: `Bearer ${agent.token}` } });
  check("an agent token can't read anything", r.status === 401, r.status);
  r = await apiCall(`/admin/servers/${agent.id}`, { token: dev.owner, method: 'DELETE' });
  check('deleting a server stops its reports', r.status === 200 && (await sendReport(agent.token, goodReport)).status === 401);

  const leaving = (await signIn('code-u5')).token;
  r = await apiCall('/account', { token: leaving, method: 'DELETE', body: { confirm: 'someone-else' } });
  check('deleting an account needs the username', r.status === 400, r.status);
  r = await apiCall('/account', { token: dev.owner, method: 'DELETE', body: { confirm: 'owner-renamed' } });
  check("the administrator's account can't be deleted here", r.status === 400, r.status);
  r = await apiCall('/account', { token: leaving, method: 'DELETE', body: { confirm: 'USER5' } });
  check('users can delete their own account', r.status === 200, JSON.stringify(r.data));
  r = await apiCall('/groups', { token: leaving });
  check('a deleted account is signed out', r.status === 401, r.status);
  const [[{ leftoverRows }]] = await connection.query("SELECT (SELECT COUNT(*) FROM users WHERE login = 'user5') AS leftoverRows");
  check('a deleted account is gone from MySQL', leftoverRows === 0, leftoverRows);

  const noConnection = await apiCall('/dev/github', { token: dev.alice });
  check('private GitHub is offered but off by default', noConnection.data.available === true && noConnection.data.connected === false && noConnection.data.data.repos.every((repo) => !repo.private), JSON.stringify(noConnection.data).slice(0, 200));
  r = await apiCall('/dev/github/connect', { method: 'POST' });
  check('connecting needs sign-in', r.status === 401, r.status);

  const fakeGitHub = async (path) => (await fetch(`http://fake-github:4000${path}`)).json();
  const startConnect = async (token) => {
    const res = await fetch(`${base}/api/dev/github/connect`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-real-ip': nextIp() } });
    const data = await res.json();
    const address = new URL(data.url);
    return { status: res.status, address, state: address.searchParams.get('state'), cookie: res.headers.get('set-cookie').split(';')[0], setCookie: res.headers.get('set-cookie') };
  };
  const finishConnect = async (code, state, cookie) => {
    const res = await fetch(`${base}/auth/github-app/callback?code=${code}&state=${state}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    return res.headers.get('location');
  };
  const tokenRow = async (login) => {
    const [rows] = await connection.query('SELECT t.access_token AS access, t.refresh_token AS refresh FROM user_github_tokens t JOIN users u ON u.id = t.user_id WHERE u.login = ?', [login]);
    return rows[0] ?? null;
  };

  let connect = await startConnect(dev.alice);
  check('connecting asks GitHub with no broad scopes', connect.address.href.startsWith('http://fake-github:4000/login/oauth/authorize') && connect.address.searchParams.get('client_id') === 'test-app-client' && !connect.address.searchParams.has('scope'), connect.address.href);
  check('connect cookie is HttpOnly, Secure, Lax', /HttpOnly/i.test(connect.setCookie) && /Secure/i.test(connect.setCookie) && /SameSite=Lax/i.test(connect.setCookie), connect.setCookie);
  let landed = await finishConnect('app-alice', connect.state, null);
  check('connecting refused without the browser cookie', landed.includes('github=failed'), landed);
  check('a refused attempt stores nothing', (await tokenRow('alice')) === null);
  landed = await finishConnect('app-alice', connect.state, connect.cookie);
  check('a connect link works only once', landed.includes('github=failed'), landed);

  connect = await startConnect(dev.alice);
  landed = await finishConnect('app-bob', connect.state, connect.cookie);
  check('another GitHub account is refused', landed.includes('github=wrong_account'), landed);
  check('the wrong account leaves nothing stored', (await tokenRow('alice')) === null);
  check("the wrong account's grant is revoked", (await fakeGitHub('/__test/last-token')).grantsRevoked === 1);

  connect = await startConnect(dev.alice);
  r = await fetch(`${base}/auth/github-app/callback?error=access_denied&state=${connect.state}`, { redirect: 'manual', headers: { cookie: connect.cookie } });
  check('cancelling on GitHub is reported', r.headers.get('location').includes('github=cancelled'), r.headers.get('location'));

  connect = await startConnect(dev.alice);
  landed = await finishConnect('app-new', connect.state, connect.cookie);
  check('with no installation, connecting continues to choosing repositories', landed === 'http://fake-github:4000/apps/home-base-test/installations/new', landed);
  r = await apiCall('/dev/github/connection', { token: dev.alice, method: 'DELETE' });

  connect = await startConnect(dev.alice);
  landed = await finishConnect('app-alice', connect.state, connect.cookie);
  check('connecting succeeds', landed.includes('github=connected'), landed);

  const stored = await tokenRow('alice');
  check('tokens are encrypted in MySQL', stored && !stored.access.includes('app-token') && !stored.refresh.includes('refresh-alice') && stored.access.length > 30, JSON.stringify(stored));

  r = await apiCall('/dev/github', { token: dev.alice });
  check('connected users see private repositories', r.data.connected === true && r.data.data.repos[0].name === 'alice/secret-project' && r.data.data.repos[0].private === true, JSON.stringify(r.data).slice(0, 300));
  check('connected users see review requests', r.data.data.reviewRequests[0]?.title === 'Please review', JSON.stringify(r.data.data.reviewRequests));
  check('connected users see private activity', r.data.data.events[0]?.repo === 'alice/secret-project', JSON.stringify(r.data.data.events));
  check('tokens never reach the browser', !JSON.stringify(r.data).includes('app-token') && !JSON.stringify(r.data).includes('refresh-alice') && !JSON.stringify(r.data).includes('test-app-secret'));
  check('the app gets a link to manage repositories', r.data.manageUrl.endsWith('/apps/home-base-test/installations/new'), r.data.manageUrl);

  r = await apiCall('/dev/github', { token: dev.owner });
  check("other users never see someone's private repositories", !JSON.stringify(r.data).includes('secret-project') && r.data.connected !== true, JSON.stringify(r.data).slice(0, 200));
  r = await apiCall('/admin/overview', { token: dev.owner });
  check('admins never see tokens or private repositories', !JSON.stringify(r.data).includes('secret-project') && !JSON.stringify(r.data).includes(stored.access));

  await connection.query("UPDATE user_github_tokens SET access_expires = '2020-01-01 00:00:00' WHERE user_id = (SELECT id FROM users WHERE login = 'alice')");
  r = await apiCall('/dev/github?fresh=1', { token: dev.alice });
  check('an expired token is refreshed automatically', r.data.connected === true && (await fakeGitHub('/__test/last-token')).token === 'app-token-alice-2', JSON.stringify(await fakeGitHub('/__test/last-token')));
  const afterRefresh = await tokenRow('alice');
  check('the refreshed token is saved encrypted', afterRefresh.access !== stored.access && !afterRefresh.access.includes('app-token'));

  await connection.query("UPDATE user_github_tokens SET access_expires = '2020-01-01 00:00:00' WHERE user_id = (SELECT id FROM users WHERE login = 'alice')");
  r = await apiCall('/dev/github?fresh=1', { token: dev.alice });
  check('a rejected refresh asks the user to reconnect', r.status === 200 && r.data.connected === false && r.data.needsReconnect === true && !JSON.stringify(r.data).includes('secret-project'), JSON.stringify(r.data).slice(0, 200));
  check('a lost connection removes the stored tokens', (await tokenRow('alice')) === null);

  connect = await startConnect(dev.alice);
  await finishConnect('app-alice', connect.state, connect.cookie);
  r = await apiCall('/dev/github?fresh=1', { token: dev.alice });
  check('reconnecting restores private data', r.data.connected === true && JSON.stringify(r.data).includes('secret-project'), JSON.stringify(r.data).slice(0, 200));
  await fakeGitHub('/__test/revoke-all');
  r = await apiCall('/dev/github?fresh=1', { token: dev.alice });
  check('revoking on GitHub stops private data straight away', r.data.connected === false && r.data.needsReconnect === true && !JSON.stringify(r.data).includes('secret-project'), JSON.stringify(r.data).slice(0, 200));
  await fakeGitHub('/__test/restore');

  connect = await startConnect(dev.alice);
  await finishConnect('app-alice', connect.state, connect.cookie);
  const revokedBefore = (await fakeGitHub('/__test/last-token')).grantsRevoked;
  r = await apiCall('/dev/github/connection', { token: dev.alice, method: 'DELETE' });
  check('disconnecting works', r.status === 200, r.status);
  check('disconnecting deletes the tokens', (await tokenRow('alice')) === null);
  check('disconnecting revokes the grant on GitHub', (await fakeGitHub('/__test/last-token')).grantsRevoked === revokedBefore + 1);
  r = await apiCall('/dev/github', { token: dev.alice });
  check('disconnecting removes private data straight away', r.data.connected === false && !JSON.stringify(r.data).includes('secret-project'), JSON.stringify(r.data).slice(0, 200));

  let limited = false;
  for (let i = 0; i < 31; i += 1) {
    const res = await fetch(`${base}/auth/github/start?challenge=${makeProof().challenge}`, { redirect: 'manual', headers: { 'x-real-ip': 'flood' } });
    limited = new URL(res.headers.get('location')).searchParams.get('error') === 'busy';
  }
  check('sign-in flood limited', limited);

  r = await fetch(`${base}/`);
  const page = await r.text();
  check('landing page served at the root', page.includes('The start page built for developers') && page.includes('/newtab?signin=1'));
  check('security policy keeps scripts to site files', !/script-src[^;]*unsafe/.test(r.headers.get('content-security-policy')) && r.headers.get('content-security-policy').includes("script-src 'self'"), r.headers.get('content-security-policy'));
  const inlineScripts = (page.match(/<script[^>]*>/g) || []).filter((tag) => !tag.includes('src='));
  check('no inline scripts for the security policy to block', inlineScripts.length === 0, inlineScripts.join(' '));
  for (const address of ['/newtab', '/newtab.html', '/admin', '/admin.html', '/privacy', '/privacy.html']) {
    r = await fetch(`${base}${address}`, { redirect: 'manual' });
    check(`${address} serves a page`, r.status === 200 && r.headers.get('content-type').startsWith('text/html'), r.status);
  }
  r = await fetch(`${base}/this-does-not-exist`);
  check('unknown pages get a 404', r.status === 404, r.status);
  r = await fetch(`${base}/icons/`);
  check('folders are not listed', r.status === 404, r.status);
  r = await fetch(`${base}/../../etc/passwd`);
  check('files outside the site are not served', r.status === 404, r.status);
  const scriptPath = /src="(\/_next\/static\/[^"]+\.js)"/.exec(page);
  r = await fetch(`${base}${scriptPath[1]}`);
  check('built scripts are served and cached', r.status === 200 && r.headers.get('cache-control').includes('immutable'), r.headers.get('cache-control'));
  check('public page has no private sites', !page.includes('UCC'));
  check('landing page offers GitHub sign-in', page.includes('Continue with GitHub'));
  r = await apiCall('/preferences', { token: fresh.owner, method: 'PUT', body: { preferences: { theme: 'dracula' } } });
  check('DaisyUI themes can be saved', r.status === 200, r.status);
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

  await connection.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error('CRASH', error);
  process.exit(2);
});
