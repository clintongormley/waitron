import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout, clearTimeout } from "node:timers";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { copyStoppedTree } from "./upgrades/copy.mjs";
import { upgradePayload, upgradeStage } from "../../bench/box-installer/upgrade.mjs";

vi.setConfig({ testTimeout: 10_000 });

it("rejects changed rows after reboot without replacing the original comparison baseline", () => {
  const root = mkdtempSync(join(tmpdir(), "upgrade-baseline-"));
  try {
    const box = join(root, "box"),
      bin = join(root, "bin"),
      nodeBin = `${box}-host/node-v26.7.0/bin`;
    for (const folder of [box, bin, nodeBin]) mkdirSync(folder, { recursive: true });
    const before = '{"checksum":"original"}\n';
    writeFileSync(join(box, "before.json"), before);
    writeFileSync(
      join(nodeBin, "node"),
      "#!/bin/sh\nprintf '%s\\n' '{\"checksum\":\"changed\"}'\n",
      { mode: 0o700 },
    );
    for (const name of ["jq", "docker", "start", "systemctl"])
      writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    writeFileSync(join(bin, "timedatectl"), "#!/bin/sh\necho yes\n", { mode: 0o700 });
    const payload = upgradePayload("reopened")
      .replaceAll("/opt/waitron", box)
      .replaceAll("/usr/local/sbin/waitron-dev-start", join(bin, "start"));
    const result = spawnSync("bash", ["-c", payload], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status, result.stderr).toBe(1);
    expect(readFileSync(join(box, "before.json"), "utf8")).toBe(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each(["restore", "keep"])(
  "joins the queued boot gate after %s before another host operation",
  (choice) => {
    const root = mkdtempSync(join(tmpdir(), "upgrade-gate-"));
    try {
      const bin = join(root, "bin"),
        script = join(root, "waitron.sh"),
        held = join(root, "held");
      mkdirSync(bin);
      writeFileSync(script, '#!/bin/sh\ntouch "$GATE_HOLD"\n');
      writeFileSync(
        join(bin, "systemctl"),
        '#!/bin/sh\n[ "$*" = "start waitron-app.service" ] || exit 2\nrm "$GATE_HOLD"\n',
        { mode: 0o700 },
      );
      writeFileSync(join(bin, "flock"), '#!/bin/sh\n[ ! -e "$GATE_HOLD" ]\n', { mode: 0o700 });
      const payload = upgradePayload("manual"),
        start = payload.indexOf(`bash /opt/waitron-host/waitron.sh ${choice}\n`);
      const end = payload.indexOf(
        "/opt/waitron-host/node-v26.7.0/bin/node --input-type=module",
        start,
      );
      const commands = payload.slice(start, end).replaceAll("/opt/waitron-host/waitron.sh", script);
      const result = spawnSync("bash", ["-ec", `${commands}\nflock -n host-operation true`], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GATE_HOLD: held },
        encoding: "utf8",
        timeout: 5000,
      });
      expect(result.status, result.stderr).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it("waits for the source's completed stable start before comparing or stopping it", () => {
  const root = mkdtempSync(join(tmpdir(), "upgrade-stayed-"));
  try {
    const box = join(root, "box"),
      bin = join(root, "bin"),
      nodeBin = `${box}-host/node-v26.7.0/bin`;
    for (const folder of [box, bin, nodeBin]) mkdirSync(folder, { recursive: true });
    writeFileSync(join(box, "before.json"), '{"checksum":"original"}\n');
    writeFileSync(
      join(nodeBin, "node"),
      `#!/bin/sh
case "$*" in
 *'startup counter did not clear'*) [ ! -e "$START_PENDING" ] || rm "$START_PENDING" ;;
 *) [ ! -f "$START_PENDING" ] || exit 1; printf '%s\\n' '{"checksum":"original"}' ;;
esac
`,
      { mode: 0o700 },
    );
    for (const name of ["jq", "docker"])
      writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    writeFileSync(join(root, "boot-pending"), "pending");
    writeFileSync(
      join(bin, "systemctl"),
      '#!/bin/sh\n[ "$*" = "start waitron-app.service" ] || exit 2\nrm "$BOOT_PENDING"\n',
      { mode: 0o700 },
    );
    writeFileSync(
      join(bin, "start"),
      '#!/bin/sh\n[ ! -e "$BOOT_PENDING" ] || exit 1\ntouch "$START_PENDING"\n',
      { mode: 0o700 },
    );
    writeFileSync(join(bin, "timedatectl"), "#!/bin/sh\necho yes\n", { mode: 0o700 });
    const payload = upgradePayload("reopened")
      .replaceAll("/opt/waitron", box)
      .replaceAll("/usr/local/sbin/waitron-dev-start", join(bin, "start"));
    const result = spawnSync("bash", ["-c", payload], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        START_PENDING: join(root, "pending"),
        BOOT_PENDING: join(root, "boot-pending"),
      },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("does not announce a restore cut when flushing its partial target fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "upgrade-cut-flush-"));
  let child;
  try {
    const bin = join(root, "bin"),
      source = join(root, "copies/0"),
      target = join(root, "target"),
      shim = join(root, "cp");
    for (const folder of [bin, source, target]) mkdirSync(folder, { recursive: true });
    writeFileSync(join(source, "data"), "source");
    writeFileSync(join(bin, "sync"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    const stage = upgradeStage();
    const begin = stage.indexOf("printf '%s' '#!/bin/bash"),
      end = stage.indexOf("\nchmod 700", begin);
    const write = stage
      .slice(begin, end)
      .replaceAll("/opt/waitron-host/probe-bin/cp", shim)
      .replaceAll(
        "/var/lib/docker/volumes/waitron_state/_data/partial-restore",
        join(root, "partial"),
      );
    expect(spawnSync("bash", ["-ec", write]).status).toBe(0);
    child = spawn("bash", [shim, "-a", "--", join(source, "data"), target], {
      detached: true,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, A950_PROBE: "restore" },
    });
    let output = "";
    child.stdout.on("data", (bytes) => {
      output += bytes;
      if (output.includes("A950_CUT")) process.kill(-child.pid, "SIGTERM");
    });
    const timer = setTimeout(() => process.kill(-child.pid, "SIGKILL"), 1000);
    const code = await new Promise((done) => child.once("exit", done));
    clearTimeout(timer);
    expect(output).not.toContain("A950_CUT");
    expect(existsSync(join(root, "console"))).toBe(false);
    expect(code).toBe(1);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null)
      process.kill(-child.pid, "SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});

it("makes the copy cut observable when the controller captures subprocess stdout", async () => {
  const root = mkdtempSync(join(tmpdir(), "upgrade-cut-console-"));
  try {
    const bin = join(root, "bin"),
      source = join(root, "copies/0"),
      consoleFile = join(root, "console"),
      shim = join(bin, "cp");
    for (const folder of [bin, source]) mkdirSync(folder, { recursive: true });
    writeFileSync(join(source, "data"), "source");
    for (const command of ["sync", "sleep"])
      writeFileSync(join(bin, command), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const stage = upgradeStage(),
      begin = stage.indexOf("printf '%s' '#!/bin/bash"),
      end = stage.indexOf("\nchmod 700", begin);
    const write = stage
      .slice(begin, end)
      .replaceAll("/opt/waitron-host/probe-bin/cp", shim)
      .replaceAll(
        "/var/lib/docker/volumes/waitron_state/_data/partial-restore",
        join(root, "partial"),
      )
      .replaceAll("/dev/console", consoleFile);
    expect(spawnSync("bash", ["-ec", write]).status).toBe(0);
    chmodSync(shim, 0o700);
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    vi.stubEnv("A950_PROBE", "restore");
    await copyStoppedTree(source, join(root, "destination"));
    expect(existsSync(consoleFile)).toBe(true);
    expect(readFileSync(consoleFile, "utf8")).toBe("A950_CUT\n");
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

it.each([0, 1])("reports unexpected online failure-probe outcomes (%s)", async (exitCode) => {
  const { failedOnlineTrialProbe } = await import("../../bench/box-installer/upgrade.mjs");
  const root = mkdtempSync(join(tmpdir(), "upgrade-online-probe-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "docker"), "#!/bin/sh\necho app-id\n", { mode: 0o700 });
    writeFileSync(
      join(bin, "flock"),
      `#!/bin/sh\necho "capture refused in fixture" >&2\nexit ${exitCode}\n`,
      { mode: 0o700 },
    );
    const commands = failedOnlineTrialProbe.replaceAll("/opt/waitron", join(root, "box"));
    mkdirSync(join(root, "box"));
    const result = spawnSync("bash", ["-ec", commands], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status, result.stderr).toBe(1);
    if (exitCode === 1) expect(result.stderr).toContain("capture refused in fixture");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each([false, true, "refused"])(
  "requires the successful Linux attempt to report an online pass (%s)",
  (pass) => {
    const root = mkdtempSync(join(tmpdir(), "upgrade-pass-check-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      mkdirSync(join(root, "box"));
      writeFileSync(
        join(bin, "flock"),
        "#!/bin/sh\n" +
          (pass === "refused"
            ? 'echo "actual upgrade refusal" >&2\nexit 7\n'
            : (pass ? 'echo "Online migration trial passed" >&2\n' : "") + "exit 0\n"),
        { mode: 0o700 },
      );
      const lines = upgradePayload("manual").split("\n");
      const start = lines.findIndex((line) => line.includes(">/opt/waitron/success.json"));
      const commands = lines
        .slice(
          start,
          lines.findIndex((line, index) => index > start && line.startsWith("jq ")),
        )
        .join("\n")
        .replaceAll("/opt/waitron", join(root, "box"));
      const result = spawnSync("bash", ["-ec", commands], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        encoding: "utf8",
        timeout: 5000,
      });
      expect(result.status, result.stderr).toBe(pass === "refused" ? 7 : pass ? 0 : 1);
      if (pass === "refused") expect(result.stderr).toContain("actual upgrade refusal");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it("keeps the optional inbox service and volume in the staged Compose configuration", () => {
  const root = mkdtempSync(join(tmpdir(), "upgrade-stage-profiles-"));
  try {
    writeFileSync(
      join(root, "compose.yml"),
      readFileSync(new URL("../../deploy/compose.yml", import.meta.url)),
    );
    const configPath = join(root, "config.json");
    const command = upgradeStage()
      .split("\n")
      .find((line) => line.startsWith("COMPOSE_PROFILES="));
    const result = spawnSync(
      "bash",
      ["-ec", command.replace("/run/a950-compose.json", '"$A950_CONFIG"')],
      {
        cwd: root,
        env: { ...process.env, A950_CONFIG: configPath },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.services.mailpit).toBeDefined();
    expect(config.volumes.mailpit).toBeDefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
