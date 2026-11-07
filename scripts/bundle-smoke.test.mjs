import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const workflow = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8");
const job = /^ {2}bundle-smoke:\n([\s\S]*?)(?=^ {2}[\w-]+:)/m.exec(workflow)?.[1];
const steps = job?.split(/^ {6}- /m).slice(1) ?? [];

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
  const open = steps.find((step) =>
    /^ {8}run: timeout 90 pnpm --filter @waitron\/setup exec node test\/bundle-smoke\.mjs$/m.test(
      step,
    ),
  );
  mandatory(install);
  mandatory(open);
});
