import { afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { receiveSetupArchive, type ReceiveArchive } from "../setup-archive-upload.js";
export function useSetupArchiveUpload(): ReceiveArchive {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });
  return async (request, options) => {
    const dir = await mkdtemp(join(tmpdir(), "setup-route-upload-"));
    dirs.push(dir);
    return receiveSetupArchive(request, dir, options);
  };
}
