import { expect, it, onTestFinished, vi } from "vitest";
import * as fs from "node:fs/promises";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { URL } from "node:url";
import { runUpgradeCli } from "./cli.mjs";

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "upgrade-cli-"));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const box = join(root, "box");
  await fs.mkdir(box);
  return { root, box, directory: join(root, "box.upgrades", "attempt") };
}

it("reports the retained manual refusal read-only, including from the installed executable", async () => {
  const f = await fixture();
  await fs.mkdir(f.directory, { recursive: true });
  const marker = {
    mode: "manual",
    phase: "awaiting-choice",
    copied: true,
    paths: ["/live/state"],
    images: { old: { app: "sha256:old" }, candidate: { app: "sha256:new" } },
    failure: "sale refused",
  };
  const text = JSON.stringify(marker);
  await fs.writeFile(join(f.directory, "attempt.json"), text);
  const forbidden = async () => {
    throw new Error("status must not call Docker");
  };
  expect(await runUpgradeCli(["status", f.box], { run: forbidden })).toEqual(marker);
  const invoked = await promisify(execFile)(process.execPath, [
    new URL("./cli.mjs", import.meta.url).pathname,
    "status",
    f.box,
  ]);
  expect(JSON.parse(invoked.stdout)).toEqual(marker);
  expect(await fs.readFile(join(f.directory, "attempt.json"), "utf8")).toBe(text);
  expect(await fs.readdir(f.root)).toEqual(["box", "box.upgrades"]);
});

it("leaves an unknown nonempty attempt held for inspection before apply, restore or keep", async () => {
  const f = await fixture();
  await fs.mkdir(f.directory, { recursive: true });
  await fs.writeFile(join(f.directory, "evidence"), "retain");
  for (const verb of ["status", "apply", "restore", "keep"]) {
    await expect(
      runUpgradeCli([verb, f.box, ...(verb === "apply" ? ["must-not-run"] : [])]),
    ).rejects.toThrow("upgrade attempt has no readable marker");
  }
  expect(await fs.readFile(join(f.directory, "evidence"), "utf8")).toBe("retain");
});

it("reports no attempt without creating files and refuses an unsupported choice", async () => {
  const f = await fixture();
  expect(await runUpgradeCli(["status", f.box])).toBeNull();
  expect(await fs.readdir(f.root)).toEqual(["box"]);
  await expect(runUpgradeCli(["discard", f.box])).rejects.toThrow(
    "Expected apply, status, restore, keep or offline-recovery",
  );
  await expect(runUpgradeCli(["apply", f.box])).rejects.toThrow(
    "apply requires the candidate preparation command",
  );
  await fs.writeFile(`${f.box}.upgrades`, "not a directory");
  await expect(runUpgradeCli(["status", f.box])).rejects.toMatchObject({ code: "ENOTDIR" });
});

it("refuses offline recovery with Docker running before removing a check tree", async () => {
  const f = await fixture();
  await fs.mkdir(join(f.directory, "check"), { recursive: true });
  await fs.writeFile(join(f.directory, "check", "retained"), "still mounted");
  await fs.writeFile(
    join(f.directory, "attempt.json"),
    JSON.stringify({
      mode: "manual",
      phase: "awaiting-choice",
      copied: true,
      paths: ["/live/state"],
      images: { old: { app: "sha256:old" }, candidate: { app: "sha256:new" } },
    }),
  );
  await expect(
    runUpgradeCli(["offline-recovery", f.box], {
      run: async () => ({ stdout: "active\nactive\n" }),
    }),
  ).rejects.toThrow("Docker must be stopped before offline recovery");
  expect(await fs.readFile(join(f.directory, "check", "retained"), "utf8")).toBe("still mounted");
});

it("clears an empty interrupted attempt through existing recovery without contacting Docker", async () => {
  const f = await fixture();
  await fs.mkdir(f.directory, { recursive: true });
  const run = async () => {
    throw new Error("an empty attempt needs no Docker call");
  };
  expect(await runUpgradeCli(["status", f.box], { run })).toBeNull();
  expect(await fs.readdir(f.directory)).toEqual([]);
  expect(await runUpgradeCli(["restore", f.box], { run })).toBeNull();
  await expect(fs.access(f.directory)).rejects.toMatchObject({ code: "ENOENT" });
});

it("holds an interrupted manual candidate on startup without choosing restore or keep", async () => {
  const f = await fixture();
  const state = join(f.box, "state");
  await fs.mkdir(state);
  await fs.mkdir(f.directory, { recursive: true });
  await fs.writeFile(
    join(f.directory, "attempt.json"),
    JSON.stringify({
      mode: "manual",
      phase: "candidate",
      copied: true,
      paths: [state],
      images: { old: { app: "sha256:old" }, candidate: { app: "sha256:new" } },
    }),
  );
  const calls = [];
  const result = await runUpgradeCli(["recover", f.box], {
    run: async (file, args) => {
      calls.push([file, ...args]);
      if (args[0] === "inspect")
        throw Object.assign(new Error("missing check container"), {
          code: 1,
          stderr: "No such container",
        });
      return { stdout: "" };
    },
  });
  expect(result).toMatchObject({ phase: "awaiting-choice", failure: "checks interrupted" });
  expect(JSON.parse(await fs.readFile(join(f.directory, "attempt.json"), "utf8"))).toEqual(result);
  expect(calls.some((args) => args.includes("stop"))).toBe(true);
  expect(calls.some((args) => args.includes("up"))).toBe(false);
  await expect(
    runUpgradeCli(["apply", f.box, "must-not-run"], {
      run: async () => {
        throw new Error("pending Apply must run nothing");
      },
    }),
  ).rejects.toThrow("resolve the upgrade attempt with restore or keep before installing");
  await fs.mkdir(join(f.directory, "check"));
  await fs.writeFile(join(f.directory, "check", "partial"), "disposable");
  const bin = join(f.root, "bin");
  await fs.mkdir(bin);
  await fs.writeFile(join(bin, "systemctl"), "#!/bin/sh\nprintf 'inactive\\ninactive\\n'\n", {
    mode: 0o700,
  });
  vi.stubEnv("PATH", bin + delimiter + process.env.PATH);
  onTestFinished(() => vi.unstubAllEnvs());
  expect(await runUpgradeCli(["offline-recovery", f.box])).toEqual(result);
  await expect(fs.access(join(f.directory, "check"))).rejects.toMatchObject({ code: "ENOENT" });
});
