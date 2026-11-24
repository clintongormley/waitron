import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  IDENTITY_CHANGE_FILE,
  recoverUpgrade,
  upgradeResultPath,
  upgradeStatus,
  writeFileDurable,
} from "./transaction.mjs";
import { execFile } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { parseEnv, promisify } from "node:util";
import { createServer, createConnection } from "node:net";
import { once } from "node:events";
import { createHash } from "node:crypto";

const execute = promisify(execFile);
const composeFor = (box) => ["compose", "--project-directory", box, "-f", join(box, "compose.yml")];
const command = (file, args, input, options = {}) => {
  const result = execute(file, args, { maxBuffer: 4 * 1024 * 1024, ...options });
  if (input !== undefined) result.child.stdin.end(input);
  return result;
};

export async function stopUpgradeWriters({ run = command, compose, requireRunning = false }) {
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
    } else if (requireRunning) {
      throw new Error("app already stopped; no upgrade copy permitted");
    }
  } else if (requireRunning) {
    throw new Error("app already stopped; no upgrade copy permitted");
  }
  await run("docker", [
    ...compose,
    "--profile",
    "staff-tunnel",
    "--profile",
    "practice-inbox",
    "stop",
    "--timeout",
    "10",
  ]);
}

const COPIED_VOLUMES = ["state", "print_agent", "mailpit", "tunnel_control", "tunnel_keys"];

async function volumeMountpoint(name, run) {
  const [volume] = JSON.parse((await run("docker", ["volume", "inspect", name])).stdout);
  return volume.Mountpoint;
}

async function installedStateDirectory(boxDirectory, run) {
  const config = await composeConfig(boxDirectory, run);
  return volumeMountpoint(config.volumes.state.name, run);
}

export async function installedBoxId(boxDirectory, run = command) {
  return readBoxId(await installedStateDirectory(boxDirectory, run));
}

export async function installedVenueTimeZone(boxDirectory, run = command) {
  const state = await installedStateDirectory(boxDirectory, run);
  const db = new DatabaseSync(join(state, "venue", "venue.db"), { readOnly: true });
  try {
    const row = db
      .prepare("select doc from settings where module = 'business_day' and version = 1")
      .get();
    return row === undefined ? undefined : JSON.parse(row.doc).timeZone;
  } finally {
    db.close();
  }
}

async function appIsRunning(compose, run) {
  const app = (await run("docker", [...compose, "ps", "-q", "app"])).stdout.trim();
  return (
    app !== "" &&
    (await run("docker", ["inspect", app, "--format", "{{.State.Running}}"])).stdout.trim() ===
      "true"
  );
}

function assertUpgradeQuiet(stateDirectory, now) {
  const db = new DatabaseSync(join(stateDirectory, "venue", "venue.db"), { readOnly: true });
  try {
    db.exec("begin");
    const since = new Date(now - 10 * 60_000).toISOString();
    const cardActivity = recentCardActivity(db, since);
    const { busy } = db
      .prepare(
        `select exists (
      select 1 from working_orders
        where status in ('open', 'placed') or opened_at > $since or settled_at > $since
      union all select 1 from sales where issued_at > $since
      union all select 1 from bill_payments
        where state = 'pending' or created_at > $since or received_at > $since
      union all select 1 from refunds
        where state = 'pending' or created_at > $since or completed_at > $since
    ) as busy`,
      )
      .get({ $since: since });
    if (busy || cardActivity) throw new Error("venue has recent or unresolved trading activity");
  } finally {
    db.close();
  }
}

function recentCardActivity(db, since) {
  if (hasTable(db, "payments")) {
    return (
      db
        .prepare(
          `select 1 from payments
      where state in ('attempting', 'initiated') or created_at > ?1 or updated_at > ?1
      limit 1`,
        )
        .get({ "?1": since }) !== undefined
    );
  }
  const disabled = db
    .prepare(
      `select 1 from settings where module = 'modules'
    and version = 1 and json_type(doc, '$.modules.payments') = 'false'`,
    )
    .get();
  if (!disabled) throw new Error("payment data is unavailable");
  return false;
}

export async function checkInstalledUpgradeQuiet(boxDirectory, run = command, now = Date.now()) {
  if (!(await appIsRunning(composeFor(boxDirectory), run))) throw new Error("app is stopped");
  const state = await installedStateDirectory(boxDirectory, run);
  await assertSingleBox(state);
  assertUpgradeQuiet(state, now);
}

export async function createUpgradeHost({
  boxDirectory,
  candidate,
  directory,
  checkCandidate,
  prepareCandidate,
  beforeAutomaticStop,
  run = command,
}) {
  const compose = composeFor(boxDirectory);
  const config = await composeConfig(boxDirectory, run);
  let rawCandidate = typeof candidate === "string" ? candidate : JSON.stringify(candidate);
  const volumePaths = new Map();
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
    volumePaths.set(key, await volumeMountpoint(name, run));
  }
  const paths = [...volumePaths.values()];
  const staffSocket = join(volumePaths.get("tunnel_control"), "staff.sock");
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
  let identityNote = null;
  return {
    paths,
    host: {
      async abortPreparation() {
        try {
          await restoreRestartPolicies(boxDirectory, run);
        } finally {
          await Promise.allSettled(tags.splice(0).map((tag) => removeImageTag(tag, run)));
        }
      },
      async prepareImages() {
        try {
          const trial = `${boxDirectory}.upgrade-trial`;
          try {
            await fs.lstat(trial);
            await fs.rm(trial, { recursive: true, force: true });
            process.stderr.write("Removed leftover online migration trial copy\n");
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
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
            if (key === "tunnel" && service.profiles?.includes("staff-tunnel")) {
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
          identityNote = await identityChangeNote(old.app, next.app, paths[0], run);
          if (await appIsRunning(compose, run))
            await runOnlineTrial({
              work: trial,
              state: paths[0],
              image: next.app,
              environment: candidateConfig.services.app.environment,
              identityNote,
              run,
            });
          else
            process.stderr.write(
              "App already stopped; using final stopped checks and mandatory sale\n",
            );
          const ids = (
            await run("docker", [...compose, "--profile", "staff-tunnel", "ps", "-a", "-q"])
          ).stdout
            .trim()
            .split(/\s+/)
            .filter(Boolean);
          await beforeAutomaticStop?.();
          if (ids.length > 0) await run("docker", ["update", "--restart=no", ...ids]);
          return { old, candidate: next };
        } catch (error) {
          await Promise.allSettled(tags.splice(0).map((tag) => removeImageTag(tag, run)));
          throw error;
        }
      },
      async stop() {
        await writeFileDurable(join(directory, "candidate-compose.json"), {
          compose: rawCandidate,
        });
        if (identityNote !== null)
          await writeFileDurable(join(directory, IDENTITY_CHANGE_FILE), identityNote);
        await stopUpgradeWriters({
          compose,
          run,
          requireRunning: Boolean(beforeAutomaticStop && !releaseState),
        });
        // GNU cp preserves sockets, and the snapshot flush cannot open them.
        try {
          if ((await fs.lstat(staffSocket)).isSocket()) await fs.unlink(staffSocket);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (!releaseState) {
          releaseState = await holdUpgradeState(paths[0]);
          if (beforeAutomaticStop) assertUpgradeQuiet(paths[0], Date.now());
        }
      },
      async installCandidate(images) {
        await pins(images, rawCandidate);
      },
      checkCandidate,
      async resume(images) {
        await pins(images);
        releaseState?.();
        releaseState = undefined;
        await reopenImages(boxDirectory, images, run);
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
  const compose = composeFor(boxDirectory);
  const recorded = await upgradeStatus(directory);
  let releaseState;
  let marker;
  try {
    marker = await recoverUpgrade({
      directory,
      resultPath: upgradeResultPath(boxDirectory),
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
          await reopenImages(boxDirectory, images, run);
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

async function readBoxId(stateDirectory) {
  try {
    return parseEnv(await fs.readFile(join(stateDirectory, "trading.env"), "utf8")).WAITRON_NODE_ID;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function assertSingleBox(stateDirectory) {
  const nodeId = await readBoxId(stateDirectory);
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
        const role = hasTable(node, "box")
          ? node
              .prepare(
                "select mode, singleton_role from box where node_id = ? and mode is not null",
              )
              .get(nodeId)
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
          "--profile",
          "practice-inbox",
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

async function reopenImages(boxDirectory, images, run) {
  const compose = composeFor(boxDirectory);
  const up = [
    ...compose,
    ...(images.tunnel === undefined ? [] : ["--profile", "staff-tunnel"]),
    ...(images.mailpit === undefined ? [] : ["--profile", "practice-inbox"]),
    "up",
    "-d",
    "--pull",
    "never",
    "--remove-orphans",
  ];
  await run("docker", up);
  await restoreRestartPolicies(boxDirectory, run);
  await run("docker", [...up, "--wait", "--wait-timeout", "180"]);
}

export async function restoreRestartPolicies(boxDirectory, run = command) {
  const compose = composeFor(boxDirectory);
  const config = JSON.parse(
    (await run("docker", [...compose, "--profile", "*", "config", "--format", "json"])).stdout,
  );
  for (const [name, service] of Object.entries(config.services)) {
    const ids = (await run("docker", [...compose, "--profile", "*", "ps", "-a", "-q", name])).stdout
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length > 0)
      await run("docker", ["update", `--restart=${service.restart ?? "no"}`, ...ids]);
  }
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

// Keep in step with scripts/box/release-list.mjs, which is not installed beside this file.
const RELEASE_REF =
  /^v(?=.{1,50}$)((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(?:0|[1-9]\d*))?)$/;
const PRODUCER = "WAITRON_PRODUCER_TAX_ID=";

const isText = (value) => typeof value === "string" && value !== "";

/** The note an earlier upgrade left in the live state, if it has the shape the server reads. */
async function liveIdentityNote(stateDirectory) {
  let note;
  try {
    // The folder is the app's: a link there leads out of it, and a pipe would never answer.
    const handle = await fs.open(
      join(stateDirectory, IDENTITY_CHANGE_FILE),
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    try {
      note = JSON.parse(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
  if (note === null) return null;
  const { version, ...texts } = note;
  return version === 1 &&
    Object.keys(texts).sort().join() === "fromProducerTaxId,producerTaxId,release" &&
    Object.values(texts).every(isText)
    ? note
    : null;
}

export async function identityChangeNote(oldImage, nextImage, stateDirectory, run) {
  const identityOf = async (image, name) => {
    const { stdout } = await run("docker", [
      "image",
      "inspect",
      image,
      "--format",
      "{{json .Config}}",
    ]);
    try {
      const config = JSON.parse(stdout);
      return {
        release: RELEASE_REF.exec(config.Labels?.["org.opencontainers.image.ref.name"])?.[1],
        // The server compares its setting trimmed (readSoftwareProducer), and otherwise exactly.
        producerTaxId: config.Env?.find((entry) => entry.startsWith(PRODUCER))
          ?.slice(PRODUCER.length)
          .trim(),
      };
    } catch {
      throw new Error(`${name} image has an unreadable configuration`);
    }
  };
  const before = await identityOf(oldImage, "installed");
  const { release, producerTaxId } = await identityOf(nextImage, "candidate");
  if (!release || !before.producerTaxId || !producerTaxId) return null;
  // While the installed release waits to open its installation, the latest record is still under
  // the producer its note replaced. The server acts only on a note naming its own release.
  const live = await liveIdentityNote(stateDirectory);
  const fromProducerTaxId =
    live?.producerTaxId === before.producerTaxId && live.release === before.release
      ? live.fromProducerTaxId
      : before.producerTaxId;
  if (producerTaxId === fromProducerTaxId) return null;
  return { version: 1, release, producerTaxId, fromProducerTaxId };
}

export async function writeIdentityNote(stateDirectory, note) {
  const owner = await fs.stat(stateDirectory);
  await writeFileDurable(join(stateDirectory, IDENTITY_CHANGE_FILE), note, owner);
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

const TOLD_SYNCHRONISED =
  "The upgrade's checks were told that the box's time is synchronised; " +
  "its time service did not say so.\n";
// Under the server's wait for a status, DEFAULT_STATUS_MS in apps/server/src/box-host-client.ts.
const HOST_ANSWER_MS = 1000;

function saysSynchronised(reply) {
  try {
    const answer = JSON.parse(reply);
    return answer.ok === true && answer.synchronised === true;
  } catch {
    return false;
  }
}

const synchronisedReply = () =>
  JSON.stringify({
    ok: true,
    service: "on",
    unit: null,
    synchronised: true,
    lastSyncAt: null,
    nowMs: Date.now(),
  }) + "\n";

/** `answerSynchronised` is for the stopped checks' copy alone: the live server asks the host. */
export async function clockStatusRelay({
  directory,
  socketPath = "/run/waitron-box/box.sock",
  answerSynchronised = false,
  attemptDirectory,
}) {
  await fs.mkdir(directory, { mode: 0o755 });
  const clients = new Set();
  let told;
  const forCopy = async (reply) => {
    if (saysSynchronised(reply)) return reply;
    try {
      await (told ??= writeFileDurable(
        join(attemptDirectory, "clock-answer.txt"),
        TOLD_SYNCHRONISED,
      ));
    } catch {
      // An answer this attempt holds no record of is not given.
      return reply;
    }
    return synchronisedReply();
  };
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
      if (answerSynchronised) source.setTimeout(HOST_ANSWER_MS, () => source.destroy());
      let answered = false;
      const answer = async (reply) => {
        if (answered) return;
        answered = true;
        client.end(answerSynchronised && !client.destroyed ? await forCopy(reply) : reply);
      };
      source.on("connect", () => source.write("clock.status\n"));
      let reply = "";
      source.on("data", (chunk) => {
        reply += chunk.toString();
        const end = reply.indexOf("\n");
        if (end >= 0) {
          void answer(reply.slice(0, end + 1));
          source.destroy();
        } else if (reply.length > 4096) source.destroy();
      });
      source.on("error", () => void answer('{"ok":false,"reason":"unavailable"}\n'));
      source.on("close", () => void answer(""));
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
      await told?.catch(() => {});
    },
  };
}

export function upgradeEnvironment(environment = {}) {
  return (
    Object.entries(environment ?? {})
      .filter(([, value]) => value !== null)
      .map(([key, value]) => {
        if (String(value).includes("\n"))
          throw new Error("upgrade environment has a multiline value");
        return `${key}=${value}`;
      })
      .join("\n") + "\n"
  );
}

async function runOnlineTrial({ work, state, image, environment, identityNote, run }) {
  const prefix =
    "waitron-upgrade-trial-" + createHash("sha256").update(work).digest("hex").slice(0, 16);
  const started = [];
  let operation = "capture";
  let failure;
  try {
    await fs.mkdir(work, { mode: 0o755 });
    const copy = join(work, "state");
    await fs.mkdir(copy, { mode: 0o700 });
    const owner = await fs.stat(state);
    await fs.chown(copy, owner.uid, owner.gid);
    const envFile = join(work, "app.env");
    await writeFileDurable(envFile, upgradeEnvironment(environment));
    for (operation of ["capture", "trial"]) {
      if (operation === "trial" && identityNote !== null)
        await writeIdentityNote(copy, identityNote);
      const name = `${prefix}-${operation}`;
      started.push(name);
      const mounts =
        operation === "capture"
          ? [
              `type=bind,src=${state},dst=/var/lib/waitron/state,readonly`,
              `type=bind,src=${copy},dst=/upgrade-copy`,
            ]
          : [`type=bind,src=${copy},dst=/var/lib/waitron/state`];
      const { stdout } = await run(
        "docker",
        [
          "run",
          "--init",
          "--rm",
          "--name",
          name,
          "--label",
          `waitron.upgrade.directory=${work}`,
          "--network",
          "none",
          "--env-file",
          envFile,
          ...mounts.flatMap((mount) => ["--mount", mount]),
          "--entrypoint",
          "node",
          image,
          "/app/upgrade-checks.js",
          operation,
          ...(operation === "capture" ? ["/upgrade-copy"] : []),
        ],
        undefined,
        { timeout: 180_000 },
      );
      const report = JSON.parse(stdout.trim().split("\n").at(-1));
      if (
        !Array.isArray(report) ||
        report.length !== 1 ||
        report[0].name !== operation ||
        report[0].ok !== true
      )
        throw new Error("missing or failed check report");
    }
  } catch (error) {
    failure = error;
  } finally {
    for (const name of started.reverse()) {
      try {
        await run("docker", ["rm", "--force", name]);
      } catch (error) {
        if (!(error.code === 1 && /no such container/i.test(error.stderr))) failure ??= error;
      }
    }
    try {
      await fs.rm(work, { recursive: true, force: true });
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) {
    const detail =
      failure.killed && failure.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        ? "timed out after 180 seconds"
        : failure.stderr?.trim() || failure.message;
    throw new Error(
      `Online migration ${operation} failed: ${detail}; the selling version and its data are unchanged`,
    );
  }
  process.stderr.write(
    "Online migration trial passed (advisory); final stopped checks and sale still required\n",
  );
}
