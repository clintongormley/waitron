import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, expect, it } from "vitest";
import { probeEnvironmentMove } from "./environment-recovery-move.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function fixture(records: boolean) {
  const stateDir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "environment-probe-")));
  dirs.push(stateDir);
  const venueDir = join(stateDir, "venue");
  await fs.mkdir(venueDir);
  await fs.writeFile(join(venueDir, "venue.db"), "database");
  await fs.writeFile(join(stateDir, "secrets.env"), "ring");
  if (records) await fs.mkdir(join(stateDir, "records", "choices"), { recursive: true });
  return { stateDir, venueDir };
}

/** Every path under `root`, folders included. */
async function paths(root: string): Promise<string[]> {
  const found = await fs.readdir(root, { recursive: true });
  return found.map((path) => relative(root, join(root, path))).sort();
}

for (const records of [false, true])
  it(`tests both roots' renames and leaves no folder behind (records/ ${records ? "present" : "absent"})`, async () => {
    const roots = await fixture(records);
    const before = await paths(roots.stateDir);
    const renamed: string[] = [];

    await probeEnvironmentMove(roots, {
      ...fs,
      rename: async (from, to) => {
        renamed.push(relative(roots.stateDir, from));
        await fs.rename(from, to);
      },
    });

    expect(renamed.map((path) => path.split("/").slice(0, -1).join("/"))).toEqual(["", "venue"]);
    expect(await paths(roots.stateDir)).toEqual(before);
  });

for (const records of [false, true])
  it(`refuses a rename across filesystems and leaves no folder behind (records/ ${records ? "present" : "absent"})`, async () => {
    const roots = await fixture(records);
    const before = await paths(roots.stateDir);

    await expect(
      probeEnvironmentMove(roots, {
        ...fs,
        rename: async () => {
          throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
        },
      }),
    ).rejects.toMatchObject({ code: "setup.start_again_set_aside_unavailable" });

    expect(await paths(roots.stateDir)).toEqual(before);
  });
