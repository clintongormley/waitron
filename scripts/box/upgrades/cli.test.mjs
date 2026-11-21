import { expect, it, onTestFinished, vi } from "vitest";
import * as fs from "node:fs/promises";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, URL } from "node:url";
import { createHash, generateKeyPairSync } from "node:crypto";
import { signUpgradeOffer } from "../release-list.mjs";
import { runUpgradeCli, runUpgradeCliMain } from "./cli.mjs";

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

const offerVerb = "check-upgrade-offer";
const deferred = (reason) => ({ status: "deferred", reason });

async function offerFixture() {
  const { root, box } = await fixture();
  const state = join(root, "state");
  const trust = join(root, "trust generation #1");
  const link = join(root, "release-trust");
  await fs.mkdir(state);
  await fs.writeFile(join(state, "trading.env"), 'WAITRON_NODE_ID="box-one"\n');
  await fs.mkdir(join(trust, "upgrades"), { recursive: true });
  await fs.copyFile(
    new URL("../release-list.mjs", import.meta.url),
    join(trust, "release-list.mjs"),
  );
  await fs.copyFile(
    new URL("./contracts.mjs", import.meta.url),
    join(trust, "upgrades/contracts.mjs"),
  );
  await fs.symlink(trust, link);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const current = generateKeyPairSync("ed25519").publicKey;
  await fs.writeFile(join(trust, "current.pem"), current.export({ type: "spki", format: "pem" }));
  await fs.writeFile(join(trust, "spare.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const offer = (serial, target) =>
    signUpgradeOffer(
      {
        format: 1,
        kind: "offer",
        serial,
        default: "none",
        entries: [{ condition: { installations: ["box-one"] }, target }],
      },
      privateKey.export({ type: "pkcs8", format: "pem" }),
    );
  const check = (download, version = "1.2.3-rc.1", trustDirectory = link) =>
    runUpgradeCli([offerVerb, box, version, trustDirectory], {
      run: async (command, args, input, options) => {
        if (command === "docker" && args.includes("config"))
          return { stdout: JSON.stringify({ volumes: { state: { name: "test_state" } } }) };
        if (command === "docker" && args.join(" ") === "volume inspect test_state")
          return { stdout: JSON.stringify([{ Mountpoint: state }]) };
        if (command === "curl") return { stdout: await download(args, options) };
        throw new Error(`unexpected command ${command} ${args.join(" ")}`);
      },
    });
  return { check, offer, state, trust, record: `${box}.upgrade-offer.json` };
}

it("checks the installed box's signed offer and remembers a newer pause across calls", async () => {
  const f = await offerFixture();
  const offered = f.offer(4, "1.2.3");
  const paused = f.offer(5, "none");
  expect(await f.check(() => offered)).toEqual({ status: "offered", version: "1.2.3" });
  expect(JSON.parse(await fs.readFile(f.record, "utf8"))).toEqual({
    serial: 4,
    digest: createHash("sha256").update(offered).digest("hex"),
  });
  expect(await f.check(() => paused)).toEqual({ status: "none" });
  expect(await f.check(() => offered)).toEqual(deferred("invalid-offer"));
  expect(JSON.parse(await fs.readFile(f.record, "utf8"))).toEqual({
    serial: 5,
    digest: createHash("sha256").update(paused).digest("hex"),
  });
});

it("defers on an interrupted attempt without running recovery or writing over the evidence", async () => {
  const f = await fixture();
  await fs.mkdir(f.directory, { recursive: true });
  const result = await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("./cli.mjs", import.meta.url)),
    offerVerb,
    f.box,
    "1.2.3",
    f.root,
  ]).catch((error) => error);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(JSON.stringify(deferred("upgrade-pending")) + "\n");
  expect(await fs.readdir(f.directory)).toEqual([]);
});

it.each([
  ["missing box ID", "box-id-unavailable", (f) => fs.rm(join(f.state, "trading.env"))],
  ["missing key", "trust-unavailable", (f) => fs.rm(join(f.trust, "spare.pem"))],
  ["bad replay state", "offer-state-unreadable", (f) => fs.writeFile(f.record, '{"serial":5}')],
  ["truncated replay state", "offer-state-unreadable", (f) => fs.writeFile(f.record, '{"serial":')],
  ["failed persistence", "offer-state-unwritable", (f) => fs.mkdir(`${f.record}.tmp`)],
])("defers for %s", async (_name, reason, arrange) => {
  const f = await offerFixture();
  await arrange(f);
  expect(await f.check(() => f.offer(1, "1.2.3"))).toEqual(deferred(reason));
});

it("defers on an unnumbered version even when the signed list has no offer", async () => {
  const f = await offerFixture();
  expect(await f.check(() => f.offer(1, "none"), "main")).toEqual(
    deferred("installed-version-unavailable"),
  );
});

it.each([22, 63])("defers when curl exits %i and leaves no replay state", async (code) => {
  const f = await offerFixture();
  const download = vi.fn(() => {
    throw Object.assign(new Error("curl failed"), { code });
  });
  expect(await f.check(download)).toEqual(deferred("offer-download-failed"));
  expect(download).toHaveBeenCalledExactlyOnceWith(
    [
      "-q",
      "-fsSL",
      "--proto",
      "=https",
      "--proto-redir",
      "=https",
      "--connect-timeout",
      "15",
      "--max-time",
      "60",
      "--max-filesize",
      "16384",
      "https://github.com/clintongormley/waitron/releases/download/upgrade-offer/waitron-offer.json",
    ],
    { encoding: "buffer", maxBuffer: 16384 },
  );
  await expect(fs.access(f.record)).rejects.toMatchObject({ code: "ENOENT" });
});

it("refuses the legacy trust directory even when it contains matching keys", async () => {
  const f = await offerFixture();
  expect(await f.check(() => f.offer(1, "1.2.3"), "1.2.3-rc.1", f.trust)).toEqual(
    deferred("trust-unavailable"),
  );
});

it("writes one JSON line or an error and returns the command's exit code", async () => {
  const { box, directory } = await fixture();
  const stdout = { write: vi.fn() };
  const stderr = { write: vi.fn() };
  const output = { stdout, stderr };
  expect(await runUpgradeCliMain(["status", box], output)).toBe(0);
  expect(stdout.write).toHaveBeenCalledExactlyOnceWith("null\n");
  expect(stderr.write).not.toHaveBeenCalled();

  await fs.mkdir(directory, { recursive: true });
  stdout.write.mockClear();
  expect(await runUpgradeCliMain([offerVerb, box], output)).toBe(1);
  expect(stdout.write).toHaveBeenCalledExactlyOnceWith(
    '{"status":"deferred","reason":"upgrade-pending"}\n',
  );
  expect(stderr.write).not.toHaveBeenCalled();

  stdout.write.mockClear();
  expect(await runUpgradeCliMain(["discard", box], output)).toBe(1);
  expect(stdout.write).not.toHaveBeenCalled();
  expect(stderr.write).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("Expected apply"));
});
