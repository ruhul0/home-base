# Home Base

A self-hosted start page for developers: a command palette, search shortcuts, GitHub and CI status, uptime monitors, server health, a dev toolbox, todos and a scratchpad. Live at [chrome.ruhul0.com](https://chrome.ruhul0.com).

## Features

- **Command palette and shortcuts:** press `⌘K`, or use `/`, `t`, `e`, `c` and `?`. Search shortcuts include `gh`, `npm`, `mdn`, `so`, `pypi`, `go`, `crates` and `docker`.
- **GitHub panel:** pull requests, issues, repositories, activity and CI status. Sign-in only reads public data. Users can opt in to a read-only GitHub App to add private repositories and review requests.
- **Needs attention:** one list of down sites, failed CI, review requests, full disks, and SSL and domain expiry at 30, 14 and 7 days. It says what it couldn't check, such as CI on repositories the GitHub App can't read, instead of implying those are fine.
- **Projects:** a card per client with production and staging links, repository, CI, uptime, SSL and domain dates and a copyable SSH command, all reachable from `⌘K`.
- **Client reports:** monthly uptime, outages, shipped commits and optional tracked time, as Markdown. Nothing is sent automatically.
- **Command library:** saved commands with `{placeholders}`, copied from `⌘K`. Nothing runs from the page.
- **Time tracking:** one timer per user, started and stopped with `⌥S`, with CSV export.
- **Work log:** a day's commits, pull requests, workflow runs and tracked time, ready to copy for a standup.
- **Re-run failed CI and trigger deploys:** optional. Both work only if you give the GitHub App the Actions read and write permission. A deploy runs the workflow saved on the project, and always asks first.
- **Uptime monitors:** background checks with history and uptime percentages, refusing private addresses.
- **Server health:** an optional agent reports disk, memory, load and container status to an admin-only panel.
- **Dev toolbox:** JSON, JWT, Base64, URL encoding, timestamps, UUIDs, hashes and regex, all in the browser.
- **Customization:** 35 DaisyUI themes, background images, custom link icons, group colours, fonts and layouts, saved per account.
- **Chrome extension:** the same page on every new tab, with real site icons, bookmarks and most visited.

## Architecture

| Path | What it is |
|---|---|
| `server/` | Go API, and the only part that talks to MySQL. It also serves the website. |
| `web/` | Next.js frontend with DaisyUI and shadcn/ui, exported as static files. |
| `web/extension/` | Chrome extension manifest. The extension packages the same export. |
| `server/test/` | End-to-end tests against the built image, with a fake GitHub and throwaway MySQL. |
| `deploy/` | Deploy, setup and agent scripts. |

The static export has its inline scripts moved to files by `web/scripts`, so the site can use a strict `script-src 'self'` policy and meet Chrome's extension rules.

## Development

```bash
# Frontend
cd web && npm ci && npm run dev

# Go checks and unit tests
cd server && go vet ./... && go test ./...

# End-to-end tests (needs Docker)
docker build -t chrome-home-app -f server/Dockerfile .
docker compose -f server/test/stack.yml run --rm --build runner
docker compose -f server/test/stack.yml down -v

# Deploy script tests
bash deploy/test-deploy.sh

# Extension: writes dist/extension and dist/home-base-extension.zip
cd web && npm run build && npm run build:extension
```

## Self-hosting

1. Create a `.env` beside `docker-compose.yml` with `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD`.
2. Run `docker compose up -d --build`. The app listens on `127.0.0.1:13100`, so put a reverse proxy with HTTPS in front of it. `deploy/chrome.ruhul0.com.nginx` is an example.
3. Create a GitHub OAuth app, then run `deploy/set-github-oauth.sh` to enable sign-in.
4. Optional: create a read-only GitHub App with `Issues`, `Pull requests` and `Actions` read access, then run `deploy/set-github-app.sh`.

`PUBLIC_URL` and the extension's `SERVER_URL` default to this project's domain, so change both when hosting your own copy.

If a CDN sits in front of the site, make sure it doesn't cache `/api/` responses. They must never be shared between users.

## Backups

The `backup` service encrypts the database and `.env` with [age](https://github.com/FiloSottile/age) and uploads them to Cloudflare R2 daily, using `deploy/set-r2-backup.sh`. The private key is never on the server. See `deploy/restore-backup.md` to restore, and `deploy/test-backup.sh` for a tested full cycle.

## Security

- GitHub App tokens are encrypted with AES-256-GCM and bound to each user. The key lives in the server's `.env`, so this protects database dumps and backups but not a full server compromise.
- Monitors check the resolved IP at connection time and only reach public addresses on ports 80 and 443.
- User-supplied links, icons and colours are strictly validated by the server, and SVG uploads are refused.

To report a vulnerability, please contact [@ruhul0](https://github.com/ruhul0) privately rather than opening a public issue.

## Licence

[MIT](LICENSE)
