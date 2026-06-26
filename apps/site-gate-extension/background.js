const ALLOWANCES_KEY = "siteGateAllowances";
const EXPIRY_ALARM_PREFIX = "siteGateExpiry:";
const MAX_CUSTOM_MINUTES = 24 * 60;

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || details.tabId < 0) {
    return;
  }

  void handleNavigation(details);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) {
    return;
  }

  void handleNavigation({ tabId, frameId: 0, url: changeInfo.url });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(EXPIRY_ALARM_PREFIX)) {
    void handleAllowanceExpiry(alarm.name.slice(EXPIRY_ALARM_PREFIX.length));
  }
});

async function handleNavigation(details) {
  const targetUrl = normalizeTargetUrl(details.url);
  if (!targetUrl) {
    return;
  }

  const origin = originFromUrl(targetUrl);
  const allowedUntil = await getAllowedUntil(origin);
  if (allowedUntil > Date.now()) {
    return;
  }

  const gateUrl = chrome.runtime.getURL(
    `gate.html?target=${encodeURIComponent(targetUrl)}&tabId=${encodeURIComponent(String(details.tabId))}`
  );
  await updateTab(details.tabId, gateUrl);
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") {
    throw new Error("Invalid message.");
  }

  if (message.type === "allow") {
    const targetUrl = requireTargetUrl(message.targetUrl);
    const minutes = normalizeMinutes(message.minutes);
    const tabId = normalizeTabId(message.tabId);
    await allowOriginFor(originFromUrl(targetUrl), minutes);
    await updateTab(tabId, targetUrl);
    return { ok: true };
  }

  if (message.type === "decline") {
    const targetUrl = requireTargetUrl(message.targetUrl);
    const tabId = normalizeTabId(message.tabId);
    await closeTab(tabId);
    return { ok: true };
  }

  throw new Error(`Unsupported message type: ${message.type}`);
}

function normalizeTargetUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  return parsed.href;
}

function requireTargetUrl(rawUrl) {
  const targetUrl = normalizeTargetUrl(rawUrl);
  if (!targetUrl) {
    throw new Error("Target must be an HTTP or HTTPS URL.");
  }
  return targetUrl;
}

function originFromUrl(rawUrl) {
  return new URL(rawUrl).origin;
}

function normalizeMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_CUSTOM_MINUTES) {
    throw new Error(`Minutes must be greater than 0 and no more than ${MAX_CUSTOM_MINUTES}.`);
  }
  return minutes;
}

function normalizeTabId(value) {
  const tabId = Number(value);
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error("Invalid tab id.");
  }
  return tabId;
}

async function getAllowedUntil(origin) {
  const state = await chrome.storage.local.get(ALLOWANCES_KEY);
  const allowances = state[ALLOWANCES_KEY] || {};
  return Number(allowances[origin] || 0);
}

async function allowOriginFor(origin, minutes) {
  const state = await chrome.storage.local.get(ALLOWANCES_KEY);
  const allowances = state[ALLOWANCES_KEY] || {};
  const allowedUntil = Date.now() + minutes * 60 * 1000;
  allowances[origin] = allowedUntil;
  await chrome.storage.local.set({ [ALLOWANCES_KEY]: allowances });
  chrome.alarms.create(`${EXPIRY_ALARM_PREFIX}${origin}`, { when: allowedUntil });
}

async function handleAllowanceExpiry(origin) {
  const allowedUntil = await getAllowedUntil(origin);
  const now = Date.now();
  if (allowedUntil > now) {
    chrome.alarms.create(`${EXPIRY_ALARM_PREFIX}${origin}`, { when: allowedUntil });
    return;
  }

  await removeAllowance(origin);
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    const targetUrl = normalizeTargetUrl(tab.url);
    if (!targetUrl || originFromUrl(targetUrl) !== origin || !Number.isInteger(tab.id)) {
      return;
    }

    await closeTab(tab.id);
  }));
}

async function removeAllowance(origin) {
  const state = await chrome.storage.local.get(ALLOWANCES_KEY);
  const allowances = state[ALLOWANCES_KEY] || {};
  delete allowances[origin];
  await chrome.storage.local.set({ [ALLOWANCES_KEY]: allowances });
}

function updateTab(tabId, url) {
  return chrome.tabs.update(tabId, { url });
}

function closeTab(tabId) {
  return chrome.tabs.remove(tabId);
}
