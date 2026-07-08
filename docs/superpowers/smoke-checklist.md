# DevBrowser smoke checklist

Run after any significant change, against the packaged exe (`npm run dist` → `release/DevBrowser 0.1.0.exe`) or dev mode (`npm run dev`).

- [ ] Two `+` tabs on the same login page → log into different accounts → both stay logged in independently
- [ ] Right-click → Duplicate (same session) → new tab shares the login
- [ ] Popup-based login (e.g. "Sign in with Google" window) completes and lands in the tab's session
- [ ] Close one duplicated tab → the other keeps its login; close both → session gone (new tab on that site is logged out)
- [ ] Restart the app → groups, tab names, URLs, and logins all restored
- [ ] Group rename / tab rename stick (page titles don't overwrite a custom name)
- [ ] Rename via right-click menu focuses the inline input immediately (typing works without an extra click)
- [ ] Delete group asks for confirmation (native dialog) and closes its tabs
- [ ] Address bar: `:3000` → `http://localhost:3000`; `example.com` → loads
- [ ] Unreachable port shows the in-view error page; reload retries the real URL
- [ ] F12 opens the floating API panel; fetch/XHR calls appear; filter works; scrolling up pauses auto-follow
- [ ] Clicking a request shows request/response headers, pretty JSON response body, and redirect chains when present
- [ ] Ctrl+T, Ctrl+W, Ctrl+L, Ctrl+R, Ctrl+Shift+F12 all work with focus in the page

## v1.1 additions

- [ ] Duplicate a tab → original + duplicate show a matching color bar and are adjacent; solo tabs have no bar; closing one duplicate does not recolor other sessions
- [ ] Ctrl+Tab cycles tabs forward (wraps); Ctrl+Shift+Tab cycles groups forward (wraps)
- [ ] No OS title bar; native min/max/close work top-right; window drags by the group row; nothing renders under the buttons
- [ ] Ctrl+wheel / Ctrl+= / Ctrl+- / Ctrl+0 zoom all tabs together; level survives restart
- [ ] Settings (⚙) opens; Zoom control matches and drives page zoom
- [ ] Login submit → save bar → Save persists (Reveal in settings shows it); Never suppresses that origin; two rapid submits queue (one prompt at a time, none dropped)
- [ ] Autofill dropdown lists saved accounts for the site; selecting fills username+password; never auto-submits; no fill inside cross-origin iframes (top-frame only)
- [ ] passwords.json on disk contains no plaintext password
