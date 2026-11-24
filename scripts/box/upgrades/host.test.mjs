import { describe, expect, it, onTestFinished, vi } from "vitest";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import { execFile, execFileSync } from "node:child_process";
import {
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { checkInstalledUpgradeQuiet, installedVenueTimeZone, stopUpgradeWriters } from "./host.mjs";
import { VENUE_LOCK_FILE } from "../../../packages/store/src/venue-lock.js";
import { RECOVERY_LOCK_FILE, VENUE_DIR_NAME } from "../../../packages/store/src/state-layout.js";
import { useVenueDb } from "../../../packages/db/src/testing/venue-db.js";
import { seedNode, seedPerson } from "../../../packages/db/src/testing/seed.js";
import {
  BUSINESS_DAY_SETTINGS,
  CORE_MIGRATIONS,
  billPayments,
  refunds,
  saveSettings,
  settings,
  workingOrders,
  withNodeTransaction,
  withTransaction,
} from "../../../packages/db/src/index.js";
import { NODE_MIGRATIONS, setNodeModeTx } from "../../../packages/node-db/src/index.js";
import { PAYMENTS_MIGRATIONS } from "../../../packages/payments/src/migrations.js";
import { payments } from "../../../packages/payments/src/schema/payments.js";
import { runUpgradeCli } from "./cli.mjs";
import { offerTrustFixture } from "./offers.test-support.mjs";
import { isNumberedVersion } from "../release-list.mjs";
import { IDENTITY_CHANGE_FILE } from "../../../packages/store/src/state-layout.js";
import { boxHostClient } from "../../../apps/server/src/box-host-client.js";
import { readIdentityChangeNote } from "../../../apps/server/src/identity-change-note.js";

async function mountVenue(suite, boxDirectory) {
  const path = join(boxDirectory, "state", "venue", "venue.db");
  await mkdir(dirname(path));
  await suite.db.archiveTo(path);
  return path;
}

describe("quiet before an offered upgrade", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
  const now = Date.parse("2026-11-21T03:45:00.000Z");

  async function clockAndZone() {
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => vi.useRealTimers());
    vi.setSystemTime(now);
    await withTransaction(suite.db, (tx) =>
      saveSettings(tx, BUSINESS_DAY_SETTINGS, {
        doc: { timeZone: "UTC" },
        expectedRevision: 0,
        personId: null,
      }),
    );
  }

  it.each([
    ["open", "2026-11-20T19:00:00.000Z", false],
    ["placed", "2026-11-20T19:00:00.000Z", false],
    ["abandoned", "2026-11-21T03:36:00.000Z", false],
    ["abandoned", "2026-11-21T03:46:00.000Z", false],
    ["abandoned", "2026-11-21T03:35:00.000Z", true],
  ])("checks %s orders opened at %s", async (status, openedAt, quiet) => {
    const box = await imageFixture({ onlineTrial: "pass", prepare: false });
    await clockAndZone();
    await suite.db.insert(workingOrders).values({
      source: "dashboard",
      orderNumber: 1,
      status,
      openedAt,
      dining: "eat_in",
    });
    await mountVenue(suite, box.root);
    if (quiet) await expect(checkInstalledUpgradeQuiet(box.root, box.run)).resolves.toBeUndefined();
    else
      expect(await runUpgradeCli(["check-offered-upgrade", box.root], { run: box.run })).toEqual({
        status: "deferred",
        reason: "venue has recent or unresolved trading activity",
      });
  });

  it.each([
    [
      "settled order during shutdown",
      "deferred-at-stop",
      "venue has recent or unresolved trading activity",
    ],
    ["pause during preparation", "deferred", "offer-changed"],
    ["stopped app", "deferred-at-stop", "app already stopped; no upgrade copy permitted"],
    ["missing app", "deferred-at-stop", "app already stopped; no upgrade copy permitted"],
  ])("the installed Apply command defers for a %s", async (scenario, status, reason) => {
    const paused = scenario === "pause during preparation";
    const box = await imageFixture({ prepare: false, beforeAutomaticStop: async () => {} });
    await clockAndZone();
    const dbPath = await mountVenue(suite, box.root);
    await writeFile(join(box.root, "state", "trading.env"), "WAITRON_NODE_ID=one\n");

    const { link, offer } = await offerTrustFixture(box.root, "one");
    let offerRead = false;
    const run = async (file, args, ...rest) => {
      if (file === "prepare-fixture")
        return { stdout: JSON.stringify({ compose: JSON.stringify(box.candidate) }) };
      if (file === "curl") {
        expect(box.calls.some((call) => call.includes("trial"))).toBe(true);
        offerRead = true;
        return { stdout: offer(1, paused ? "none" : "1.2.3") };
      }
      if (scenario === "stopped app" && args[0] === "inspect" && args.length === 2)
        return { stdout: '[{"State":{"Running":false}}]' };
      if (
        offerRead &&
        scenario === "missing app" &&
        args.includes("ps") &&
        args.includes("-a") &&
        args.at(-1) === "app"
      )
        return { stdout: "" };
      if (scenario === "settled order during shutdown" && args[0] === "stop") {
        await suite.db.insert(workingOrders).values({
          source: "dashboard",
          orderNumber: 1,
          status: "settled",
          dining: "eat_in",
          openedAt: "2026-11-20T19:00:00.000Z",
          settledAt: "2026-11-21T03:44:59.000Z",
        });
        await rm(dbPath);
        await suite.db.archiveTo(dbPath);
      }
      return box.run(file, args, ...rest);
    };
    const result = await runUpgradeCli(
      ["apply-offered-upgrade", box.root, "1.2.2", "1.2.3", link, "prepare-fixture"],
      { run },
    );
    expect(result).toEqual({ status, reason });
    expect(await readdir(box.root + ".upgrades")).toEqual([]);
  });

  it("reports a partial offered copy as a rollback with both installed and offered versions", async () => {
    const box = await imageFixture({ prepare: false, beforeAutomaticStop: async () => {} });
    await clockAndZone();
    await mountVenue(suite, box.root);
    await writeFile(join(box.root, "state", "trading.env"), "WAITRON_NODE_ID=one\n");
    const { link, offer } = await offerTrustFixture(box.root, "one");
    const resultPath = box.root + ".upgrade-result.json";
    onTestFinished(() => rm(resultPath, { force: true }));

    let stopped = false;
    const run = async (file, args, ...rest) => {
      if (file === "prepare-fixture")
        return { stdout: JSON.stringify({ compose: JSON.stringify(box.candidate) }) };
      if (file === "curl") return { stdout: offer(1, "1.2.3") };
      if (args[0] === "stop" && !stopped) {
        stopped = true;
        await box.fs.rmdir(join(box.root, "print_agent"));
      }
      return box.run(file, args, ...rest);
    };

    const result = await runUpgradeCli(
      ["apply-offered-upgrade", box.root, "1.2.2", "1.2.3", link, "prepare-fixture"],
      { run },
    );

    expect(result.status).toBe("rolled-back");
    expect(JSON.parse(await box.fs.readFile(resultPath, "utf8"))).toMatchObject({
      status: result.status,
      fromVersion: "1.2.2",
      toVersion: "1.2.3",
    });
  });

  it("defers for a card payment without an open order", async () => {
    const box = await imageFixture({ onlineTrial: "pass", prepare: false });
    const old = "2026-11-20T19:00:00.000Z";
    const [order] = await suite.db
      .insert(workingOrders)
      .values({
        source: "dashboard",
        orderNumber: 1,
        status: "settled",
        openedAt: old,
        settledAt: old,
        dining: "eat_in",
      })
      .returning({ id: workingOrders.id });
    await suite.db.insert(payments).values({
      workingOrderId: order.id,
      source: "operator_script",
      provider: "sumup",
      paymentRef: "held-checkout",
      amount: 100,
      state: "initiated",
      createdAt: old,
      updatedAt: old,
    });
    await mountVenue(suite, box.root);
    await expect(checkInstalledUpgradeQuiet(box.root, box.run, now)).rejects.toThrow(
      "venue has recent or unresolved trading activity",
    );
  });

  it.each([
    ["pending", null, false],
    ["completed", "2026-11-21T03:40:00.000Z", false],
    ["completed", "2026-11-20T19:05:00.000Z", true],
  ])("checks a %s refund with completion time %s", async (state, completedAt, quiet) => {
    const box = await imageFixture({ onlineTrial: "pass", prepare: false });
    const db = suite.db;
    const old = "2026-11-20T19:00:00.000Z";
    const person = await seedPerson(db);
    const nodeId = await seedNode(db);
    const [order] = await db
      .insert(workingOrders)
      .values({
        source: "dashboard",
        orderNumber: 1,
        status: "settled",
        dining: "eat_in",
        openedAt: old,
        settledAt: old,
      })
      .returning({ id: workingOrders.id });
    const [payment] = await db
      .insert(billPayments)
      .values({
        workingOrderId: order.id,
        submissionId: "payment",
        fingerprint: "payment",
        kind: "contribution",
        method: "cash",
        applied: 500,
        tendered: 500,
        state: "received",
        source: "operator_script",
        requestedBy: person,
        createdAt: old,
        receivedAt: old,
      })
      .returning({ id: billPayments.id });
    await db.insert(refunds).values({
      billPaymentId: payment.id,
      submissionId: "refund",
      fingerprint: "refund",
      nodeId,
      method: "cash",
      appliedAmount: 500,
      reason: "Returned",
      source: "operator_script",
      requestedBy: person,
      authorizedBy: person,
      state,
      createdAt: old,
      completedAt,
    });
    await mountVenue(suite, box.root);
    const check = checkInstalledUpgradeQuiet(box.root, box.run, now);
    if (quiet) await expect(check).resolves.toBeUndefined();
    else await expect(check).rejects.toThrow("venue has recent or unresolved trading activity");
  });

  it("allows a rollback stop even if trading changed after the first stop", async () => {
    const box = await imageFixture({ prepare: false, beforeAutomaticStop: async () => {} });
    const path = await mountVenue(suite, box.root);
    await mkdir(box.directory);
    const images = await box.f.host.prepareImages();
    try {
      await box.f.host.stop();
      await suite.db.insert(workingOrders).values({
        source: "dashboard",
        orderNumber: 1,
        dining: "eat_in",
      });
      await rm(path);
      await suite.db.archiveTo(path);
      await expect(box.f.host.stop()).resolves.toBeUndefined();
    } finally {
      await box.f.host.resume(images.old);
    }
  });
});

describe("an offered upgrade on a venue without the payments tables", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it.each([false, true])("checks the saved Payments setting (%s)", async (payments) => {
    const box = await imageFixture({ onlineTrial: "pass", prepare: false });
    await suite.db.insert(settings).values({
      module: "modules",
      version: 1,
      revision: 1,
      doc: { modules: { payments } },
      updatedAt: "2026-11-20T18:00:00.000Z",
    });
    await mountVenue(suite, box.root);
    const check = checkInstalledUpgradeQuiet(box.root, box.run);
    if (payments) await expect(check).rejects.toThrow("payment data is unavailable");
    else await expect(check).resolves.toBeUndefined();
  });
});

describe("upgrade admission against the current node schema", () => {
  const suite = useVenueDb({ migrations: [NODE_MIGRATIONS] });

  it("refuses the role written by the product and accepts its sole-primary and empty-role forms", async () => {
    const fs = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { DatabaseSync } = await import("node:sqlite");
    const { onTestFinished } = await import("vitest");
    const { holdUpgradeState } = await import("./host.mjs");
    const root = await fs.mkdtemp(join(tmpdir(), "upgrade-current-role-"));
    onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(join(root, "venue"));
    await fs.writeFile(join(root, "trading.env"), "WAITRON_NODE_ID=one\n");
    await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, "one", "mirror", "adopt"));
    const path = join(root, "venue", "node.db");
    await suite.node.archiveTo(path);
    await expect(holdUpgradeState(root)).rejects.toThrow("paired upgrades are not available");
    const copy = new DatabaseSync(path);
    try {
      copy.exec("update box set mode='primary', singleton_role='primary'");
      (await holdUpgradeState(root))();
      copy.exec("update box set mode=null, singleton_role=null, role_changed_at=null");
      (await holdUpgradeState(root))();
    } finally {
      copy.close();
    }
  });
});

function dockerFixture({
  event = "server.shutdown_complete",
  exitCode = 0,
  running = true,
  stale = false,
} = {}) {
  const calls = [];
  let stopped = false;
  const run = async (command, args) => {
    calls.push([command, ...args]);
    if (args.includes("ps")) return { stdout: "app-id\n" };
    if (args[0] === "inspect")
      return {
        stdout: JSON.stringify([
          {
            State: {
              Running: running && !stopped,
              Status: stopped ? "exited" : "running",
              ExitCode: exitCode,
            },
          },
        ]),
      };
    if (args[0] === "stop") {
      stopped = true;
      return { stdout: "app-id\n" };
    }
    if (args[0] === "logs") {
      const prefix = args.includes("--timestamps") ? "2026-11-12T05:00:00.000000000Z " : "";
      const prior =
        prefix +
        JSON.stringify({ event: stale ? "server.shutdown_complete" : "server.started" }) +
        "\n";
      return {
        stdout: prior + (stopped && !stale ? prefix + JSON.stringify({ event }) + "\n" : ""),
      };
    }
    if (args.includes("stop")) return { stdout: "" };
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
  return { run, calls };
}

it("requires a completed app shutdown before stopping every remaining writer including the tunnel", async () => {
  const f = dockerFixture();
  await stopUpgradeWriters({ run: f.run, compose: ["compose", "-f", "/box/compose.yml"] });
  const stop = f.calls.findIndex((args) => args[1] === "stop");
  const receipt = f.calls.findLastIndex((args) => args[1] === "logs");
  const all = f.calls.findIndex((args) => args.includes("--profile"));
  expect(stop).toBeGreaterThan(-1);
  expect(receipt).toBeGreaterThan(stop);
  expect(all).toBeGreaterThan(receipt);
  expect(f.calls[all]).toEqual([
    "docker",
    "compose",
    "-f",
    "/box/compose.yml",
    "--profile",
    "staff-tunnel",
    "--profile",
    "practice-inbox",
    "stop",
    "--timeout",
    "10",
  ]);
  expect(f.calls[receipt]).toContain("--timestamps");
});

it.each([
  { event: "server.shutdown_timeout", exitCode: 0 },
  { event: "server.stopped", exitCode: 0 },
  { event: "server.shutdown_complete", exitCode: 1 },
  { event: "server.shutdown_complete", exitCode: 137 },
])("refuses copying for shutdown evidence %j", async (outcome) => {
  const f = dockerFixture(outcome);
  await expect(stopUpgradeWriters({ run: f.run, compose: ["compose"] })).rejects.toThrow(
    "app shutdown incomplete",
  );
  expect(f.calls.some((args) => args.includes("--profile"))).toBe(false);
});

async function imageFixture({
  activeTunnel = false,
  activeInbox,
  stoppedTunnel = false,
  noEnv = false,
  realCompose = false,
  stage = true,
  prepare = true,
  pullFailure = false,
  cleanupFailure = false,
  inUse = false,
  reopenFailure = false,
  serviceChange = false,
  prepareCandidate,
  beforeAutomaticStop,
  writers = false,
  onlineTrial,
  imageConfigs = {},
  onOnlineRun,
  stoppable = Boolean(beforeAutomaticStop),
} = {}) {
  const fs = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { onTestFinished } = await import("vitest");
  const { createUpgradeHost } = await import("./host.mjs");
  const root = await fs.mkdtemp(join(tmpdir(), "upgrade-host-"));
  onTestFinished(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(`${root}.upgrades`, { recursive: true, force: true });
    await fs.rm(`${root}.upgrade-trial`, { recursive: true, force: true });
  });
  const directory = join(`${root}.upgrades`, "attempt");
  await fs.mkdir(prepare ? directory : `${root}.upgrades`, { recursive: true });
  const calls = [];
  const config = {
    name: "waitron",
    services: {
      app: { image: "app:old", environment: { UPGRADE_SETTING: "old" } },
      "print-agent": { image: "agent:old" },
      mailpit: { image: "mail:old" },
      tunnel: { image: "tunnel:dev", profiles: ["staff-tunnel"] },
    },
    volumes: {},
  };
  if (activeInbox !== undefined) config.services.mailpit.profiles = ["practice-inbox"];
  for (const key of ["state", "print_agent", "mailpit", "tunnel_control", "tunnel_keys"]) {
    config.volumes[key] = { name: `waitron_${key}` };
    await fs.mkdir(join(root, key));
  }
  const shipped = await fs.readFile(
    new URL("../../../deploy/compose.yml", import.meta.url),
    "utf8",
  );
  await fs.writeFile(join(root, "compose.yml"), realCompose ? shipped : JSON.stringify(config));
  if (!noEnv) await fs.writeFile(join(root, ".env"), "WAITRON_BOX_SOCKET_DIR=/run/first\n");
  const created = new Set();
  const resolved = new Map();
  const shutdown = stoppable ? dockerFixture() : null;
  let opened = false;
  const run = async (file, args, input, options) => {
    calls.push([file, ...args]);
    if (
      shutdown &&
      (["logs", "stop"].includes(args[0]) ||
        (args[0] === "inspect" && args.length === 2) ||
        (args.includes("ps") && args.at(-1) === "app"))
    )
      return shutdown.run(file, args);
    if (args[0] === "run" && ["capture", "trial"].some((mode) => args.includes(mode))) {
      expect(options.timeout).toBe(180_000);
      const mode = args.includes("capture") ? "capture" : "trial";
      await onOnlineRun?.(mode, args);
      if (onlineTrial === "maxbuffer")
        throw Object.assign(new Error("output limit"), {
          killed: true,
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
          stderr: "too much output",
        });
      if (onlineTrial === "timeout")
        throw Object.assign(new Error("Command failed"), {
          killed: true,
          stderr: "partial diagnostic",
        });
      if (mode === "trial" && onlineTrial === "failed")
        throw new Error("append_only.triggers_changed");
      return {
        stdout:
          onlineTrial === "malformed"
            ? "not-json"
            : JSON.stringify([{ name: mode, ok: onlineTrial !== "refused" }]),
      };
    }
    if (args[0] === "rm") {
      if (onlineTrial === "cleanup") throw new Error("container cleanup refused");
      return { stdout: "" };
    }
    if (args.includes("up")) opened = true;
    if (pullFailure && args[0] === "pull" && resolved.get(args[1]) === "agent:old")
      throw new Error("registry offline");
    if (cleanupFailure && args[0] === "image" && args[1] === "rm")
      throw new Error("cleanup failed");
    if (reopenFailure && args.includes("up") && args.includes("--wait"))
      throw new Error("app exited before healthy");
    if (inUse && args[0] === "image" && args[1] === "rm" && args[2].includes("old-app"))
      throw Object.assign(new Error("image in use"), {
        code: 1,
        stderr: "container selected is using its referenced image",
      });
    if (args[0] === "manifest") {
      const digest =
        "sha256:" + Buffer.from(args.at(-1)).toString("hex").padEnd(64, "0").slice(0, 64);
      resolved.set(args.at(-1).replace(/:[^/:]+$/, "") + "@" + digest, args.at(-1));
      return {
        stdout: JSON.stringify({
          Descriptor: {
            digest,
            platform: { os: "linux", architecture: process.arch === "x64" ? "amd64" : "arm64" },
          },
        }),
      };
    }
    if (args[0] === "volume" && args[1] === "create") {
      created.add(args.at(-1));
      return { stdout: args.at(-1) + "\n" };
    }
    if (
      args[0] === "volume" &&
      args[1] === "inspect" &&
      args[2] === "waitron_tunnel_keys" &&
      !created.has(args[2])
    ) {
      throw new Error("no such volume");
    }
    if (file === "du") return { stdout: "4 /fixture\n" };
    if (args.includes("--format") && args.includes("json")) {
      if (realCompose) {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const result = promisify(execFile)(file, args, { maxBuffer: 1024 * 1024 });
        if (input !== undefined) result.child.stdin.end(input);
        return result;
      }
      return { stdout: input ?? (await fs.readFile(join(root, "compose.yml"), "utf8")) };
    }
    if (args[0] === "volume" && args[1] === "inspect")
      return { stdout: JSON.stringify([{ Mountpoint: join(root, args[2].slice(8)) }]) };
    if (args.includes("ps"))
      return {
        stdout:
          onlineTrial !== undefined && args.at(-1) === "app"
            ? "app-id\n"
            : activeInbox && args.at(-1) === "mailpit"
              ? "inbox-id\n"
              : (activeTunnel || stoppedTunnel) && args.at(-1) === "tunnel"
                ? "tunnel-id\n"
                : writers && args.at(-1) === "-q"
                  ? "app-id\nagent-id\n"
                  : writers && opened && ["app", "print-agent"].includes(args.at(-1))
                    ? args.at(-1) === "app"
                      ? "app-id\n"
                      : "agent-id\n"
                    : "",
      };
    if (args[0] === "inspect")
      return {
        stdout:
          args.at(-1) === "{{.State.Running}}"
            ? String(!stoppedTunnel)
            : args.at(-1) === "{{.Image}}"
              ? "sha256:running-tunnel\n"
              : join(root, "compose.yml") + "\n",
      };
    if (args[0] === "image" && args[1] === "inspect") {
      if (args[2] === "tunnel:dev") throw new Error("tunnel is not installed");
      if (args.at(-1) === "{{json .Config}}")
        return { stdout: imageConfigs[args[2]]?.() ?? '{"Env":["PATH=/usr/bin"],"Labels":null}' };
      return {
        stdout: realCompose
          ? `sha256:${"1".repeat(64)}\n`
          : `sha256:${resolved.get(args[2]) ?? args[2]}\n`,
      };
    }
    if (
      args[0] === "update" ||
      args[0] === "image" ||
      args[0] === "pull" ||
      args.includes("up") ||
      args.includes("stop")
    )
      return { stdout: "" };
    throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
  };
  const candidate = {
    ...config,
    services: {
      ...config.services,
      app: { image: "app:new", environment: { UPGRADE_SETTING: "new" } },
    },
  };
  if (serviceChange) {
    delete candidate.services.mailpit;
    candidate.services.sidecar = { image: "sidecar:new" };
  }
  const f = await createUpgradeHost({
    boxDirectory: root,
    directory,
    candidate: realCompose ? shipped : candidate,
    prepareCandidate: prepareCandidate && (() => prepareCandidate({ candidate, calls })),
    beforeAutomaticStop,
    run,
    checkCandidate: async () => [{ name: "sale", ok: true }],
  });
  const images = prepare ? await f.host.prepareImages() : undefined;
  if (stage && prepare)
    await fs.writeFile(
      join(directory, "candidate-compose.json"),
      JSON.stringify({ compose: realCompose ? shipped : JSON.stringify(candidate) }),
    );
  return { f, root, directory, fs, join, config, candidate, calls, run, images };
}

it("pins all old images before pulling any candidate, and resumes only recorded image IDs", async () => {
  const { f, root, directory, fs, join, calls, images } = await imageFixture();
  expect(calls.findIndex((args) => args[0] === "du")).toBeGreaterThan(
    calls.findLastIndex((args) => args[1] === "pull"),
  );
  expect(
    calls.find(
      (args) =>
        args[1] === "volume" && args[2] === "create" && args.at(-1) === "waitron_tunnel_keys",
    ),
  ).toEqual([
    "docker",
    "volume",
    "create",
    "--label",
    "com.docker.compose.project=waitron",
    "--label",
    "com.docker.compose.volume=tunnel_keys",
    "waitron_tunnel_keys",
  ]);
  const firstPull = calls.findIndex((args) => args[1] === "pull");
  expect(calls.slice(0, firstPull).filter((args) => args[2] === "tag").length).toBe(3);
  expect(images.old).toEqual({
    app: "sha256:app:old",
    "print-agent": "sha256:agent:old",
    mailpit: "sha256:mail:old",
  });
  expect(images.candidate.app).toBe("sha256:app:new");
  await f.host.stop();
  const { DatabaseSync } = await import("node:sqlite");
  const contender = new DatabaseSync(join(root, "state", "recovery.lock"));
  try {
    expect(() => contender.exec("begin immediate")).toThrow(/locked/);
  } finally {
    contender.close();
  }
  await f.host.installCandidate(images.candidate);
  await f.host.resume(images.old);
  const pinned = JSON.parse(await fs.readFile(join(root, "compose.yml"), "utf8"));
  expect(pinned.services.app.image).toBe("sha256:app:old");
  expect(calls.findLast((args) => args.includes("up"))).toEqual([
    "docker",
    "compose",
    "--project-directory",
    root,
    "-f",
    join(root, "compose.yml"),
    "--profile",
    "practice-inbox",
    "up",
    "-d",
    "--pull",
    "never",
    "--remove-orphans",
    "--wait",
    "--wait-timeout",
    "180",
  ]);
  expect(f.paths).toEqual(
    ["state", "print_agent", "mailpit", "tunnel_control", "tunnel_keys", "compose.yml", ".env"].map(
      (key) => join(root, key),
    ),
  );
  await f.host.cleanup(images);
  await expect(fs.access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  expect(calls.filter((args) => args[1] === "image" && args[2] === "rm")).toHaveLength(6);
});

it("pins the stopped source before building local candidates and saves the refreshed candidate configuration", async () => {
  const { f, root, directory, fs, join, images, calls } = await imageFixture({
    stage: false,
    activeTunnel: true,
    prepareCandidate: async ({ candidate, calls }) => {
      expect(calls.filter((args) => args[2] === "tag")).toHaveLength(4);
      return {
        compose: JSON.stringify({
          ...candidate,
          services: {
            ...candidate.services,
            app: { image: "local:new", environment: { UPGRADE_SETTING: "built" } },
          },
        }),
        images: { app: "sha256:local", "print-agent": "sha256:agent", mailpit: "sha256:mail" },
      };
    },
  });
  expect(images.old.app).toBe("sha256:app:old");
  expect(images.candidate).toEqual({
    app: "sha256:local",
    "print-agent": "sha256:agent",
    mailpit: "sha256:mail",
    tunnel: "sha256:running-tunnel",
  });
  expect(calls.some((args) => ["pull", "manifest"].includes(args[1]))).toBe(false);
  await f.host.stop();
  const saved = JSON.parse(await fs.readFile(join(directory, "candidate-compose.json"), "utf8"));
  expect(JSON.parse(saved.compose).services.app.environment).toEqual({ UPGRADE_SETTING: "built" });
  await f.host.installCandidate(images.candidate);
  const installed = JSON.parse(await fs.readFile(join(root, "compose.yml"), "utf8"));
  expect(installed.services.app.image).toBe("sha256:local");
  expect(installed.services.app.environment).toEqual({ UPGRADE_SETTING: "built" });
  await f.host.resume(images.old);
});

it("boot recovery holds a failed manual attempt without Docker, and pins a committed target without removing its copies", async () => {
  const fs = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { onTestFinished } = await import("vitest");
  const { recoverInstalledUpgrade } = await import("./host.mjs");
  const root = await fs.mkdtemp(join(tmpdir(), "upgrade-recovery-"));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const boxDirectory = join(root, "box");
  const directory = join(root, "box.upgrades", "attempt");
  await fs.mkdir(boxDirectory);
  await fs.writeFile(
    join(boxDirectory, "compose.yml"),
    JSON.stringify({ services: { app: { image: "sha256:new" } } }),
  );
  await fs.mkdir(directory, { recursive: true });
  await fs.mkdir(join(directory, "copies"));
  const marker = {
    mode: "manual",
    phase: "awaiting-choice",
    copied: true,
    paths: [join(boxDirectory, "state")],
    images: { old: { app: "sha256:old" }, candidate: { app: "sha256:new" } },
  };
  await fs.writeFile(join(directory, "attempt.json"), JSON.stringify(marker));
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    return { stdout: "inactive\ninactive\n" };
  };
  const { DatabaseSync } = await import("node:sqlite");
  await fs.mkdir(join(boxDirectory, "state"));
  const maintenance = new DatabaseSync(join(boxDirectory, "state", "recovery.lock"));
  maintenance.exec("begin immediate");
  try {
    await expect(recoverInstalledUpgrade({ boxDirectory, offline: true, run })).rejects.toThrow(
      /locked/,
    );
  } finally {
    maintenance.close();
  }
  const held = await recoverInstalledUpgrade({ boxDirectory, offline: true, run });
  const released = new DatabaseSync(join(boxDirectory, "state", "recovery.lock"));
  try {
    expect(() => released.exec("begin immediate")).not.toThrow();
  } finally {
    released.close();
  }
  expect(held.phase).toBe("awaiting-choice");
  expect(calls.every((args) => args[0] !== "docker")).toBe(true);
  await fs.writeFile(
    join(directory, "attempt.json"),
    JSON.stringify({ ...marker, phase: "committed", target: "old" }),
  );
  const committed = await recoverInstalledUpgrade({ boxDirectory, offline: true, run });
  expect(committed.target).toBe("old");
  expect(JSON.parse(await fs.readFile(join(boxDirectory, "compose.yml"), "utf8"))).toEqual({
    services: { app: { image: "sha256:old" } },
  });
  expect(await fs.readdir(directory)).toEqual(["attempt.json", "copies"]);
});

it("holds the existing state and venue lock files and refuses a paired venue before copying", async () => {
  const fs = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const { onTestFinished } = await import("vitest");
  const { holdUpgradeState } = await import("./host.mjs");
  const root = await fs.mkdtemp(join(tmpdir(), "upgrade-locks-"));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(join(root, "venue"));
  const db = new DatabaseSync(join(root, "venue", "venue.db"));
  db.exec("create table nodes (id text); insert into nodes values ('one')");
  db.close();
  const release = await holdUpgradeState(root);
  for (const name of [RECOVERY_LOCK_FILE, `${VENUE_DIR_NAME}/${VENUE_LOCK_FILE}`]) {
    const contender = new DatabaseSync(join(root, name));
    try {
      expect(() => contender.exec("begin immediate")).toThrow(/locked/);
    } finally {
      contender.close();
    }
  }
  release();
  const paired = new DatabaseSync(join(root, "venue", "venue.db"));
  paired.exec("insert into nodes values ('two')");
  paired.close();
  await expect(holdUpgradeState(root)).rejects.toThrow("paired upgrades are not available");
  const history = new DatabaseSync(join(root, "venue", "venue.db"));
  history.exec("create table node_membership (id integer, document text)");
  history
    .prepare("insert into node_membership values (1, ?)")
    .run(JSON.stringify({ body: { nodes: [{ nodeId: "one", standing: "serving-primary" }] } }));
  history.close();
  await fs.writeFile(join(root, "trading.env"), "WAITRON_NODE_ID=one\n");
  const sole = await holdUpgradeState(root);
  sole();
  const local = new DatabaseSync(join(root, "venue", "node.db"));
  local.exec(
    "create table box (node_id text, mode text, singleton_role text); insert into box values ('one', 'mirror', 'secondary')",
  );
  local.close();
  await expect(holdUpgradeState(root)).rejects.toThrow("paired upgrades are not available");
  const released = new DatabaseSync(join(root, "recovery.lock"));
  try {
    expect(() => released.exec("begin immediate")).not.toThrow();
  } finally {
    released.close();
  }
});

it("does not mistake a retained completion from an earlier container run for this shutdown", async () => {
  const f = dockerFixture({ stale: true });
  await expect(stopUpgradeWriters({ run: f.run, compose: ["compose"] })).rejects.toThrow(
    "app shutdown incomplete",
  );
});

it("a fresh Keep retries the saved candidate configuration when installation failed before replacing Compose", async () => {
  const { recoverInstalledUpgrade } = await import("./host.mjs");
  const { root, directory, fs, join, config, run, images, f } = await imageFixture();
  await fs.writeFile(join(root, "compose.yml"), JSON.stringify(config));
  await fs.writeFile(
    join(directory, "attempt.json"),
    JSON.stringify({
      mode: "manual",
      phase: "awaiting-choice",
      copied: true,
      paths: f.paths,
      images,
    }),
  );
  await recoverInstalledUpgrade({ boxDirectory: root, run, choice: "keep" });
  const kept = JSON.parse(await fs.readFile(join(root, "compose.yml"), "utf8"));
  expect(kept.services.app.image).toBe("sha256:app:new");
  expect(kept.services.app.environment).toEqual({ UPGRADE_SETTING: "new" });
});

it("requires room for the intact and disposable copies plus a reserve in the attempt filesystem", async () => {
  const { assertCopyRoom } = await import("./host.mjs");
  const run = async () => ({ stdout: "4 /volumes/state\n8 /box/compose.yml\n" });
  await expect(
    assertCopyRoom(["/volumes/state", "/box/compose.yml"], "/attempts", {
      run,
      statfs: async () => ({ bavail: 4099n, bsize: 4096n }),
    }),
  ).rejects.toThrow("not enough room for the upgrade copy");
  await expect(
    assertCopyRoom(["/volumes/state", "/box/compose.yml"], "/attempts", {
      run,
      statfs: async () => ({ bavail: 4102n, bsize: 4096n }),
    }),
  ).resolves.toBeUndefined();
});

it("retains the active tunnel's exact running image without trying its local-only tag in a registry", async () => {
  const { f, images, calls } = await imageFixture({ activeTunnel: true });
  await f.host.resume(images.old);
  expect(calls.find((args) => args.includes("up"))).toContain("staff-tunnel");
  expect(images.old.tunnel).toBe("sha256:running-tunnel");
  expect(images.candidate.tunnel).toBe("sha256:running-tunnel");
  expect(calls.some((args) => args[1] === "pull" && args[2] === "tunnel:dev")).toBe(false);
});

it.each(["absent", "stopped", "running"])(
  "installs the new default companion when the old companion was %s",
  async (old) => {
    const { f, images, fs, join, root } = await imageFixture({
      activeTunnel: old === "running",
      stoppedTunnel: old === "stopped",
      prepareCandidate: ({ candidate }) => {
        candidate.services.tunnel = { image: "tunnel:new" };
        return { compose: JSON.stringify(candidate), images: { tunnel: "sha256:new-tunnel" } };
      },
    });
    expect(images.old.tunnel).toBe(old === "running" ? "sha256:running-tunnel" : undefined);
    expect(images.candidate.tunnel).toBe("sha256:new-tunnel");
    await f.host.installCandidate(images.candidate);
    const compose = JSON.parse(await fs.readFile(join(root, "compose.yml"), "utf8"));
    expect(compose.services.tunnel.image).toBe("sha256:new-tunnel");
  },
);

it("removes the interrupted staff socket before copying and keeps the saved peer", async () => {
  const { execFileSync } = await import("node:child_process");
  const { f, root, fs, join } = await imageFixture();
  const { copyStoppedTree } = await import("./copy.mjs");
  const control = join(root, "tunnel_control");
  const socket = join(control, "staff.sock");
  const peer = join(control, "peer.json");
  await fs.writeFile(peer, "saved peer");
  execFileSync(process.execPath, [
    "-e",
    "require('node:net').createServer().listen(process.argv[1], () => process.exit(0))",
    socket,
  ]);
  expect((await fs.lstat(socket)).isSocket()).toBe(true);
  await f.host.stop();
  try {
    await expect(fs.lstat(socket)).rejects.toMatchObject({ code: "ENOENT" });
    const snapshot = join(root, "snapshot");
    await copyStoppedTree(control, snapshot);
    expect(await fs.readFile(join(snapshot, "peer.json"), "utf8")).toBe("saved peer");
  } finally {
    await f.host.resume({ app: "sha256:old" });
  }
});

it("captures an installed box without an optional .env without inventing one", async () => {
  const { f, root, fs, join } = await imageFixture({ noEnv: true });
  expect(f.paths).not.toContain(join(root, ".env"));
  await expect(fs.access(join(root, ".env"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["missing", "unreadable"])(
  "refuses Keep when the saved candidate Compose is %s",
  async (kind) => {
    const { recoverInstalledUpgrade } = await import("./host.mjs");
    const { root, directory, fs, join, run, images, f } = await imageFixture();
    const before = await fs.readFile(join(root, "compose.yml"), "utf8");
    await fs.writeFile(
      join(directory, "attempt.json"),
      JSON.stringify({
        mode: "manual",
        phase: "awaiting-choice",
        copied: true,
        paths: f.paths,
        images,
      }),
    );
    const saved = join(directory, "candidate-compose.json");
    if (kind === "missing") await fs.rm(saved);
    else await fs.writeFile(saved, "{");
    await expect(
      recoverInstalledUpgrade({ boxDirectory: root, run, choice: "keep" }),
    ).rejects.toThrow("saved candidate Compose is missing or unreadable");
    expect(await fs.readFile(join(root, "compose.yml"), "utf8")).toBe(before);
    expect(JSON.parse(await fs.readFile(join(directory, "attempt.json"), "utf8")).phase).toBe(
      "awaiting-choice",
    );
  },
);

it("construction and image preparation leave installed Compose unchanged and stage nothing before the marker", async () => {
  const { root, directory, fs, join, config } = await imageFixture({ stage: false });
  expect(await fs.readFile(join(root, "compose.yml"), "utf8")).toBe(JSON.stringify(config));
  await expect(fs.access(join(directory, "candidate-compose.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("accepts the real shipped Compose, retains tunnel inventory and keeps socket interpolation on install", async () => {
  const { f, root, fs, join, images, run } = await imageFixture({
    realCompose: true,
    stage: false,
  });
  await f.host.stop();
  await f.host.installCandidate(images.candidate);
  await f.host.resume(images.candidate);
  await fs.writeFile(join(root, ".env"), "WAITRON_BOX_SOCKET_DIR=/run/second\n");
  const { stdout } = await run("docker", [
    "compose",
    "--profile",
    "staff-tunnel",
    "--project-directory",
    root,
    "-f",
    join(root, "compose.yml"),
    "config",
    "--format",
    "json",
  ]);
  const config = JSON.parse(stdout);
  expect(config.services.app.volumes).toContainEqual(
    expect.objectContaining({ type: "bind", source: "/run/second", target: "/run/waitron-box" }),
  );
  expect(config.services.tunnel).toBeDefined();
  expect(config.volumes.tunnel_keys.name).toBe("waitron_tunnel_keys");
});

it("pulls and pins the candidate service set when a release adds or removes a service", async () => {
  const { images, calls } = await imageFixture({ serviceChange: true });
  expect(images.old.mailpit).toBe("sha256:mail:old");
  expect(images.candidate).not.toHaveProperty("mailpit");
  expect(images.candidate.sidecar).toBe("sha256:sidecar:new");
  expect(calls.some((args) => args[1] === "pull" && args[2].startsWith("sidecar@sha256:"))).toBe(
    true,
  );
});

it("attempts every preparation tag cleanup and preserves the registry error if cleanup also fails", async () => {
  const { applyUpgrade } = await import("./transaction.mjs");
  const { f, directory, fs, calls } = await imageFixture({
    prepare: false,
    pullFailure: true,
    cleanupFailure: true,
  });
  await expect(
    applyUpgrade({ directory, paths: f.paths, host: f.host, mode: "manual" }),
  ).rejects.toThrow("registry offline");
  await expect(fs.access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  expect(calls.filter((args) => args[1] === "image" && args[2] === "rm")).toHaveLength(4);
});

it("finishes cleanup while retaining the selected image's last in-use tag", async () => {
  const { f, directory, fs, images } = await imageFixture({ inUse: true });
  await f.host.cleanup(images);
  await expect(fs.access(directory)).rejects.toMatchObject({ code: "ENOENT" });
});

it("retains the committed attempt and copies when the selected app exits before becoming healthy", async () => {
  const { recoverInstalledUpgrade } = await import("./host.mjs");
  const { root, directory, fs, join, run, images, f } = await imageFixture({ reopenFailure: true });
  await fs.mkdir(join(directory, "copies"));
  await fs.writeFile(join(directory, "copies", "old"), "retained state");
  await fs.writeFile(
    join(directory, "attempt.json"),
    JSON.stringify({
      mode: "manual",
      phase: "committed",
      target: "candidate",
      copied: true,
      paths: f.paths,
      images,
    }),
  );
  await expect(recoverInstalledUpgrade({ boxDirectory: root, run })).rejects.toThrow(
    "app exited before healthy",
  );
  expect(await fs.readFile(join(directory, "copies", "old"), "utf8")).toBe("retained state");
  expect(JSON.parse(await fs.readFile(join(directory, "attempt.json"), "utf8")).phase).toBe(
    "committed",
  );
});

it("allows a source already stopped before a manual repair, after stopping the other writers", async () => {
  const f = dockerFixture({ running: false });
  await stopUpgradeWriters({ run: f.run, compose: ["compose"] });
  expect(f.calls.some((args) => args.includes("--profile"))).toBe(true);
  expect(f.calls.some((args) => args[1] === "stop")).toBe(false);
});

it("refuses an unsupported installed Compose layout before any pull or stop", async () => {
  const { f, root, fs, join, calls } = await imageFixture({ prepare: false });
  await fs.writeFile(join(root, "compose.yml"), "services: { app: { image: app:old } }\n");
  await expect(f.host.prepareImages()).rejects.toThrow("unsupported Compose image layout");
  expect(calls.some((args) => args[1] === "pull" || args[1] === "stop")).toBe(false);
});

it("pulls digest references without moving the installed tags", async () => {
  const { calls } = await imageFixture();
  const pulls = calls.filter((args) => args[1] === "pull");
  expect(pulls).toHaveLength(3);
  expect(pulls.every((args) => args[2].includes("@sha256:"))).toBe(true);
});

it("keeps an already-stopped tunnel off when reopening", async () => {
  const { f, images, calls } = await imageFixture({ stoppedTunnel: true });
  expect(images.old).not.toHaveProperty("tunnel");
  await f.host.resume(images.old);
  expect(calls.find((args) => args.includes("up"))).not.toContain("staff-tunnel");
});

it("relays only the real clock status line and refuses a clock change without contacting the host", async () => {
  const { createServer, createConnection } = await import("node:net");
  const { clockStatusRelay } = await import("./host.mjs");
  const { root, fs, join } = await imageFixture({ prepare: false });
  const source = join(root, "host.sock");
  const received = [];
  const realReply =
    '{"ok":true,"service":"on","unit":"chrony.service","synchronised":false,"lastSyncAt":null}\n';
  const upstream = createServer((socket) =>
    socket.on("data", (bytes) => {
      received.push(bytes.toString());
      socket.end(realReply);
    }),
  );
  await new Promise((done) => upstream.listen(source, done));
  let relay;
  try {
    relay = await clockStatusRelay({ directory: join(root, "relay"), socketPath: source });
    const exchange = (line) =>
      new Promise((done, reject) => {
        const socket = createConnection(join(root, "relay", "box.sock"));
        let reply = "";
        socket.on("connect", () => socket.write(line));
        socket.on("data", (bytes) => {
          reply += bytes.toString();
        });
        socket.on("end", () => done(reply));
        socket.on("error", reject);
      });
    expect(await exchange("clock.status\n")).toBe(realReply);
    expect(await exchange('clock.set {"targetMs":1}\n')).toBe(
      '{"ok":false,"reason":"forbidden"}\n',
    );
    expect(received).toEqual(["clock.status\n"]);
    expect((await fs.stat(join(root, "relay", "box.sock"))).mode & 0o777).toBe(0o666);
  } finally {
    await relay?.close();
    await new Promise((done) => upstream.close(done));
  }
});

describe("the clock relay told to answer synchronised", () => {
  const LINE =
    "The upgrade's checks were told that the box's time is synchronised; its time service did not say so.\n";
  const reply = (synchronised) =>
    `{"ok":true,"service":"on","unit":"chrony.service","synchronised":${synchronised},"lastSyncAt":null,"nowMs":1795420800000}\n`;

  async function relayed({ answer, host = answer !== undefined, ...told }) {
    const root = await mkdtemp(join(tmpdir(), "upgrade-relay-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const log = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    onTestFinished(() => log.mockRestore());
    const source = join(root, "host.sock");
    const received = [];
    const connections = new Set();
    if (host) {
      const upstream = createServer((socket) => {
        connections.add(socket);
        socket.on("error", () => {});
        socket.on("data", (bytes) => {
          received.push(bytes.toString());
          answer?.(socket);
        });
      });
      await new Promise((done) => upstream.listen(source, done));
      onTestFinished(async () => {
        for (const socket of connections) socket.destroy();
        await new Promise((done) => upstream.close(done));
      });
    }
    const { clockStatusRelay } = await import("./host.mjs");
    const relay = await clockStatusRelay({
      directory: join(root, "relay"),
      socketPath: source,
      answerSynchronised: true,
      ...told,
    });
    onTestFinished(() => relay.close().catch(() => {}));
    const socketPath = join(root, "relay", "box.sock");
    const exchange = (line) =>
      new Promise((done, reject) => {
        const socket = createConnection(socketPath);
        let text = "";
        socket.on("connect", () => socket.write(line));
        socket.on("data", (bytes) => {
          text += bytes.toString();
        });
        socket.on("end", () => done(text));
        socket.on("error", reject);
      });
    const lines = () => log.mock.calls.map(([text]) => text);
    return { relay, received, exchange, lines, client: boxHostClient({ socketPath }) };
  }

  it.each([
    ["answers not synchronised", (socket) => socket.end(reply(false))],
    ["refuses", (socket) => socket.end('{"ok":false,"reason":"host_failed"}\n')],
    [
      "says synchronised in a refusal",
      (socket) => socket.end('{"ok":false,"synchronised":true}\n'),
    ],
    ["answers something else", (socket) => socket.end('"synchronised":true\n')],
    ["answers null", (socket) => socket.end("null\n")],
    ["names the flag as text", (socket) => socket.end(reply('"true"'))],
    ["answers part of a line", (socket) => socket.end(reply(true).slice(0, -1))],
    ["answers too much", (socket) => socket.end(" ".repeat(5000))],
    ["hangs up", (socket) => socket.end()],
    ["never answers", () => {}],
    ["is not there", undefined],
  ])(
    "tells the copy its time is synchronised, and says so once, when the host %s",
    async (_, answer) => {
      const t = await relayed({ answer });
      for (let read = 0; read < 2; read += 1)
        expect(await t.client.clockStatus()).toEqual({
          available: true,
          service: "on",
          unit: null,
          synchronised: true,
          lastSyncAt: null,
        });
      expect(t.received).toEqual(answer ? ["clock.status\n", "clock.status\n"] : []);
      expect(t.lines()).toEqual([LINE]);
    },
  );

  it("passes a synchronised host's own answer on unchanged, and writes nothing", async () => {
    const t = await relayed({ answer: (socket) => socket.end(reply(true)) });
    expect(await t.exchange("clock.status\n")).toBe(reply(true));
    expect(t.received).toEqual(["clock.status\n"]);
    expect(t.lines()).toEqual([]);
  });

  it.each([
    'clock.set {"targetMs":1}\n',
    "clock.sync-on\n",
    "clock.retry\n",
    "clock.status\nclock.retry\n",
    "upgrade.status\n",
  ])("refuses %j without contacting the host", async (line) => {
    const t = await relayed({ answer: (socket) => socket.end(reply(false)) });
    expect(await t.exchange(line)).toBe('{"ok":false,"reason":"forbidden"}\n');
    expect(t.received).toEqual([]);
    expect(t.lines()).toEqual([]);
  });

  it("passes the host's own answer on, and writes nothing, without the option", async () => {
    const t = await relayed({
      answer: (socket) => socket.end(reply(false)),
      answerSynchronised: undefined,
    });
    expect(await t.exchange("clock.status\n")).toBe(reply(false));
    expect(t.lines()).toEqual([]);
  });

  it("cuts no host short without the option", async () => {
    const t = await relayed({ answer: () => {}, answerSynchronised: undefined });
    expect(await t.client.clockStatus()).toMatchObject({ available: false, reason: "timeout" });
  });

  it("answers two reads at once", async () => {
    const t = await relayed({ answer: (socket) => socket.end(reply(false)) });
    const answers = await Promise.all([t.client.clockStatus(), t.client.clockStatus()]);
    expect(answers.map(({ synchronised }) => synchronised)).toEqual([true, true]);
    expect(t.lines()).toEqual([LINE]);
  });

  it("writes nothing for a copy that stopped waiting", async () => {
    let asked;
    const waiting = new Promise((done) => {
      asked = done;
    });
    const t = await relayed({ answer: (socket) => asked(socket) });
    const answered = t.exchange("clock.status\n");
    const host = await waiting;
    const left = once(host, "close");
    await t.relay.close();
    expect(await answered).toBe("");
    await left;
    await delay(200);
    expect(t.lines()).toEqual([]);
  });
});

it.each([false, true])(
  "disables container restart before the marker and restores policies on reopen (%s)",
  async (realCompose) => {
    const t = await imageFixture({
      realCompose,
      writers: true,
      stoppedTunnel: true,
      prepare: false,
      stage: false,
    });
    const path = t.join(t.root, "compose.yml");
    if (!realCompose) {
      for (const service of Object.values(t.config.services)) service.restart = "unless-stopped";
      await t.fs.writeFile(path, JSON.stringify(t.config));
    }
    const original = await t.fs.readFile(path, "utf8");
    const images = await t.f.host.prepareImages();
    expect(t.calls).toContainEqual(["docker", "update", "--restart=no", "app-id", "agent-id"]);
    expect(await t.fs.readFile(path, "utf8")).toBe(original);
    await t.f.host.resume(images.old);
    expect(t.calls).toContainEqual(["docker", "update", "--restart=unless-stopped", "app-id"]);
    expect(t.calls).toContainEqual(["docker", "update", "--restart=unless-stopped", "agent-id"]);
    expect(t.calls).toContainEqual(["docker", "update", "--restart=unless-stopped", "tunnel-id"]);
    if (realCompose) expect(images.old.tunnel).toBe("sha256:running-tunnel");
    else expect(t.calls.findLast((args) => args.includes("up"))).not.toContain("staff-tunnel");
    expect(t.calls.findIndex((args) => args.includes("--restart=unless-stopped"))).toBeLessThan(
      t.calls.findLastIndex((args) => args.includes("--wait")),
    );
    const resolved = JSON.parse(
      (await t.run("docker", ["compose", "-f", path, "config", "--format", "json"])).stdout,
    );
    for (const service of Object.values(resolved.services))
      expect(service.restart).toBe("unless-stopped");
  },
);

it("routes Apply through the host controller and retains a refused copy sale", async () => {
  const { runUpgradeCli } = await import("./cli.mjs");
  const f = await imageFixture({ prepare: false });
  const stateFile = f.join(f.root, "state", "retained");
  await f.fs.writeFile(stateFile, "intact source");
  f.candidate.services["print-agent"].healthcheck = { test: ["CMD", "true"] };
  const run = async (file, args, input) => {
    if (file === "prepare-fixture") {
      expect(args).toEqual(["candidate-ref"]);
      return { stdout: JSON.stringify({ compose: JSON.stringify(f.candidate) }) };
    }
    if (args[0] === "inspect" && !args.includes("--format"))
      return {
        stdout: JSON.stringify([{ State: { Running: true, Health: { Status: "healthy" } } }]),
      };
    if (args[0] === "run" && args.includes("readiness"))
      return { stdout: '[{"name":"readiness","ok":true}]\n' };
    if (args[0] === "exec") {
      if (args.includes("sale")) throw new Error("sale refused");
      return { stdout: "" };
    }
    if (args[0] === "run" || args[0] === "rm" || args[0] === "stop") return { stdout: "" };
    return f.run(file, args, input);
  };
  const result = await runUpgradeCli(["apply", f.root, "prepare-fixture", "candidate-ref"], {
    run,
  });
  expect(result).toMatchObject({ phase: "awaiting-choice", copied: true, failure: "sale refused" });
  expect(result).not.toHaveProperty("versions");
  const directory = f.join(`${f.root}.upgrades`, (await f.fs.readdir(`${f.root}.upgrades`))[0]);
  expect(await f.fs.readFile(f.join(directory, "copies/0/retained"), "utf8")).toBe("intact source");
});

it.each(["restore", "keep"])(
  "routes the CLI %s choice through the retained host attempt",
  async (verb) => {
    const { runUpgradeCli } = await import("./cli.mjs");
    const { copyStoppedTree } = await import("./copy.mjs");
    const { f, root, directory, fs, join, images, run: hostRun, calls } = await imageFixture();
    const original = "original state";
    await fs.writeFile(join(root, "state", "retained"), original);
    await fs.mkdir(join(directory, "copies"));
    for (const [index, path] of f.paths.entries())
      await copyStoppedTree(path, join(directory, "copies", String(index)));
    await fs.writeFile(join(root, "state", "retained"), "candidate state");
    await fs.mkdir(join(directory, "check"));
    await fs.writeFile(
      join(directory, "attempt.json"),
      JSON.stringify({
        mode: "manual",
        phase: "awaiting-choice",
        copied: true,
        paths: f.paths,
        images,
      }),
    );
    const removed = [];
    const run = async (file, args, input) => {
      if (args[0] === "inspect" && args[2]?.includes("Config.Labels")) {
        if (args.at(-1).endsWith("-agent")) return { stdout: directory };
        throw Object.assign(new Error("missing"), { code: 1, stderr: "No such container" });
      }
      if (args[0] === "rm") {
        removed.push(args);
        return { stdout: "" };
      }
      if (args.includes("up"))
        await expect(fs.access(join(directory, "check"))).rejects.toMatchObject({ code: "ENOENT" });
      return hostRun(file, args, input);
    };
    const result = await runUpgradeCli([verb, root], { run });
    expect(result).toMatchObject({
      phase: "committed",
      target: verb === "restore" ? "old" : "candidate",
    });
    expect(removed).toEqual([["rm", "--force", expect.stringMatching(/-agent$/)]]);
    const installed = JSON.parse(await fs.readFile(join(root, "compose.yml"), "utf8"));
    expect(installed.services.app.image).toBe(images[verb === "restore" ? "old" : "candidate"].app);
    expect(await fs.readFile(join(root, "state", "retained"), "utf8")).toBe(
      verb === "restore" ? original : "candidate state",
    );
    await expect(fs.access(join(directory, "check"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls.some((args) => args.includes("up") && args.includes("--wait"))).toBe(true);
  },
);

it.each([true, false])(
  "adds an explicit inbox profile when captured as running (%s)",
  async (activeInbox) => {
    const { f, images, calls } = await imageFixture({ activeInbox });
    await f.host.stop();
    await f.host.resume(images.old);
    expect(calls.at(-1).includes("practice-inbox")).toBe(activeInbox);
    const configs = calls.filter((args) => args.includes("config"));
    expect(configs.every((args) => args.includes("practice-inbox") || args.includes("*"))).toBe(
      true,
    );
  },
);

it("runs a networkless read-only online capture and copy-only trial before disabling restart", async () => {
  const t = await imageFixture({ prepare: false, onlineTrial: "pass", writers: true });
  const leftover = `${t.root}.upgrade-trial`;
  await t.fs.mkdir(leftover);
  await t.fs.writeFile(t.join(leftover, "leftover"), "old copy");
  const images = await t.f.host.prepareImages();
  const capture = t.calls.find((args) => args.includes("capture"));
  const trial = t.calls.find((args) => args.includes("trial"));
  expect(capture).toContain(
    `type=bind,src=${t.join(t.root, "state")},dst=/var/lib/waitron/state,readonly`,
  );
  expect(capture).toContain(images.candidate.app);
  expect(capture).toContain("--init");
  expect(trial).toContain("--init");
  expect(capture.slice(capture.indexOf("--network"), capture.indexOf("--network") + 2)).toEqual([
    "--network",
    "none",
  ]);
  expect(trial).toContain(`type=bind,src=${t.join(leftover, "state")},dst=/var/lib/waitron/state`);
  expect(trial.some((arg) => arg.includes(`src=${t.join(t.root, "state")},`))).toBe(false);
  expect(trial).toContain(images.candidate.app);
  expect(t.calls.indexOf(trial)).toBeLessThan(
    t.calls.findIndex((args) => args.includes("--restart=no")),
  );
  expect(t.calls.some((args) => args.includes("sale"))).toBe(false);
  expect(t.calls.filter((args) => args[1] === "rm")).toHaveLength(2);
  await expect(t.fs.access(leftover)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["failed", "malformed"])(
  "aborts %s online advice before any writer stops or installed file changes",
  async (onlineTrial) => {
    const t = await imageFixture({ prepare: false, onlineTrial, writers: true });
    const before = await t.fs.readFile(t.join(t.root, "compose.yml"), "utf8");
    await expect(t.f.host.prepareImages()).rejects.toThrow(
      /online.*(append_only.triggers_changed|capture).*selling version and its data are unchanged/i,
    );
    expect(t.calls.some((args) => args.includes("--restart=no") || args[1] === "stop")).toBe(false);
    expect(await t.fs.readFile(t.join(t.root, "compose.yml"), "utf8")).toBe(before);
    await expect(t.fs.access(`${t.root}.upgrade-trial`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(t.calls.some((args) => args[1] === "rm")).toBe(true);
  },
);

it("names a timed-out capture rather than presenting its partial log as the failed check", async () => {
  const t = await imageFixture({ prepare: false, onlineTrial: "timeout" });
  await expect(t.f.host.prepareImages()).rejects.toThrow(
    "Online migration capture failed: timed out after 180 seconds; the selling version and its data are unchanged",
  );
});

it.each([undefined, null])("accepts an absent Compose environment (%s)", async (environment) => {
  const { upgradeEnvironment } = await import("./host.mjs");
  expect(upgradeEnvironment(environment)).toBe("\n");
});

it("reports an output limit as output failure rather than a timeout", async () => {
  const t = await imageFixture({ prepare: false, onlineTrial: "maxbuffer" });
  await expect(t.f.host.prepareImages()).rejects.toThrow(
    "Online migration capture failed: too much output; the selling version and its data are unchanged",
  );
});

it.each([
  ["refused", "missing or failed check report"],
  ["cleanup", "container cleanup refused"],
])(
  "keeps the source running when %s invalidates online preparation",
  async (onlineTrial, detail) => {
    const t = await imageFixture({ prepare: false, onlineTrial, writers: true });
    const before = await t.fs.readFile(t.join(t.root, "compose.yml"), "utf8");
    await expect(t.f.host.prepareImages()).rejects.toThrow(detail);
    expect(t.calls.some((args) => args.includes("--restart=no") || args[1] === "stop")).toBe(false);
    expect(await t.fs.readFile(t.join(t.root, "compose.yml"), "utf8")).toBe(before);
    await expect(t.fs.access(`${t.root}.upgrade-trial`)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("rejects a multiline environment value before it can introduce another variable", async () => {
  const { upgradeEnvironment } = await import("./host.mjs");
  expect(() => upgradeEnvironment({ VALUE: "first\nOTHER=value" })).toThrow("multiline");
});

it("surfaces an unreadable saved box ID through the read-only state mount lookup", async () => {
  const { installedBoxId } = await import("./host.mjs");
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { onTestFinished } = await import("vitest");
  const root = await mkdtemp(join(tmpdir(), "upgrade-box-id-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "trading.env"));
  await expect(
    installedBoxId(root, async (_file, args) => {
      if (args.includes("config"))
        return { stdout: '{"volumes":{"state":{"name":"existing_state"}}}' };
      if (args.join(" ") === "volume inspect existing_state")
        return { stdout: JSON.stringify([{ Mountpoint: root }]) };
      throw new Error(`unexpected Docker command: ${args.join(" ")}`);
    }),
  ).rejects.toMatchObject({ code: "EISDIR" });
});

describe("the installed venue time zone", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it.each([" Europe/Madrid ", undefined])(
    "reads the stored spelling or missing row: %j",
    async (timeZone) => {
      const state = await mkdtemp(join(tmpdir(), "upgrade-venue-zone-"));
      onTestFinished(() => rm(state, { recursive: true, force: true }));
      await mkdir(join(state, "venue"));
      if (timeZone !== undefined) {
        await withTransaction(suite.db, (tx) =>
          saveSettings(tx, BUSINESS_DAY_SETTINGS, {
            doc: { timeZone },
            expectedRevision: 0,
            personId: null,
          }),
        );
      }
      await suite.db.archiveTo(join(state, "venue/venue.db"));
      const run = async (file, args) => {
        if (file === "docker" && args.includes("config"))
          return { stdout: '{"volumes":{"state":{"name":"venue_state"}}}' };
        if (file === "docker" && args.join(" ") === "volume inspect venue_state")
          return { stdout: JSON.stringify([{ Mountpoint: state }]) };
        throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
      };
      expect(await installedVenueTimeZone(state, run)).toBe(timeZone);
    },
  );
});

describe("the note of a change of producer", () => {
  const imageConfig = (ref, ...env) =>
    JSON.stringify({
      Env: ["PATH=/usr/bin", "WAITRON_PRODUCER_NAME=Producer", ...env, "NODE_ENV=production"],
      Labels: { "org.opencontainers.image.ref.name": ref },
    });
  const producer = (taxId) => `WAITRON_PRODUCER_TAX_ID=${taxId}`;
  const FROM = "B00000001";
  const TO = "B00000002";
  const OLD = imageConfig("v1.3.0", producer(FROM));
  const NEXT = imageConfig("v1.4.0", producer(TO));
  const NOTE = {
    version: 1,
    release: "1.4.0",
    producerTaxId: TO,
    fromProducerTaxId: FROM,
  };

  async function upgrade({ old = OLD, next = NEXT, onRun, live, beforeStop } = {}) {
    const seen = {};
    const t = await imageFixture({
      prepare: false,
      onlineTrial: "pass",
      stoppable: true,
      imageConfigs: {
        // The id this fixture gives the image of any running container.
        "sha256:running-tunnel": typeof old === "function" ? old : () => old,
        "sha256:app:new": typeof next === "function" ? next : () => next,
      },
      onOnlineRun: async (mode, args) => {
        const copy = args
          .find((arg) => arg.startsWith("type=bind,") && !arg.endsWith(",readonly"))
          .match(/src=([^,]+),/)[1];
        await onRun?.(mode, copy);
        seen[mode] = {
          args,
          environment: await readFile(args[args.indexOf("--env-file") + 1], "utf8"),
          names: await readdir(copy),
        };
        if (mode === "capture" || !seen[mode].names.includes(IDENTITY_CHANGE_FILE)) return;
        const path = join(copy, IDENTITY_CHANGE_FILE);
        const entry = await lstat(path);
        seen[mode].note = JSON.parse(await readFile(path, "utf8"));
        seen[mode].read = await readIdentityChangeNote(copy);
        seen[mode].regularFile = entry.isFile();
        seen[mode].mode = entry.mode & 0o777;
        seen[mode].owner = { uid: entry.uid, gid: entry.gid };
        const folder = await stat(copy);
        seen[mode].folder = { uid: folder.uid, gid: folder.gid };
      },
    });
    const livePath = join(t.root, "state", IDENTITY_CHANGE_FILE);
    if (typeof live === "function") await live(livePath);
    else if (live !== undefined) await writeFile(livePath, live);
    const images = await t.f.host.prepareImages();
    await beforeStop?.(livePath);
    await mkdir(t.directory, { recursive: true });
    await t.f.host.stop();
    onTestFinished(() => t.f.host.resume(images.old));
    return { ...t, images, seen, livePath };
  }

  it("gives a release by another producer the note, in the trial's copy and the attempt", async () => {
    const t = await upgrade();
    expect(t.seen.capture.names).toEqual([]);
    expect(t.seen.trial.note).toEqual(NOTE);
    expect(t.seen.trial.read).toEqual({
      release: "1.4.0",
      producerTaxId: TO,
      fromProducerTaxId: FROM,
    });
    expect(JSON.parse(await readFile(join(t.directory, IDENTITY_CHANGE_FILE), "utf8"))).toEqual(
      NOTE,
    );
    expect(await readIdentityChangeNote(t.directory)).toEqual(t.seen.trial.read);
    expect(await readdir(join(t.root, "state"))).not.toContain(IDENTITY_CHANGE_FILE);
    expect((await readdir(t.directory)).sort()).toEqual([
      "candidate-compose.json",
      IDENTITY_CHANGE_FILE,
    ]);
  });

  it("reads the producers from the two images' own configuration", async () => {
    const t = await upgrade();
    expect(t.calls.filter((args) => args.at(-1) === "{{json .Config}}")).toEqual(
      [t.images.old.app, t.images.candidate.app].map((id) => [
        "docker",
        "image",
        "inspect",
        id,
        "--format",
        "{{json .Config}}",
      ]),
    );
  });

  it("gives the trial's note the copy's owner, and nobody else access", async () => {
    const probe = await open(join(tmpdir(), "."), "r");
    const chown = vi.spyOn(Object.getPrototypeOf(probe), "chown");
    onTestFinished(() => chown.mockRestore());
    await probe.close();
    let chowned;
    const t = await upgrade({
      onRun: async (mode) => {
        if (mode === "trial") chowned = [...chown.mock.calls];
      },
    });
    const { trial } = t.seen;
    expect(trial.owner).toEqual(trial.folder);
    expect(trial.mode).toBe(0o600);
    expect(chowned).toEqual([[trial.folder.uid, trial.folder.gid]]);
  });

  it("does not write through a link the captured copy holds under the note's names", async () => {
    const outside = await mkdtemp(join(tmpdir(), "upgrade-note-outside-"));
    onTestFinished(() => rm(outside, { recursive: true, force: true }));
    const kept = join(outside, "kept");
    await writeFile(kept, "kept");
    const t = await upgrade({
      onRun: async (mode, copy) => {
        if (mode !== "capture") return;
        await symlink(kept, join(copy, IDENTITY_CHANGE_FILE));
        await symlink(kept, join(copy, `${IDENTITY_CHANGE_FILE}.tmp`));
      },
    });
    expect(await readFile(kept, "utf8")).toBe("kept");
    expect(t.seen.trial.regularFile).toBe(true);
    expect(t.seen.trial.note).toEqual(NOTE);
    expect(t.seen.trial.names).toEqual([IDENTITY_CHANGE_FILE]);
  });

  it("keeps the trial without a network or a clock relay", async () => {
    const { args } = (await upgrade()).seen.trial;
    expect(args[args.indexOf("--network") + 1]).toBe("none");
    expect(args.filter((arg) => arg === "--mount")).toHaveLength(1);
    expect(args.some((arg) => arg.includes("/run/waitron-box"))).toBe(false);
  });

  it.each([
    ["the same producer", { next: imageConfig("v1.4.0", producer(FROM)) }],
    [
      "a producer differing only in the spaces around it",
      { next: imageConfig("v1.4.0", producer(` ${FROM} `)) },
    ],
    ["a candidate built from main", { next: imageConfig("main", producer(TO)) }],
    ["a candidate whose label has no v", { next: imageConfig("1.4.0", producer(TO)) }],
    ["a candidate from a branch named like a release", { next: imageConfig("v1.4", producer(TO)) }],
    ["a candidate with no label", { next: imageConfig(undefined, producer(TO)) }],
    ["a candidate with no labels", { next: JSON.stringify({ Env: [producer(TO)] }) }],
    ["a candidate naming no producer", { next: imageConfig("v1.4.0") }],
    ["a candidate naming an empty producer", { next: imageConfig("v1.4.0", producer("")) }],
    ["a candidate naming a blank producer", { next: imageConfig("v1.4.0", producer("  ")) }],
    ["an old image naming no producer", { old: imageConfig("v1.3.0") }],
    ["an old image naming an empty producer", { old: imageConfig("v1.3.0", producer("")) }],
    ["an old image with no environment", { old: JSON.stringify({ Env: null, Labels: null }) }],
  ])("writes no note for %s", async (_case, configs) => {
    const t = await upgrade(configs);
    expect(t.seen.trial.names).toEqual([]);
    expect(await readdir(t.directory)).toEqual(["candidate-compose.json"]);
  });

  const OLD_UNREADABLE = /^installed image has an unreadable configuration$/;
  const NEXT_UNREADABLE = /^candidate image has an unreadable configuration$/;
  const refusedInspect = () => {
    throw new Error("No such image");
  };
  it.each([
    ["an old image's answer that is not JSON", { old: "not json" }, OLD_UNREADABLE],
    ["a candidate's answer that is not JSON", { next: "not json" }, NEXT_UNREADABLE],
    ["an old image's answer that is null", { old: "null" }, OLD_UNREADABLE],
    ["a candidate's answer that is null", { next: "null" }, NEXT_UNREADABLE],
    ["an old image's environment that is no list", { old: '{"Env":"x"}' }, OLD_UNREADABLE],
    ["a candidate's environment that is no list", { next: '{"Env":"x"}' }, NEXT_UNREADABLE],
    ["a refused inspect of the old image", { old: refusedInspect }, "No such image"],
    ["a refused inspect of the candidate", { next: refusedInspect }, "No such image"],
  ])("abandons the upgrade before any stop for %s", async (_case, configs, failure) => {
    const t = await imageFixture({
      prepare: false,
      onlineTrial: "pass",
      writers: true,
      imageConfigs: {
        "sha256:running-tunnel": () => OLD,
        "sha256:app:new": () => NEXT,
        ...Object.fromEntries(
          Object.entries(configs).map(([key, value]) => [
            key === "old" ? "sha256:running-tunnel" : "sha256:app:new",
            typeof value === "function" ? value : () => value,
          ]),
        ),
      },
    });
    await expect(t.f.host.prepareImages()).rejects.toThrow(failure);
    const ran = (...words) => t.calls.filter((args) => words.every((word) => args.includes(word)));
    expect(ran("tag").length).toBeGreaterThan(0);
    expect(ran("image", "rm")).toHaveLength(ran("tag").length);
    for (const word of ["stop", "run", "update"]) expect(ran(word)).toEqual([]);
  });

  it.each([
    ["letter case", "b00000001"],
    ["inner spacing", "B 00000001"],
  ])("names a producer that differs in %s, as the running producer does", async (_case, taxId) => {
    const t = await upgrade({ next: imageConfig("v1.4.0", producer(taxId)) });
    expect(t.seen.trial.note).toEqual({ ...NOTE, producerTaxId: taxId });
  });

  it("names the producers as the running producer reads them, without the spaces around", async () => {
    const t = await upgrade({
      old: imageConfig("v1.3.0", producer(` ${FROM}`)),
      next: imageConfig("v1.4.0", producer(`${TO} `)),
    });
    expect(t.seen.trial.note).toEqual(NOTE);
  });

  it.each([
    "1.4.0",
    "1.4.0-rc.2",
    "0.0.1-alpha.0",
    "01.4.0",
    "1.4.0-dev.1",
    "1.4.0\n",
    "1.4.0+abc",
    `1.4.${"1".repeat(46)}`,
    `1.4.${"1".repeat(47)}`,
  ])("takes %j as a release exactly as the release list does", async (version) => {
    const t = await upgrade({ next: imageConfig(`v${version}`, producer(TO)) });
    expect(t.seen.trial.note?.release).toBe(isNumberedVersion(version) ? version : undefined);
  });

  describe("over a live note whose installation has not opened", () => {
    const THIRD = "B00000003";
    const SAME = {
      old: imageConfig("v1.4.0", producer(TO)),
      next: imageConfig("v1.4.1", producer(TO)),
    };
    const FURTHER = { ...SAME, next: imageConfig("v1.5.0", producer(THIRD)) };
    const LIVE = JSON.stringify(NOTE) + "\n";
    const given = async (options) => (await upgrade(options)).seen.trial.note;

    it("gives a fixed release by the same producer a note from the producer first replaced", async () => {
      const t = await upgrade({ ...SAME, live: LIVE });
      const carried = { ...NOTE, release: "1.4.1" };
      expect(t.seen.trial.note).toEqual(carried);
      expect(JSON.parse(await readFile(join(t.directory, IDENTITY_CHANGE_FILE), "utf8"))).toEqual(
        carried,
      );
      expect(await readFile(t.livePath, "utf8")).toBe(LIVE);
    });

    it("gives a release by a third producer a note from the producer first replaced", async () => {
      expect(await given({ ...FURTHER, live: LIVE })).toEqual({
        version: 1,
        release: "1.5.0",
        producerTaxId: THIRD,
        fromProducerTaxId: FROM,
      });
    });

    it("compares the live note with the running producer as that producer reads it", async () => {
      expect(
        await given({ ...SAME, old: imageConfig("v1.4.0", producer(` ${TO} `)), live: LIVE }),
      ).toEqual({ ...NOTE, release: "1.4.1" });
    });

    it.each([
      ["once the installation has opened, the note gone", SAME, undefined],
      ["for a live note naming another producer", SAME, { ...NOTE, producerTaxId: THIRD }],
      [
        "for a live note whose producer differs in letter case",
        SAME,
        { ...NOTE, producerTaxId: TO.toLowerCase() },
      ],
      ["back to the producer first replaced", { ...SAME, next: OLD }, NOTE],
      [
        "for a candidate built from main",
        { ...SAME, next: imageConfig("main", producer(TO)) },
        NOTE,
      ],
      ["for a candidate naming no producer", { ...SAME, next: imageConfig("v1.4.1") }, NOTE],
      ["for an old image naming no producer", { ...SAME, old: imageConfig("v1.4.0") }, NOTE],
    ])("writes no note %s", async (_case, configs, note) => {
      const live = note && JSON.stringify(note);
      const t = await upgrade({ ...configs, live });
      expect(t.seen.trial.names).toEqual([]);
      expect(await readdir(t.directory)).toEqual(["candidate-compose.json"]);
      if (live) expect(await readFile(t.livePath, "utf8")).toBe(live);
    });

    it("names the running producer to a third one, for a live note naming another", async () => {
      const live = JSON.stringify({ ...NOTE, producerTaxId: FROM, fromProducerTaxId: "B00000009" });
      expect(await given({ ...FURTHER, live })).toMatchObject({ fromProducerTaxId: TO });
    });

    it.each([
      ["of another release", "v1.4.1"],
      ["built from main", "main"],
      ["with no label", undefined],
      ["whose label has no v", "1.4.0"],
    ])("carries nothing for a running image %s", async (_case, ref) => {
      const old = imageConfig(ref, producer(TO));
      expect(await given({ ...SAME, old, live: LIVE })).toBeUndefined();
      expect(await given({ ...FURTHER, old, live: LIVE })).toEqual({
        version: 1,
        release: "1.5.0",
        producerTaxId: THIRD,
        fromProducerTaxId: TO,
      });
    });

    it("carries nothing for a running image with no labels", async () => {
      const old = JSON.stringify({ Env: [producer(TO)], Labels: null });
      expect(await given({ ...SAME, old, live: LIVE })).toBeUndefined();
    });

    it("writes no note for an unlabelled running image with no live note", async () => {
      const old = imageConfig(undefined, producer(TO));
      expect(await given({ ...SAME, old })).toBeUndefined();
    });

    it.each([
      ["exactly the server's shape", LIVE, true],
      [
        "its keys in another order",
        JSON.stringify(Object.fromEntries(Object.entries(NOTE).reverse())),
        true,
      ],
      ["nothing", "", false],
      ["not JSON", LIVE.slice(0, -3), false],
      ["null", "null", false],
      ["text", JSON.stringify(LIVE), false],
      ["a list", JSON.stringify([NOTE]), false],
      ["another version", JSON.stringify({ ...NOTE, version: 2 }), false],
      ["its version as text", JSON.stringify({ ...NOTE, version: "1" }), false],
      ["a key too many", JSON.stringify({ ...NOTE, more: "x" }), false],
      ...Object.keys(NOTE).flatMap((key) => [
        [`no ${key}`, JSON.stringify({ ...NOTE, [key]: undefined }), false],
        [`an empty ${key}`, JSON.stringify({ ...NOTE, [key]: "" }), false],
        [`a listed ${key}`, JSON.stringify({ ...NOTE, [key]: [NOTE[key]] }), false],
        [`a null ${key}`, JSON.stringify({ ...NOTE, [key]: null }), false],
      ]),
    ])(
      "takes a live file holding %s as a note exactly as the server does",
      async (_case, live, noted) => {
        const t = await upgrade({ ...SAME, live });
        expect((await readIdentityChangeNote(join(t.root, "state"))) !== null).toBe(noted);
        expect(t.seen.trial.names).toEqual(noted ? [IDENTITY_CHANGE_FILE] : []);
        const further = await given({ ...FURTHER, live });
        expect(further).toMatchObject({ fromProducerTaxId: noted ? FROM : TO });
      },
    );

    it.each([
      ["a folder", (path) => mkdir(path)],
      [
        "a link to a note elsewhere",
        async (path) => {
          const outside = await mkdtemp(join(tmpdir(), "upgrade-note-outside-"));
          onTestFinished(() => rm(outside, { recursive: true, force: true }));
          await writeFile(join(outside, "note"), LIVE);
          await symlink(join(outside, "note"), path);
        },
      ],
      ["a pipe nobody writes to", (path) => promisify(execFile)("mkfifo", [path])],
    ])("takes %s under the note's name as no note", async (_case, live) => {
      expect(await given({ ...SAME, live })).toBeUndefined();
      expect(await given({ ...FURTHER, live })).toMatchObject({ fromProducerTaxId: TO });
    });

    it("reads the live note before the stop", async () => {
      const t = await upgrade({ ...SAME, live: LIVE, beforeStop: (path) => rm(path) });
      expect(await readIdentityChangeNote(t.directory)).toMatchObject({
        release: "1.4.1",
        fromProducerTaxId: FROM,
      });
    });

    it("replaces the live note with the carried one once every check has passed", async () => {
      const t = await apply({ ...SAME, live: LIVE });
      expect(t.result).toMatchObject({ phase: "committed", target: "candidate" });
      expect(await readIdentityChangeNote(t.state)).toEqual({
        release: "1.4.1",
        producerTaxId: TO,
        fromProducerTaxId: FROM,
      });
    });

    it("leaves the live note as it was when the fixed release's sale is refused", async () => {
      const t = await apply({
        ...SAME,
        live: LIVE,
        sale: () => {
          throw new Error("sale refused");
        },
      });
      expect(t.result).toMatchObject({ phase: "awaiting-choice" });
      expect(await readFile(join(t.state, IDENTITY_CHANGE_FILE), "utf8")).toBe(LIVE);
    });
  });

  it("saves the note for an app already stopped, which runs no trial", async () => {
    const t = await imageFixture({
      prepare: false,
      imageConfigs: { "sha256:app:old": () => OLD, "sha256:app:new": () => NEXT },
    });
    const images = await t.f.host.prepareImages();
    expect(t.calls.some((args) => args.includes("trial"))).toBe(false);
    await mkdir(t.directory, { recursive: true });
    await t.f.host.stop();
    await t.f.host.resume(images.old);
    expect(await readIdentityChangeNote(t.directory)).toMatchObject({ release: "1.4.0" });
  });

  async function apply({
    sale = () => ({ stdout: '[{"name":"sale","ok":true}]' }),
    old = OLD,
    next = NEXT,
    live,
  } = {}) {
    const { runUpgradeCli } = await import("./cli.mjs");
    const t = await imageFixture({
      prepare: false,
      imageConfigs: { "sha256:app:old": () => old, "sha256:app:new": () => next },
    });
    t.candidate.services["print-agent"].healthcheck = { test: ["CMD", "true"] };
    const state = join(t.root, "state");
    await writeFile(join(state, "retained"), "intact source");
    if (live !== undefined) await writeFile(join(state, IDENTITY_CHANGE_FILE), live);
    // From another process: in this one SQLite answers "locked" even once the OS lock is gone.
    const held = () =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            "-e",
            `const { DatabaseSync } = require("node:sqlite");
            const held = process.argv.slice(1).map((path) => {
              const contender = new DatabaseSync(path);
              try {
                contender.exec("pragma busy_timeout = 0; begin immediate");
                return false;
              } catch (error) {
                if (!/locked/.test(error.message)) throw error;
                return true;
              } finally {
                contender.close();
              }
            });
            process.stdout.write(JSON.stringify(held));`,
            ...[RECOVERY_LOCK_FILE, `${VENUE_DIR_NAME}/${VENUE_LOCK_FILE}`].map((name) =>
              join(state, name),
            ),
          ],
          { encoding: "utf8" },
        ),
      );
    const seen = [];
    const record = async (step) => {
      seen.push({
        step,
        held: held(),
        note: (await readdir(state)).includes(IDENTITY_CHANGE_FILE),
      });
    };
    const run = async (file, args, input) => {
      if (file === "prepare-fixture")
        return { stdout: JSON.stringify({ compose: JSON.stringify(t.candidate) }) };
      if (["readiness", "sale"].includes(args.at(-1))) await record(args.at(-1));
      if (args.at(-1) === "readiness") return { stdout: '[{"name":"readiness","ok":true}]' };
      if (args.at(-1) === "sale") return sale();
      if (args[0] === "rm") await record("remove");
      if (args.includes("up")) await record("open");
      if (args[0] === "inspect" && !args.includes("--format"))
        return {
          stdout: JSON.stringify([{ State: { Running: true, Health: { Status: "healthy" } } }]),
        };
      if (["run", "exec", "rm", "stop"].includes(args[0])) return { stdout: "" };
      return t.run(file, args, input);
    };
    const probe = await open(join(tmpdir(), "."), "r");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const { chown } = prototype;
    const spy = vi.spyOn(prototype, "chown").mockImplementation(function (...args) {
      // The hold's own lock files are made, and given their owner, before it begins.
      if (seen.length > 0) seen.push({ step: "write", held: held() });
      return chown.apply(this, args);
    });
    onTestFinished(() => spy.mockRestore());
    const result = await runUpgradeCli(["apply", t.root, "prepare-fixture", "candidate-ref"], {
      run,
    });
    return { ...t, state, held, seen, result };
  }

  it("holds the venue from the stop to the live note, and lets go only to open it", async () => {
    const t = await apply();
    expect(t.result).toMatchObject({ phase: "committed", target: "candidate" });
    const HELD = [true, true];
    const before = (step) => ({ step, held: HELD, note: false });
    expect(t.seen).toEqual([
      before("readiness"),
      before("sale"),
      before("remove"),
      before("remove"),
      before("remove"),
      { step: "write", held: HELD },
      { step: "open", held: [false, false], note: true },
      { step: "open", held: [false, false], note: true },
    ]);
    expect(await readIdentityChangeNote(t.state)).toMatchObject({ release: "1.4.0" });
    expect(await readdir(`${t.root}.upgrades`)).toEqual([]);
  });

  it("goes on holding the venue, with no live note, after a refused sale", async () => {
    const t = await apply({
      sale: () => {
        throw new Error("sale refused");
      },
    });
    expect(t.result).toMatchObject({ phase: "awaiting-choice", failure: "sale refused" });
    expect(t.held()).toEqual([true, true]);
    expect(await readdir(t.state)).not.toContain(IDENTITY_CHANGE_FILE);
    expect(t.seen.some(({ step }) => ["write", "open"].includes(step))).toBe(false);
  });

  it.each(["manual", "automatic"])(
    "puts the copy back without the live note when the %s upgrade stopped before it was recorded complete",
    async (mode) => {
      const { runUpgradeCli } = await import("./cli.mjs");
      const { copyStoppedTree } = await import("./copy.mjs");
      const { f, root, directory, images, run: hostRun } = await imageFixture();
      const state = join(root, "state");
      await writeFile(join(state, "retained"), "original state");
      await mkdir(join(directory, "copies"));
      for (const [index, path] of f.paths.entries())
        await copyStoppedTree(path, join(directory, "copies", String(index)));
      const note = JSON.stringify(NOTE) + "\n";
      for (const folder of [directory, state])
        await writeFile(join(folder, IDENTITY_CHANGE_FILE), note);
      await writeFile(
        join(directory, "attempt.json"),
        JSON.stringify({ mode, phase: "candidate", copied: true, paths: f.paths, images }),
      );
      const run = async (file, args, input) => {
        if (args[0] === "inspect" && args[2]?.includes("Config.Labels"))
          throw Object.assign(new Error("missing"), { code: 1, stderr: "No such container" });
        return hostRun(file, args, input);
      };

      let result = await runUpgradeCli(["recover", root], { run });
      if (mode === "manual") {
        expect(result).toMatchObject({ phase: "awaiting-choice", failure: "checks interrupted" });
        await expect(runUpgradeCli(["keep", root], { run })).rejects.toThrow(
          "This upgrade changes the software producer, so it cannot be kept.",
        );
        expect(await readdir(directory)).toContain("copies");
        result = await runUpgradeCli(["restore", root], { run });
      }

      expect(result).toMatchObject({ phase: "committed", target: "old" });
      expect((await readdir(state)).sort()).toEqual([RECOVERY_LOCK_FILE, "retained", "venue"]);
      expect(await readFile(join(state, "retained"), "utf8")).toBe("original state");
      const installed = JSON.parse(await readFile(join(root, "compose.yml"), "utf8"));
      expect(installed.services.app.image).toBe(images.old.app);
    },
  );

  it("never puts the note in Compose, .env, an environment file or a command", async () => {
    const t = await upgrade();
    await t.f.host.installCandidate(t.images.candidate);
    await t.f.host.resume(t.images.candidate);
    expect(t.calls.some((args) => args.includes("up"))).toBe(true);
    const written = {
      compose: await readFile(join(t.root, "compose.yml"), "utf8"),
      env: await readFile(join(t.root, ".env"), "utf8"),
      saved: await readFile(join(t.directory, "candidate-compose.json"), "utf8"),
      captureEnvironment: t.seen.capture.environment,
      trialEnvironment: t.seen.trial.environment,
      commands: JSON.stringify(t.calls),
    };
    for (const text of Object.values(written))
      for (const word of [FROM, TO, "fromProducerTaxId", IDENTITY_CHANGE_FILE])
        expect(text).not.toContain(word);
    expect(written.trialEnvironment).toContain("UPGRADE_SETTING");
  });
});
