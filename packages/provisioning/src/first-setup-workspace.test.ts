import { chmod, mkdtemp, rm, mkdir, realpath, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { assertNoLegacyFirstSetupWorkspace } from "./index.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function folders() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "legacy-workspace-")));
  dirs.push(root);
  const roots = { venueDir: join(root, "venue"), stateDir: join(root, "state") };
  await mkdir(roots.venueDir);
  await mkdir(roots.stateDir);
  return { root, roots };
}

it("a box with no earlier first-setup layout passes", async () => {
  const { roots } = await folders();
  await writeFile(join(roots.stateDir, "first-setup.json"), "{}");
  await writeFile(join(roots.venueDir, "first-setup-claim.json"), "{}");
  await expect(assertNoLegacyFirstSetupWorkspace(roots)).resolves.toBeUndefined();
});

it.each([
  ["venueDir", "first-setup-selection.json", "file"],
  ["venueDir", "first-setup-retirement.json", "file"],
  ["venueDir", "first-setup-workspace.json", "file"],
  ["venueDir", "first-setup-workspaces", "folder"],
  ["stateDir", "first-setup-selection.json", "file"],
  ["stateDir", "first-setup-retirement.json", "file"],
  ["stateDir", "first-setup-workspace.json", "file"],
  ["stateDir", "first-setup-workspaces", "folder"],
] as const)(
  "%s holding %s (an empty %s) is refused as an earlier layout",
  async (folder, name, kind) => {
    const { roots } = await folders();
    const path = join(roots[folder], name);
    if (kind === "folder") await mkdir(path);
    else await writeFile(path, "");
    await expect(assertNoLegacyFirstSetupWorkspace(roots)).rejects.toMatchObject({
      code: "setup.workspace_unsupported",
    });
  },
);

it("a venue folder inside first-setup-workspaces/<id>/ is refused as an earlier layout", async () => {
  const { root } = await folders();
  const base = join(root, "elsewhere", "first-setup-workspaces", "w1");
  const roots = { venueDir: join(base, "venue"), stateDir: join(root, "state") };
  await mkdir(roots.venueDir, { recursive: true });
  await expect(assertNoLegacyFirstSetupWorkspace(roots)).rejects.toMatchObject({
    code: "setup.workspace_unsupported",
  });
});

it.each(["venueDir", "stateDir"] as const)(
  "a %s that is a symbolic link is uncertain, not an earlier layout",
  async (folder) => {
    const { root, roots } = await folders();
    const real = join(root, "real");
    await mkdir(real);
    await rm(roots[folder], { recursive: true });
    await symlink(real, roots[folder]);
    await expect(assertNoLegacyFirstSetupWorkspace(roots)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
  },
);

it("a folder that cannot be searched is uncertain, not an earlier layout", async () => {
  const { roots } = await folders();
  await chmod(roots.stateDir, 0o000);
  try {
    await expect(assertNoLegacyFirstSetupWorkspace(roots)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
  } finally {
    await chmod(roots.stateDir, 0o700);
  }
});
