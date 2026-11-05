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

http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/login/oauth/access_token') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const { code, client_secret: secret } = JSON.parse(body);
      if (secret !== 'test-secret' || !profiles[code]) {
        res.end(JSON.stringify({ error: 'bad_verification_code' }));
        return;
      }
      res.end(JSON.stringify({ access_token: code }));
    });
    return;
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
  if (url.pathname === '/users/alice') return respond({ name: 'Alice', public_repos: 3, followers: 5, following: 2 });
  if (url.pathname === '/users/alice/repos') return respond([{ full_name: 'alice/app', html_url: 'https://github.com/alice/app', description: 'An app', language: 'Go', stargazers_count: 9, pushed_at: '2026-11-01T00:00:00Z' }]);
  if (url.pathname === '/users/alice/events/public') return respond([{ type: 'PushEvent', repo: { name: 'alice/app' }, created_at: '2026-11-01T00:00:00Z' }]);

  res.statusCode = 404;
  res.end('{}');
}).listen(4000);
