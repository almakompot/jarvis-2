import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const ignoredDirs = new Set([
  ".git",
  ".hg",
  ".svn",
  ".task-runs",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vercel"
]);

const secretNamePatterns = [
  /^\.env(?:\.|$)/,
  /\.pem$/i,
  /\.key$/i,
  /private[-_]?key/i,
  /service[-_]?account.*\.json$/i,
  /credentials?.*\.json$/i,
  /firebase.*admin.*\.json$/i
];

export function inspectRepo({ repoPath, runId, createdAt }) {
  const targetPath = realpathSync(resolve(repoPath));
  const git = inspectGit(targetPath);
  const profileRoot = git.isRepo ? git.root : targetPath;
  const files = collectFiles(profileRoot);
  const packageJson = readJsonIfSafe(join(profileRoot, "package.json"));
  const manifest = readJsonIfSafe(join(profileRoot, "manifest.json"));
  const packageProfile = buildPackageProfile({ repoPath: profileRoot, packageJson });
  const frameworkSignals = detectFrameworkSignals({ repoPath: profileRoot, files, packageJson, manifest, packageProfile });
  const testSignals = detectTestSignals({ repoPath: profileRoot, files, packageProfile });
  const devServer = detectDevServer({ packageProfile, files });
  const surfaces = detectSurfaces({ repoPath: profileRoot, files, packageJson, manifest });
  const sensitivePathPolicy = detectSensitivePaths({ files });
  const liveSystemRisks = detectLiveSystemRisks({ packageProfile, packageJson, files });

  return {
    schemaVersion: 1,
    kind: "meta-harness.repo-profile",
    runId,
    createdAt,
    repoPath: profileRoot,
    targetPath,
    adapterStatus: "m2-core",
    milestone: "M2 Repo Adapter",
    note: "Live repo profile generated from local files and safe commands. Secret file contents are not read.",
    root: {
      name: basename(profileRoot),
      entries: rootEntries(profileRoot),
      scannedFileCount: files.length,
      sensitiveNamesOmitted: true
    },
    git,
    package: packageProfile,
    frameworkSignals,
    testSignals,
    devServer,
    surfaces,
    sensitivePathPolicy,
    sensitivePaths: sensitivePathPolicy.forbiddenPatterns,
    liveSystemRisks
  };
}

function collectFiles(repoPath, { maxFiles = 800, maxDepth = 5 } = {}) {
  const collected = [];
  const visit = (dir, depth) => {
    if (collected.length >= maxFiles || depth > maxDepth) {
      return;
    }
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (collected.length >= maxFiles) {
        return;
      }
      const absolute = join(dir, entry.name);
      const rel = relative(repoPath, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          visit(absolute, depth + 1);
        }
        continue;
      }
      if (entry.isFile()) {
        collected.push(rel);
      }
    }
  };
  visit(repoPath, 0);
  return collected.sort();
}

function rootEntries(repoPath) {
  return readdirSync(repoPath, { withFileTypes: true })
    .filter((entry) => !ignoredDirs.has(entry.name) && !isSecretPath(entry.name))
    .slice(0, 80)
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file"
    }));
}

function readJsonIfSafe(path) {
  if (!existsSync(path) || isSecretPath(basename(path))) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readTextIfSafe(path, maxBytes = 20000) {
  if (!existsSync(path) || isSecretPath(basename(path))) {
    return "";
  }
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > maxBytes) {
      return "";
    }
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function buildPackageProfile({ repoPath, packageJson }) {
  const managerSignals = detectPackageManagerSignals({ repoPath, packageJson });
  const manager = choosePackageManager(managerSignals, Boolean(packageJson));
  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
  const scriptNames = Object.keys(scripts).sort();
  const scriptClassifications = scriptNames.map((name) => ({
    name,
    command: scripts[name],
    categories: classifyScript(name, scripts[name]),
    risk: scriptRisk(name, scripts[name])
  }));
  const dependencies = collectDependencyNames(packageJson);

  return {
    hasPackageJson: Boolean(packageJson),
    manager,
    managerGuess: manager,
    packageManagerField: packageJson?.packageManager || null,
    managerSignals,
    scripts,
    scriptNames,
    scriptClassifications,
    dependencies
  };
}

function detectPackageManagerSignals({ repoPath, packageJson }) {
  const signals = [];
  if (packageJson?.packageManager) {
    const manager = String(packageJson.packageManager).split("@")[0];
    signals.push({
      kind: "packageManager-field",
      manager,
      value: packageJson.packageManager,
      confidence: "high"
    });
  }
  for (const [file, manager] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"]
  ]) {
    if (existsSync(join(repoPath, file))) {
      signals.push({
        kind: "lockfile",
        manager,
        path: file,
        confidence: "high"
      });
    }
  }
  if (packageJson && signals.length === 0) {
    signals.push({
      kind: "package-json-default",
      manager: "npm",
      confidence: "low"
    });
  }
  return signals;
}

function choosePackageManager(signals, hasPackageJson) {
  const field = signals.find((signal) => signal.kind === "packageManager-field");
  if (field) {
    return field.manager;
  }
  for (const manager of ["pnpm", "yarn", "bun", "npm"]) {
    if (signals.some((signal) => signal.manager === manager)) {
      return manager;
    }
  }
  return hasPackageJson ? "npm" : null;
}

function collectDependencyNames(packageJson) {
  if (!packageJson) {
    return [];
  }
  return Object.keys({
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
    ...(packageJson.peerDependencies || {}),
    ...(packageJson.optionalDependencies || {})
  }).sort();
}

function detectFrameworkSignals({ repoPath, files, packageJson, manifest, packageProfile }) {
  const deps = new Set(packageProfile.dependencies);
  const scripts = Object.values(packageProfile.scripts || {}).join("\n");
  const signals = [];
  const has = (path) => files.includes(path) || existsSync(join(repoPath, path));
  const any = (pattern) => files.some((file) => pattern.test(file));

  if (deps.has("next") || has("next.config.js") || has("next.config.mjs") || has("next.config.ts") || any(/^app\/.*page\.(t|j)sx?$/) || any(/^pages\/.*\.(t|j)sx?$/) || /\bnext\b/.test(scripts)) {
    signals.push({
      kind: any(/^app\//) ? "next-app-router" : "next",
      confidence: deps.has("next") || any(/^app\//) ? "high" : "medium",
      evidence: evidenceList([
        deps.has("next") && "dependency:next",
        any(/^app\//) && "app/",
        any(/^pages\//) && "pages/",
        (has("next.config.js") || has("next.config.mjs") || has("next.config.ts")) && "next.config",
        /\bnext\b/.test(scripts) && "script:next"
      ])
    });
  }
  if (deps.has("react")) {
    signals.push({ kind: "react", confidence: "medium", evidence: ["dependency:react"] });
  }
  if (deps.has("vue") || deps.has("@vitejs/plugin-vue")) {
    signals.push({ kind: "vue", confidence: "medium", evidence: ["dependency:vue"] });
  }
  if (manifest?.manifest_version || has("manifest.json") || files.some((file) => /(^|\/)(background|content)\.(m?js|ts)$/.test(file))) {
    signals.push({
      kind: "browser-extension",
      confidence: manifest?.manifest_version ? "high" : "medium",
      evidence: evidenceList([
        has("manifest.json") && "manifest.json",
        manifest?.manifest_version && `manifest_version:${manifest.manifest_version}`,
        files.find((file) => /(^|\/)background\.(m?js|ts)$/.test(file)),
        files.find((file) => /(^|\/)content\.(m?js|ts)$/.test(file))
      ])
    });
  }
  if (has("pyproject.toml") || has("requirements.txt") || files.some((file) => /^scripts\/.*\.py$/.test(file)) || files.some((file) => /^src\/.*\.py$/.test(file))) {
    signals.push({
      kind: "python-pipeline",
      confidence: has("pyproject.toml") || has("requirements.txt") ? "high" : "medium",
      evidence: evidenceList([
        has("pyproject.toml") && "pyproject.toml",
        has("requirements.txt") && "requirements.txt",
        files.find((file) => /^scripts\/.*\.py$/.test(file)),
        files.find((file) => /^src\/.*\.py$/.test(file))
      ])
    });
  }
  if (has("pubspec.yaml") || has("lib/main.dart")) {
    signals.push({ kind: "flutter", confidence: "high", evidence: evidenceList([has("pubspec.yaml") && "pubspec.yaml", has("lib/main.dart") && "lib/main.dart"]) });
  }
  if (packageJson?.bin || files.some((file) => /^bin\/.+\.(m?js|ts)$/.test(file))) {
    signals.push({ kind: "node-cli", confidence: "medium", evidence: evidenceList([packageJson?.bin && "package.json:bin", files.find((file) => /^bin\/.+\.(m?js|ts)$/.test(file))]) });
  }
  return signals;
}

function detectTestSignals({ repoPath, files, packageProfile }) {
  const signals = [];
  const scripts = packageProfile.scripts || {};
  const runner = scriptRunner(packageProfile.manager);
  for (const [name, command] of Object.entries(scripts)) {
    const categories = classifyScript(name, command);
    if (categories.some((category) => ["test", "e2e", "smoke", "lint", "build", "typecheck"].includes(category))) {
      signals.push({
        kind: testKindFromScript(name, command, categories),
        source: "package-script",
        script: name,
        command: `${runner} ${name}`,
        rawCommand: command
      });
    }
  }
  if (existsSync(join(repoPath, "vitest.config.ts")) || existsSync(join(repoPath, "vitest.config.js")) || packageProfile.dependencies.includes("vitest")) {
    signals.push({ kind: "vitest", source: "config-or-dependency", command: scripts.test ? `${runner} test` : null });
  }
  if (existsSync(join(repoPath, "playwright.config.ts")) || existsSync(join(repoPath, "playwright.config.js")) || packageProfile.dependencies.includes("@playwright/test")) {
    signals.push({ kind: "playwright", source: "config-or-dependency", command: scripts["test:e2e"] ? `${runner} test:e2e` : null });
  }
  if (existsSync(join(repoPath, "cypress.config.ts")) || existsSync(join(repoPath, "cypress.config.js")) || packageProfile.dependencies.includes("cypress")) {
    signals.push({ kind: "cypress", source: "config-or-dependency", command: null });
  }
  if (files.some((file) => /^tests?\/.*\.py$/.test(file))) {
    signals.push({ kind: "pytest", source: "test-files", command: "pytest" });
  }
  if (files.some((file) => /\.(test|spec)\.(m?js|ts|tsx|jsx)$/.test(file))) {
    signals.push({ kind: "js-test-files", source: "test-files", command: scripts.test ? `${runner} test` : null });
  }
  return uniqueSignals(signals, (signal) => `${signal.kind}:${signal.script || ""}:${signal.command || ""}`);
}

function detectDevServer({ packageProfile, files }) {
  const scripts = packageProfile.scripts || {};
  const runner = scriptRunner(packageProfile.manager);
  const candidates = [];
  for (const [name, command] of Object.entries(scripts)) {
    const categories = classifyScript(name, command);
    if (categories.includes("dev") || name === "start") {
      candidates.push({
        script: name,
        command: `${runner} ${name}`,
        rawCommand: command,
        port: inferPort(command),
        needsEnv: /\b(env|dotenv|process\.env)\b/i.test(command),
        cleanStart: /clean|NEXT_DIST_DIR|rm -rf|rimraf/.test(command)
      });
    }
  }
  return {
    candidates,
    ports: [...new Set(candidates.map((candidate) => candidate.port).filter(Boolean))],
    configEvidence: files.filter((file) => /^(next\.config|vite\.config|playwright\.config)/.test(file)).slice(0, 10)
  };
}

function detectSurfaces({ repoPath, files, packageJson, manifest }) {
  return {
    routes: detectRoutes(files),
    browserExtension: detectExtensionSurfaces({ manifest, files }),
    cli: detectCliSurfaces({ packageJson, files }),
    api: detectApiSurfaces(files),
    dataPipeline: detectDataSurfaces({ repoPath, files })
  };
}

function detectRoutes(files) {
  const routes = [];
  for (const file of files) {
    const appMatch = file.match(/^app\/(.*)\/page\.(?:t|j)sx?$/);
    if (appMatch) {
      routes.push({
        kind: "next-app-router",
        file,
        route: routeFromSegments(appMatch[1])
      });
    }
    const pageMatch = file.match(/^pages\/(.*)\.(?:t|j)sx?$/);
    if (pageMatch && !pageMatch[1].startsWith("api/")) {
      routes.push({
        kind: "next-pages-router",
        file,
        route: routeFromSegments(pageMatch[1].replace(/\/index$/, ""))
      });
    }
  }
  return routes.slice(0, 80);
}

function routeFromSegments(value) {
  const cleaned = value
    .split("/")
    .filter((segment) => segment && !segment.startsWith("("))
    .map((segment) => segment === "index" ? "" : segment)
    .join("/");
  return `/${cleaned}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function detectExtensionSurfaces({ manifest, files }) {
  if (!manifest && !files.includes("manifest.json")) {
    return null;
  }
  return {
    manifestVersion: manifest?.manifest_version || null,
    background: manifest?.background || null,
    action: manifest?.action || null,
    optionsPage: manifest?.options_page || null,
    hostPermissions: manifest?.host_permissions || [],
    contentScripts: manifest?.content_scripts || [],
    files: files.filter((file) => file === "manifest.json" || /(^|\/)(background|content|popup|options|gate|blocked)\.(html|m?js|ts)$/.test(file)).slice(0, 80)
  };
}

function detectCliSurfaces({ packageJson, files }) {
  const bins = packageJson?.bin
    ? typeof packageJson.bin === "string"
      ? { [packageJson.name || "cli"]: packageJson.bin }
      : packageJson.bin
    : {};
  return {
    bins,
    files: files.filter((file) => /^bin\/|(^|\/)cli\.(m?js|ts)$|(^|\/)index\.(m?js|ts)$/.test(file)).slice(0, 40)
  };
}

function detectApiSurfaces(files) {
  return files
    .filter((file) => /(^app\/api\/.*\/route\.(t|j)s$)|(^pages\/api\/.*\.(t|j)s$)|(^src\/.*(controller|route|router).*\.(t|j)s$)/.test(file))
    .slice(0, 80)
    .map((file) => ({ file }));
}

function detectDataSurfaces({ repoPath, files }) {
  return {
    directories: ["data", "input", "inputs", "output", "outputs", "fixtures", "samples"]
      .filter((dir) => existsSync(join(repoPath, dir))),
    scripts: files.filter((file) => /^scripts\/.*\.(py|m?js|ts|sh)$/.test(file)).slice(0, 60),
    manifests: files.filter((file) => /manifest|index|catalog/i.test(file) && /\.(json|csv|xlsx|md)$/.test(file)).slice(0, 40)
  };
}

function detectSensitivePaths({ files }) {
  const detected = files
    .filter((file) => isSecretPath(file))
    .map((path) => ({ path, contentsRead: false }))
    .slice(0, 80);
  return {
    forbiddenPatterns: [
      ".git/**",
      ".env",
      ".env.*",
      "node_modules/**",
      "**/*.pem",
      "**/*.key",
      "**/service-account*.json",
      "**/credentials*.json",
      ".task-runs/**/transcript-secrets/**"
    ],
    detectedSensitivePaths: detected,
    contentsRead: false
  };
}

function detectLiveSystemRisks({ packageProfile, packageJson, files }) {
  const risks = [];
  for (const script of packageProfile.scriptClassifications || []) {
    if (script.risk !== "local") {
      risks.push({
        kind: script.categories.find((category) => ["deploy", "live", "send", "migration", "seed", "publish", "dangerous", "cost"].includes(category)) || script.risk,
        source: `script:${script.name}`,
        command: script.command,
        policy: "approval-required"
      });
    }
  }
  const deps = new Set(packageProfile.dependencies || []);
  for (const [dependency, kind] of [
    ["stripe", "stripe"],
    ["firebase-admin", "firebase"],
    ["firebase", "firebase"],
    ["@supabase/supabase-js", "supabase"],
    ["openai", "external-api-cost"],
    ["resend", "email-send"],
    ["nodemailer", "email-send"],
    ["@slack/web-api", "external-send"],
    ["twilio", "external-send"]
  ]) {
    if (deps.has(dependency)) {
      risks.push({
        kind,
        source: `dependency:${dependency}`,
        policy: "no live external action without explicit approval"
      });
    }
  }
  if (packageJson?.scripts) {
    const scriptText = Object.values(packageJson.scripts).join("\n");
    if (/vercel|firebase|supabase|stripe|resend|send|deploy|publish|migrat|seed|prod/i.test(scriptText)) {
      risks.push({
        kind: "script-live-keywords",
        source: "package.json:scripts",
        policy: "review scripts before execution"
      });
    }
  }
  for (const file of files) {
    if (/^(vercel\.json|firebase\.json|supabase\/|\.github\/workflows\/)/.test(file)) {
      risks.push({
        kind: "ops-config",
        source: file,
        policy: "deployment or live-system config requires approval for mutation"
      });
    }
  }
  return uniqueSignals(risks, (risk) => `${risk.kind}:${risk.source}`);
}

function classifyScript(name, command) {
  const text = `${name} ${command}`.toLowerCase();
  const categories = [];
  if (/\bdev\b|dev:|next dev|vite --host|astro dev/.test(text)) {
    categories.push("dev");
  }
  if (/\bbuild\b|next build|vite build|tsc\b/.test(text)) {
    categories.push("build");
  }
  if (/\blint\b|eslint/.test(text)) {
    categories.push("lint");
  }
  if (/\btypecheck\b|tsc --noemit/.test(text)) {
    categories.push("typecheck");
  }
  if (/\btest\b|vitest|jest|node --test|pytest/.test(text)) {
    categories.push("test");
  }
  if (/e2e|playwright|cypress/.test(text)) {
    categories.push("e2e");
  }
  if (/smoke/.test(text)) {
    categories.push("smoke");
  }
  if (/deploy|vercel --prod|firebase deploy|wrangler deploy/.test(text)) {
    categories.push("deploy");
  }
  if (/prod|production|live/.test(text)) {
    categories.push("live");
  }
  if (/send|email|slack|twilio|resend|mail/.test(text)) {
    categories.push("send");
  }
  if (/migrat|prisma db push|supabase db push/.test(text)) {
    categories.push("migration");
  }
  if (/\bseed\b/.test(text)) {
    categories.push("seed");
  }
  if (/publish|npm publish|chrome webstore/.test(text)) {
    categories.push("publish");
  }
  if (/openai|anthropic|stripe|paid|billing/.test(text)) {
    categories.push("cost");
  }
  if (categories.length === 0) {
    categories.push("other");
  }
  if (categories.some((category) => ["deploy", "live", "send", "migration", "seed", "publish", "cost"].includes(category))) {
    categories.push("dangerous");
  }
  return [...new Set(categories)];
}

function scriptRisk(name, command) {
  const categories = classifyScript(name, command);
  if (categories.includes("dangerous")) {
    return "approval-required";
  }
  return "local";
}

function testKindFromScript(name, command, categories) {
  if (name.includes("e2e") || categories.includes("e2e")) {
    return "playwright-or-e2e";
  }
  if (name.includes("smoke") || categories.includes("smoke")) {
    return name.includes("browse") ? "browse-smoke" : "smoke";
  }
  if (categories.includes("lint")) {
    return "lint";
  }
  if (categories.includes("build")) {
    return "build";
  }
  if (categories.includes("typecheck")) {
    return "typecheck";
  }
  if (/vitest/.test(command)) {
    return "vitest";
  }
  if (/jest/.test(command)) {
    return "jest";
  }
  if (/node --test/.test(command)) {
    return "node-test";
  }
  return "test";
}

function inferPort(command) {
  const match = String(command).match(/(?:-p|--port)\s+(\d{2,5})|PORT=(\d{2,5})|:(\d{4})/);
  if (!match) {
    return null;
  }
  return Number(match[1] || match[2] || match[3]);
}

function inspectGit(repoPath) {
  const inside = runGit(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    return {
      isRepo: false,
      dirty: false,
      dirtySummary: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, other: 0 },
      statusEntries: []
    };
  }
  const rootRaw = runGit(repoPath, ["rev-parse", "--show-toplevel"]).stdout.trim() || repoPath;
  const root = realpathSync(rootRaw);
  const statusEntries = parseGitStatus(runGit(repoPath, ["status", "--short"]).stdout);
  const dirtySummary = summarizeStatus(statusEntries);
  return {
    isRepo: true,
    root,
    targetRelativePath: relative(root, repoPath).replaceAll("\\", "/") || ".",
    nestedRepoRoot: root !== repoPath,
    branch: runGit(repoPath, ["branch", "--show-current"]).stdout.trim() || null,
    head: runGit(repoPath, ["rev-parse", "--short", "HEAD"]).stdout.trim() || null,
    dirty: statusEntries.length > 0,
    dirtySummary,
    statusEntries: statusEntries.slice(0, 80)
  };
}

function runGit(repoPath, args) {
  return spawnSync("git", args, {
    cwd: repoPath,
    encoding: "utf8",
    timeout: 5000
  });
}

function parseGitStatus(stdout) {
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2),
      path: line.slice(3)
    }));
}

function summarizeStatus(entries) {
  const summary = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, other: 0 };
  for (const entry of entries) {
    if (entry.code === "??") {
      summary.untracked += 1;
    } else if (entry.code.includes("R")) {
      summary.renamed += 1;
    } else if (entry.code.includes("D")) {
      summary.deleted += 1;
    } else if (entry.code.includes("A")) {
      summary.added += 1;
    } else if (entry.code.includes("M")) {
      summary.modified += 1;
    } else {
      summary.other += 1;
    }
  }
  return summary;
}

function scriptRunner(packageManager) {
  if (packageManager === "pnpm") {
    return "pnpm run";
  }
  if (packageManager === "yarn") {
    return "yarn";
  }
  if (packageManager === "bun") {
    return "bun run";
  }
  return "npm run";
}

function isSecretPath(path) {
  return secretNamePatterns.some((pattern) => pattern.test(path));
}

function evidenceList(values) {
  return values.filter(Boolean);
}

function uniqueSignals(items, keyFn) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  return unique;
}
