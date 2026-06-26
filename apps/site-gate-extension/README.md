# Site Gate

Site Gate is a small Chrome/Edge extension that interrupts HTTP and HTTPS navigation before the page opens. It is meant for sites you want to make less automatic to visit: the gate appears in a random in-viewport location and shuffles the main action buttons on every render, so clicking through is harder to turn into muscle memory.

## What It Does

- Shows a gate before opening web pages.
- Moves the gate card to a random position while keeping it fully inside the browser viewport.
- Randomizes the order of `Actually no`, `10 sec`, `1 min`, and `5 min`.
- Lets you allow the current site origin for `10 sec`, `1 min`, `5 min`, or a custom decimal number of minutes such as `0.05` or `0.1`.
- Reuses the active allowance for same-origin navigation.
- Closes the open tabs for that origin when a short allowance expires.
- Closes the gated tab when you click `Actually no` or press `Escape`.

## Install From GitHub

1. Download or clone this repository:

   ```bash
   git clone https://github.com/almakompot/jarvis-2.git
   ```

2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Select **Load unpacked**.
5. Choose this folder:

   ```text
   apps/site-gate-extension
   ```

The extension starts working as soon as the unpacked folder is loaded.

## Use It

When Site Gate intercepts a navigation, choose one of the gate actions:

- `Actually no`: close the gated tab.
- `10 sec`: open the site briefly.
- `1 min`: open the site for one minute.
- `5 min`: open the site for five minutes.
- Custom minutes: type any value greater than `0` and no more than `1440`, then select `Open`.

The allowance is stored per origin, so allowing `https://example.com/path-a` also allows `https://example.com/path-b` until the allowance expires.

## Privacy And Permissions

Site Gate has no backend service and does not send browsing data anywhere. It uses browser extension APIs only:

- `webNavigation`: intercept top-level HTTP/HTTPS navigations.
- `tabs`: redirect gated pages, open allowed targets, and close declined or expired tabs.
- `storage`: remember temporary per-origin allowances locally in the browser profile.
- `alarms`: expire temporary allowances on schedule.
- `<all_urls>` host permission: observe and gate HTTP/HTTPS navigation across sites.

## Verify Locally

From the repository root:

```bash
npm run site-gate:check
```

This runs static extension validation and a real browser smoke test with a temporary profile. The smoke runner tries Google Chrome first, then Microsoft Edge if the local Chrome build does not expose the unpacked extension worker. To force a browser:

```bash
SITE_GATE_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run site-gate:smoke
```

The smoke test verifies:

- navigation redirects to the gate before the site is shown,
- the gate card stays inside the viewport while avoiding the old fixed center placement,
- the main action buttons are shuffled away from static HTML order,
- invalid custom minutes stay on the gate,
- `10 sec` opens the target,
- `1 min` opens the target and allows the same origin,
- `5 min` opens a separate target,
- custom decimal minutes open separate targets,
- expiry closes open tabs for that origin,
- `Actually no` and `Escape` close the tab instead of opening the target.

Smoke artifacts are written under `tmp/site-gate-smoke/`.
