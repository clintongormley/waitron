import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 30000 });

const workflowPath = resolve(import.meta.dirname, "../../.github/workflows/publish-ui.yml");
const workflow = () => (existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : "");
const steps = () =>
  workflow()
    .split(/^ {6}- /m)
    .slice(1);
const step = (id) => {
  const found = steps().find((text) => text.startsWith(`id: ${id}\n`));
  expect(found, `workflow step ${id}`).toBeDefined();
  return found;
};
const command = (id) => {
  const body = step(id).match(/^ {8}run: \|\n((?: {10}.*\n|\n)+)/m)?.[1];
  expect(body, `shell body of ${id}`).toBeDefined();
  return body.replace(/^ {10}/gm, "");
};

function checkFixture(fn, packageName = "ui-core") {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ui-publish-checks-")));
  try {
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, `packages/${packageName}`), { recursive: true });
    for (const file of ["changed-packages.mjs", "changed-scope.mjs", "run-with-deadline.mjs"])
      copyFileSync(resolve(import.meta.dirname, "..", file), join(dir, "scripts", file));
    const scripts = Object.fromEntries(
      ["typecheck", "lint", "test:coverage", "test:package"].map((key) => [key, "present"]),
    );
    const manifest = join(dir, `packages/${packageName}/package.json`);
    const record = join(dir, "calls.jsonl");
    const pnpm = join(dir, "pnpm");
    writeFileSync(
      pnpm,
      `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.CHECK_RECORD, JSON.stringify(args) + "\\n");
if (args[1] !== process.env.SOURCE_PACKAGE) process.exit(21);
if (args[2] === "ls") console.log(JSON.stringify([{ name: process.env.SOURCE_PACKAGE, path: process.env.CHECK_PACKAGE }]));
else if (args[2] === process.env.FAIL_CHECK) process.exit(19);
`,
    );
    chmodSync(pnpm, 0o755);
    const invoke = (id, { missing, fail } = {}) => {
      const kept = { ...scripts };
      if (missing) delete kept[missing];
      writeFileSync(manifest, JSON.stringify({ name: `@waitron/${packageName}`, scripts: kept }));
      writeFileSync(record, "");
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", command(id)], {
        cwd: dir,
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          PATH: `${dir}${delimiter}${process.env.PATH}`,
          CHECK_PACKAGE: join(dir, `packages/${packageName}`),
          SOURCE_PACKAGE: `@waitron/${packageName}`,
          PACKAGE: packageName,
          CHECK_RECORD: record,
          FAIL_CHECK: fail ?? "",
          GITHUB_WORKSPACE: dir,
        },
      });
      const calls = readFileSync(record, "utf8").trim();
      return { ...result, calls: calls ? calls.split("\n").map((line) => JSON.parse(line)) : [] };
    };
    fn(invoke);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.each(["ui-core", "contract"])("automatic private %s publication", (packageName) => {
  it("selects main UI changes and queues publications without cancelling earlier runs", () => {
    const text = workflow();
    expect(text.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1]).toBe(
      '  push:\n    branches: [main]\n    paths: ["packages/ui-core/**", "packages/contract/**"]\n\n',
    );
    expect(text).toMatch(/matrix:\n {8}package: \[ui-core, contract\]/);
    expect(text).toContain("fail-fast: false");
    expect(text).toMatch(
      /^concurrency:\n {2}group: ui-core-publication\n {2}queue: max\n {2}cancel-in-progress: false$/m,
    );
  });

  it("keeps the publishing credential out of source checks and package preparation", () => {
    const text = workflow();
    expect(text).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(text.match(/UI_PACKAGES_WRITE_TOKEN/g)).toHaveLength(1);
    expect(step("publish")).toContain("NODE_AUTH_TOKEN: ${{ secrets.UI_PACKAGES_WRITE_TOKEN }}");
    for (const id of ["checks", "prepare", "consumer", "publish"])
      expect(step(id)).not.toMatch(/^ {8}(continue-on-error|if):/m);
    expect(workflow().match(/persist-credentials: false/g)).toHaveLength(2);
    for (const check of ["typecheck", "lint", "test:coverage"])
      expect(step("checks")).toContain(`pnpm --filter "@waitron/$PACKAGE" ${check}`);
    expect(step("prepare")).toContain("scripts/release/prepare-ui.mjs");
    expect(step("prepare")).toContain('--source-commit "$GITHUB_SHA"');
    expect(step("prepare")).toContain('--release-version "0.2.$GITHUB_RUN_NUMBER"');
    const consumer = step("consumer");
    expect(consumer).toContain('pnpm --filter "@waitron/$PACKAGE" test:package');
    expect(consumer).toContain(
      "UI_PACKAGE_TARBALL: ${{ runner.temp }}/shared-release/waitron-io-${{ matrix.package }}-0.2.${{ github.run_number }}.tgz",
    );
    expect(consumer).toContain("UI_PACKAGE_RELEASE_VERSION: 0.2.${{ github.run_number }}");
    expect(consumer).toContain("UI_PACKAGE_SOURCE_COMMIT: ${{ github.sha }}");
    expect(consumer).toContain(
      "CONTRACT_PACKAGE_TARBALL: ${{ runner.temp }}/shared-release/waitron-io-${{ matrix.package }}-0.2.${{ github.run_number }}.tgz",
    );
    expect(consumer).toContain("CONTRACT_PACKAGE_RELEASE_VERSION: 0.2.${{ github.run_number }}");
    expect(consumer).toContain("CONTRACT_PACKAGE_SOURCE_COMMIT: ${{ github.sha }}");
    for (const [before, after] of [
      ["checks", "prepare"],
      ["prepare", "consumer"],
      ["consumer", "publish"],
    ])
      expect(steps().indexOf(step(before))).toBeLessThan(steps().indexOf(step(after)));
  });

  it("runs browser coverage through the diagnostic deadline used by ordinary CI", () => {
    expect(command("checks")).toContain("scripts/run-with-deadline.mjs 360 --diagnostics --");
    expect(command("checks")).toContain(
      '--reporter="$GITHUB_WORKSPACE/scripts/vitest-file-progress.mjs"',
    );
  });

  it.each(["typecheck", "lint", "test:coverage", "test:package"])(
    "refuses a missing %s script before running the source checks",
    (missing) => {
      checkFixture((invoke) => {
        const result = invoke("checks", { missing });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(`declares no "${missing}" script`);
        expect(result.calls.every((args) => args[2] === "ls")).toBe(true);
      }, packageName);
    },
  );

  it.each([
    ["checks", "typecheck"],
    ["checks", "lint"],
    ["checks", "test:coverage"],
    ["consumer", "test:package"],
  ])("propagates failure from %s / %s", (id, fail) => {
    checkFixture((invoke) => {
      const result = invoke(id, { fail });
      expect(result.status).toBe(19);
      expect(result.calls.at(-1)[2]).toBe(fail);
    }, packageName);
  });

  it("runs every source check when all four required scripts exist", () => {
    checkFixture((invoke) => {
      const result = invoke("checks");
      expect(result.status).toBe(0);
      expect(result.calls.filter((args) => args[2] !== "ls").map((args) => args[2])).toEqual([
        "typecheck",
        "lint",
        "test:coverage",
      ]);
    }, packageName);
  });

  it.each([
    [0, 0],
    [23, 0],
    [0, 31],
  ])("publishes or stops for npm status %i and access status %i", (status, accessStatus) => {
    const dir = mkdtempSync(join(tmpdir(), "ui-publish-shell-"));
    try {
      const npm = join(dir, "npm");
      const record = join(dir, "invocation.json");
      writeFileSync(
        npm,
        `#!${process.execPath}
import { appendFileSync } from "node:fs";
appendFileSync(process.env.PUBLISH_RECORD, JSON.stringify({ args: process.argv.slice(2), authenticated: Boolean(process.env.NODE_AUTH_TOKEN) }) + "\\n");
if (process.argv[2] === "publish") process.exit(Number(process.env.PUBLISH_STATUS));
`,
      );
      chmodSync(npm, 0o755);
      const node = join(dir, "node");
      writeFileSync(
        node,
        `#!${process.execPath}\nprocess.exit(Number(process.env.ACCESS_STATUS));\n`,
      );
      chmodSync(node, 0o755);
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", command("publish")], {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          PATH: `${dir}${delimiter}${process.env.PATH}`,
          RUNNER_TEMP: join(dir, "runner temporary files"),
          GITHUB_RUN_NUMBER: "742",
          PACKAGE: packageName,
          GITHUB_WORKSPACE: dir,
          NODE_AUTH_TOKEN: "test-publishing-credential",
          PUBLISH_RECORD: record,
          PUBLISH_STATUS: String(status),
          ACCESS_STATUS: String(accessStatus),
        },
      });
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("");
      expect(result.status).toBe(accessStatus || status);
      if (accessStatus) {
        expect(existsSync(record)).toBe(false);
        return;
      }
      const calls = readFileSync(record, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls[0]).toEqual({
        args: [
          "publish",
          join(dir, `runner temporary files/shared-release/waitron-io-${packageName}-0.2.742.tgz`),
          "--registry=https://npm.pkg.github.com",
          "--access=restricted",
          "--ignore-scripts",
        ],
        authenticated: true,
      });
      expect(calls.slice(1)).toEqual(
        status
          ? []
          : [
              {
                args: [
                  "view",
                  `@waitron-io/${packageName}@0.2.742`,
                  "dist.integrity",
                  "waitronSource.commit",
                  "repository.url",
                  "--json",
                  "--registry=https://npm.pkg.github.com",
                ],
                authenticated: true,
              },
            ],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
