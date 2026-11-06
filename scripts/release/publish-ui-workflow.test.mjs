import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(step("publish")).not.toContain("continue-on-error");
    for (const check of ["typecheck", "lint", "test:coverage"])
      expect(step("checks")).toContain(`pnpm --filter @waitron/ui-core ${check}`);
    expect(step("prepare")).toContain("scripts/release/prepare-ui.mjs");
    expect(step("prepare")).toContain('--source-commit "$GITHUB_SHA"');
    expect(step("prepare")).toContain('--release-version "0.2.$GITHUB_RUN_NUMBER"');
    const consumer = step("consumer");
    expect(consumer).toContain("pnpm --filter @waitron/ui-core test:package");
    expect(consumer).toContain("UI_PACKAGE_TARBALL:");
    expect(consumer).toContain("UI_PACKAGE_RELEASE_VERSION:");
    expect(consumer).toContain("UI_PACKAGE_SOURCE_COMMIT:");
    expect(steps().indexOf(step("consumer"))).toBeLessThan(steps().indexOf(step("publish")));
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
