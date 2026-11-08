import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const workflow = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8");
const job = /^ {2}bundle-smoke:\n([\s\S]*?)(?=^ {2}[\w-]+:)/m.exec(workflow)?.[1];
const steps = job?.split(/^ {6}- /m).slice(1) ?? [];
const open = steps.find((step) => step.startsWith("name: Open the built setup page\n"));

function mandatory(step) {
  expect(step, "a required bundle-smoke step must exist").toBeDefined();
  expect(step).not.toMatch(/^ {8}if:/m);
  const tolerant = /^ {8}continue-on-error:\s*(.+)$/m.exec(step)?.[1];
  expect([undefined, "false"], "required smoke steps must fail the job").toContain(tolerant);
}

it("selects real build scripts for every shipped application without tolerating failure", () => {
  expect(job).toBeDefined();
  const builds = steps.flatMap((step) => {
    const match = /^(?:run:| {8}run:) pnpm --filter (\S+) build\s*$/m.exec(step);
    return match ? [{ step, name: match[1] }] : [];
  });
  const applications = [
    "packages/credentials",
    "apps/server",
    "apps/print-agent",
    "packages/provisioning",
    "apps/dashboard",
    "apps/setup",
    "apps/till",
  ].map((path) => JSON.parse(readFileSync(new URL(`${path}/package.json`, root), "utf8")));
  expect(builds.map(({ name }) => name)).toEqual(applications.map(({ name }) => name));
  for (const application of applications) {
    expect(application.scripts?.build, `${application.name} must declare build`).toBeTypeOf(
      "string",
    );
    expect(application.scripts.build.trim()).not.toBe("");
  }
  for (const { step } of builds) mandatory(step);
});

it("requires installing Chromium and opening the built setup page, with failures enforced", () => {
  const install = steps.find((step) =>
    /^ {12}if timeout 120 pnpm --filter @waitron\/setup exec playwright install chromium --only-shell; then$/m.test(
      step,
    ),
  );
  mandatory(install);
  mandatory(open);
  expect(existsSync(new URL("apps/setup/test/bundle-smoke.mjs", root))).toBe(true);
  expect(open).toMatch(
    /^ {12}timeout 90 pnpm --filter @waitron\/setup exec node test\/bundle-smoke\.mjs$/m,
  );
});

it.each(["absent", "passes", "fails"])(
  "executes the browser smoke step when the checked-out script %s",
  (state) => {
    const workspace = mkdtempSync(join(tmpdir(), "waitron-smoke-step-"));
    try {
      mkdirSync(join(workspace, "bin"));
      mkdirSync(join(workspace, "apps/setup/test"), { recursive: true });
      const timeout = spawnSync(
        "sh",
        ["-c", "command -v gnutimeout || command -v gtimeout || command -v timeout"],
        { encoding: "utf8" },
      );
      expect(timeout.status, timeout.stderr).toBe(0);
      symlinkSync(timeout.stdout.trim(), join(workspace, "bin/timeout"));
      writeFileSync(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
      writeFileSync(join(workspace, "package.json"), '{"private":true}');
      writeFileSync(join(workspace, "apps/setup/package.json"), '{"name":"@waitron/setup"}');
      if (state !== "absent")
        writeFileSync(
          join(workspace, "apps/setup/test/bundle-smoke.mjs"),
          `console.log("checked-out smoke executed"); process.exit(${state === "fails" ? 17 : 0});\n`,
        );
      expect(open).toBeDefined();
      const run = /^ {8}run: (.+)$/m.exec(open)?.[1];
      expect(run).toBeDefined();
      const shell =
        run === "|"
          ? open
              .split("\n")
              .filter((line) => line.startsWith("          "))
              .map((line) => line.slice(10))
              .join("\n")
          : run;
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", shell], {
        cwd: workspace,
        env: { ...process.env, PATH: `${join(workspace, "bin")}:${process.env.PATH}` },
        encoding: "utf8",
        timeout: 10000,
      });
      expect(result.error).toBeUndefined();
      if (state === "absent") {
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("::notice::");
        expect(result.stdout).toContain("apps/setup/test/bundle-smoke.mjs");
        expect(result.stdout).toContain("Skipping");
        expect(result.stdout).not.toContain("checked-out smoke executed");
      } else {
        expect(result.stdout).toContain("checked-out smoke executed");
        expect(result.stdout).not.toContain("::notice::");
        if (state === "fails") expect(result.status).not.toBe(0);
        else expect(result.status, result.stderr).toBe(0);
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
  15000,
);
