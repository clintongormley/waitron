import { describe, expect, it } from "vitest";
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

function checkFixture(fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ui-publish-checks-")));
  try {
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "packages/ui-core"), { recursive: true });
    for (const file of ["changed-packages.mjs", "changed-scope.mjs", "run-with-deadline.mjs"])
      copyFileSync(resolve(import.meta.dirname, "..", file), join(dir, "scripts", file));
    const scripts = Object.fromEntries(
      ["typecheck", "lint", "test:coverage", "test:package"].map((key) => [key, "present"]),
    );
    const manifest = join(dir, "packages/ui-core/package.json");
    const record = join(dir, "calls.jsonl");
    const pnpm = join(dir, "pnpm");
    writeFileSync(
      pnpm,
      `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.CHECK_RECORD, JSON.stringify(args) + "\\n");
if (args[2] === "ls") console.log(JSON.stringify([{ name: "@waitron/ui-core", path: process.env.CHECK_PACKAGE }]));
else if (args[2] === process.env.FAIL_CHECK) process.exit(19);
`,
    );
    chmodSync(pnpm, 0o755);
    const invoke = (id, { missing, fail } = {}) => {
      const kept = { ...scripts };
      if (missing) delete kept[missing];
      writeFileSync(manifest, JSON.stringify({ name: "@waitron/ui-core", scripts: kept }));
      writeFileSync(record, "");
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", command(id)], {
        cwd: dir,
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          PATH: `${dir}${delimiter}${process.env.PATH}`,
          CHECK_PACKAGE: join(dir, "packages/ui-core"),
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

describe("automatic private UI publication", () => {
  it("selects main UI changes and queues publications without cancelling earlier runs", () => {
    const text = workflow();
    expect(text.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1]).toBe(
      '  push:\n    branches: [main]\n    paths: ["packages/ui-core/**"]\n\n',
    );
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
      expect(step("checks")).toContain(`pnpm --filter @waitron/ui-core ${check}`);
    expect(step("prepare")).toContain("scripts/release/prepare-ui.mjs");
    expect(step("prepare")).toContain('--source-commit "$GITHUB_SHA"');
    expect(step("prepare")).toContain('--release-version "0.2.$GITHUB_RUN_NUMBER"');
    const consumer = step("consumer");
    expect(consumer).toContain("pnpm --filter @waitron/ui-core test:package");
    expect(consumer).toContain(
      "UI_PACKAGE_TARBALL: ${{ runner.temp }}/ui-release/waitron-io-ui-core-0.2.${{ github.run_number }}.tgz",
    );
    expect(consumer).toContain("UI_PACKAGE_RELEASE_VERSION: 0.2.${{ github.run_number }}");
    expect(consumer).toContain("UI_PACKAGE_SOURCE_COMMIT: ${{ github.sha }}");
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
      });
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
    });
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
    });
  });

  it.each([0, 23])("publishes the numbered artifact and propagates npm status %i", (status) => {
    const dir = mkdtempSync(join(tmpdir(), "ui-publish-shell-"));
    try {
      const npm = join(dir, "npm");
      const record = join(dir, "invocation.json");
      writeFileSync(
        npm,
        `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(process.env.PUBLISH_RECORD, JSON.stringify({ args: process.argv.slice(2), authenticated: Boolean(process.env.NODE_AUTH_TOKEN) }));
process.exit(Number(process.env.PUBLISH_STATUS));
`,
      );
      chmodSync(npm, 0o755);
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", command("publish")], {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          PATH: `${dir}${delimiter}${process.env.PATH}`,
          RUNNER_TEMP: join(dir, "runner temporary files"),
          GITHUB_RUN_NUMBER: "742",
          NODE_AUTH_TOKEN: "test-publishing-credential",
          PUBLISH_RECORD: record,
          PUBLISH_STATUS: String(status),
        },
      });
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("");
      expect(result.status).toBe(status);
      expect(JSON.parse(readFileSync(record, "utf8"))).toEqual({
        args: [
          "publish",
          join(dir, "runner temporary files/ui-release/waitron-io-ui-core-0.2.742.tgz"),
          "--registry=https://npm.pkg.github.com",
          "--access=restricted",
          "--ignore-scripts",
        ],
        authenticated: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
