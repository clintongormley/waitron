import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { timedatectlSynchronised } from "./timedatectl-reader.js";

let stubs: string;
const stub = (name: string) => join(stubs, name);
beforeAll(async () => {
  stubs = await mkdtemp(join(tmpdir(), "timedatectl-"));
  const scripts = {
    // Answers as timedatectl does only when asked exactly for NTPSynchronized's bare value.
    yes: `[ "$*" = "show -p NTPSynchronized --value" ] && echo yes || echo no`,
    no: "echo no",
    failing: "echo yes; exit 1",
    slow: "exec sleep 5",
  };
  for (const [name, body] of Object.entries(scripts)) {
    await writeFile(stub(name), `#!/bin/sh\n${body}\n`);
    await chmod(stub(name), 0o755);
  }
});
afterAll(() => rm(stubs, { recursive: true, force: true }));

it("answers synchronised when timedatectl says yes", async () => {
  expect(await timedatectlSynchronised({ command: stub("yes") })()).toBe(true);
});

it("answers not synchronised when timedatectl says no", async () => {
  expect(await timedatectlSynchronised({ command: stub("no") })()).toBe(false);
});

it("answers not synchronised when timedatectl fails, whatever it printed", async () => {
  expect(await timedatectlSynchronised({ command: stub("failing") })()).toBe(false);
});

it("answers not synchronised when there is no timedatectl", async () => {
  expect(await timedatectlSynchronised({ command: stub("missing") })()).toBe(false);
});

it("answers not synchronised when timedatectl does not answer in time", async () => {
  const started = performance.now();
  expect(await timedatectlSynchronised({ command: stub("slow"), timeoutMs: 200 })()).toBe(false);
  expect(performance.now() - started).toBeLessThan(4_000);
});
