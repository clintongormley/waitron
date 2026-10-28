import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockVenueDatabase, openVenueDatabase } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import {
  canonicalFirstSetupRoots,
  readModulePreparationHistory,
  readDurableHostJson,
  type FirstSetupRoots,
} from "@waitron/provisioning";
import { AppError, isAppError } from "@waitron/shared";
import "./errors.js";
import { readFirstSetupBackupSetups } from "./first-setup-backup-setups.js";
import { copyVenueFiles } from "./venue-private-copy.js";

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
  return options.withVenueExclusion(async () => {
    await options.recheck();
    const roots: FirstSetupRoots[] = [await canonicalFirstSetupRoots(options)];
    const venues = [...new Set(roots.map((root) => root.venueDir))];
    const databases: unknown[] = [];
    for (const venueDir of venues) {
      const lock = await lockVenueDatabase(venueDir);
      let scratch: string | undefined;
      try {
        scratch = await mkdtemp(join(tmpdir(), "waitron-backup-history-"));
        if (!(await copyVenueFiles(venueDir, scratch, refuse))) continue;
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
