import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, it } from "vitest";

const root = mkdtempSync(join(tmpdir(), "upgrade-restart-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const bin = join(root, "bin");
mkdirSync(bin);
for (const [name, body] of Object.entries({
  flock: 'printf "flock %s\\n" "$*" >> "$CALLS"; [ "${BUSY:-0}" = 0 ]',
  "aa-enabled": '[ "${AA_ENABLED:-1}" = 1 ]',
  apparmor_parser: 'echo apparmor >> "$CALLS"; exit "${APPARMOR_EXIT:-0}"',
  docker: `printf 'docker %s\\n' "$*" >> "$CALLS"
case "$*" in
 'compose --profile staff-tunnel ps -a -q tunnel') printf '%s' "\${TUNNEL:-}" ;;
 'compose ps -q') printf 'app-id\\nagent-id\\n' ;;
 'wait '*) exit 0 ;;
 'compose up '*) exit "\${UP_EXIT:-0}" ;;
esac`,
}))
  writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o700 });

function invoke(mode, { held = false, runtime = true, ...knobs } = {}) {
  const folder = mkdtempSync(join(root, "case-"));
  const box = join(folder, "box");
  const host = join(folder, "host");
  mkdirSync(box);
  if (held) {
    mkdirSync(`${box}.upgrades/interrupted`, { recursive: true });
    writeFileSync(`${box}.upgrades/interrupted/attempt.json`, "retained");
  }
  if (runtime) {
    mkdirSync(join(host, "node-v26.7.0/bin"), { recursive: true });
    mkdirSync(join(host, "box/upgrades"), { recursive: true });
    copyFileSync(
      resolve("scripts/box/upgrades/restart.mjs"),
      join(host, "box/upgrades/restart.mjs"),
    );
    writeFileSync(
      join(host, "node-v26.7.0/bin/node"),
      `#!/bin/bash\nprintf 'node %s\\n' "$*" >> "$CALLS"\nif [[ "$1" == */restart.mjs ]]; then exec '${process.execPath}' "$@"; fi\n`,
      { mode: 0o700 },
    );
  }
  const calls = join(folder, "calls");
  writeFileSync(calls, "");
  const result = spawnSync("bash", [resolve("deploy/box/upgrade-restart.sh"), mode], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      WAITRON_DIR: box,
      WAITRON_HOST_DIR: host,
      CALLS: calls,
      ...knobs,
    },
    encoding: "utf8",
    timeout: 5000,
  });
  return { ...result, calls: readFileSync(calls, "utf8"), box, host };
}

it("holds an unresolved manual attempt before starting any container", () => {
  const result = invoke("run", { held: true });
  expect(result.status).toBe(78);
  expect(result.stderr).toContain("restore or keep");
  expect(result.calls).toContain(`cli.mjs recover ${result.box}`);
  expect(result.calls).not.toContain("docker ");
  expect(readFileSync(`${result.box}.upgrades/interrupted/attempt.json`, "utf8")).toBe("retained");
});

it("recovers before Docker using only the retained runtime", () => {
  const result = invoke("offline", { held: true });
  expect(result.status).toBe(0);
  expect(result.calls).toContain(`cli.mjs offline-recovery ${result.box}`);
  expect(result.calls).not.toContain("docker ");
});

it("refuses missing retained runtime or a busy host before Docker", () => {
  for (const [knobs, code, reason] of [
    [{ held: true, runtime: false }, 78, "retained runtime"],
    [{ runtime: false }, 78, "retained runtime"],
    [{ BUSY: "1" }, 75, "another host operation"],
  ]) {
    const result = invoke("run", knobs);
    expect(result.status).toBe(code);
    expect(result.stderr).toContain(reason);
    expect(result.calls).not.toContain("docker ");
  }
});

it("starts under the lock, releases it, and ends the group when a container exits", () => {
  const result = invoke("run");
  expect(result.status).toBe(1);
  expect(result.calls.indexOf("apparmor")).toBeLessThan(result.calls.indexOf("docker compose up"));
  expect(result.calls).toContain("docker compose up -d --pull never --remove-orphans\n");
  expect(result.calls.indexOf("docker compose ps -q")).toBeLessThan(
    result.calls.indexOf("flock -u 9"),
  );
  expect(result.calls).toContain("docker compose --profile staff-tunnel stop --timeout 10\n");
});

it("does not start a group whose AppArmor profile could not be loaded", () => {
  const result = invoke("run", { APPARMOR_EXIT: "7" });
  expect(result.status).toBe(7);
  expect(result.calls).not.toContain("docker ");
});

it("includes a previously installed tunnel when reopening the group", () => {
  const result = invoke("run", { TUNNEL: "tunnel-id" });
  expect(result.status).toBe(1);
  expect(result.calls).toContain(
    "docker compose --profile staff-tunnel up -d --pull never --remove-orphans\n",
  );
});

it("starts with Docker's default profile when AppArmor is disabled on the host", () => {
  const result = invoke("run", { AA_ENABLED: "0" });
  expect(result.status).toBe(1);
  expect(result.calls).toContain("docker compose up -d --pull never --remove-orphans\n");
  expect(result.calls).not.toContain("apparmor\n");
});
