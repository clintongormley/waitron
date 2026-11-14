import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function seedModuleRecord(
  stateDir: string,
  module: string,
  sections: { prepared?: readonly unknown[]; retained?: Record<string, unknown> },
): Promise<void> {
  await mkdir(join(stateDir, "module-records"), { recursive: true });
  const path = join(stateDir, "module-records", `${module}.json`);
  const current = await readFile(path, "utf8")
    .then(JSON.parse)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return { version: 1, prepared: [], retained: {} };
    });
  await writeFile(path, JSON.stringify({ ...current, ...sections }));
}
