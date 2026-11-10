import { afterAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

vi.setConfig({ testTimeout: 15_000 });

const scratch = mkdtempSync(join(tmpdir(), "b3-installed-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const stub = join(scratch, "command");
writeFileSync(
  stub,
  `#!/bin/bash
name="\${0##*/}"
case "$name" in
 cat) case "$*" in
  */product_name) echo "\${DMI:-Waitron-B3-dev}" ;;
  */waitron-dev-root) echo installed-root ;;
  *) echo machine-a ;; esac ;;
 findmnt) echo "\${ROOT_UUID:-wrong-root}" ;;
 readlink) [ "$*" = "-f /run/systemd/volatile-root" ] || exit 99; echo "\${SOURCE_ROOT:-/dev/vda2}" ;;
 lsblk)
  if [[ "$*" == *MOUNTPOINTS* ]]; then echo "\${MOUNTED:-}"
  elif [[ "$*" == *PKNAME* ]]; then [[ "\${!#}" == "\${SOURCE_ROOT:-/dev/vda2}" ]] || exit 99; echo "\${SOURCE_PARENT:-vda}"
  elif [[ "$*" == *SERIAL* && "$*" != *json* ]]; then echo "\${SERIAL:-waitron-dev-target}"
  else printf '%s\n' "$DISKS"; fi ;;
 ls) echo "\${HOLDERS:-}" ;;
 blockdev)
  read -r count < "$SIZE_CALLS"
  printf '%s\n' "$((count + 1))" > "$SIZE_CALLS"
  if [ "$count" = 0 ]; then echo "\${DISK_SIZE:-12884901888}"; else echo "\${FINAL_SIZE:-12884901888}"; fi ;;
 sleep) : ;;
 curl)
  echo "curl $*" >> "$WRITES"
  if [[ "$*" == */health ]]; then exit 0; fi
  code="\${SETUP_HTTP:-404}"
  if [[ "$*" == *http_code* ]]; then printf '%s' "$code"; fi
  if [[ "$1" == *f* && "$code" != 200 ]]; then exit 22; fi ;;
 cmp) exit "\${OCCUPIED:-0}" ;;
 apparmor_parser) echo apparmor >> "$WRITES"; exit "\${APPARMOR_EXIT:-0}" ;;
 docker) echo "docker $* profile=$WAITRON_PRINT_AGENT_APPARMOR" >> "$WRITES"; exit "\${DOCKER_EXIT:-43}" ;;
 sfdisk) echo "$*" >> "$WRITES"; exit 42 ;;
 *) echo "unexpected $name $*" >&2; exit 99 ;;
esac
`,
  { mode: 0o700 },
);
for (const name of [
  "cat",
  "findmnt",
  "readlink",
  "sleep",
  "curl",
  "lsblk",
  "blockdev",
  "cmp",
  "sfdisk",
  "apparmor_parser",
  "docker",
  "ls",
])
  symlinkSync(stub, join(scratch, name));
const disk = (path = "/dev/vdb", serial = "waitron-dev-target") => ({
  path,
  type: "disk",
  serial,
  size: 12884901888,
});
const source = disk("/dev/vda", "waitron-dev-stick");
function writer(env = {}, args = []) {
  const writes = join(scratch, "writes");
  writeFileSync(writes, "");
  const sizeCalls = join(scratch, "size-calls");
  writeFileSync(sizeCalls, "0\n");
  const result = spawnSync("bash", [resolve("deploy/box/install-dev.sh"), ...args], {
    env: {
      ...process.env,
      PATH: `${scratch}:${process.env.PATH}`,
      WRITES: writes,
      SIZE_CALLS: sizeCalls,
      DISKS: JSON.stringify({ blockdevices: [source, disk()] }),
      ...env,
    },
    encoding: "utf8",
    timeout: 5000,
  });
  return { ...result, writes: readFileSync(writes, "utf8") };
}

describe("development disk writer", () => {
  it.each([
    ["arguments", {}, ["/dev/vda"]],
    ["machine", { DMI: "ordinary laptop" }],
    ["disk-count", { DISKS: JSON.stringify({ blockdevices: [source, disk(), disk("/dev/vdc")] }) }],
    [
      "serial",
      { DISKS: JSON.stringify({ blockdevices: [source, disk("/dev/vdb", "personal-disk")] }) },
    ],
    ["disk-count", { DISKS: JSON.stringify({ blockdevices: [source] }) }],
    ["occupied", { OCCUPIED: "1" }],
    ["device", { DISKS: JSON.stringify({ blockdevices: [source, disk("/dev/sdb")] }) }],
    ["size", { DISK_SIZE: "12884901887", FINAL_SIZE: "12884901887" }],
    ["size", { FINAL_SIZE: "12884901889" }],
    ["serial", { SERIAL: "replacement-disk" }],
    ["mounted", { MOUNTED: "/personal" }],
    ["holders", { HOLDERS: "dm-0" }],
  ])("refuses %s before any partition write", (reason, env, args = []) => {
    const result = writer(env, args);
    expect(result.stderr).toContain(`install.refused:${reason}`);
    expect(result.status).toBe(1);
    expect(result.writes).toBe("");
  });
  it("excludes the USB source while admitting the virtio target", () => {
    const result = writer({
      SOURCE_ROOT: "/dev/sda2",
      SOURCE_PARENT: "sda",
      DISKS: JSON.stringify({
        blockdevices: [disk("/dev/sda", "waitron-dev-stick"), disk("/dev/vda")],
      }),
    });
    expect(result.status).toBe(42);
    expect(result.writes).toBe("/dev/vda\n");
  });
  it("admits only the blank named QEMU target to the first partition write", () => {
    const result = writer();
    expect(result.status).toBe(42);
    expect(result.writes).toBe("/dev/vdb\n");
  });
});

describe("installed startup", () => {
  const bashEnv = join(scratch, "bash-env");
  writeFileSync(bashEnv, `cd() { builtin cd "$B3_TEST_CWD"; }\n`);
  it.each([
    ["0", 43, "apparmor\ndocker compose up -d --pull never profile=waitron-print-agent\n"],
    ["7", 7, "apparmor\n"],
  ])("loads AppArmor before Compose and stops on refusal (%s)", (apparmorExit, code, calls) => {
    const writes = join(scratch, "startup-calls");
    writeFileSync(writes, "");
    const result = spawnSync("bash", [resolve("deploy/box/start-dev.sh")], {
      env: {
        ...process.env,
        PATH: `${scratch}:${process.env.PATH}`,
        ROOT_UUID: "installed-root",
        BASH_ENV: bashEnv,
        B3_TEST_CWD: scratch,
        WRITES: writes,
        APPARMOR_EXIT: apparmorExit,
      },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(code);
    expect(readFileSync(writes, "utf8")).toBe(calls);
  });
  it("starts an already set-up server without waiting for the absent setup route", () => {
    const writes = join(scratch, "set-up-start-calls");
    writeFileSync(writes, "");
    const result = spawnSync("bash", [resolve("deploy/box/start-dev.sh")], {
      env: {
        ...process.env,
        PATH: `${scratch}:${process.env.PATH}`,
        ROOT_UUID: "installed-root",
        BASH_ENV: bashEnv,
        B3_TEST_CWD: scratch,
        WRITES: writes,
        DOCKER_EXIT: "0",
      },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("B3_INSTALLED:");
    expect(readFileSync(writes, "utf8")).toContain("https://127.0.0.1/health");
  });
  it("does not call a setup server's HTTP 500 an already set-up server", () => {
    const writes = join(scratch, "failed-start-calls");
    writeFileSync(writes, "");
    const result = spawnSync("bash", [resolve("deploy/box/start-dev.sh")], {
      env: {
        ...process.env,
        PATH: `${scratch}:${process.env.PATH}`,
        ROOT_UUID: "installed-root",
        BASH_ENV: bashEnv,
        B3_TEST_CWD: scratch,
        WRITES: writes,
        DOCKER_EXIT: "0",
        SETUP_HTTP: "500",
      },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("B3_INSTALLED:");
  });
  it("refuses the wrong mounted root before Docker starts", () => {
    const result = spawnSync("bash", [resolve("deploy/box/start-dev.sh")], {
      env: { ...process.env, PATH: `${scratch}:${process.env.PATH}` },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.stderr).toContain("start.refused:root-uuid");
    expect(result.status).toBe(1);
  });
});
