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
