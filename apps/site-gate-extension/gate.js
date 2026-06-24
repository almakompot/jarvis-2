const params = new URLSearchParams(location.search);
const targetUrl = params.get("target") || "";
const tabId = Number(params.get("tabId"));

const target = document.querySelector("#target");
const status = document.querySelector("#status");
const decline = document.querySelector("#decline");
const customForm = document.querySelector("#custom-form");
const minutesInput = document.querySelector("#minutes");

init();

function init() {
  const parsed = parseTarget(targetUrl);
  if (!parsed || !Number.isInteger(tabId)) {
    document.body.dataset.invalid = "true";
    target.textContent = "This gate was opened without a valid target.";
    setStatus("Cannot continue because the target URL is invalid.", true);
    return;
  }

  target.textContent = parsed.href;
  decline.addEventListener("click", () => declineTarget());
  for (const button of document.querySelectorAll("[data-minutes]")) {
    button.addEventListener("click", () => allowFor(Number(button.dataset.minutes)));
  }
  customForm.addEventListener("submit", (event) => {
    event.preventDefault();
    allowFor(Number(minutesInput.value));
  });
  document.body.dataset.ready = "true";
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
    setStatus("Enter a whole number of minutes from 1 to 1440.", true);
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
  setStatus("Staying away from this site...");
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
