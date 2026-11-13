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
