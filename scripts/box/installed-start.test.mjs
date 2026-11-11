import { afterAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
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
  */waitron-dev-luks) echo installed-luks ;;
  */waitron-status.json|*/waitron-images.json) /bin/cat "$@" ;;
  *) echo machine-a ;; esac ;;
 findmnt)
  if [[ "$*" == *SOURCE* ]]; then echo '/dev/mapper/luks-installed-luks[/@rootfs]'
  elif [[ "$*" == *FSROOT* ]]; then printf '/@rootfs\n/@images\n/@volumes\n/@logs\n/@host-state\n'
  else echo "\${ROOT_UUID:-wrong-root}"; fi ;;
 readlink) [ "$*" = "-f /run/systemd/volatile-root" ] || exit 99; echo "\${SOURCE_ROOT:-/dev/vda2}" ;;
 lsblk)
  if [[ "$*" == *MOUNTPOINTS* ]]; then echo "\${MOUNTED:-}"
  elif [[ "$*" == *PKNAME* ]]; then
   if [ "\${!#}" = /dev/vda3 ]; then
    if [[ "$*" == *-d* ]]; then echo vda; else printf 'vda\nvda3\n'; fi
   else [[ "\${!#}" == "\${SOURCE_ROOT:-/dev/vda2}" ]] || exit 99; echo "\${SOURCE_PARENT:-vda}"; fi
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
  if [ "$code" = 200 ]; then
   for ((i=1; i<=$#; i++)); do
    if [ "\${!i}" = -o ]; then ((i+=1)); printf '%s' "$API_STATUS" > "\${!i}"; fi
   done
  fi
  if [[ "$*" == *http_code* ]]; then printf '%s' "$code"; fi
  if [[ "$1" == *f* && "$code" != 200 ]]; then exit 22; fi ;;
 cmp) exit "\${OCCUPIED:-0}" ;;
 systemd-cryptsetup) echo chip >> "$WRITES"; exit "\${CHIP_EXIT:-0}" ;;
 tpm2_pcrextend) echo "extend:$(/bin/cat "$B3_OPEN_MARKER")" >> "$WRITES"; exit "\${EXTEND_EXIT:-0}" ;;
 reboot) echo reboot >> "$WRITES" ;;
 apparmor_parser) echo apparmor >> "$WRITES"; exit "\${APPARMOR_EXIT:-0}" ;;
 node)
  [ "$1" = /opt/waitron-host/box/disk-start.mjs ] || exit 99
  [ "\${DISK_CHECK_EXIT:-0}" = 0 ] || exit 1
  echo '{"action":"ready","diskUuid":"installed-luks","openedBy":"chip","emptyPassword":false,"keySlots":2,"tpmSlots":1,"tpmPcrs":[5,7,8,9,15]}' ;;
 docker)
  echo "docker $* profile=$WAITRON_PRINT_AGENT_APPARMOR" >> "$WRITES"
  [ "\${DOCKER_EXIT:-43}" = 0 ] || exit "\${DOCKER_EXIT:-43}"
  case "$*" in
   'compose config --format json') echo '{"services":{"app":{"image":"app"},"print-agent":{"image":"agent"},"mailpit":{"image":"mailpit"}}}' ;;
   'image inspect '*) echo "sha256:$3" ;;
   'compose ps -q') echo containers ;;
   'inspect '*) echo '[{"Config":{"Labels":{"com.docker.compose.service":"app"}},"State":{"Status":"running"}},{"Config":{"Labels":{"com.docker.compose.service":"print-agent"}},"State":{"Status":"running"}},{"Config":{"Labels":{"com.docker.compose.service":"mailpit"}},"State":{"Status":"running"}}]' ;;
  esac ;;
 sfdisk)
  if [ "$1" = --json ]; then
   [ "$2" = /dev/vda ] || { printf 'sfdisk parent: <%s>\n' "$2" >&2; exit 17; }
   printf '%s\n' "$PARTITION_JSON"; exit 0
  fi
  echo "$*" >> "$WRITES"
  if [ "\${PARTITION_EXIT:-42}" = 0 ]; then /bin/cat > "$LAYOUT_FILE"; fi
  exit "\${PARTITION_EXIT:-42}" ;;
 mktemp) /usr/bin/mktemp -d "$B3_TMP/install.XXXXXX" ;;
 mkfs.vfat|mkfs.ext4|udevadm|umount) : ;;
 cryptsetup)
  if [ "$1" = status ]; then
   [ "$2" = /dev/mapper/luks-installed-luks ] || exit 4
   echo '  device: /dev/vda3'; exit "\${CRYPT_STATUS:-0}"
  fi
  if [ "$1" = luksUUID ]; then echo "\${LUKS_UUID:-installed-luks}"; exit 0; fi
  if [ "$1" = luksDump ]; then printf 'Version: 2\nSubsystem: waitron-box-1\n'; exit 0; fi
  echo "cryptsetup $*" >> "$WRITES"
  for ((i=1; i<=$#; i++)); do
   if [ "\${!i}" = --key-file ]; then ((i+=1)); [ -f "\${!i}" ] && [ ! -s "\${!i}" ] || exit 95; fi
  done
  if [[ "$*" == *luksFormat* ]]; then exit "\${FORMAT_EXIT:-0}"; fi ;;
 mkfs.btrfs) echo "btrfs $*" >> "$WRITES"; exit 44 ;;
 sync) : ;;
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
  "node",
  "systemd-cryptsetup",
  "tpm2_pcrextend",
  "reboot",
  "ls",
  "mktemp",
  "mkfs.vfat",
  "mkfs.ext4",
  "udevadm",
  "umount",
  "cryptsetup",
  "mkfs.btrfs",
  "sync",
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
      B3_TMP: scratch,
      LAYOUT_FILE: join(scratch, "layout"),
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
  it("formats LUKS2 before btrfs and closes the opened mapper on a later failure", () => {
    const result = writer({ PARTITION_EXIT: "0" });
    expect(result.status).toBe(44);
    expect(result.writes).toMatch(
      /cryptsetup .*--type luks2 .*--key-file \S+ luksFormat \/dev\/vdb3/,
    );
    expect(result.writes).toMatch(/cryptsetup open --key-file \S+ \/dev\/vdb3 waitron-dev-root/);
    expect(result.writes).toContain("btrfs -q -f /dev/mapper/waitron-dev-root\n");
    expect(result.writes).toContain("cryptsetup close waitron-dev-root\n");
    expect(readFileSync(join(scratch, "layout"), "utf8")).toContain(
      'type=a8aaea61-baef-47f4-9cff-c4c967ee12c7, name="waitron-box"',
    );
    expect(result.writes).toContain("--subsystem waitron-box-1");
  });
  it("does not format btrfs when LUKS creation fails", () => {
    const result = writer({ PARTITION_EXIT: "0", FORMAT_EXIT: "45" });
    expect(result.status).toBe(45);
    expect(result.writes).not.toContain("btrfs");
    expect(result.writes).not.toContain("cryptsetup close");
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
  it("refuses an unconfirmed disk key before Compose can start", () => {
    const writes = join(scratch, "disk-key-refusal-calls");
    writeFileSync(writes, "");
    const result = spawnSync("bash", [resolve("deploy/box/start-dev.sh")], {
      env: {
        ...process.env,
        PATH: `${scratch}:${process.env.PATH}`,
        ROOT_UUID: "installed-root",
        BASH_ENV: bashEnv,
        B3_TEST_CWD: scratch,
        WRITES: writes,
        DISK_CHECK_EXIT: "1",
      },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(readFileSync(writes, "utf8")).toBe("");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("start.refused:disk-key");
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
  it.each([{ CRYPT_STATUS: "4" }, { LUKS_UUID: "another-disk" }])(
    "refuses an unencrypted or mismatched backing before starting services (%j)",
    (env) => {
      const writes = join(scratch, "wrong-backing-calls");
      writeFileSync(writes, "");
      const result = spawnSync("bash", [resolve("deploy/box/start-dev.sh")], {
        env: {
          ...process.env,
          PATH: `${scratch}:${process.env.PATH}`,
          ROOT_UUID: "installed-root",
          BASH_ENV: bashEnv,
          B3_TEST_CWD: scratch,
          WRITES: writes,
          ...env,
        },
        encoding: "utf8",
        timeout: 5000,
      });
      expect(result.stderr).toContain("start.refused:encrypted-root");
      expect(result.status).toBe(1);
      expect(readFileSync(writes, "utf8")).toBe("");
    },
  );
  it("reports the direct backing disk when the opened mapper is its child", () => {
    const script = join(scratch, "full-start.sh");
    writeFileSync(
      script,
      readFileSync(resolve("deploy/box/start-dev.sh"), "utf8").replaceAll(
        "/run/waitron-",
        `${scratch}/waitron-`,
      ),
    );
    const writes = join(scratch, "evidence-calls");
    writeFileSync(writes, "");
    const result = spawnSync("bash", [script], {
      env: {
        ...process.env,
        PATH: `${scratch}:${process.env.PATH}`,
        ROOT_UUID: "installed-root",
        BASH_ENV: bashEnv,
        B3_TEST_CWD: scratch,
        WRITES: writes,
        DOCKER_EXIT: "0",
        SETUP_HTTP: "200",
        API_STATUS: JSON.stringify({
          provisioned: false,
          environment: "preproduction",
          installationOrigin: "usb",
          needs: ["venue"],
        }),
        PARTITION_JSON: JSON.stringify({
          partitiontable: {
            sectorsize: 512,
            partitions: [
              { size: 1048576 },
              { size: 2097152 },
              { size: 22016000, type: "A8AAEA61-BAEF-47F4-9CFF-C4C967EE12C7", name: "waitron-box" },
            ],
          },
        }),
      },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const evidence = JSON.parse(result.stdout.trim().slice("B3_INSTALLED:".length));
    expect(evidence).toMatchObject({
      luksUuid: "installed-luks",
      luksVersion: "2",
      luksSubsystem: "waitron-box-1",
      dataPartition: { type: "A8AAEA61-BAEF-47F4-9CFF-C4C967EE12C7", name: "waitron-box" },
      partitionBytes: [536870912, 1073741824, 11272192000],
    });
  });
});

describe("the startup-image unlock", () => {
  it.each([
    { chipExit: 0, extendExit: 0, status: 0, markerText: "chip\n", fallback: 0, reboots: 0 },
    { chipExit: 1, extendExit: 0, status: 0, markerText: "bootstrap\n", fallback: 1, reboots: 0 },
    { chipExit: 0, extendExit: 1, status: 1, markerText: "failed\n", fallback: 0, reboots: 1 },
  ])(
    "records the opening and stops after an extension failure (%j)",
    ({ chipExit, extendExit, status, markerText, fallback, reboots }) => {
      const folder = mkdtempSync(join(scratch, "unlock-"));
      mkdirSync(join(folder, "devices"));
      writeFileSync(join(folder, "devices", "test-luks"), "");
      const marker = join(folder, "waitron-disk-opened");
      const script = join(folder, "unlock.sh");
      writeFileSync(
        script,
        readFileSync(resolve("deploy/box/dracut/95waitron/unlock.sh"), "utf8")
          .replaceAll("/run/waitron-", `${folder}/waitron-`)
          .replaceAll("/dev/disk/by-uuid/", `${folder}/devices/`),
      );
      const bashEnv = join(folder, "env");
      writeFileSync(bashEnv, 'getarg() { echo "test-luks"; }\n');
      const writes = join(folder, "writes");
      writeFileSync(writes, "");
      const result = spawnSync("bash", ["-ec", '. "$1"; . "$1"', "hook", script], {
        env: {
          ...process.env,
          PATH: `${scratch}:${process.env.PATH}`,
          BASH_ENV: bashEnv,
          WRITES: writes,
          CHIP_EXIT: String(chipExit),
          EXTEND_EXIT: String(extendExit),
          B3_OPEN_MARKER: marker,
        },
        encoding: "utf8",
        timeout: 5000,
      });
      expect(result.status).toBe(status);
      const calls = readFileSync(writes, "utf8").trim().split("\n");
      expect(calls.slice(0, 2)).toEqual(["chip", `extend:${chipExit === 0 ? "chip" : "failed"}`]);
      expect(calls.filter((line) => line.startsWith("extend:"))).toHaveLength(1);
      expect(calls.filter((line) => line.startsWith("cryptsetup open"))).toHaveLength(fallback);
      expect(calls.filter((line) => line === "reboot")).toHaveLength(reboots);
      expect(readFileSync(marker, "utf8")).toBe(markerText);
    },
  );
});
