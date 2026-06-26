const params = new URLSearchParams(location.search);
const targetUrl = params.get("target") || "";
const tabId = Number(params.get("tabId"));

const target = document.querySelector("#target");
const status = document.querySelector("#status");
const decline = document.querySelector("#decline");
const customForm = document.querySelector("#custom-form");
const minutesInput = document.querySelector("#minutes");
const shell = document.querySelector(".shell");
const actions = document.querySelector(".actions");
const gateMargin = 24;

init();

function init() {
  randomizeActionButtons();
  const parsed = parseTarget(targetUrl);
  if (!parsed || !Number.isInteger(tabId)) {
    document.body.dataset.invalid = "true";
    target.textContent = "This gate was opened without a valid target.";
    setStatus("Cannot continue because the target URL is invalid.", true);
    finishGateSetup();
    return;
  }

  target.textContent = parsed.href;
  decline.addEventListener("click", () => declineTarget());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      declineTarget();
    }
  });
  for (const button of document.querySelectorAll("[data-minutes]")) {
    button.addEventListener("click", () => allowFor(Number(button.dataset.minutes)));
  }
  customForm.addEventListener("submit", (event) => {
    event.preventDefault();
    allowFor(Number(minutesInput.value));
  });
  finishGateSetup();
}

function finishGateSetup() {
  requestAnimationFrame(() => {
    randomizeGatePosition();
    document.body.dataset.ready = "true";
  });
}

function parseTarget(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

async function allowFor(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
    setStatus("Enter minutes greater than 0 and no more than 1440.", true);
    minutesInput.focus();
    return;
  }

  setStatus("Opening...");
  const response = await chrome.runtime.sendMessage({
    type: "allow",
    targetUrl,
    tabId,
    minutes
  });
  if (!response?.ok) {
    setStatus(response?.error || "Could not open the site.", true);
  }
}

async function declineTarget() {
  setStatus("Closing...");
  const response = await chrome.runtime.sendMessage({
    type: "decline",
    targetUrl,
    tabId
  });
  if (!response?.ok) {
    setStatus(response?.error || "Could not decline the site.", true);
  }
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = isError ? "true" : "false";
}

function randomizeActionButtons() {
  if (!actions) {
    return;
  }

  const buttons = Array.from(actions.querySelectorAll("button"));
  const originalOrder = buttons.map(actionButtonKey).join("|");
  const shuffled = shuffle(buttons);
  if (shuffled.length > 1 && shuffled.map(actionButtonKey).join("|") === originalOrder) {
    const offset = 1 + Math.floor(Math.random() * (shuffled.length - 1));
    shuffled.push(...shuffled.splice(0, offset));
  }

  for (const button of shuffled) {
    actions.append(button);
  }
  actions.dataset.shuffled = "true";
  actions.dataset.order = shuffled.map(actionButtonKey).join("|");
}

function actionButtonKey(button) {
  return button.dataset.minutes || button.textContent.trim();
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function randomizeGatePosition() {
  if (!shell) {
    return;
  }

  const viewport = getViewportSize();
  const rect = shell.getBoundingClientRect();
  let left = randomStart(viewport.width, rect.width, gateMargin);
  let top = randomStart(viewport.height, rect.height, gateMargin);
  const centerLeft = Math.max(0, (viewport.width - rect.width) / 2);
  const centerTop = Math.max(0, (viewport.height - rect.height) / 2);

  if (Math.abs(left - centerLeft) < 40 && Math.abs(top - centerTop) < 40) {
    const horizontalBounds = startBounds(viewport.width, rect.width, gateMargin);
    left = Math.random() < 0.5 ? horizontalBounds.min : horizontalBounds.max;
  }

  placeGate(left, top);
  shell.dataset.positioned = "true";
}

function placeGate(left, top) {
  shell.style.setProperty("--gate-left", `${Math.round(left)}px`);
  shell.style.setProperty("--gate-top", `${Math.round(top)}px`);
  shell.style.setProperty("--gate-transform", "none");
}

function getViewportSize() {
  return {
    width: Math.max(document.documentElement.clientWidth, window.innerWidth || 0),
    height: Math.max(document.documentElement.clientHeight, window.innerHeight || 0)
  };
}

function randomStart(viewportSize, elementSize, margin) {
  const bounds = startBounds(viewportSize, elementSize, margin);
  if (bounds.max <= bounds.min) {
    return bounds.min;
  }
  return bounds.min + Math.random() * (bounds.max - bounds.min);
}

function startBounds(viewportSize, elementSize, margin) {
  const spare = viewportSize - elementSize;
  if (spare <= margin * 2) {
    const centered = Math.max(0, spare / 2);
    return { min: centered, max: centered };
  }
  return { min: margin, max: spare - margin };
}

function clampGatePosition() {
  if (!shell || shell.dataset.positioned !== "true") {
    return;
  }

  const viewport = getViewportSize();
  const rect = shell.getBoundingClientRect();
  const left = clampStart(rect.left, viewport.width, rect.width, gateMargin);
  const top = clampStart(rect.top, viewport.height, rect.height, gateMargin);
  placeGate(left, top);
}

function clampStart(value, viewportSize, elementSize, margin) {
  const bounds = startBounds(viewportSize, elementSize, margin);
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

window.addEventListener("resize", clampGatePosition);
