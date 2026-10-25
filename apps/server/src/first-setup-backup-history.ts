import { constants } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { lockVenueDatabase, openVenueDatabase } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import {
  firstSetupAnchorFor,
  canonicalFirstSetupDirectory,
  readModulePreparationHistory,
  readDurableHostJson,
  type FirstSetupRoots,
} from "@waitron/provisioning";
import { AppError, isAppError } from "@waitron/shared";
import "./errors.js";
import { readFirstSetupBackupSetups } from "./first-setup-backup-setups.js";

interface Options extends FirstSetupRoots {
  module: WaitronModule;
  withVenueExclusion<T>(run: () => Promise<T>): Promise<T>;
  recheck(): Promise<void>;
}
// Venue locks exclude other processes; the authenticated caller also holds its coordinator turn.
export async function readFirstSetupBackupHistory(options: Options): Promise<{
  databases: readonly unknown[];
  documents: Readonly<Record<string, unknown>>;
}> {
  const refuse = (): never => {
    throw new AppError("module.operation_invalid", { module: options.module.name });
  };
  const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
  async function copy(source: string, target: string): Promise<boolean> {
    let input;
    try {
      input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
    try {
      if (!(await input.stat()).isFile()) refuse();
      const output = await open(target, "wx", 0o600);
      try {
        await pipeline(input.createReadStream(), output.createWriteStream());
      } finally {
        await output.close();
      }
      return true;
    } finally {
      await input.close();
    }
  }
  return options.withVenueExclusion(async () => {
    await options.recheck();
    const anchor = await firstSetupAnchorFor(options);
    const roots: FirstSetupRoots[] = [];
    for (const root of [anchor, options])
      roots.push({
        stateDir: await canonicalFirstSetupDirectory(root.stateDir),
        venueDir: await canonicalFirstSetupDirectory(root.venueDir),
      });
    const venues = [...new Set(roots.map((root) => root.venueDir))];
    const databases: unknown[] = [];
    for (const venueDir of venues) {
      const lock = await lockVenueDatabase(venueDir);
      let scratch: string | undefined;
      try {
        scratch = await mkdtemp(join(tmpdir(), "waitron-backup-history-"));
        const present = await copy(join(venueDir, "venue.db"), join(scratch, "venue.db"));
        let sidecar = false;
        for (const suffix of ["-wal", "-journal", "-shm"])
          sidecar =
            (await copy(join(venueDir, `venue.db${suffix}`), join(scratch, `venue.db${suffix}`))) ||
            sidecar;
        if (!present) {
          if (sidecar) refuse();
          continue;
        }
        const reader = options.module.operations?.readRecoveryHistory;
        if (reader === undefined) return refuse();
        // SQLite may rebuild journals while reading; only this disposable copy is opened.
        const store = await openVenueDatabase(scratch);
        try {
          databases.push(...structuredClone(await reader(store.venue)));
        } finally {
          await store.close();
        }
      } catch (error) {
        if (isAppError(error)) throw error;
        refuse();
      } finally {
        try {
          if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
        } finally {
          lock.release();
        }
      }
    }
    const documents: Record<string, unknown> = {};
    const setupHistory = await readFirstSetupBackupSetups(
      roots.filter(
        (root, index) => roots.findIndex((known) => known.stateDir === root.stateDir) === index,
      ),
      options.module,
    );
    const preparations = await readModulePreparationHistory(options, options.module.name);
    for (const source of options.module.backup?.nonDbState ?? []) {
      if (source.kind !== "preparation-history") continue;
      if (![options.module.name, source.source].every((name) => /^[a-z][a-z0-9-]*$/.test(name)))
        refuse();
      const retained: unknown[] = [];
      for (const stateDir of new Set(roots.map((root) => root.stateDir))) {
        const value = await readDurableHostJson(
          join(stateDir, "module-evidence", options.module.name, `${source.source}.json`),
          1024 * 1024,
        );
        if (value !== null) retained.push(value);
      }
      documents[source.source] = source.project({
        preparations,
        retained,
        recovery: { history: [], ...setupHistory },
      });
    }
    await options.recheck();
    return { databases, documents };
  });
}
