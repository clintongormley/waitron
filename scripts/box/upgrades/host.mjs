import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { recoverUpgrade, upgradeStatus, writeFileDurable } from "./transaction.mjs";
import { execFile } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

const execute = promisify(execFile);
const command = (file, args) => execute(file, args, { maxBuffer: 4 * 1024 * 1024 });

export async function stopUpgradeWriters({ run = command, compose }) {
  const id = (await run("docker", [...compose, "ps", "-a", "-q", "app"])).stdout.trim();
  if (id) {
    const inspect = async () => JSON.parse((await run("docker", ["inspect", id])).stdout)[0].State;
    if ((await inspect()).Running) {
      const before = (await run("docker", ["logs", "--timestamps", "--tail", "1", id])).stdout;
      const cursor = before.trimEnd();
      await run("docker", ["stop", "--time", "10", id]);
      const state = await inspect();
      const { stdout } = await run("docker", ["logs", "--timestamps", "--tail", "256", id]);
      const at = cursor === "" ? 0 : stdout.lastIndexOf(cursor);
      if (at === -1) throw new Error("app shutdown log changed; no upgrade copy permitted");
      const fresh = stdout.slice(cursor === "" ? 0 : at + cursor.length);
      const events = fresh.split("\n").flatMap((line) => {
        try {
          return [JSON.parse(line.slice(line.indexOf(" ") + 1)).event];
        } catch {
          return [];
        }
      });
      if (
        state.Running ||
        state.ExitCode !== 0 ||
        !events.includes("server.shutdown_complete") ||
        events.some((event) =>
          ["server.shutdown_failed", "server.shutdown_timeout"].includes(event),
        )
      ) {
        throw new Error("app shutdown incomplete; no upgrade copy permitted");
      }
    }
  }
  await run("docker", [...compose, "--profile", "staff-tunnel", "stop", "--timeout", "10"]);
}

const COPIED_VOLUMES = ["state", "print_agent", "mailpit", "tunnel_control", "tunnel_keys"];

export async function createUpgradeHost({
  boxDirectory,
  candidate,
  directory,
  checkCandidate,
  run = command,
}) {
  const compose = [
    "compose",
    "--project-directory",
    boxDirectory,
    "-f",
    join(boxDirectory, "compose.yml"),
  ];
  const config = JSON.parse(
    (await run("docker", [...compose, "config", "--format", "json"])).stdout,
  );
  const paths = [];
  for (const key of COPIED_VOLUMES) {
    const name = config.volumes[key].name;
    await run("docker", [
      "volume",
      "create",
      "--label",
      `com.docker.compose.project=${config.name}`,
      "--label",
      `com.docker.compose.volume=${key}`,
      name,
    ]);
    const [volume] = JSON.parse((await run("docker", ["volume", "inspect", name])).stdout);
    paths.push(volume.Mountpoint);
  }
  const pins = (images, config) => pinImages(boxDirectory, images, config);
  const idOf = async (image) =>
    (await run("docker", ["image", "inspect", image, "--format", "{{.Id}}"])).stdout.trim();
  const old = {};
  for (const [key, service] of Object.entries(config.services)) {
    const container = (await run("docker", [...compose, "ps", "-a", "-q", key])).stdout.trim();
    if (service.profiles?.length && !container) continue;
    old[key] = container
      ? (await run("docker", ["inspect", container, "--format", "{{.Image}}"])).stdout.trim()
      : await idOf(service.image);
  }
  await pins(old, config);
  paths.push(join(boxDirectory, "compose.yml"));
  try {
    await fs.access(join(boxDirectory, ".env"));
    paths.push(join(boxDirectory, ".env"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const tags = [];
  let releaseState;
  return {
    paths,
    host: {
      async prepareImages() {
        for (const [key, id] of Object.entries(old)) {
          const tag = `waitron-upgrade-old-${key}:${id.replace("sha256:", "")}`;
          await run("docker", ["image", "tag", id, tag]);
          tags.push(tag);
        }
        const next = {};
        for (const key of Object.keys(old)) {
          const service = candidate.services[key];
          if (key === "tunnel" && service.image === config.services[key].image) {
            next[key] = old[key];
          } else {
            await run("docker", ["pull", service.image]);
            next[key] = await idOf(service.image);
          }
          const tag = `waitron-upgrade-candidate-${key}:${next[key].replace("sha256:", "")}`;
          await run("docker", ["image", "tag", next[key], tag]);
          tags.push(tag);
        }
        await assertCopyRoom(paths, dirname(directory), { run });
        await writeFileDurable(join(directory, "candidate-compose.json"), candidate);
        return { old, candidate: next };
      },
      async stop() {
        await stopUpgradeWriters({ compose, run });
        releaseState ??= await holdUpgradeState(paths[0]);
      },
      async installCandidate(images) {
        await pins(images, candidate);
      },
      checkCandidate,
      async resume(images) {
        await pins(images);
        releaseState?.();
        releaseState = undefined;
        await run("docker", [...compose, "up", "-d", "--pull", "never", "--remove-orphans"]);
      },
      async cleanup() {
        for (const tag of tags) await run("docker", ["image", "rm", tag]);
        await discardAttempt(directory);
      },
    },
  };
}

async function attemptDirectory(boxDirectory) {
  const root = `${boxDirectory}.upgrades`;
  let entries;
  try {
    entries = await fs.readdir(root);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (entries.length > 1) throw new Error("multiple upgrade attempts; inspect host status");
  return entries.length === 0 ? null : join(root, entries[0]);
}

export async function recoverInstalledUpgrade({
  boxDirectory,
  offline = false,
  run = command,
  choice,
}) {
  const directory = await attemptDirectory(boxDirectory);
  if (directory === null) return null;
  if (offline) {
    let states;
    try {
      states = (await run("systemctl", ["is-active", "docker.service", "docker.socket"])).stdout;
    } catch (error) {
      if (error.code !== 3) throw error;
      states = error.stdout;
    }
    if (
      states
        .trim()
        .split("\n")
        .some((state) => !["inactive", "failed", "unknown"].includes(state))
    )
      throw new Error("Docker must be stopped before offline recovery");
  }
  const compose = [
    "compose",
    "--project-directory",
    boxDirectory,
    "-f",
    join(boxDirectory, "compose.yml"),
  ];
  const recorded = await upgradeStatus(directory);
  let releaseState;
  let marker;
  try {
    marker = await recoverUpgrade({
      directory,
      choice,
      host: {
        async stop() {
          if (!offline) await stopUpgradeWriters({ run, compose });
          releaseState ??= await holdUpgradeState(recorded.paths[0]);
        },
        async installCandidate(images) {
          let candidate;
          try {
            candidate = JSON.parse(
              await fs.readFile(join(directory, "candidate-compose.json"), "utf8"),
            );
          } catch {
            throw new Error("saved candidate Compose is missing or unreadable");
          }
          await pinImages(boxDirectory, images, candidate);
        },
        async resume(images) {
          await pinImages(boxDirectory, images);
          if (offline) return false;
          releaseState?.();
          releaseState = undefined;
          await run("docker", [...compose, "up", "-d", "--pull", "never", "--remove-orphans"]);
        },
        async cleanup(images) {
          for (const [kind, services] of Object.entries(images))
            for (const [key, id] of Object.entries(services)) {
              const tag = `waitron-upgrade-${kind === "old" ? "old" : "candidate"}-${key}:${id.replace("sha256:", "")}`;
              try {
                await run("docker", ["image", "inspect", tag]);
              } catch (error) {
                if (error.code === 1) continue;
                throw error;
              }
              await run("docker", ["image", "rm", tag]);
            }
        },
      },
    });
  } finally {
    releaseState?.();
  }
  if (!offline && (marker === null || marker.phase === "committed")) {
    await discardAttempt(directory);
  }
  return marker;
}

async function discardAttempt(directory) {
  await fs.rm(directory, { recursive: true, force: true });
  const handle = await fs.open(dirname(directory), "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// The host has no workspace runtime; these paths match the store's default-layout locks.
export async function holdUpgradeState(stateDirectory) {
  const locks = [];
  const release = () => {
    for (const lock of locks.splice(0).reverse()) lock.close();
  };
  try {
    await fs.mkdir(join(stateDirectory, "venue"), { recursive: true });
    for (const name of ["recovery.lock", "venue/venue.lock"]) {
      const lock = new DatabaseSync(join(stateDirectory, name));
      locks.push(lock);
      lock.exec("pragma busy_timeout = 0; begin immediate");
    }
    const venue = join(stateDirectory, "venue", "venue.db");
    try {
      await fs.access(venue);
      const db = new DatabaseSync(venue, { readOnly: true });
      try {
        const table = db
          .prepare("select name from sqlite_master where type = 'table' and name = 'nodes'")
          .get();
        if (table && db.prepare("select count(*) as total from nodes").get().total > 1)
          throw new Error("paired upgrades are not available");
      } finally {
        db.close();
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await fs.access(join(stateDirectory, "tls", "joined.json"));
      throw new Error("paired upgrades are not available");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

async function pinImages(boxDirectory, images, config) {
  config ??= JSON.parse(await fs.readFile(join(boxDirectory, "compose.yml"), "utf8"));
  const services = { ...config.services };
  for (const [key, image] of Object.entries(images)) services[key] = { ...services[key], image };
  await writeFileDurable(join(boxDirectory, "compose.yml"), { ...config, services });
}

export async function assertCopyRoom(paths, directory, { run = command, statfs = fs.statfs } = {}) {
  const { stdout } = await run("du", ["-sk", "--", ...paths]);
  const bytes = stdout
    .trim()
    .split("\n")
    .reduce((total, line) => total + BigInt(line.trim().split(/\s+/)[0]) * 1024n, 0n);
  const available = await statfs(directory, { bigint: true });
  if (available.bavail * available.bsize < bytes + 16n * 1024n * 1024n)
    throw new Error("not enough room for the upgrade copy");
}
