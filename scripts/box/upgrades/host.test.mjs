import { expect, it } from "vitest";
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

async function imageFixture({ activeTunnel = false, noEnv = false } = {}) {
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
  await fs.mkdir(directory, { recursive: true });
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
  for (const key of ["state", "print_agent", "mailpit", "tunnel_control", "tunnel_keys"]) {
    config.volumes[key] = { name: `waitron_${key}` };
    await fs.mkdir(join(root, key));
  }
  await fs.writeFile(join(root, "compose.yml"), "old compose");
  if (!noEnv) await fs.writeFile(join(root, ".env"), "old env");
  const created = new Set();
  const run = async (file, args) => {
    calls.push([file, ...args]);
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
    if (args.includes("--format") && args.includes("json"))
      return { stdout: JSON.stringify(config) };
    if (args[0] === "volume" && args[1] === "inspect")
      return { stdout: JSON.stringify([{ Mountpoint: join(root, args[2].slice(8)) }]) };
    if (args.includes("ps"))
      return { stdout: activeTunnel && args.at(-1) === "tunnel" ? "tunnel-id\n" : "" };
    if (args[0] === "inspect") return { stdout: "sha256:running-tunnel\n" };
    if (args[0] === "image" && args[1] === "inspect") {
      if (args[2] === "tunnel:dev") throw new Error("tunnel is not installed");
      return { stdout: `sha256:${args[2]}\n` };
    }
    if (args[0] === "image" || args[0] === "pull" || args.includes("up") || args.includes("stop"))
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
  const f = await createUpgradeHost({
    boxDirectory: root,
    directory,
    candidate,
    run,
    checkCandidate: async () => [{ name: "sale", ok: true }],
  });
  const images = await f.host.prepareImages();
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
  expect(calls.at(-1)).toEqual([
    "docker",
    "compose",
    "--project-directory",
    root,
    "-f",
    join(root, "compose.yml"),
    "up",
    "-d",
    "--pull",
    "never",
    "--remove-orphans",
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

it("a fresh Keep retries the resolved candidate configuration when installation failed before replacing Compose", async () => {
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

it("requires measured copy size plus a reserve in the attempt filesystem", async () => {
  const { assertCopyRoom } = await import("./host.mjs");
  const run = async () => ({ stdout: "4 /volumes/state\n8 /box/compose.yml\n" });
  await expect(
    assertCopyRoom(["/volumes/state", "/box/compose.yml"], "/attempts", {
      run,
      statfs: async () => ({ bavail: 4098n, bsize: 4096n }),
    }),
  ).rejects.toThrow("not enough room for the upgrade copy");
  await expect(
    assertCopyRoom(["/volumes/state", "/box/compose.yml"], "/attempts", {
      run,
      statfs: async () => ({ bavail: 4099n, bsize: 4096n }),
    }),
  ).resolves.toBeUndefined();
});

it("retains the active tunnel's exact running image without trying its local-only tag in a registry", async () => {
  const { images, calls } = await imageFixture({ activeTunnel: true });
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
  "refuses Keep when the resolved candidate Compose is %s",
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
