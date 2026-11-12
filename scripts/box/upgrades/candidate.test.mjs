import { expect, it, onTestFinished, vi } from "vitest";
import * as fs from "node:fs/promises";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { checkUpgradeCandidate, removeUpgradeCheckContainers } from "./candidate.mjs";

async function fixture(failed = false) {
  const root = await fs.mkdtemp(join(tmpdir(), "upgrade-candidate-"));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  if (process.platform === "darwin") {
    const bin = join(root, "bin");
    await fs.mkdir(bin);
    await fs.symlink(execFileSync("which", ["gcp"], { encoding: "utf8" }).trim(), join(bin, "cp"));
    vi.stubEnv("PATH", bin + delimiter + process.env.PATH);
    onTestFinished(() => vi.unstubAllEnvs());
  }
  const directory = join(root, "attempt");
  await fs.mkdir(directory);
  await fs.mkdir(join(directory, "copies"));
  for (const index of [0, 1]) {
    await fs.mkdir(join(directory, "copies", String(index)));
    await fs.writeFile(join(directory, "copies", String(index), "retained"), "intact");
  }
  const marker = {
    mode: "manual",
    phase: "candidate",
    copied: true,
    paths: ["/live/state", "/live/agent"],
    images: {
      old: { app: "sha256:old" },
      candidate: { app: "sha256:new", "print-agent": "sha256:agent" },
    },
  };
  await fs.writeFile(join(directory, "attempt.json"), JSON.stringify(marker));
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes("config"))
      return {
        stdout: JSON.stringify({
          services: {
            app: {
              environment: {
                WAITRON_BACKUP_DIR: "/var/lib/waitron/backups",
                WAITRON_BACKUP_RECOVERY_KEY: "SYNTHETIC-secret",
              },
            },
          },
        }),
      };
    if (args.includes("sale")) {
      if (failed) throw new Error("sale refused");
      return { stdout: 'boot log\n[{"name":"sale","ok":true}]\n' };
    }
    return { stdout: '[{"name":"readiness","ok":true}]\n' };
  };
  return { root, directory, calls, run };
}

it("checks data, observes the contained agent, stops it and then sells without live mounts or network", async () => {
  const f = await fixture();
  expect(
    await checkUpgradeCandidate({ boxDirectory: f.root, directory: f.directory, run: f.run }),
  ).toEqual([
    { name: "readiness", ok: true },
    { name: "sale", ok: true },
  ]);
  const readiness = f.calls.findIndex((args) => args.includes("readiness"));
  const status = f.calls.findIndex((args) => args.some((arg) => arg.includes("/status.json")));
  const stop = f.calls.findIndex((args) => args[1] === "stop");
  const sale = f.calls.findIndex((args) => args.includes("sale"));
  expect(readiness).toBeGreaterThan(-1);
  expect(status).toBeGreaterThan(readiness);
  expect(stop).toBeGreaterThan(status);
  expect(sale).toBeGreaterThan(stop);
  const starts = f.calls.filter((args) => args[1] === "run");
  expect(starts).toHaveLength(3);
  expect(starts[0]).toContain("host");
  expect(starts[1]).toContain("none");
  expect(starts[2].find((arg) => arg.startsWith("container:"))).toBeDefined();
  expect(starts.flat().some((arg) => /\/live\/|\/dev:|dbus|SYNTHETIC-secret/.test(arg))).toBe(
    false,
  );
  expect(starts.flat().some((arg) => arg.startsWith("--restart"))).toBe(false);
  expect(starts.flat().some((arg) => arg.includes("/check/state,dst=/var/lib/waitron/state"))).toBe(
    true,
  );
  expect(await fs.readFile(join(f.directory, "copies", "0", "retained"), "utf8")).toBe("intact");
  await expect(fs.access(join(f.directory, "check"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("retains the intact recovery copy and removes the disposable tree and its containers after a refused sale", async () => {
  const f = await fixture(true);
  await expect(
    checkUpgradeCandidate({ boxDirectory: f.root, directory: f.directory, run: f.run }),
  ).rejects.toThrow("sale refused");
  expect(await fs.readFile(join(f.directory, "copies", "0", "retained"), "utf8")).toBe("intact");
  await expect(fs.access(join(f.directory, "check"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(f.calls.filter((args) => args[1] === "rm" && args.includes("--force"))).toHaveLength(3);
});

it("cleans only containers labelled for this interrupted attempt and refuses somebody else's container", async () => {
  const calls = [];
  const run = async (file, args) => {
    calls.push(args);
    return { stdout: "/box.upgrades/attempt\n" };
  };
  await removeUpgradeCheckContainers("/box.upgrades/attempt", run);
  expect(calls.filter((args) => args[0] === "rm")).toHaveLength(3);
  const refused = [];
  await expect(
    removeUpgradeCheckContainers("/box.upgrades/attempt", async (file, args) => {
      refused.push(args);
      return { stdout: "/another.upgrades/attempt\n" };
    }),
  ).rejects.toThrow("upgrade check container belongs to another attempt");
  expect(refused.some((args) => args[0] === "rm")).toBe(false);
  await expect(
    removeUpgradeCheckContainers("/box.upgrades/attempt", async () => {
      throw Object.assign(new Error("missing"), { code: 1, stderr: "No such object" });
    }),
  ).resolves.toBeUndefined();
});
