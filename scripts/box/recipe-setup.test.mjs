import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const expected = {
  uuid: "5418a8bb-eeb9-4e94-832f-72629874781e",
  sha256: "original-root",
  images: { app: "app-config", "print-agent": "agent-config", mailpit: "mail-config" },
};
const complete = {
  uuid: expected.uuid,
  hashBefore: "original-root",
  hashAfter: "original-root",
  images: { app: "app-config", "print-agent": "agent-config", mailpit: "mail-config" },
  services: { app: "running", "print-agent": "running", mailpit: "running" },
  status: {
    provisioned: false,
    environment: "preproduction",
    installationOrigin: "usb",
    needs: ["venue"],
  },
};

it.each([
  ['B3_DISK_START:{"action":"restart"}\n', true],
  ['B3_DISK_START:{"action":"ready"}\n', false],
  ['B3_INSTALLED:{}\nB3_DISK_START:{"action":"restart"}\n', false],
  [
    'B3_DISK_START:{"action":"restart"}\nB3_DISK_START:{"command":"systemctl","operation":"start","status":1}\n',
    false,
  ],
  ['B3_DISK_START:{"action":"restart"}\ndisk_start.refused {}\n', false],
  ...[
    "Starting docker.service - Docker Application Container Engine...",
    "Starting Docker Application Container Engine...",
    "Started Docker Application Container Engine.",
    "Listening on Docker Socket for the API.",
    "Started docker.service - Docker Application Container Engine.",
    "Starting docker.socket - Docker Socket for the API...",
    "Listening on docker.socket - Docker Socket for the API.",
    "Starting \u001b[0;1;39mdocker.service\u001b[0m - Docker Application Container Engine...",
  ].map((line) => [`${line}\nB3_DISK_START:{"action":"restart"}\n`, false]),
])("checks the bootstrap restart without Docker (%j)", async (serial, expected) => {
  const { bootstrapSucceeded } = await import("./recipe-setup.mjs");
  expect(bootstrapSucceeded(serial)).toBe(expected);
});

it.each([
  ["basic.target: Found ordering cycle on docker.socket/start", true],
  ["Job sockets.target/start deleted to break ordering cycle", true],
  ["Ordering cycle found, skipping Docker Socket for the API", true],
  ["Started docker.service - Docker Application Container Engine.", false],
])("reports a boot ordering cycle (%s)", async (serial, expected) => {
  const { bootHasOrderingCycle } = await import("./recipe-setup.mjs");
  expect(bootHasOrderingCycle(serial)).toBe(expected);
});

describe("recipe boot evidence", () => {
  it.each(["", undefined])(
    "names a missing image setting before using a path (%s)",
    (value) => {
      const root = mkdtempSync(join(tmpdir(), "b3-image-argument-"));
      const env = { ...process.env };
      if (value === undefined) delete env.B3_RECIPE_IMAGE;
      else env.B3_RECIPE_IMAGE = value;
      try {
        const result = spawnSync(
          process.execPath,
          [
            fileURLToPath(new URL("../../bench/box-installer/run.mjs", import.meta.url)),
            "--case",
            "recipe-setup",
            "--run-dir",
            join(root, "check"),
          ],
          { env, encoding: "utf8", timeout: 5000 },
        );
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("B3_RECIPE_IMAGE");
        expect(result.stderr).not.toContain("EISDIR");
        expect(result.stderr).not.toContain("ERR_INVALID_ARG_TYPE");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    10000,
  );

  it("identifies a guest that exits before the preload success marker", () => {
    const root = mkdtempSync(join(tmpdir(), "b3-guest-exit-"));
    try {
      writeFileSync(join(root, "uuid"), expected.uuid);
      const qemu = join(root, "qemu-system-x86_64");
      writeFileSync(qemu, '#!/bin/sh\nprintf "%s\\n" "$@" > "$B3_QEMU_ARGS"\nsleep 0.1\nexit 0\n');
      chmodSync(qemu, 0o700);
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("../../bench/box-installer/run.mjs", import.meta.url)),
          "--case",
          "recipe-setup",
          "--run-dir",
          join(root, "check"),
        ],
        {
          env: {
            ...process.env,
            PATH: `${root}:${process.env.PATH}`,
            B3_POPULATE: "1",
            B3_QEMU_ARGS: join(root, "qemu-args"),
            B3_RECIPE_IMAGE: join(root, "image"),
          },
          encoding: "utf8",
          timeout: 5000,
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("guest exited before B3_PRELOAD_OK");
      expect(readFileSync(join(root, "qemu-args"), "utf8")).toContain(
        "systemd.unit=setup-smoke.service",
      );
      const args = readFileSync(join(root, "qemu-args"), "utf8");
      for (const name of ["waitron-disk-start", "waitron-disk-ready"]) {
        const encoded = args.match(
          new RegExp(`systemd.extra-unit.${name}\\.service=([^\\n]+)`),
        )?.[1];
        expect(encoded).toBeTruthy();
        expect(Buffer.from(encoded, "base64").toString()).toContain("ExecStart=/usr/bin/true");
        expect(Buffer.from(encoded, "base64").toString()).toContain("DefaultDependencies=no");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 10000);

  it("accepts the built root serving fresh setup with all embedded services", async () => {
    await expect(
      import("./recipe-setup.mjs").then(({ recipeFailures }) => recipeFailures(expected, complete)),
    ).resolves.toEqual([]);
  });

  it.each([
    ["another root", { uuid: "another-root" }, ["root-uuid"]],
    ["a changed input", { hashBefore: "different" }, ["artifact"]],
    ["persistent boot writes", { hashAfter: "different" }, ["artifact"]],
    [
      "an absent guest image report",
      { images: undefined },
      ["image:app", "image:print-agent", "image:mailpit"],
    ],
    [
      "an incomplete guest",
      { services: {} },
      ["service:app", "service:print-agent", "service:mailpit"],
    ],
    [
      "no service report",
      { services: undefined },
      ["service:app", "service:print-agent", "service:mailpit"],
    ],
    ["another app", { images: { ...complete.images, app: "wrong" } }, ["image:app"]],
    [
      "a stopped agent",
      { services: { ...complete.services, "print-agent": "exited" } },
      ["service:print-agent"],
    ],
  ])("refuses %s", async (_label, patch, failures) => {
    await expect(
      import("./recipe-setup.mjs").then(({ recipeFailures }) =>
        recipeFailures(expected, { ...complete, ...patch }),
      ),
    ).resolves.toEqual(failures);
  });

  it.each([
    undefined,
    null,
    "not JSON status",
    [],
    {},
    { ...complete.status, provisioned: true },
    { ...complete.status, environment: "production" },
    { ...complete.status, installationOrigin: undefined },
    { ...complete.status, installationOrigin: "manual" },
    { ...complete.status, needs: [] },
    { ...complete.status, developmentMode: false },
    { ...complete.status, operation: {} },
    { ...complete.status, operationBlocked: false },
  ])("refuses an unusable setup response %#", async (status) => {
    await expect(
      import("./recipe-setup.mjs").then(({ recipeFailures }) =>
        recipeFailures(expected, { ...complete, status }),
      ),
    ).resolves.toEqual(["setup-status"]);
  });
});

describe("installed boot evidence", () => {
  const first = {
    ...complete,
    uuid: "installed-root",
    luksUuid: "installed-luks",
    luksVersion: "2",
    luksSubsystem: "waitron-box-1",
    dataPartition: { type: "A8AAEA61-BAEF-47F4-9CFF-C4C967EE12C7", name: "waitron-box" },
    partitionBytes: [536870912, 1073741824, 11272192000],
    machineId: "machine-a",
    ca: "ca-a",
    writerAbsent: true,
    disk: {
      action: "ready",
      openedBy: "chip",
      emptyPassword: false,
      keySlots: 2,
      tpmSlots: 1,
      tpmPcrs: [5, 7, 8, 9, 15],
    },
    areas: ["@rootfs", "@images", "@volumes", "@logs", "@host-state"],
    network: {
      ok: true,
      wired: { connected: true, address: "192.0.2.8" },
      wifi: { connectedSsidHex: null, savedSsidHex: null },
      change: null,
      bootCopy: { state: "pending", reason: null, failure: null },
    },
    networkInterfaces: { eth0: [{ address: "192.0.2.8", internal: false }] },
  };
  it("accepts the installed services and a second boot keeping identity", async () => {
    const { installedFailures } = await import("./recipe-setup.mjs");
    expect(installedFailures(expected, "installed-root", first, first)).toEqual([]);
  });
  it.each([
    { network: undefined },
    { network: { ok: false, reason: "host_failed" } },
    { network: { ok: true, wired: { connected: false, address: null } } },
    { network: { ok: true, wired: { connected: true, address: "192.0.2.9" } } },
    { networkInterfaces: undefined },
    {
      network: { ...first.network, wired: { connected: true, address: "127.0.0.1" } },
      networkInterfaces: { lo: [{ address: "127.0.0.1", internal: true }] },
    },
  ])("rejects a disk boot without a matching real network observation (%j)", async (patch) => {
    const { installedFailures } = await import("./recipe-setup.mjs");
    for (const boots of [
      [{ ...first, ...patch }, first],
      [first, { ...first, ...patch }],
    ])
      expect(installedFailures(expected, "installed-root", ...boots)).toContain("host-network");
  });
  it.each([
    ["uuid", { uuid: expected.uuid }, "root-uuid"],
    ["missing disk proof", { disk: undefined }, "disk-startup"],
    ...[
      { emptyPassword: true },
      { openedBy: "bootstrap" },
      { tpmSlots: 0 },
      { keySlots: 3 },
      { tpmPcrs: [5, 7, 15] },
    ].map((patch) => ["disk proof", { disk: { ...first.disk, ...patch } }, "disk-startup"]),
    ["writer", { writerAbsent: false }, "installer-present"],
    ["areas", { areas: ["@rootfs"] }, "areas"],
    ["identity", { machineId: "another" }, "machine-id"],
    ["CA", { ca: "another" }, "ca"],
    ["app", { images: { ...first.images, app: "another" } }, "image:app"],
    ["LUKS identity", { luksUuid: "another-disk" }, "luks-uuid"],
    ["LUKS version", { luksVersion: "1" }, "disk-markers"],
    ["LUKS subsystem", { luksSubsystem: "another-system" }, "disk-markers"],
    [
      "partition type",
      { dataPartition: { ...first.dataPartition, type: "0FC63DAF-8483-4772-8E79-3D69D8477DE4" } },
      "disk-markers",
    ],
    [
      "partition name",
      { dataPartition: { ...first.dataPartition, name: "another-system" } },
      "disk-markers",
    ],
    ["missing partition marks", { dataPartition: undefined }, "disk-markers"],
    ["EFI size", { partitionBytes: [535822336, 1073741824, 11272192000] }, "partitions"],
    ["boot size", { partitionBytes: [536870912, 1048576000, 11272192000] }, "partitions"],
    ["data size", { partitionBytes: [536870912, 1073741824, 1073741824] }, "partitions"],
    ["partition report", { partitionBytes: undefined }, "partitions"],
  ])("rejects a changed %s on the disk-only reboot", async (_name, patch, failure) => {
    const { installedFailures } = await import("./recipe-setup.mjs");
    expect(installedFailures(expected, "installed-root", first, { ...first, ...patch })).toContain(
      failure,
    );
  });
  it.each([
    ["source UUID", expected.uuid, { uuid: expected.uuid }, "root-uuid"],
    ["missing UUID", undefined, { uuid: undefined }, "root-uuid"],
    ["blank identity", "installed-root", { machineId: "" }, "machine-id"],
    ["blank CA", "installed-root", { ca: "" }, "ca"],
    ["missing LUKS identity", "installed-root", { luksUuid: undefined }, "luks-uuid"],
    ["filesystem as LUKS identity", "installed-root", { luksUuid: "installed-root" }, "luks-uuid"],
  ])("rejects two matching but unusable boots (%s)", async (_name, uuid, patch, failure) => {
    const { installedFailures } = await import("./recipe-setup.mjs");
    expect(
      installedFailures(expected, uuid, { ...first, ...patch }, { ...first, ...patch }),
    ).toContain(failure);
  });
});

it.each(["installed-setup", "installed-refusals"])(
  "names the missing installer image for %s",
  (caseName) => {
    const result = spawnSync(
      process.execPath,
      ["bench/box-installer/run.mjs", "--case", caseName, "--run-dir", "/tmp/not-created"],
      {
        env: { ...process.env, B3_INSTALLER_IMAGE: "" },
        encoding: "utf8",
        timeout: 5000,
      },
    );
    expect(result.stderr).toContain("B3_INSTALLER_IMAGE must be set");
  },
);

it("waits for a complete serial record before parsing its JSON", async () => {
  const { rigLine } = await import("./recipe-setup.mjs");
  expect(rigLine('kernel boot\nB3_INSTALLED:{"uuid":"ro', "B3_INSTALLED:")).toBeUndefined();
  expect(rigLine('kernel boot\nB3_INSTALLED:{"uuid":"root"}\r\n', "B3_INSTALLED:")).toBe(
    '{"uuid":"root"}',
  );
  expect(rigLine('\u001b[?25hB3_INSTALLED:{"uuid":"root"}\r\n', "B3_INSTALLED:")).toBe(
    '{"uuid":"root"}',
  );
});

it.each([
  ["unit=waitron-dev-install comm=systemd res=success'\n", true],
  ["B3_INSTALL_OK:root\nunit=waitron-dev-install comm=systemd res=failed'\n", false],
  ["B3_INSTALL_OK:root\n", false],
])("requires the installer unit's success, beyond its marker", async (serial, expected) => {
  const { installSucceeded } = await import("./recipe-setup.mjs");
  expect(installSucceeded(serial)).toBe(expected);
});

it("stops the rig when the installer unit fails after printing its marker", () => {
  const root = mkdtempSync(join(tmpdir(), "b3-unit-failure-"));
  try {
    const qemu = join(root, "qemu-system-x86_64");
    writeFileSync(
      qemu,
      `#!/bin/sh
sleep 0.1
printf "%s\\n" "B3_INSTALL_OK:installed-root" "unit=waitron-dev-install comm=systemd res=failed'"
sleep 0.1
`,
      { mode: 0o700 },
    );
    writeFileSync(
      join(root, "swtpm"),
      `#!${process.execPath}
const net = require("node:net");
const ctrl = process.argv[process.argv.indexOf("--ctrl") + 1];
net.createServer().listen(ctrl.split("path=")[1]);
`,
      { mode: 0o700 },
    );
    writeFileSync(join(root, "mkfs.ext4"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    writeFileSync(join(root, "vars.fd"), "private firmware fixture");
    writeFileSync(
      join(root, "firmware.mjs"),
      `import fs from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
const copy = fs.copyFile;
fs.copyFile = (source, ...rest) => copy(source === "/usr/share/OVMF/OVMF_VARS_4M.fd" ? new URL("./vars.fd", import.meta.url) : source, ...rest);
syncBuiltinESMExports();
`,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        join(root, "firmware.mjs"),
        "bench/box-installer/run.mjs",
        "--case",
        "installed-setup",
        "--run-dir",
        join(root, "check"),
      ],
      {
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          B3_INSTALLER_IMAGE: join(root, "image"),
          XDG_RUNTIME_DIR: root,
        },
        encoding: "utf8",
        timeout: 5000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("install service did not report success");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
