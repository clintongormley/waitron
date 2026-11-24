import { describe, expect, it, onTestFinished, vi } from "vitest";
import * as fs from "node:fs/promises";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { checkUpgradeCandidate, removeUpgradeCheckContainers } from "./candidate.mjs";
import { IDENTITY_CHANGE_FILE } from "../../../packages/store/src/state-layout.js";
import { boxHostClient } from "../../../apps/server/src/box-host-client.js";
import { readIdentityChangeNote } from "../../../apps/server/src/identity-change-note.js";

async function fixture(
  failed = false,
  agentState = { Running: true, Health: { Status: "healthy" } },
) {
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
            "print-agent": {
              healthcheck: {
                test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:9110/status.json')"],
                interval: "10s",
                timeout: "5s",
                start_period: "20s",
                retries: 3,
              },
            },
            app: {
              environment: {
                WAITRON_BACKUP_DIR: "/var/lib/waitron/backups",
                WAITRON_BACKUP_RECOVERY_KEY: "SYNTHETIC-secret",
              },
            },
          },
        }),
      };
    if (args[0] === "inspect") return { stdout: JSON.stringify([{ State: agentState }]) };
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
  const status = f.calls.findIndex(
    (args) => args[1] === "exec" && args.some((arg) => arg.includes("/status.json")),
  );
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
  expect(starts[2]).not.toContain("--env");
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

it.each([
  [{ Running: true, Health: { Status: "unhealthy" } }, "unhealthy"],
  [{ Running: false, Health: { Status: "starting" } }, "stopped"],
])("refuses the existing agent healthcheck's %s outcome before the sale", async (state, reason) => {
  const f = await fixture(false, state);
  const result = await checkUpgradeCandidate({
    boxDirectory: f.root,
    directory: f.directory,
    run: f.run,
  }).catch((error) => error);
  expect(f.calls.some((args) => args.includes("sale"))).toBe(false);
  expect(result).toMatchObject({ message: `upgrade agent ${reason}` });
});

it.each(["No such object", "error: no such object: check-agent"])(
  "ignores an already removed check container (%s)",
  async (stderr) => {
    await expect(
      removeUpgradeCheckContainers("/box.upgrades/attempt", async () => {
        throw Object.assign(new Error(stderr), { code: 1, stderr });
      }),
    ).resolves.toBeUndefined();
  },
);

it("finishes successful checks when Docker already removed their containers", async () => {
  const f = await fixture();
  const run = (file, args) => {
    if (args[0] === "rm")
      throw Object.assign(new Error("missing"), { code: 1, stderr: "error: no such container" });
    return f.run(file, args);
  };
  await expect(
    checkUpgradeCandidate({ boxDirectory: f.root, directory: f.directory, run }),
  ).resolves.toHaveLength(2);
});

it("tells only the stopped checks' copy that its time is synchronised, whatever the host says", async () => {
  const f = await fixture();
  const relay = join(f.directory, "check", "clock");
  const statuses = [];
  const run = async (file, args) => {
    if (["readiness", "sale"].includes(args.at(-1)))
      statuses.push(await boxHostClient({ socketPath: join(relay, "box.sock") }).clockStatus());
    return f.run(file, args);
  };
  const log = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  onTestFinished(() => log.mockRestore());
  await checkUpgradeCandidate({ boxDirectory: f.root, directory: f.directory, run });
  expect(statuses).toMatchObject(Array(2).fill({ available: true, synchronised: true }));
  const mount = `type=bind,src=${relay},dst=/run/waitron-box,readonly`;
  const given = f.calls.filter((args) => args.some((arg) => arg.includes("/run/waitron-box")));
  expect(given.map((args) => args.includes(mount))).toEqual([true, true]);
  expect(given.map((args) => args[args.indexOf("--name") + 1])).toEqual([
    expect.stringMatching(/-readiness$/),
    expect.stringMatching(/-sale$/),
  ]);
  await expect(fs.access(relay)).rejects.toMatchObject({ code: "ENOENT" });
  expect(log.mock.calls).toEqual([[expect.stringMatching(/^The upgrade's checks .*\n$/)]]);
});

describe("an attempt that changes the producer", () => {
  const NOTE = {
    release: "1.4.0",
    producerTaxId: "B00000002",
    fromProducerTaxId: "B00000001",
  };
  const FILE = JSON.stringify({ version: 1, ...NOTE }) + "\n";
  const EARLIER = {
    release: "1.3.0",
    producerTaxId: "B00000001",
    fromProducerTaxId: "B00000000",
  };
  const EARLIER_FILE = JSON.stringify({ version: 1, ...EARLIER }) + "\n";

  async function noted({ note = FILE, failed, agentState, reply } = {}) {
    const f = await fixture(failed, agentState);
    const live = join(f.root, "live", "state");
    await fs.mkdir(live, { recursive: true });
    const marker = JSON.parse(await fs.readFile(join(f.directory, "attempt.json"), "utf8"));
    marker.paths = [live, join(f.root, "live", "agent")];
    await fs.writeFile(join(f.directory, "attempt.json"), JSON.stringify(marker));
    if (note !== null) await fs.writeFile(join(f.directory, IDENTITY_CHANGE_FILE), note);
    const state = join(f.directory, "check", "state");
    const seen = { checks: {}, live: [], environment: "" };
    const run = async (file, args) => {
      seen.live.push(await readIdentityChangeNote(live));
      for (const check of ["readiness", "sale"])
        if (args.at(-1) === check) seen.checks[check] = await readIdentityChangeNote(state);
      if (args.includes("--env-file"))
        seen.environment += await fs.readFile(args[args.indexOf("--env-file") + 1], "utf8");
      const answer = await reply?.(args, state);
      return answer ?? f.run(file, args);
    };
    const check = () =>
      checkUpgradeCandidate({ boxDirectory: f.root, directory: f.directory, run });
    return { ...f, live, state, seen, check };
  }

  const answers = (check, stdout) => (args) =>
    args.at(-1) === check ? { stdout: JSON.stringify(stdout) } : undefined;

  it("gives the note to the copy both checks read, and to the live state only when they have passed", async () => {
    const f = await noted();
    expect(await f.check()).toEqual([
      { name: "readiness", ok: true },
      { name: "sale", ok: true },
    ]);
    expect(f.seen.checks).toEqual({ readiness: NOTE, sale: NOTE });
    expect(f.calls.at(-1).slice(0, 3)).toEqual(["docker", "rm", "--force"]);
    expect(f.seen.live.every((note) => note === null)).toBe(true);
    expect(await fs.readFile(join(f.live, IDENTITY_CHANGE_FILE), "utf8")).toBe(FILE);
    expect(await fs.readdir(f.live)).toEqual([IDENTITY_CHANGE_FILE]);
    await expect(fs.access(join(f.directory, "check"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("gives each note its folder's owner, and nobody else access", async () => {
    const probe = await fs.open(join(tmpdir(), "."), "r");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const chown = vi.spyOn(prototype, "chown");
    onTestFinished(() => chown.mockRestore());
    let copied;
    const f = await noted({
      reply: async (args, state) => {
        if (args.at(-1) !== "readiness") return;
        copied = {
          note: await fs.stat(join(state, IDENTITY_CHANGE_FILE)),
          folder: await fs.stat(state),
        };
      },
    });
    await f.check();
    const written = {
      note: await fs.stat(join(f.live, IDENTITY_CHANGE_FILE)),
      folder: await fs.stat(f.live),
    };
    for (const { note } of [copied, written]) expect(note.mode & 0o777).toBe(0o600);
    expect(chown.mock.calls).toEqual(
      [copied, written].map(({ folder }) => [folder.uid, folder.gid]),
    );
  });

  it("writes nothing for an attempt without a note", async () => {
    const f = await noted({ note: null });
    await expect(f.check()).resolves.toHaveLength(2);
    expect(f.seen.checks).toEqual({ readiness: null, sale: null });
    expect(await fs.readdir(f.live)).toEqual([]);
  });

  it("fails an attempt without a note on an empty sale report", async () => {
    const f = await noted({ note: null, reply: answers("sale", []) });
    await expect(f.check()).rejects.toThrow("the sale check reported nothing");
    expect(await fs.readdir(f.live)).toEqual([]);
  });

  it("leaves an earlier upgrade's unused note as it is when this attempt has none", async () => {
    const f = await noted({ note: null });
    for (const folder of [f.live, join(f.directory, "copies", "0")])
      await fs.writeFile(join(folder, IDENTITY_CHANGE_FILE), EARLIER_FILE);
    await expect(f.check()).resolves.toHaveLength(2);
    expect(f.seen.checks).toEqual({ readiness: EARLIER, sale: EARLIER });
    expect(await fs.readFile(join(f.live, IDENTITY_CHANGE_FILE), "utf8")).toBe(EARLIER_FILE);
  });

  it("replaces an earlier upgrade's note in the live state only after the checks pass", async () => {
    const f = await noted();
    for (const folder of [f.live, join(f.directory, "copies", "0")])
      await fs.writeFile(join(folder, IDENTITY_CHANGE_FILE), EARLIER_FILE);
    await f.check();
    expect(f.seen.checks).toEqual({ readiness: NOTE, sale: NOTE });
    expect(f.seen.live.every((note) => note.release === EARLIER.release)).toBe(true);
    expect(await readIdentityChangeNote(f.live)).toEqual(NOTE);
    expect(await fs.readFile(join(f.directory, "copies", "0", IDENTITY_CHANGE_FILE), "utf8")).toBe(
      EARLIER_FILE,
    );
  });

  it.each([
    [
      "a refused readiness check",
      {
        reply: (args) => {
          if (args.at(-1) === "readiness") throw new Error("readiness refused");
        },
      },
      "readiness refused",
    ],
    [
      "an unhealthy agent",
      { agentState: { Running: true, Health: { Status: "unhealthy" } } },
      "unhealthy",
    ],
    ["a refused sale", { failed: true }, "sale refused"],
    [
      "a container that cannot be removed",
      {
        reply: (args) => {
          if (args[0] === "rm") throw new Error("removal refused");
        },
      },
      "removal refused",
    ],
  ])("writes no live note after %s", async (_, options, reason) => {
    const f = await noted(options);
    await expect(f.check()).rejects.toThrow(reason);
    expect(await fs.readdir(f.live)).toEqual([]);
  });

  it.each([
    ["readiness", [{ name: "readiness", ok: false }]],
    ["sale", [{ name: "sale", ok: false }]],
    ["sale", [{ name: "sale" }]],
  ])("writes no live note when the %s check reports %j", async (check, stdout) => {
    const f = await noted({ reply: answers(check, stdout) });
    expect(await f.check()).toContainEqual(stdout[0]);
    expect(await fs.readdir(f.live)).toEqual([]);
  });

  const emptyChecks = (args) =>
    ["readiness", "sale"].includes(args.at(-1)) ? { stdout: "[]" } : undefined;
  it.each([
    ["an empty readiness report", answers("readiness", []), "readiness"],
    ["an empty sale report", answers("sale", []), "sale"],
    ["a sale report that is not a list", answers("sale", { name: "sale", ok: true }), "sale"],
    ["an empty report from both checks", emptyChecks, "readiness"],
  ])("fails, and writes no live note, on %s", async (_, reply, check) => {
    const f = await noted({ reply });
    await expect(f.check()).rejects.toThrow(`the ${check} check reported nothing`);
    expect(await fs.readdir(f.live)).toEqual([]);
  });

  it.each([
    ["a readiness report from the sale command", [{ name: "readiness", ok: true }]],
    [
      "two passing entries from the sale command",
      [
        { name: "sale", ok: true },
        { name: "sale", ok: true },
      ],
    ],
  ])("fails, and writes no live note, on %s", async (_, stdout) => {
    const f = await noted({ reply: answers("sale", stdout) });
    await expect(f.check()).rejects.toThrow("the sale check did not report itself");
    expect(await fs.readdir(f.live)).toEqual([]);
  });

  it("does not write through links left under the note's names", async () => {
    const f = await noted();
    const outside = join(f.root, "outside");
    await fs.writeFile(outside, "outside");
    for (const folder of [f.live, join(f.directory, "copies", "0")])
      for (const name of [IDENTITY_CHANGE_FILE, `${IDENTITY_CHANGE_FILE}.tmp`])
        await fs.symlink(outside, join(folder, name));
    await f.check();
    expect(await fs.readFile(outside, "utf8")).toBe("outside");
    expect((await fs.lstat(join(f.live, IDENTITY_CHANGE_FILE))).isFile()).toBe(true);
    expect(f.seen.checks).toEqual({ readiness: NOTE, sale: NOTE });
  });

  it("runs no check when the attempt's note cannot be read", async () => {
    const f = await noted({ note: null });
    await fs.mkdir(join(f.directory, IDENTITY_CHANGE_FILE));
    await expect(f.check()).rejects.toMatchObject({ code: "EISDIR" });
    expect(f.calls.some((args) => args[1] === "run")).toBe(false);
    expect(await fs.readdir(f.live)).toEqual([]);
  });

  it("names the note and the live state in no command or environment", async () => {
    const f = await noted();
    await f.check();
    const said = JSON.stringify(f.calls) + f.seen.environment;
    expect(f.seen.environment).toContain("WAITRON_BACKUP_DIR");
    for (const word of [...Object.values(NOTE).slice(1), IDENTITY_CHANGE_FILE, f.live])
      expect(said).not.toContain(word);
  });
});
