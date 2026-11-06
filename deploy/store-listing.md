# Chrome Web Store listing

Build with `npm run build && npm run build:extension` in `web/`, upload `dist/home-base-extension.zip`, then use the text below.

**Name:** Home Base

**Summary:** Your own new tab page: search, your saved sites on every device, most visited pages and bookmarks.

**Category:** Productivity

**Description:**

Home Base replaces the new tab page with one simple place to start.

- Search the web, your saved sites and your bookmarks from one box
- Organise your favourite sites into groups
- Choose your own colours and layout
- Sign in with GitHub to see your sites and design on every device
- See your most visited pages and bookmarks at a glance
- Press Cmd+K or Ctrl+K to jump to any site, tool or action
- See your pull requests, CI status and review requests
- Keep client projects in one place, with uptime, SSL and domain expiry, time tracking and monthly reports
- Use a built-in toolbox for JSON, JWT, Base64, timestamps, hashes and regex

Your bookmarks and most visited pages stay in your browser and are never sent to the server.

**Homepage URL:** https://chrome.ruhul0.com

**Privacy policy URL:** https://chrome.ruhul0.com/privacy.html

## Single purpose

Replaces Chrome's new tab page with a personal start page for search, saved sites, bookmarks and most visited pages.

## Permission justifications

- **bookmarks:** Shows the user's bookmarks on the new tab page and includes them in its search. They are not sent anywhere.
- **favicon:** Shows each site's icon next to its link.
- **identity:** Opens Chrome's sign-in window so the user can sign in with GitHub.
- **search:** Sends searches from the new tab page to the user's default search engine.
- **storage:** Keeps the user's session and a copy of their saved sites so the page loads straight away.
- **topSites:** Shows the user's most visited pages on the new tab page. They are not sent anywhere.
- **Host permission (chrome.ruhul0.com):** Loads and saves the user's sites on the Home Base server.
- **Remote code:** No. All code is included in the extension package.

## Data usage answers

- Collected: personally identifiable information (GitHub username and user ID), authentication information (the signed-in session) and website content (the sites, projects, saved commands, todos, notes and tracked time the user saves).
- Not sold, not used for unrelated purposes, and not used for creditworthiness or lending.

## Test instructions for the reviewer

Open a new tab, click Continue with GitHub and sign in with any GitHub account. No special account or test credentials are needed. Click Customize to change the design and Edit to add or remove sites.

## Images

- Store icon: `assets/store/store-icon-128x128.png`
- Screenshots: `assets/store/screenshot-*-1280x800.png`
- Small promo tile: `assets/store/small-promo-440x280.png`

## Before submitting for review

The Web Store gives the extension its own ID as soon as the package is uploaded. Sign-in refuses unknown extension IDs, so add the new one to `~/chrome-home/.env` on the server before submitting, keeping the development ID, then restart the app:

```
EXTENSION_IDS=ckmmmpglhbeeeppgclggngmgdjogmlmh,NEW_STORE_ID
```

```bash
cd ~/chrome-home && docker compose up -d app
```

## After approval

Add the store address to `.env` and restart the app the same way. The website only offers the extension after this is set.

```
EXTENSION_URL=https://chromewebstore.google.com/detail/NEW_STORE_ID
```
