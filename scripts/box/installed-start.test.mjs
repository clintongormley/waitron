import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
 findmnt) if [[ "$*" == *UUID* ]]; then echo "\${ROOT_UUID:-wrong-root}"; else echo /dev/vda2; fi ;;
 lsblk)
  if [[ "$*" == *MOUNTPOINTS* ]]; then echo "\${MOUNTED:-}"
  elif [[ "$*" == *PKNAME* ]]; then echo vda
  elif [[ "$*" == *SERIAL* && "$*" != *json* ]]; then echo "\${SERIAL:-waitron-dev-target}"
  else printf '%s\n' "$DISKS"; fi ;;
 ls) echo "\${HOLDERS:-}" ;;
 blockdev) echo 12884901888 ;;
 cmp) exit "\${OCCUPIED:-0}" ;;
 apparmor_parser) echo apparmor >> "$WRITES"; exit "\${APPARMOR_EXIT:-0}" ;;
 docker) echo "docker $*" >> "$WRITES"; exit 43 ;;
 sfdisk) echo "$*" >> "$WRITES"; exit 42 ;;
 *) echo "unexpected $name $*" >&2; exit 99 ;;
esac
`,
  { mode: 0o700 },
);
for (const name of [
  "cat",
  "findmnt",
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
  const result = spawnSync("bash", [resolve("deploy/box/install-dev.sh"), ...args], {
    env: {
      ...process.env,
      PATH: `${scratch}:${process.env.PATH}`,
      WRITES: writes,
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
    ["mounted", { MOUNTED: "/personal" }],
    ["holders", { HOLDERS: "dm-0" }],
  ])("refuses %s before any partition write", (reason, env, args = []) => {
    const result = writer(env, args);
    expect(result.stderr).toContain(`install.refused:${reason}`);
    expect(result.status).toBe(1);
    expect(result.writes).toBe("");
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
    ["0", 43, "apparmor\ndocker compose up -d --pull never\n"],
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
