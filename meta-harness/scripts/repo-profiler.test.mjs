import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import test from "node:test";

import { inspectRepo } from "../lib/repo-profiler.mjs";
import {
  createBrowserExtensionFixture,
  createDirtyNestedFixture,
  createFixtureWorkspace,
  createNextWebFixture,
  createNodeCliFixture,
  createPythonDataFixture,
  createSensitivePathFixture
} from "./fixtures/repo-fixtures.mjs";

test("M2 fixture matrix profiles expected repo classes", () => {
  const workspace = createFixtureWorkspace();
  const fixtures = [
    createNextWebFixture(workspace),
    createBrowserExtensionFixture(workspace),
    createNodeCliFixture(workspace),
    createPythonDataFixture(workspace)
  ];

  for (const fixture of fixtures) {
    const profile = inspectRepo({
      repoPath: fixture.repo,
      runId: `${fixture.name}-profile`,
      createdAt: "2026-06-24T00:00:00.000Z"
    });

    assert.equal(profile.adapterStatus, "m2-core", fixture.name);
    assert.equal(profile.package.manager, fixture.expected.manager, fixture.name);
    assertIncludesAll(profile.frameworkSignals.map((signal) => signal.kind), fixture.expected.frameworkKinds, `${fixture.name}: framework signals`);
    assertIncludesAll(profile.testSignals.map((signal) => signal.kind), fixture.expected.testKinds, `${fixture.name}: test signals`);

    if (fixture.name === "next-web") {
      assertIncludesAll(Object.keys(profile.package.scripts), fixture.expected.scripts, "next-web: scripts");
      assertIncludesAll(profile.surfaces.routes.map((route) => route.route), fixture.expected.routes, "next-web: routes");
      assert.ok(profile.devServer.candidates.some((candidate) => candidate.port === fixture.expected.devPort), "next-web: dev port");
      assertIncludesAll(profile.liveSystemRisks.map((risk) => risk.source), fixture.expected.liveRiskSources, "next-web: live risks");
      assertIncludesAll(profile.sensitivePathPolicy.detectedSensitivePaths.map((item) => item.path), fixture.expected.sensitivePaths, "next-web: sensitive paths");
      assert.doesNotMatch(JSON.stringify(profile), /super-secret-value/);
    }

    if (fixture.name === "browser-extension") {
      assert.equal(profile.surfaces.browserExtension.manifestVersion, 3);
      assertIncludesAll(profile.surfaces.browserExtension.hostPermissions, fixture.expected.hostPermissions, "browser-extension: host permissions");
      assertIncludesAll(profile.surfaces.browserExtension.files, fixture.expected.extensionFiles, "browser-extension: files");
      assertIncludesAll(profile.liveSystemRisks.map((risk) => risk.source), fixture.expected.liveRiskSources, "browser-extension: publish risk");
    }

    if (fixture.name === "node-cli") {
      assert.equal(profile.surfaces.cli.bins[fixture.expected.binName], "bin/fixture.mjs");
      assertIncludesAll(profile.surfaces.cli.files, fixture.expected.cliFiles, "node-cli: cli files");
    }

    if (fixture.name === "python-data") {
      assertIncludesAll(profile.surfaces.dataPipeline.directories, fixture.expected.dataDirectories, "python-data: data directories");
      assertIncludesAll(profile.surfaces.dataPipeline.scripts, fixture.expected.dataScripts, "python-data: data scripts");
      assertIncludesAll(profile.surfaces.dataPipeline.manifests, fixture.expected.manifests, "python-data: manifests");
    }
  }
});

test("M2 fixture matrix records dirty nested git roots without reverting changes", () => {
  const workspace = createFixtureWorkspace();
  const fixture = createDirtyNestedFixture(workspace);
  const profile = inspectRepo({
    repoPath: fixture.target,
    runId: "dirty-nested-profile",
    createdAt: "2026-06-24T00:00:00.000Z"
  });

  assert.equal(realpathSync(profile.repoPath), fixture.expected.repoRealPath);
  assert.equal(realpathSync(profile.targetPath), fixture.expected.targetRealPath);
  assert.equal(profile.git.isRepo, true);
  assert.equal(profile.git.nestedRepoRoot, true);
  assert.equal(profile.git.targetRelativePath, fixture.expected.targetRelativePath);
  assert.equal(profile.git.dirty, fixture.expected.dirty);
  assert.ok(profile.git.dirtySummary.untracked >= fixture.expected.untrackedAtLeast);
});

test("M2 fixture matrix records sensitive paths without reading secret contents", () => {
  const workspace = createFixtureWorkspace();
  const fixture = createSensitivePathFixture(workspace);
  const profile = inspectRepo({
    repoPath: fixture.repo,
    runId: "sensitive-path-profile",
    createdAt: "2026-06-24T00:00:00.000Z"
  });
  const serialized = JSON.stringify(profile);

  assert.equal(profile.sensitivePathPolicy.contentsRead, false);
  assertIncludesAll(profile.sensitivePathPolicy.detectedSensitivePaths.map((item) => item.path), fixture.expected.sensitivePaths, "sensitive-paths: detected");
  assertIncludesAll(profile.sensitivePathPolicy.forbiddenPatterns, fixture.expected.forbiddenPatterns, "sensitive-paths: forbidden patterns");
  for (const secretText of fixture.expected.forbiddenText) {
    assert.doesNotMatch(serialized, new RegExp(escapeRegExp(secretText)));
  }
});

function assertIncludesAll(actual, expected, label) {
  for (const value of expected) {
    assert.ok(actual.includes(value), `${label} missing ${value}; actual=${JSON.stringify(actual)}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
