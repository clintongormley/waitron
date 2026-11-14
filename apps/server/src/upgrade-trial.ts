import { DatabaseSync } from "node:sqlite";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  archiveTo,
  connectionPair,
  drizzleNodeSqlite,
  DATABASE_FILES,
  VENUE_DIR_NAME,
  SECRETS_ENV_FILE,
  TRADING_ENV_FILE,
  BACKUP_ENV_FILE,
  FIRST_SETUP_FILE,
} from "@waitron/store";
import { START_AGAIN_MARKER_FILE } from "@waitron/provisioning";
import type { ServerConfig } from "./config.js";

export async function captureUpgradeTrial(config: ServerConfig, output: string) {
  const venue = join(output, VENUE_DIR_NAME);
  await mkdir(venue, { recursive: true, mode: 0o700 });
  for (const file of DATABASE_FILES) {
    const reader = new DatabaseSync(join(config.venueDir, file), {
      readOnly: true,
      allowExtension: false,
    });
    try {
      await archiveTo(
        drizzleNodeSqlite(connectionPair(reader, reader), { schema: {} }),
        join(venue, file),
      );
    } finally {
      reader.close();
    }
  }
  for (const [source, target] of [
    ...[SECRETS_ENV_FILE, TRADING_ENV_FILE, BACKUP_ENV_FILE, FIRST_SETUP_FILE].map(
      (name) => [join(config.stateDir, name), join(output, name)] as const,
    ),
    [join(config.venueDir, START_AGAIN_MARKER_FILE), join(venue, START_AGAIN_MARKER_FILE)],
  ]) {
    await mkdir(dirname(target!), { recursive: true, mode: 0o700 });
    try {
      await copyFile(source!, target!);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { databases: [...DATABASE_FILES] };
}
