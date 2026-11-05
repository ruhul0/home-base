'use strict';

const AUTO_LOGIN_KEY = 'auto-login';
const AUTO_ATTEMPT_KEY = 'auto-login-attempted';

// People who are already signed in skip this page. People who signed in on this browser
// before, and didn't sign out, are signed straight back in through GitHub. That only
// happens once per browser session, so a failed sign-in can't cause a redirect loop.
function routeReturningVisitor() {
  if (localStorage.getItem('token')) {
    location.replace('newtab.html');
    return true;
  }
  if (localStorage.getItem(AUTO_LOGIN_KEY) === 'true' && !sessionStorage.getItem(AUTO_ATTEMPT_KEY)) {
    sessionStorage.setItem(AUTO_ATTEMPT_KEY, '1');
    location.replace('newtab.html?signin=1');
    return true;
  }
  return false;
}

async function showStoreLink() {
  const response = await fetch('/api/config');
  if (!response.ok) return;
  const { extensionUrl } = await response.json();
  if (!extensionUrl) return;
  const link = document.getElementById('add-to-chrome');
  link.href = extensionUrl;
  link.hidden = false;
  document.getElementById('extension-note').textContent = 'Free to use.';
}

if (!routeReturningVisitor()) showStoreLink().catch(() => {});
