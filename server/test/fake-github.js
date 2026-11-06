'use strict';

// Stands in for GitHub during tests. Each sign-in code maps to one test user.
const http = require('node:http');

const profiles = {
  'code-owner': { id: 1001, login: 'owner-user', email: null },
  'code-owner-renamed': { id: 1001, login: 'owner-renamed', email: null },
  'code-alice': { id: 2002, login: 'alice', email: 'Alice@Example.com' },
  'code-bob': { id: 3003, login: 'bob', email: null },
  'code-u4': { id: 4004, login: 'user4', email: null },
  'code-u5': { id: 5005, login: 'user5', email: null },
  'code-u6': { id: 6006, login: 'user6', email: null },
};

let lastAppToken = null;
let revokedAll = false;
let grantsRevoked = 0;
let reruns = 0;
let blipHits = 0;
const deploys = [];

http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/login/oauth/access_token') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      const { code, client_secret: secret } = parsed;
      if (parsed.client_id === 'test-app-client') {
        if (secret !== 'test-app-secret') return res.end(JSON.stringify({ error: 'incorrect_client_credentials' }));
        const life = { expires_in: 28800, refresh_token_expires_in: 15552000 };
        if (parsed.grant_type === 'refresh_token') {
          if (parsed.refresh_token !== 'refresh-alice') return res.end(JSON.stringify({ error: 'bad_refresh_token' }));
          return res.end(JSON.stringify({ access_token: 'app-token-alice-2', refresh_token: 'refresh-alice-2', ...life }));
        }
        const issued = { 'app-alice': 'app-token-alice', 'app-new': 'app-token-new', 'app-bob': 'app-token-bob' }[code];
        if (!issued) return res.end(JSON.stringify({ error: 'bad_verification_code' }));
        return res.end(JSON.stringify({ access_token: issued, refresh_token: 'refresh-alice', ...life }));
      }
      if (secret !== 'test-secret' || !profiles[code]) {
        res.end(JSON.stringify({ error: 'bad_verification_code' }));
        return;
      }
      res.end(JSON.stringify({ access_token: code }));
    });
    return;
  }

  const bearer = (req.headers.authorization || '').replace('Bearer ', '');
  const appToken = bearer.startsWith('app-token-') ? bearer : null;
  if (appToken) {
    lastAppToken = appToken;
    if (revokedAll) {
      res.statusCode = 401;
      return res.end('{}');
    }
  }
  if (req.url === '/__test/last-token') return res.end(JSON.stringify({ token: lastAppToken, grantsRevoked }));
  if (req.url === '/__test/revoke-all') {
    revokedAll = true;
    return res.end('{}');
  }
  if (req.url === '/__test/restore') {
    revokedAll = false;
    return res.end('{}');
  }
  if (req.method === 'DELETE' && req.url === '/applications/test-app-client/grant') {
    if (req.headers.authorization !== `Basic ${Buffer.from('test-app-client:test-app-secret').toString('base64')}`) {
      res.statusCode = 401;
      return res.end('{}');
    }
    grantsRevoked += 1;
    res.statusCode = 204;
    return res.end();
  }
  if (appToken) {
    const identity = appToken === 'app-token-bob' ? { id: 3003, login: 'bob' } : { id: 2002, login: 'alice' };
    if (req.url === '/user') return res.end(JSON.stringify(identity));
    if (req.url.startsWith('/user/installations')) return res.end(JSON.stringify({ total_count: appToken === 'app-token-new' ? 0 : 1 }));
    if (req.url.startsWith('/user/repos')) {
      return res.end(JSON.stringify([{ full_name: 'alice/secret-project', html_url: 'https://github.com/alice/secret-project', description: '', language: 'Go', stargazers_count: 0, pushed_at: '2026-11-05T00:00:00Z', private: true }]));
    }
    if (req.url.startsWith('/users/alice/events?')) {
      return res.end(JSON.stringify([{ type: 'PushEvent', repo: { name: 'alice/secret-project' }, created_at: '2026-11-05T00:00:00Z' }]));
    }
    if (req.url.startsWith('/search/issues') && decodeURIComponent(req.url).replaceAll('+', ' ').includes('review-requested:alice')) {
      return res.end(JSON.stringify({ items: [{ title: 'Please review', html_url: 'https://github.com/alice/secret-project/pull/9', number: 9, updated_at: '2026-11-05T00:00:00Z', repository_url: 'https://api.github.com/repos/alice/secret-project' }] }));
    }
  }

  if (req.url === '/user') {
    const profile = profiles[(req.headers.authorization || '').replace('Bearer ', '')];
    res.statusCode = profile ? 200 : 401;
    res.end(JSON.stringify(profile || {}));
    return;
  }

  const respond = (value) => res.end(JSON.stringify(value));
  const url = new URL(req.url, 'http://fake');

  if (url.pathname === '/up') return respond({ ok: true });
  // Fails once, then works, like a brief network problem.
  if (url.pathname === '/blip') {
    blipHits += 1;
    if (blipHits === 1) res.statusCode = 500;
    return respond({});
  }
  if (url.pathname === '/down') {
    res.statusCode = 500;
    return respond({});
  }

  if (url.pathname === '/v0/topstories.json') return respond([101, 102]);
  if (url.pathname === '/v0/item/101.json') return respond({ title: 'A real story', url: 'https://example.com/story', score: 42, descendants: 7 });
  if (url.pathname === '/v0/item/102.json') return respond({ title: 'A bad link', url: 'javascript:alert(1)', score: 1, descendants: 0 });

  const issue = (kind) => ({ title: `Alice's open ${kind}`, html_url: `https://github.com/alice/app/${kind}/1`, number: 1, updated_at: '2026-11-01T00:00:00Z', repository_url: 'https://api.github.com/repos/alice/app' });
  if (url.pathname === '/search/issues') {
    const query = url.searchParams.get('q') ?? '';
    if (query.includes('author:user4')) {
      res.statusCode = 422;
      return respond({ message: 'Validation Failed' });
    }
    if (!query.includes('author:alice')) return respond({ items: [] });
    if (query.includes('is:pr')) return respond({ items: [issue('pull'), { ...issue('pull'), title: 'Bad link', html_url: 'javascript:alert(1)' }] });
    return respond({ items: [issue('issues')] });
  }
  if (url.pathname === '/users/user4') return respond({ name: '', public_repos: 2, followers: 0, following: 0 });
  if (url.pathname === '/users/user4/repos') return respond([{ full_name: 'user4/tool', html_url: 'https://github.com/user4/tool', description: '', language: 'Go', stargazers_count: 1, pushed_at: '2026-11-01T00:00:00Z' }]);
  if (url.pathname === '/users/user4/events/public') return respond([]);
  if (url.pathname === '/repos/user4/tool/issues') {
    return respond(url.searchParams.get('creator') !== 'user4' ? [] : [
      { title: 'A pull request', html_url: 'https://github.com/user4/tool/pull/2', number: 2, updated_at: '2026-11-02T00:00:00Z', pull_request: { url: 'x' } },
      { title: 'An issue', html_url: 'https://github.com/user4/tool/issues/1', number: 1, updated_at: '2026-11-01T00:00:00Z' },
      { title: 'Bad link', html_url: 'javascript:alert(1)', number: 3, updated_at: '2026-11-03T00:00:00Z' },
    ]);
  }
  if (url.pathname === '/search/commits') {
    if (!(url.searchParams.get('q') ?? '').includes('author:alice')) return respond({ items: [] });
    return respond({ items: [{ html_url: 'https://github.com/alice/app/commit/abc', repository: { full_name: 'alice/app' }, commit: { message: 'Fix the login bug\n\nLonger details here', author: { date: '2026-11-05T10:00:00Z' } } }, { html_url: 'javascript:alert(1)', repository: { full_name: 'alice/app' }, commit: { message: 'Bad link', author: { date: '2026-11-05T09:00:00Z' } } }] });
  }
  if (url.pathname === '/repos/alice/app/commits') {
    return respond([
      { html_url: 'https://github.com/alice/app/commit/1', commit: { message: 'Add the new checkout\n\nDetails', author: { date: '2026-10-15T00:00:00Z' } } },
      { html_url: 'https://github.com/alice/app/commit/2', commit: { message: 'Merge branch main', author: { date: '2026-10-16T00:00:00Z' } } },
    ]);
  }
  if (req.method === 'POST' && url.pathname === '/repos/alice/app/actions/runs/1/rerun-failed-jobs') {
    if (!bearer.startsWith('app-token-')) {
      res.statusCode = 401;
      return res.end('{}');
    }
    reruns += 1;
    res.statusCode = 201;
    return res.end('{}');
  }
  if (req.method === 'POST' && url.pathname === '/repos/alice/app/actions/runs/403/rerun-failed-jobs') {
    res.statusCode = 403;
    return res.end('{}');
  }
  if (req.url === '/__test/deploys') return respond({ deploys });
  if (url.pathname === '/repos/alice/app/actions/workflows') {
    return respond({ workflows: [
      { name: 'Deploy', path: '.github/workflows/deploy.yml', state: 'active' },
      { name: 'Old', path: '.github/workflows/old.yml', state: 'disabled_manually' },
      { name: 'Pages', path: 'dynamic/pages/pages-build', state: 'active' },
    ] });
  }
  const dispatch = url.pathname.match(/^\/repos\/alice\/app\/actions\/workflows\/([^/]+)\/dispatches$/);
  if (req.method === 'POST' && dispatch) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (dispatch[1] === 'denied.yml') res.statusCode = 403;
      else if (dispatch[1] === 'manual-off.yml') res.statusCode = 422;
      else if (!bearer.startsWith('app-token-')) res.statusCode = 401;
      else {
        deploys.push({ workflow: dispatch[1], ref: JSON.parse(body).ref });
        res.statusCode = 204;
      }
      res.end();
    });
    return undefined;
  }
  if (req.url === '/__test/reruns') return respond({ reruns });
  if (url.pathname === '/repos/alice/app') return respond({ default_branch: 'main' });
  if (url.pathname === '/repos/alice/quiet') return respond({ default_branch: 'main' });
  if (url.pathname === '/repos/alice/quiet/actions/runs') return respond({ workflow_runs: [] });
  // A newer passing scheduled job sits on top of the failure, as it would in a real repository.
  if (url.pathname === '/repos/alice/app/actions/runs') {
    if (url.searchParams.get('branch') !== 'main') return respond({ workflow_runs: [] });
    return respond({ workflow_runs: [
      { id: 2, workflow_id: 20, name: 'Nightly', head_branch: 'main', status: 'completed', conclusion: 'success', html_url: 'https://github.com/alice/app/actions/runs/2', updated_at: '2026-11-02T00:00:00Z' },
      { id: 1, workflow_id: 10, name: 'CI', head_branch: 'main', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/alice/app/actions/runs/1', updated_at: '2026-11-01T00:00:00Z' },
    ] });
  }
  if (url.pathname === '/users/alice') return respond({ name: 'Alice', public_repos: 3, followers: 5, following: 2 });
  if (url.pathname === '/users/alice/repos') return respond([{ full_name: 'alice/app', html_url: 'https://github.com/alice/app', description: 'An app', language: 'Go', stargazers_count: 9, pushed_at: '2026-11-01T00:00:00Z', default_branch: 'main' }]);
  if (url.pathname === '/users/alice/events/public') return respond([{ type: 'PushEvent', repo: { name: 'alice/app' }, created_at: '2026-11-01T00:00:00Z' }]);

  res.statusCode = 404;
  res.end('{}');
}).listen(4000);
