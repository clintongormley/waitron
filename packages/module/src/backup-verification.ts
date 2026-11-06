import type { BackupQuery } from "@waitron/store";

export type BackupModuleStatus = "passed" | "invalid" | "needs_authority" | "unsupported";
export type BackupCheckCode =
  | "data"
  | "immutable"
  | "chain"
  | "head"
  | "history"
  | "source"
  | "secret"
  | "entries"
  | "effects"
  | "not_applicable";

export interface BackupModuleCheck {
  readonly code: BackupCheckCode;
  readonly status: BackupModuleStatus;
}

export interface BackupModuleResult {
  readonly status: BackupModuleStatus;
  readonly checks: readonly BackupModuleCheck[];
}

export interface BackupEntries {
  read(name: string): Promise<Uint8Array | null>;
}

export interface BackupVerificationContext {
  readonly before: BackupQuery;
  readonly after: BackupQuery;
  readonly entries: BackupEntries;
  readonly source: {
    readonly nodeId: string;
    readonly environment: "preproduction" | "production";
    readonly createdAt: string;
  };
  readonly sourceSchema: number | null;
  readonly targetSchema: number;
  readonly signal: AbortSignal;
}

export interface BackupVerificationContribution {
  readonly version: 1;
  readonly publicEvidenceDigest: string | null;
  readonly data: {
    readonly kind: "database_only" | "custom";
    readonly tables: readonly string[];
    readonly immutableTables: readonly string[];
    readonly checks: readonly BackupCheckCode[];
  };
  readonly secrets: readonly string[];
  readonly entries: readonly {
    readonly name: string;
    readonly presence: "required" | "optional";
  }[];
  readonly effects: readonly {
    readonly id: string;
    readonly kind: "data" | "activation";
    readonly check: BackupCheckCode | null;
  }[];
  readonly zeroSchema: "absent_tables_and_entries" | "empty_schema";
  readonly targetOnly: "empty_after_migration" | "unsupported";
  verifyRestoredData(context: BackupVerificationContext): Promise<BackupModuleResult>;
}

export class BackupVerificationUnsupported extends Error {
  constructor(readonly reason: "module_missing" | "semantics_missing" | "target_incompatible") {
    super("Backup verification unsupported");
    this.name = "BackupVerificationUnsupported";
  }
}

export class BackupCheckUnavailable extends Error {
  constructor(readonly reason: "secret_unavailable" | "decryption_unavailable" | "resource_limit") {
    super("Backup check unavailable");
    this.name = "BackupCheckUnavailable";
  }
}

const CHECKS: readonly BackupCheckCode[] = [
  "data",
  "immutable",
  "chain",
  "head",
  "history",
  "source",
  "secret",
  "entries",
  "effects",
  "not_applicable",
];
const STATUSES: readonly BackupModuleStatus[] = [
  "passed",
  "invalid",
  "needs_authority",
  "unsupported",
];

function refuse(): never {
  throw new BackupVerificationUnsupported("semantics_missing");
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) refuse();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== "string" || !keys.includes(key))
  )
    refuse();
  return value as Record<string, unknown>;
}

function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) refuse();
  return value as T;
}

function list<T>(
  value: unknown,
  read: (entry: unknown) => T,
  key: (entry: T) => string,
): readonly T[] {
  if (!Array.isArray(value)) refuse();
  const entries = value.map(read);
  if (new Set(entries.map(key)).size !== entries.length) refuse();
  return Object.freeze(entries);
}

function text(value: unknown): string {
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,256}$/.test(value)) refuse();
  return value;
}

function table(value: unknown): string {
  const name = text(value);
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) refuse();
  return name;
}

export function validateBackupVerificationContribution(
  value: unknown,
): BackupVerificationContribution {
  const owner = object(value, [
    "version",
    "publicEvidenceDigest",
    "data",
    "secrets",
    "entries",
    "effects",
    "zeroSchema",
    "targetOnly",
    "verifyRestoredData",
  ]);
  if (owner.version !== 1 || typeof owner.verifyRestoredData !== "function") refuse();
  if (
    owner.publicEvidenceDigest !== null &&
    (typeof owner.publicEvidenceDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(owner.publicEvidenceDigest))
  )
    refuse();
  const data = object(owner.data, ["kind", "tables", "immutableTables", "checks"]);
  const tables = list(data.tables, table, (entry) => entry);
  const immutableTables = list(data.immutableTables, table, (entry) => entry);
  if (immutableTables.some((entry) => !tables.includes(entry))) refuse();
  const checks = list(
    data.checks,
    (entry) => choice(entry, CHECKS),
    (entry) => entry,
  );
  if (checks.length === 0 || checks.includes("not_applicable")) refuse();
  return Object.freeze({
    version: 1,
    publicEvidenceDigest: owner.publicEvidenceDigest,
    data: Object.freeze({
      kind: choice(data.kind, ["database_only", "custom"]),
      tables,
      immutableTables,
      checks,
    }),
    secrets: list(owner.secrets, text, (entry) => entry),
    entries: list(
      owner.entries,
      (value) => {
        const entry = object(value, ["name", "presence"]);
        const name = text(entry.name);
        if (
          name.includes("\\") ||
          name.split("/").some((part) => part === "" || part === "." || part === "..")
        )
          refuse();
        return Object.freeze({ name, presence: choice(entry.presence, ["required", "optional"]) });
      },
      (entry) => entry.name,
    ),
    effects: list(
      owner.effects,
      (value) => {
        const effect = object(value, ["id", "kind", "check"]);
        if (
          effect.kind === "data" &&
          (effect.check === null || !checks.includes(effect.check as BackupCheckCode))
        )
          refuse();
        if (effect.kind === "activation" && effect.check !== null) refuse();
        return Object.freeze({
          id: text(effect.id),
          kind: choice(effect.kind, ["data", "activation"]),
          check: effect.check === null ? null : choice(effect.check, CHECKS),
        });
      },
      (effect) => effect.id,
    ),
    zeroSchema: choice(owner.zeroSchema, ["absent_tables_and_entries", "empty_schema"]),
    targetOnly: choice(owner.targetOnly, ["empty_after_migration", "unsupported"]),
    verifyRestoredData:
      owner.verifyRestoredData as BackupVerificationContribution["verifyRestoredData"],
  });
}

export function validateBackupModuleResult(
  value: unknown,
  contribution: BackupVerificationContribution,
  notApplicable: boolean,
): BackupModuleResult {
  const result = object(value, ["status", "checks"]);
  const status = choice(result.status, STATUSES);
  const checks = list(
    result.checks,
    (value) => {
      const check = object(value, ["code", "status"]);
      return Object.freeze({
        code: choice(check.code, CHECKS),
        status: choice(check.status, STATUSES),
      });
    },
    (check) => check.code,
  );
  const expected = notApplicable ? ["not_applicable"] : contribution.data.checks;
  if (checks.length !== expected.length || checks.some((check) => !expected.includes(check.code)))
    refuse();
  if (notApplicable && status !== "passed") refuse();
  const aggregate = [...STATUSES]
    .reverse()
    .find((candidate) => checks.some((check) => check.status === candidate));
  if (status !== aggregate) refuse();
  return Object.freeze({ status, checks });
}

function worst(statuses: readonly BackupModuleStatus[]): BackupModuleStatus {
  return STATUSES.reduce((found, status) => (statuses.includes(status) ? status : found));
}

function union<T>(lists: readonly (readonly T[])[]): T[] {
  return [...new Set(lists.flat())];
}

/**
 * One set's verification: its own module's contribution followed by those of the modules whose
 * tables it holds, in the order given. Each part's result is checked against its own contribution
 * before the parts are merged into one check per code. A public evidence digest is kept only when
 * every part that has one has the same one: two different ones are refused, since this package has
 * no hash to combine them with.
 */
export function combineBackupVerification(
  host: BackupVerificationContribution,
  hosted: readonly BackupVerificationContribution[],
): BackupVerificationContribution {
  if (hosted.length === 0) return host;
  const parts = [host, ...hosted];
  const digests = union(
    parts.map((p) => (p.publicEvidenceDigest === null ? [] : [p.publicEvidenceDigest])),
  );
  if (digests.length > 1) refuse();
  const entries = new Map<string, "required" | "optional">();
  for (const entry of parts.flatMap((p) => p.entries))
    if (entries.get(entry.name) !== "required") entries.set(entry.name, entry.presence);
  const effects = new Map<string, BackupVerificationContribution["effects"][number]>();
  for (const effect of parts.flatMap((p) => p.effects)) {
    const seen = effects.get(effect.id);
    if (seen !== undefined && (seen.kind !== effect.kind || seen.check !== effect.check)) refuse();
    effects.set(effect.id, effect);
  }
  return validateBackupVerificationContribution({
    version: 1,
    publicEvidenceDigest: digests[0] ?? null,
    data: {
      kind: parts.some((p) => p.data.kind === "custom") ? "custom" : "database_only",
      tables: union(parts.map((p) => p.data.tables)),
      immutableTables: union(parts.map((p) => p.data.immutableTables)),
      checks: union(parts.map((p) => p.data.checks)),
    },
    secrets: union(parts.map((p) => p.secrets)),
    entries: [...entries].map(([name, presence]) => ({ name, presence })),
    effects: [...effects.values()].map((e) => ({ id: e.id, kind: e.kind, check: e.check })),
    zeroSchema: host.zeroSchema,
    targetOnly: parts.some((p) => p.targetOnly === "unsupported")
      ? "unsupported"
      : "empty_after_migration",
    verifyRestoredData: async (context: BackupVerificationContext) => {
      const statuses = new Map<BackupCheckCode, BackupModuleStatus[]>();
      for (const part of parts) {
        const result = validateBackupModuleResult(
          await part.verifyRestoredData(context),
          part,
          false,
        );
        for (const check of result.checks)
          statuses.set(check.code, [...(statuses.get(check.code) ?? []), check.status]);
      }
      const checks = [...statuses].map(([code, found]) => ({ code, status: worst(found) }));
      return { status: worst(checks.map((c) => c.status)), checks };
    },
  });
}
