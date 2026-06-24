#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.service_worker, "background.js");
assert.ok(manifest.permissions.includes("webNavigation"));
assert.ok(manifest.permissions.includes("tabs"));
assert.ok(manifest.permissions.includes("storage"));
assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);

for (const file of ["background.js", "gate.html", "gate.js", "gate.css", "blocked.html", "blocked.js"]) {
  assert.ok(existsSync(join(root, file)), `Missing extension file: ${file}`);
}

const background = readFileSync(join(root, "background.js"), "utf8");
assert.match(background, /onBeforeNavigate/);
assert.match(background, /tabs\.onUpdated/);
assert.match(background, /frameId !== 0/);
assert.match(background, /chrome\.tabs\.update/);

const gate = readFileSync(join(root, "gate.js"), "utf8");
assert.match(gate, /data-minutes/);
assert.match(gate, /minutes <= 0/);
assert.match(gate, /type: "allow"/);
assert.match(gate, /type: "decline"/);
assert.match(gate, /dataset\.ready/);

const gateHtml = readFileSync(join(root, "gate.html"), "utf8");
assert.match(gateHtml, /novalidate/);

console.log("Site Gate extension manifest and source checks passed.");
