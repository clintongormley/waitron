import { constants } from "node:fs";
import { open, rmdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export async function syncFolder(path: string): Promise<void> {
  const folder = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
  );
  try {
    await folder.sync();
  } finally {
    await folder.close();
  }
}

export async function removeAndSync(path: string, kind: "file" | "folder"): Promise<void> {
  if (kind === "file") await unlink(path);
  else await rmdir(path);
  await syncFolder(dirname(path));
}
