import { expect, it, onTestFinished, vi } from "vitest";
import * as fs from "node:fs/promises";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, URL } from "node:url";
import { createHash } from "node:crypto";
import { offerTrustFixture } from "./offers.test-support.mjs";
import { recheckOfferedUpgrade, runUpgradeCli, runUpgradeCliMain } from "./cli.mjs";

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
  expect(await runUpgradeCli(["apply-offered-upgrade", f.box], { run: forbidden })).toEqual({
    status: "deferred",
    reason: "upgrade-pending",
  });
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
  const { trust, link, offer } = await offerTrustFixture(root, "box-one");
  await fs.mkdir(state);
  await fs.writeFile(join(state, "trading.env"), 'WAITRON_NODE_ID="box-one"\n');
  const run = async (command, args) => {
    if (command === "docker" && args.includes("config"))
      return { stdout: JSON.stringify({ volumes: { state: { name: "test_state" } } }) };
    if (command === "docker" && args.join(" ") === "volume inspect test_state")
      return { stdout: JSON.stringify([{ Mountpoint: state }]) };
    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  };
  const check = async (bytes, version = "1.2.3-rc.1", trustDirectory = link) => {
    const stagedOffer = join(root, "offer");
    await fs.writeFile(stagedOffer, bytes);
    return runUpgradeCli([offerVerb, box, version, trustDirectory, stagedOffer], { run });
  };
  return { box, check, link, offer, run, state, trust, record: `${box}.upgrade-offer.json` };
}

async function installVenueZone(state) {
  await fs.mkdir(join(state, "venue"));
  const database = new DatabaseSync(join(state, "venue/venue.db"));
  try {
    database.exec(`create table settings (module text, version integer, doc text);
      insert into settings values ('business_day', 1, '{"timeZone":"Europe/Madrid"}');`);
  } finally {
    database.close();
  }
}

it.each([
  ["none", "03:29:00", "offer-changed"],
  ["1.2.4", "03:29:00", "offer-changed"],
  ["1.2.3", "03:30:01", "outside the offered upgrade start window"],
  ["1.2.3", "03:30:00", null],
])("rechecks target %s at %s UTC while this attempt is preparing", async (target, time, reason) => {
  const f = await offerFixture();
  await f.check(f.offer(4, "1.2.3"));
  await fs.mkdir(join(`${f.box}.upgrades`, "preparing"), { recursive: true });
  await installVenueZone(f.state);
  vi.useFakeTimers({ toFake: ["Date"] });
  onTestFinished(() => vi.useRealTimers());
  vi.setSystemTime(new Date(`2026-11-21T${time}Z`));
  const bytes = f.offer(5, target);
  const run = (command, args) => (command === "curl" ? { stdout: bytes } : f.run(command, args));
  const recheck = recheckOfferedUpgrade(f.box, "1.2.3-rc.1", "1.2.3", f.link, run);
  if (reason) await expect(recheck).rejects.toThrow(reason);
  else await expect(recheck).resolves.toBeUndefined();
  expect(JSON.parse(await fs.readFile(f.record, "utf8"))).toEqual({
    serial: 5,
    digest: createHash("sha256").update(bytes).digest("hex"),
  });
});

it.each([
  [false, "03:00", "05:00", "automatic upgrades are paused"],
  [true, null, null, "automatic upgrade hours are cleared"],
])(
  "rechecks saved settings while an offered release is being prepared (%s, %s–%s)",
  async (automatic, start, end, reason) => {
    const f = await offerFixture();
    await fs.mkdir(join(`${f.box}.upgrades`, "preparing"), { recursive: true });
    await installVenueZone(f.state);
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => vi.useRealTimers());
    vi.setSystemTime(new Date("2026-11-21T02:30:00Z"));
    const run = (command, args) =>
      command === "curl" ? { stdout: f.offer(5, "1.2.3") } : f.run(command, args);
    const recheck = () => recheckOfferedUpgrade(f.box, "1.2.3-rc.1", "1.2.3", f.link, run);
    await expect(recheck()).resolves.toBeUndefined();
    await fs.writeFile(
      `${f.box}.upgrade-settings.json`,
      JSON.stringify({
        version: 1,
        revision: 1,
        automatic,
        start,
        end,
      }),
    );
    await expect(recheck()).rejects.toThrow(reason);
  },
);

it("checks the installed box's signed offer and remembers a newer pause across calls", async () => {
  const f = await offerFixture();
  const offered = f.offer(4, "1.2.3");
  const paused = f.offer(5, "none");
  expect(await f.check(offered)).toEqual({ status: "offered", version: "1.2.3" });
  expect(JSON.parse(await fs.readFile(f.record, "utf8"))).toEqual({
    serial: 4,
    digest: createHash("sha256").update(offered).digest("hex"),
  });
  expect(await f.check(paused)).toEqual({ status: "none" });
  expect(await f.check(offered)).toEqual(deferred("invalid-offer"));
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
  expect(await f.check(f.offer(1, "1.2.3"))).toEqual(deferred(reason));
});

it("defers on an unnumbered version even when the signed list has no offer", async () => {
  const f = await offerFixture();
  expect(await f.check(f.offer(1, "none"), "main")).toEqual(
    deferred("installed-version-unavailable"),
  );
});

it.each([22, 63])("refuses to stage anything when curl exits %i", async (code) => {
  const { box } = await fixture();
  const run = vi.fn(() => {
    throw Object.assign(new Error("curl failed"), { code });
  });
  expect(await runUpgradeCli(["download-upgrade-offer", box], { run })).toBeNull();
  expect(run).toHaveBeenCalledExactlyOnceWith(
    "curl",
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
    undefined,
    { encoding: "buffer", maxBuffer: 16384 },
  );
});

it("refuses the legacy trust directory even when it contains matching keys", async () => {
  const f = await offerFixture();
  expect(await f.check(f.offer(1, "1.2.3"), "1.2.3-rc.1", f.trust)).toEqual(
    deferred("trust-unavailable"),
  );
});

it("writes one JSON line or an error and returns the command's exit code", async () => {
  const { box } = await fixture();
  const stdout = { write: vi.fn() };
  const stderr = { write: vi.fn() };
  const output = { stdout, stderr };
  expect(await runUpgradeCliMain(["status", box], output)).toBe(0);
  expect(stdout.write).toHaveBeenCalledExactlyOnceWith("null\n");
  expect(stderr.write).not.toHaveBeenCalled();

  stdout.write.mockClear();
  expect(await runUpgradeCliMain(["discard", box], output)).toBe(1);
  expect(stdout.write).not.toHaveBeenCalled();
  expect(stderr.write).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("Expected apply"));
});

it("admits only the venue-local window and skips a missing, invalid or unreadable zone", async () => {
  const { root, box } = await fixture();
  const state = join(root, "state");
  await fs.mkdir(join(state, "venue"), { recursive: true });
  const database = new DatabaseSync(join(state, "venue/venue.db"));
  onTestFinished(() => database.close());
  database.exec("create table settings (module text, version integer, doc text)");
  const insert = database.prepare("insert into settings values ('business_day', 1, ?)");
  insert.run(JSON.stringify({ timeZone: "Europe/Madrid" }));

  const run = async (file, args) => {
    if (file === "docker" && args.includes("config"))
      return { stdout: '{"volumes":{"state":{"name":"test_state"}}}' };
    if (file === "docker" && args.join(" ") === "volume inspect test_state")
      return { stdout: JSON.stringify([{ Mountpoint: state }]) };
    throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
  };
  const stdout = { write: vi.fn() };
  const stderr = { write: vi.fn() };
  const check = () => runUpgradeCliMain(["check-upgrade-window", box], { run, stdout, stderr });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("TZ", "UTC");
  onTestFinished(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  for (const [hour, status] of [
    ["01:59:59", 1],
    ["02:00:00", 0],
    ["03:59:59", 0],
    ["04:00:00", 1],
  ]) {
    vi.setSystemTime(new Date(`2026-11-21T${hour}Z`));
    stderr.write.mockClear();
    expect(await check()).toBe(status);
    if (status === 0) expect(stderr.write).not.toHaveBeenCalled();
    else expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining("outside"));
  }
  vi.setSystemTime(new Date("2026-11-21T02:30:00Z"));
  for (const timeZone of [" Europe/Madrid ", "+01:00", "\u221201:00", 3]) {
    database.exec("delete from settings");
    insert.run(JSON.stringify({ timeZone }));
    expect(await check()).toBe(1);
    expect(stderr.write).toHaveBeenLastCalledWith(expect.stringContaining("invalid"));
  }
  database.exec("delete from settings");
  expect(await check()).toBe(1);
  expect(stderr.write).toHaveBeenLastCalledWith(expect.stringContaining("missing"));
  database.exec("drop table settings");
  expect(await check()).toBe(1);
  expect(stderr.write).toHaveBeenLastCalledWith(expect.stringContaining("could not read"));
  expect(stdout.write).not.toHaveBeenCalled();
});

it("saves editable hours, rejects a stale edit and reads the cleared window after restart", async () => {
  const { box } = await fixture();
  const read = () => runUpgradeCli(["read-upgrade-settings", box]);
  const save = (revision, automatic, start, end) =>
    runUpgradeCli([
      "save-upgrade-settings",
      box,
      JSON.stringify({ revision, automatic, start, end }),
    ]);
  expect(await read()).toEqual({
    ok: true,
    result: { version: 1, revision: 0, automatic: true, start: "03:00", end: "05:00" },
  });
  expect(await save(0, false, "23:30", "00:30")).toEqual({
    ok: true,
    result: { version: 1, revision: 1, automatic: false, start: "23:30", end: "00:30" },
  });
  expect(await save(1, true, "23:30", "00:29")).toEqual({ ok: false, reason: "settings_invalid" });
  expect(await save(1, true, "23:30", null)).toEqual({ ok: false, reason: "settings_invalid" });
  expect(await save(0, true, null, null)).toEqual({ ok: false, reason: "settings_stale" });
  expect(await read()).toMatchObject({ result: { revision: 1, automatic: false, start: "23:30" } });
  const cleared = {
    ok: true,
    result: { version: 1, revision: 2, automatic: true, start: null, end: null },
  };
  expect(await save(1, true, null, null)).toEqual(cleared);
  const { stdout } = await promisify(execFile)(process.execPath, [
    new URL("./cli.mjs", import.meta.url).pathname,
    "read-upgrade-settings",
    box,
  ]);
  expect(JSON.parse(stdout)).toEqual(cleared);
});

it.each([
  '{"version":',
  '{"version":2,"revision":0,"automatic":true,"start":"03:00","end":"05:00"}',
])("leaves unreadable settings in place (%s)", async (bytes) => {
  const { box } = await fixture();
  const file = `${box}.upgrade-settings.json`;
  await fs.writeFile(file, bytes);
  const window = runUpgradeCli(["check-upgrade-window", box], {
    run: async () => {
      throw new Error("unexpected venue lookup");
    },
  });
  await expect(window).rejects.toThrow("the saved upgrade settings are unreadable");
  expect(await runUpgradeCli(["read-upgrade-settings", box])).toEqual({
    ok: false,
    reason: "host_failed",
  });
  expect(
    await runUpgradeCli([
      "save-upgrade-settings",
      box,
      '{"revision":0,"automatic":true,"start":"03:00","end":"05:00"}',
    ]),
  ).toEqual({ ok: false, reason: "host_failed" });
  expect(await fs.readFile(file, "utf8")).toBe(bytes);
});

it.each([
  ["23:30", "01:30", "2026-10-29T22:29:59Z", false],
  ["23:30", "01:30", "2026-10-29T22:30:00Z", true],
  ["23:30", "01:30", "2026-10-30T00:29:59Z", true],
  ["23:30", "01:30", "2026-10-30T00:30:00Z", false],
  ["23:30", "01:30", "2026-12-31T23:50:00Z", true],
  ["23:30", "01:30", "2028-02-29T00:00:00Z", true],
  ["01:30", "04:00", "2026-03-29T01:30:00Z", true],
  ["01:30", "04:00", "2026-10-25T02:30:00Z", true],
  ["02:30", "05:00", "2026-03-29T02:00:00Z", false],
  ["01:00", "02:30", "2026-03-29T00:30:00Z", false],
  ["02:30", "05:00", "2026-10-25T03:00:00Z", false],
  ["01:00", "02:30", "2026-10-25T00:00:00Z", false],
  ["23:00", "02:30", "2026-03-28T23:30:00Z", false],
  ["23:00", "02:30", "2026-10-24T23:30:00Z", false],
  [null, null, "2026-11-21T02:30:00Z", true],
  [null, null, "2026-11-21T01:30:00Z", false],
])("checks offers with saved hours %s–%s at %s", async (start, end, time, allowed) => {
  const f = await offerFixture();
  await installVenueZone(f.state);
  await fs.writeFile(
    `${f.box}.upgrade-settings.json`,
    JSON.stringify({
      version: 1,
      revision: 1,
      automatic: false,
      start,
      end,
    }),
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  onTestFinished(() => vi.useRealTimers());
  vi.setSystemTime(new Date(time));
  const check = runUpgradeCli(["check-upgrade-window", f.box], { run: f.run });
  if (allowed) await expect(check).resolves.toBeUndefined();
  else await expect(check).rejects.toThrow("outside");
});
