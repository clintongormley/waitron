import { lstat, mkdir, mkdtemp, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createFirstSetupBackupWorkspace } from "./first-setup-backup-workspace.js";
import { SPARE_SPACE_FILE } from "./spare-space-name.js";

vi.mock("node:fs/promises", { spy: true });

let root: string | undefined;
afterEach(async () => {
  vi.mocked(lstat).mockReset();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

it("a spare file deleted between the folder's listing and its own read leaves the originals digest unchanged", async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "backup-workspace-spare-race-")));
  const anchor = { venueDir: join(root, "venue"), stateDir: join(root, "state") };
  for (const path of Object.values(anchor)) await mkdir(path);
  await writeFile(join(anchor.venueDir, "venue.db"), "unchanged database bytes");
  const store = createFirstSetupBackupWorkspace(anchor);
  const id = "f063ea32-8c34-4b43-8ffc-5a319ec8c895";
  const before = await store.inspect(id);
  const spare = join(anchor.stateDir, SPARE_SPACE_FILE);
  await writeFile(spare, Buffer.alloc(1024, 1));
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(lstat).mockImplementation(async (path, options) => {
    if (path === spare) await unlink(spare);
    return actual.lstat(path, options);
  });
  expect(await store.inspect(id)).toBe(before);
  expect(vi.mocked(lstat)).toHaveBeenCalledWith(spare);
});
