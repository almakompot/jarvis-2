import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

export function createFixtureWorkspace() {
  return mkdtempSync(join(tmpdir(), "meta-harness-fixtures-"));
}

export function createNextWebFixture(workspace) {
  const repo = makeRepo(workspace, "next-web");
  writeJson(join(repo, "package.json"), {
    packageManager: "pnpm@10.30.0",
    scripts: {
      dev: "NEXT_DIST_DIR=.next-dev next dev -p 3001",
      "dev:clean": "node -e \"require('fs').rmSync('.next-dev', { recursive: true, force: true })\" && NEXT_DIST_DIR=.next-dev next dev -p 3001",
      build: "next build",
      lint: "next lint",
      test: "vitest run",
      "test:e2e": "playwright test",
      "smoke:browse": "node scripts/smoke-browse.mjs",
      "deploy:prod": "vercel --prod"
    },
    dependencies: {
      next: "15.0.0",
      react: "19.0.0",
      stripe: "1.0.0",
      "@supabase/supabase-js": "2.0.0"
    },
    devDependencies: {
      vitest: "latest",
      "@playwright/test": "latest"
    }
  });
  writeFileSync(join(repo, "pnpm-lock.yaml"), "");
  writeFileSync(join(repo, "package-lock.json"), "{}\n");
  mkdirSync(join(repo, "app", "(browse)", "browse", "course", "[id]"), { recursive: true });
  mkdirSync(join(repo, "app", "(browse)", "browse", "bundle", "[id]"), { recursive: true });
  writeFileSync(join(repo, "app", "(browse)", "browse", "page.tsx"), "export default function Browse() { return null; }\n");
  writeFileSync(join(repo, "app", "(browse)", "browse", "course", "[id]", "page.tsx"), "export default function Course() { return null; }\n");
  writeFileSync(join(repo, "app", "(browse)", "browse", "bundle", "[id]", "page.tsx"), "export default function Bundle() { return null; }\n");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  writeFileSync(join(repo, "scripts", "smoke-browse.mjs"), "console.log('browse smoke');\n");
  writeFileSync(join(repo, "next.config.mjs"), "export default {};\n");
  writeFileSync(join(repo, "playwright.config.ts"), "export default {};\n");
  writeFileSync(join(repo, "vitest.config.ts"), "export default {};\n");
  writeFileSync(join(repo, "vercel.json"), "{}\n");
  writeFileSync(join(repo, ".env.local"), "SECRET_SHOULD_NOT_LEAK=super-secret-value\n");
  return {
    name: "next-web",
    repo,
    expected: {
      manager: "pnpm",
      scripts: ["build", "dev", "dev:clean", "lint", "test", "test:e2e", "smoke:browse", "deploy:prod"],
      frameworkKinds: ["next-app-router", "react"],
      testKinds: ["vitest", "playwright", "browse-smoke", "build", "lint", "playwright-or-e2e"],
      routes: ["/browse", "/browse/course/[id]", "/browse/bundle/[id]"],
      liveRiskSources: ["dependency:stripe", "dependency:@supabase/supabase-js", "script:deploy:prod", "vercel.json"],
      sensitivePaths: [".env.local"],
      devPort: 3001
    }
  };
}

export function createBrowserExtensionFixture(workspace) {
  const repo = makeRepo(workspace, "browser-extension");
  writeJson(join(repo, "package.json"), {
    scripts: {
      test: "node --test",
      smoke: "node scripts/smoke-cdp.mjs",
      publish: "chrome-webstore-upload upload"
    }
  });
  writeJson(join(repo, "manifest.json"), {
    manifest_version: 3,
    name: "Site Gate",
    background: { service_worker: "background.js" },
    action: { default_popup: "gate.html" },
    options_page: "options.html",
    host_permissions: ["http://*/*", "https://*/*"],
    content_scripts: [{ matches: ["https://example.test/*"], js: ["content.js"] }]
  });
  mkdirSync(join(repo, "scripts"), { recursive: true });
  writeFileSync(join(repo, "background.js"), "chrome.tabs.update(1, {});\n");
  writeFileSync(join(repo, "content.js"), "console.log('content');\n");
  writeFileSync(join(repo, "gate.html"), "<main>gate</main>\n");
  writeFileSync(join(repo, "options.html"), "<main>options</main>\n");
  writeFileSync(join(repo, "scripts", "smoke-cdp.mjs"), "console.log('smoke');\n");
  return {
    name: "browser-extension",
    repo,
    expected: {
      manager: "npm",
      frameworkKinds: ["browser-extension"],
      testKinds: ["node-test", "smoke"],
      extensionFiles: ["manifest.json", "background.js", "content.js", "gate.html", "options.html"],
      liveRiskSources: ["script:publish"],
      hostPermissions: ["http://*/*", "https://*/*"]
    }
  };
}

export function createNodeCliFixture(workspace) {
  const repo = makeRepo(workspace, "node-cli");
  writeJson(join(repo, "package.json"), {
    name: "fixture-cli",
    packageManager: "npm@10.0.0",
    bin: { "fixture-cli": "bin/fixture.mjs" },
    scripts: {
      test: "node --test",
      "smoke:cli": "node bin/fixture.mjs --help"
    }
  });
  mkdirSync(join(repo, "bin"), { recursive: true });
  mkdirSync(join(repo, "test"), { recursive: true });
  writeFileSync(join(repo, "bin", "fixture.mjs"), "#!/usr/bin/env node\nconsole.log('fixture');\n");
  writeFileSync(join(repo, "test", "fixture.test.mjs"), "import test from 'node:test';\ntest('ok', () => {});\n");
  return {
    name: "node-cli",
    repo,
    expected: {
      manager: "npm",
      frameworkKinds: ["node-cli"],
      testKinds: ["node-test", "smoke"],
      binName: "fixture-cli",
      cliFiles: ["bin/fixture.mjs"]
    }
  };
}

export function createPythonDataFixture(workspace) {
  const repo = makeRepo(workspace, "python-data");
  writeFileSync(join(repo, "pyproject.toml"), "[project]\nname='fixture-pipeline'\n");
  writeFileSync(join(repo, "requirements.txt"), "pypdf\n");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "fixtures"), { recursive: true });
  mkdirSync(join(repo, "outputs"), { recursive: true });
  mkdirSync(join(repo, "tests"), { recursive: true });
  writeFileSync(join(repo, "scripts", "run_pipeline.py"), "print('pipeline')\n");
  writeFileSync(join(repo, "fixtures", "input.csv"), "id,value\n");
  writeFileSync(join(repo, "outputs", "manifest.json"), "{\"items\":[]}\n");
  writeFileSync(join(repo, "tests", "test_pipeline.py"), "def test_ok():\n    assert True\n");
  return {
    name: "python-data",
    repo,
    expected: {
      manager: null,
      frameworkKinds: ["python-pipeline"],
      testKinds: ["pytest"],
      dataDirectories: ["fixtures", "outputs"],
      dataScripts: ["scripts/run_pipeline.py"],
      manifests: ["outputs/manifest.json"]
    }
  };
}

export function createDirtyNestedFixture(workspace) {
  const parent = makeRepo(workspace, "dirty-nested-parent");
  mkdirSync(join(parent, "nested", "src"), { recursive: true });
  const repo = join(parent, "nested");
  run("git", ["init"], repo);
  writeJson(join(repo, "package.json"), {
    scripts: { test: "node --test" }
  });
  writeFileSync(join(repo, "src", "index.js"), "console.log('dirty');\n");
  return {
    name: "dirty-nested",
    repo,
    target: join(repo, "src"),
    expected: {
      repoRealPath: realpathSync(repo),
      targetRealPath: realpathSync(join(repo, "src")),
      targetRelativePath: "src",
      dirty: true,
      untrackedAtLeast: 1
    }
  };
}

export function createSensitivePathFixture(workspace) {
  const repo = makeRepo(workspace, "sensitive-paths");
  writeJson(join(repo, "package.json"), {
    scripts: { test: "node --test" }
  });
  mkdirSync(join(repo, "config"), { recursive: true });
  writeFileSync(join(repo, ".env"), "API_KEY=should-not-leak\n");
  writeFileSync(join(repo, "config", "service-account-prod.json"), "{\"private_key\":\"do-not-copy\"}\n");
  writeFileSync(join(repo, "config", "private.key"), "PRIVATE KEY SHOULD NOT LEAK\n");
  return {
    name: "sensitive-paths",
    repo,
    expected: {
      sensitivePaths: [".env", "config/private.key", "config/service-account-prod.json"],
      forbiddenPatterns: [".env", ".env.*", "**/*.key", "**/service-account*.json"],
      forbiddenText: ["should-not-leak", "do-not-copy", "PRIVATE KEY SHOULD NOT LEAK"]
    }
  };
}

function makeRepo(workspace, name) {
  const repo = join(workspace, name);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "README.md"), `# ${name}\n`);
  return repo;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

export function readFixtureFile(path) {
  return readFileSync(path, "utf8");
}
