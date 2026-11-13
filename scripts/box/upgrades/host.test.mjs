import { expect, it } from "vitest";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import { stopUpgradeWriters } from "./host.mjs";
import { VENUE_LOCK_FILE } from "../../../packages/store/src/venue-lock.js";
import { RECOVERY_LOCK_FILE, VENUE_DIR_NAME } from "../../../packages/store/src/state-layout.js";

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
  writers = false,
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
  let opened = false;
  const run = async (file, args, input) => {
    calls.push([file, ...args]);
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
          activeInbox && args.at(-1) === "mailpit"
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
    "create table node_mode (node_id text, mode text, singleton_role text); insert into node_mode values ('one', 'mirror', 'secondary')",
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
    expect(t.calls.findLast((args) => args.includes("up"))).not.toContain("staff-tunnel");
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
