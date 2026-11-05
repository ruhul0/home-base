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

  res.statusCode = 404;
  res.end('{}');
}).listen(4000);
