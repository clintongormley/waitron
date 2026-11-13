import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { upgradePayload } from "../../bench/box-installer/upgrade.mjs";

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
    for (const name of ["jq", "docker", "start"])
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
    writeFileSync(join(bin, "start"), '#!/bin/sh\ntouch "$START_PENDING"\n', { mode: 0o700 });
    writeFileSync(join(bin, "timedatectl"), "#!/bin/sh\necho yes\n", { mode: 0o700 });
    const payload = upgradePayload("reopened")
      .replaceAll("/opt/waitron", box)
      .replaceAll("/usr/local/sbin/waitron-dev-start", join(bin, "start"));
    const result = spawnSync("bash", ["-c", payload], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        START_PENDING: join(root, "pending"),
      },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
