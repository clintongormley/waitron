import * as fs from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyStoppedTree } from "./copy.mjs";
import { clockStatusRelay } from "./host.mjs";
import { upgradeStatus, writeFileDurable } from "./transaction.mjs";

const execute = promisify(execFile);
const command = (file, args) => execute(file, args, { maxBuffer: 4 * 1024 * 1024 });
const namesFor = (directory) => {
  const prefix =
    "waitron-upgrade-" + createHash("sha256").update(directory).digest("hex").slice(0, 16);
  return [prefix + "-readiness", prefix + "-sale", prefix + "-agent"];
};

export async function removeUpgradeCheckContainers(directory, run = command) {
  for (const name of namesFor(directory).reverse()) {
    let label;
    try {
      label = (
        await run("docker", [
          "inspect",
          "--format",
          '{{index .Config.Labels "waitron.upgrade.directory"}}',
          name,
        ])
      ).stdout.trim();
    } catch (error) {
      if (error.code === 1 && /No such (object|container)/.test(error.stderr)) continue;
      throw error;
    }
    if (label !== directory) throw new Error("upgrade check container belongs to another attempt");
    await run("docker", ["rm", "--force", name]);
  }
}

export async function checkUpgradeCandidate({ boxDirectory, directory, run = command }) {
  const marker = await upgradeStatus(directory);
  const config = JSON.parse(
    (
      await run("docker", [
        "compose",
        "--project-directory",
        boxDirectory,
        "-f",
        join(boxDirectory, "compose.yml"),
        "config",
        "--format",
        "json",
      ])
    ).stdout,
  );
  const work = join(directory, "check");
  await fs.mkdir(work, { mode: 0o700 });
  const [readiness, app, agent] = namesFor(directory);
  const started = [];
  let relay;
  let failure;
  const reports = [];
  try {
    for (const [index, name] of ["state", "agent"].entries())
      await copyStoppedTree(join(directory, "copies", String(index)), join(work, name));
    const owner = await fs.stat(join(work, "state"));
    for (const name of ["logs", "backups", "tunnel"]) {
      const path = join(work, name);
      await fs.mkdir(path, { mode: 0o750 });
      await fs.chown(path, owner.uid, owner.gid);
    }
    relay = await clockStatusRelay({ directory: join(work, "clock") });
    const environment =
      Object.entries(config.services.app.environment ?? {})
        .filter(([, value]) => value !== null)
        .map(([key, value]) => {
          if (String(value).includes("\n"))
            throw new Error("upgrade environment has a multiline value");
          return `${key}=${value}`;
        })
        .join("\n") + "\n";
    const envFile = join(work, "app.env");
    await writeFileDurable(envFile, environment);
    const mounts = [
      "state:/var/lib/waitron/state",
      "logs:/var/lib/waitron/logs",
      "backups:/var/lib/waitron/backups",
      "tunnel:/var/lib/waitron/tunnel",
      "clock:/run/waitron-box:ro",
    ].flatMap((mount) => [
      "--mount",
      `type=bind,src=${join(work, mount.split(":")[0])},dst=${mount.split(":")[1]}${mount.endsWith(":ro") ? ",readonly" : ""}`,
    ]);
    const common = [
      "--label",
      `waitron.upgrade.directory=${directory}`,
      "--env-file",
      envFile,
      ...mounts,
    ];
    const result = (stdout) => JSON.parse(stdout.trim().split("\n").at(-1));
    started.push(readiness);
    reports.push(
      ...result(
        (
          await run("docker", [
            "run",
            "--rm",
            "--name",
            readiness,
            "--network",
            "host",
            ...common,
            "--entrypoint",
            "node",
            marker.images.candidate.app,
            "/app/upgrade-checks.js",
            "readiness",
          ])
        ).stdout,
      ),
    );
    started.push(app);
    await run("docker", [
      "run",
      "-d",
      "--name",
      app,
      "--network",
      "none",
      ...common,
      "--entrypoint",
      "sleep",
      marker.images.candidate.app,
      "infinity",
    ]);
    started.push(agent);
    await run("docker", [
      "run",
      "-d",
      "--name",
      agent,
      "--network",
      `container:${app}`,
      "--label",
      `waitron.upgrade.directory=${directory}`,
      "--env",
      "WAITRON_SERVER_URL=https://127.0.0.1",
      "--mount",
      `type=bind,src=${join(work, "agent")},dst=/var/lib/waitron-print-agent`,
      marker.images.candidate["print-agent"],
    ]);
    const status = `for(let i=0;i<90;i++){try{const r=await fetch("http://127.0.0.1:9110/status.json");if(r.ok){await r.json();process.exit(0)}}catch{}await new Promise(r=>setTimeout(r,1000))}throw Error("upgrade agent status unavailable")`;
    await run("docker", ["exec", app, "node", "--input-type=module", "-e", status]);
    await run("docker", ["stop", "--time", "10", agent]);
    reports.push(
      ...result(
        (await run("docker", ["exec", app, "node", "/app/upgrade-checks.js", "sale"])).stdout,
      ),
    );
  } catch (error) {
    failure = error;
  } finally {
    const cleanups = [];
    for (const name of started.reverse()) {
      try {
        await run("docker", ["rm", "--force", name]);
      } catch (error) {
        if (!(error.code === 1 && /No such container/.test(error.stderr))) cleanups.push(error);
      }
    }
    try {
      await relay?.close();
    } catch (error) {
      cleanups.push(error);
    }
    await fs.rm(work, { recursive: true, force: true });
    failure ??= cleanups[0];
  }
  if (failure) throw failure;
  return reports;
}
