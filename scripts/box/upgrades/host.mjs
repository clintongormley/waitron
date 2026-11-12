import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { recoverUpgrade, upgradeStatus, writeFileDurable } from "./transaction.mjs";
import { execFile } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { parseEnv, promisify } from "node:util";
import { createServer, createConnection } from "node:net";
import { once } from "node:events";

const execute = promisify(execFile);
const command = (file, args, input) => {
  const result = execute(file, args, { maxBuffer: 4 * 1024 * 1024 });
  if (input !== undefined) result.child.stdin.end(input);
  return result;
};

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
  prepareCandidate,
  run = command,
}) {
  const compose = [
    "compose",
    "--project-directory",
    boxDirectory,
    "-f",
    join(boxDirectory, "compose.yml"),
  ];
  const config = await composeConfig(boxDirectory, run);
  let rawCandidate = typeof candidate === "string" ? candidate : JSON.stringify(candidate);
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
  const pins = (images, raw) => pinImages(boxDirectory, images, raw);
  const idOf = async (image) =>
    (await run("docker", ["image", "inspect", image, "--format", "{{.Id}}"])).stdout.trim();
  const old = {};
  for (const [key, service] of Object.entries(config.services)) {
    const container = (await run("docker", [...compose, "ps", "-a", "-q", key])).stdout.trim();
    if (
      service.profiles?.length &&
      (!container ||
        (
          await run("docker", ["inspect", container, "--format", "{{.State.Running}}"])
        ).stdout.trim() !== "true")
    )
      continue;
    if (container) {
      const files = (
        await run("docker", [
          "inspect",
          container,
          "--format",
          '{{index .Config.Labels "com.docker.compose.project.config_files"}}',
        ])
      ).stdout
        .trim()
        .split(",");
      if (
        files.length !== 1 ||
        (await fs.realpath(files[0])) !== (await fs.realpath(join(boxDirectory, "compose.yml")))
      )
        throw new Error("upgrade requires the installed single Compose file");
    }
    old[key] = container
      ? (await run("docker", ["inspect", container, "--format", "{{.Image}}"])).stdout.trim()
      : await idOf(service.image);
  }
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
        try {
          pinnedCompose(await fs.readFile(join(boxDirectory, "compose.yml"), "utf8"), old);
          for (const [key, id] of Object.entries(old)) {
            const tag = `waitron-upgrade-old-${key}:${id.replace("sha256:", "")}`;
            await run("docker", ["image", "tag", id, tag]);
            tags.push(tag);
          }
          const prepared = await prepareCandidate?.();
          if (prepared) rawCandidate = prepared.compose;
          const candidateConfig = await composeConfig(boxDirectory, run, rawCandidate);
          const next = {};
          for (const [key, service] of Object.entries(candidateConfig.services)) {
            if (service.profiles?.length && old[key] === undefined) continue;
            if (key === "tunnel" && old[key] !== undefined) {
              next[key] = old[key];
            } else if (prepared?.images?.[key]) {
              next[key] = prepared.images[key];
            } else {
              const reference = await candidateReference(service.image, run);
              await run("docker", ["pull", reference]);
              next[key] = await idOf(reference);
            }
            const tag = `waitron-upgrade-candidate-${key}:${next[key].replace("sha256:", "")}`;
            await run("docker", ["image", "tag", next[key], tag]);
            tags.push(tag);
          }
          await assertCopyRoom(paths, dirname(directory), { run });
          pinnedCompose(rawCandidate, next);
          const ids = (
            await run("docker", [...compose, "--profile", "staff-tunnel", "ps", "-a", "-q"])
          ).stdout
            .trim()
            .split(/\s+/)
            .filter(Boolean);
          if (ids.length > 0) await run("docker", ["update", "--restart=no", ...ids]);
          return { old, candidate: next };
        } catch (error) {
          await Promise.allSettled(tags.map((tag) => removeImageTag(tag, run)));
          throw error;
        }
      },
      async stop() {
        await writeFileDurable(join(directory, "candidate-compose.json"), {
          compose: rawCandidate,
        });
        await stopUpgradeWriters({ compose, run });
        releaseState ??= await holdUpgradeState(paths[0]);
      },
      async installCandidate(images) {
        await pins(images, rawCandidate);
      },
      checkCandidate,
      async resume(images) {
        await pins(images);
        releaseState?.();
        releaseState = undefined;
        await reopenImages(compose, images, run);
      },
      async cleanup() {
        for (const tag of tags) await removeImageTag(tag, run);
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
            ).compose;
            if (typeof candidate !== "string") throw new Error("invalid candidate Compose");
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
          await reopenImages(compose, images, run);
        },
        async cleanup(images) {
          for (const [kind, services] of Object.entries(images))
            for (const [key, id] of Object.entries(services)) {
              const tag = `waitron-upgrade-${kind === "old" ? "old" : "candidate"}-${key}:${id.replace("sha256:", "")}`;
              try {
                await run("docker", ["image", "inspect", tag]);
              } catch (error) {
                if (error.code === 1 && /No such image/.test(error.stderr)) continue;
                throw error;
              }
              await removeImageTag(tag, run);
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
    const owner = await fs.stat(stateDirectory);
    const created = await fs.mkdir(join(stateDirectory, "venue"), {
      recursive: true,
      mode: owner.mode & 0o777,
    });
    if (created) await fs.chown(created, owner.uid, owner.gid);
    for (const name of ["recovery.lock", "venue/venue.lock"]) {
      const path = join(stateDirectory, name);
      try {
        const file = await fs.open(path, "ax", 0o600);
        try {
          await file.chown(owner.uid, owner.gid);
        } finally {
          await file.close();
        }
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const lock = new DatabaseSync(path);
      locks.push(lock);
      lock.exec("pragma busy_timeout = 0; begin immediate");
    }
    await assertSingleBox(stateDirectory);
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

const hasTable = (db, name) =>
  db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(name) !==
  undefined;

async function assertSingleBox(stateDirectory) {
  let nodeId;
  try {
    nodeId = parseEnv(
      await fs.readFile(join(stateDirectory, "trading.env"), "utf8"),
    ).WAITRON_NODE_ID;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let sole = false;
  try {
    await fs.access(join(stateDirectory, "venue", "venue.db"));
    const db = new DatabaseSync(join(stateDirectory, "venue", "venue.db"), { readOnly: true });
    try {
      const row = hasTable(db, "node_membership")
        ? db.prepare("select document from node_membership where id = 1").get()
        : undefined;
      if (row) {
        const entries = JSON.parse(row.document).body?.nodes;
        if (!Array.isArray(entries)) throw new Error("saved membership is unreadable");
        const active = entries.filter((entry) => entry.standing !== "evicted");
        sole =
          active.length === 1 &&
          active[0].nodeId === nodeId &&
          active[0].standing === "serving-primary";
        if (!sole) throw new Error("paired upgrades are not available");
      } else if (
        hasTable(db, "nodes") &&
        db.prepare("select count(*) as total from nodes").get().total > 1
      ) {
        throw new Error("paired upgrades are not available");
      }
    } finally {
      db.close();
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (nodeId) {
    try {
      const path = join(stateDirectory, "venue", "node.db");
      await fs.access(path);
      const node = new DatabaseSync(path, { readOnly: true });
      try {
        const role = hasTable(node, "node_mode")
          ? node.prepare("select mode, singleton_role from node_mode where node_id = ?").get(nodeId)
          : undefined;
        if (role && (role.mode !== "primary" || role.singleton_role !== "primary"))
          throw new Error("paired upgrades are not available");
      } finally {
        node.close();
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!sole) {
    try {
      await fs.access(join(stateDirectory, "tls", "joined.json"));
      throw new Error("paired upgrades are not available");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function pinImages(boxDirectory, images, raw) {
  raw ??= await fs.readFile(join(boxDirectory, "compose.yml"), "utf8");
  await writeFileDurable(join(boxDirectory, "compose.yml"), pinnedCompose(raw, images));
}

// The shipped block layout is checked against real Compose; other YAML layouts fail before install.
function pinnedCompose(raw, images) {
  if (raw.trimStart().startsWith("{")) {
    const config = JSON.parse(raw);
    for (const [key, image] of Object.entries(images)) {
      if (config.services[key] === undefined)
        throw new Error("selected service is missing from Compose");
      config.services[key].image = image;
    }
    return JSON.stringify(config) + "\n";
  }
  let section;
  let service;
  const found = new Set();
  const lines = raw.split("\n").map((line) => {
    const top = /^([^\s#][^:]*):/.exec(line);
    if (top) {
      section = top[1];
      service = undefined;
    }
    const next = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(line);
    if (section === "services" && next) service = next[1];
    if (section === "services" && images[service] !== undefined && /^ {4}image:/.test(line)) {
      found.add(service);
      return `    image: ${JSON.stringify(images[service])}`;
    }
    return line;
  });
  if (Object.keys(images).some((key) => !found.has(key)))
    throw new Error("unsupported Compose image layout");
  return lines.join("\n");
}

async function composeConfig(boxDirectory, run, input) {
  const file = input === undefined ? join(boxDirectory, "compose.yml") : "-";
  return JSON.parse(
    (
      await run(
        "docker",
        [
          "compose",
          "--project-directory",
          boxDirectory,
          "--profile",
          "staff-tunnel",
          "-f",
          file,
          "config",
          "--format",
          "json",
        ],
        input,
      )
    ).stdout,
  );
}

async function reopenImages(compose, images, run) {
  await run("docker", [
    ...compose,
    ...(images.tunnel === undefined ? [] : ["--profile", "staff-tunnel"]),
    "up",
    "-d",
    "--pull",
    "never",
    "--remove-orphans",
    "--wait",
    "--wait-timeout",
    "180",
  ]);
}

async function candidateReference(image, run) {
  if (/@sha256:[a-f0-9]{64}$/.test(image)) return image;
  const manifest = JSON.parse(
    (await run("docker", ["manifest", "inspect", "--verbose", image])).stdout,
  );
  const entries = Array.isArray(manifest) ? manifest : [manifest];
  const descriptor = entries
    .map((entry) => entry.Descriptor)
    .find(
      (entry) =>
        entry?.platform?.os === "linux" &&
        entry.platform.architecture === (process.arch === "x64" ? "amd64" : "arm64"),
    );
  if (!/^sha256:[a-f0-9]{64}$/.test(descriptor?.digest))
    throw new Error("candidate image has no host-platform digest");
  return image.replace(/:[^/:]+$/, "") + "@" + descriptor.digest;
}

async function removeImageTag(tag, run) {
  try {
    await run("docker", ["image", "rm", tag]);
  } catch (error) {
    if (error.code !== 1 || !/is using its referenced image/.test(error.stderr)) throw error;
  }
}

export async function assertCopyRoom(paths, directory, { run = command, statfs = fs.statfs } = {}) {
  const { stdout } = await run("du", ["-sk", "--", ...paths]);
  const bytes = stdout
    .trim()
    .split("\n")
    .reduce((total, line) => total + BigInt(line.trim().split(/\s+/)[0]) * 1024n, 0n);
  const available = await statfs(directory, { bigint: true });
  if (available.bavail * available.bsize < 2n * bytes + 16n * 1024n * 1024n)
    throw new Error("not enough room for the upgrade copy");
}

export async function clockStatusRelay({ directory, socketPath = "/run/waitron-box/box.sock" }) {
  await fs.mkdir(directory, { mode: 0o755 });
  const clients = new Set();
  const server = createServer((client) => {
    clients.add(client);
    let source;
    let request = "";
    client.on("error", () => {});
    client.on("close", () => {
      clients.delete(client);
      source?.destroy();
    });
    client.on("data", (bytes) => {
      request += bytes.toString();
      if (!request.includes("\n") && request.length <= 4096) return;
      client.removeAllListeners("data");
      if (request !== "clock.status\n") {
        client.end('{"ok":false,"reason":"forbidden"}\n');
        return;
      }
      source = createConnection(socketPath);
      source.on("connect", () => source.write("clock.status\n"));
      let reply = "";
      source.on("data", (chunk) => {
        reply += chunk.toString();
        const end = reply.indexOf("\n");
        if (end >= 0) {
          client.end(reply.slice(0, end + 1));
          source.destroy();
        } else if (reply.length > 4096) source.destroy();
      });
      source.on("error", () => client.end('{"ok":false,"reason":"unavailable"}\n'));
      source.on("close", () => client.end());
    });
  });
  const path = join(directory, "box.sock");
  server.listen(path);
  await once(server, "listening");
  await fs.chmod(path, 0o666);
  return {
    async close() {
      for (const client of clients) client.destroy();
      await new Promise((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
    },
  };
}
