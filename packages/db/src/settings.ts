import "./errors.js";
import { recordActivity } from "./activity-log.js";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Database, Transaction } from "./client.js";
import { settings } from "./schema/settings.js";
import { nowIso } from "./schema/columns.js";

export type SettingsParse<T> =
  { readonly ok: true; readonly doc: T } | { readonly ok: false; readonly field: string };

export interface SettingsDocument<T extends object> {
  readonly module: string;
  readonly version: number;
  readonly defaults: () => T;
  readonly parse: (doc: unknown) => SettingsParse<T>;
  readonly transfers: boolean;
}
export interface SettingsRead<T> {
  readonly doc: T;
  readonly revision: number;
}
export interface SettingsChange<T> {
  readonly doc: T;
  readonly expectedRevision: number;
  readonly personId: string | null;
}

export function defineSettingsDocument<T extends object>(
  definition: SettingsDocument<T>,
): SettingsDocument<T> {
  if (!/^[a-z][a-z0-9_]*$/.test(definition.module))
    throw new Error("settings module must be a lowercase name");
  if (!Number.isInteger(definition.version) || definition.version < 1)
    throw new Error("settings version must be an integer from 1");
  return definition;
}

export async function readSettings<T extends object>(
  db: Database | Transaction,
  definition: SettingsDocument<T>,
): Promise<SettingsRead<T>> {
  const [row] = await db.select().from(settings).where(eq(settings.module, definition.module));
  return decodeSettingsRow(row, definition);
}

export function decodeSettingsRow<T extends object>(
  row: Pick<typeof settings.$inferSelect, "version" | "doc" | "revision"> | undefined,
  definition: SettingsDocument<T>,
): SettingsRead<T> {
  if (row === undefined) return { doc: definition.defaults(), revision: 0 };
  if (row.version !== definition.version)
    throw new AppError("settings.invalid", {
      module: definition.module,
      field: "version",
      version: row.version,
    });
  const parsed = definition.parse(row.doc);
  if (!parsed.ok)
    throw new AppError("settings.invalid", { module: definition.module, field: parsed.field });
  return { doc: parsed.doc, revision: row.revision };
}

export async function saveSettings<T extends object>(
  tx: Transaction,
  definition: SettingsDocument<T>,
  change: SettingsChange<T>,
): Promise<SettingsRead<T>> {
  if (!Number.isInteger(change.expectedRevision) || change.expectedRevision < 0)
    throw new RangeError("expectedRevision must be a non-negative integer");
  const parsed = definition.parse(change.doc);
  if (!parsed.ok)
    throw new AppError("settings.invalid", { module: definition.module, field: parsed.field });
  const values = {
    version: definition.version,
    doc: parsed.doc as Record<string, unknown>,
    updatedAt: nowIso(),
    updatedBy: change.personId,
  };
  const [saved] =
    change.expectedRevision === 0
      ? await tx
          .insert(settings)
          .values({ ...values, module: definition.module, revision: 1 })
          .onConflictDoNothing({ target: settings.module })
          .returning({ revision: settings.revision })
      : await tx
          .update(settings)
          .set({ ...values, revision: sql`${settings.revision} + 1` })
          .where(
            and(
              eq(settings.module, definition.module),
              eq(settings.revision, change.expectedRevision),
            ),
          )
          .returning({ revision: settings.revision });
  if (saved === undefined) {
    const [row] = await tx
      .select({ revision: settings.revision })
      .from(settings)
      .where(eq(settings.module, definition.module));
    throw new AppError("settings.out_of_date", {
      module: definition.module,
      revision: row?.revision ?? 0,
    });
  }
  await recordActivity(tx, {
    kind: "settings.saved",
    subjectId: definition.module,
    personId: change.personId,
    data: { revision: saved.revision },
  });
  return { doc: parsed.doc, revision: saved.revision };
}

/** Replaces only the transferring definitions; imported documents name no source person. */
export async function replaceTransferredSettings(
  tx: Transaction,
  definitions: readonly SettingsDocument<object>[],
  docs: ReadonlyMap<string, object>,
): Promise<void> {
  const byModule = new Map(definitions.map((definition) => [definition.module, definition]));
  for (const key of docs.keys()) {
    if (!byModule.has(key)) throw new Error(`Unknown settings document: ${key}`);
  }
  for (const definition of definitions) {
    await tx.delete(settings).where(eq(settings.module, definition.module));
    const doc = docs.get(definition.module);
    if (doc !== undefined)
      await saveSettings(tx, definition, { doc, expectedRevision: 0, personId: null });
  }
}
