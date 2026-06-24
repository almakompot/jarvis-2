# Site Gate Chrome Extension

Site Gate asks before opening HTTP/HTTPS sites. The user can decline, allow the site for one minute, allow it for five minutes, or type a custom number of minutes.

## Load Manually

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Select **Load unpacked**.
4. Choose this directory.

## Verify

```bash
npm run site-gate:check
```

The smoke runner tries Google Chrome first, then Microsoft Edge if the local Chrome build does not expose the unpacked extension worker. To force a browser:

```bash
SITE_GATE_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run site-gate:smoke
```

The smoke test launches a temporary Chromium browser profile with this unpacked extension, opens local test sites, and verifies:

- navigation redirects to the gate before the site is shown,
- invalid custom minutes stay on the gate,
- `1 min` opens the target and allows the same origin,
- `5 min` opens a separate target,
- custom minutes open a separate target,
- `Actually no` does not open the target and shows the local blocked page.

It writes `tmp/site-gate-smoke/scenario.json` plus screenshot, trace, and console-log artifacts for meta-harness browser-extension evidence.
