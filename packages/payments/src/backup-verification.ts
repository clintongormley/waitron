import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { compareBackupTables } from "@waitron/db";
import {
  BackupCredentialReadError,
  readBackupCredential,
  resolveBackupKeyInputs,
} from "@waitron/credentials";
import {
  BackupCheckUnavailable,
  type BackupModuleStatus,
  type BackupVerificationContribution,
} from "@waitron/module";
import type { BackupQuery, BackupValue } from "@waitron/store";
import { PAYMENTS_CLASSIFICATION } from "./classification.js";
import * as schema from "./schema/index.js";
import type { CardProviderContribution } from "./card-provider.js";

type BackupProvider = Pick<
  CardProviderContribution,
  "providerId" | "credentialPurpose" | "verifyBackupCredential"
>;

const tables = PAYMENTS_CLASSIFICATION.map((entry) => entry.table);
const immutableTables = PAYMENTS_CLASSIFICATION.filter((entry) => entry.appendOnly === true).map(
  (entry) => entry.table,
);
export function paymentsBackupVerification(
  providers: readonly BackupProvider[],
): BackupVerificationContribution {
  const checks = providers.map(({ providerId, credentialPurpose, verifyBackupCredential }) => ({
    providerId,
    credentialPurpose,
    verifyBackupCredential,
  }));
  return {
    version: 1,
    publicEvidenceDigest: null,
    data: { kind: "custom", tables, immutableTables, checks: ["data", "immutable", "secret"] },
    secrets: checks.map((provider) => `vault:${provider.credentialPurpose}`),
    entries: [
      { name: "secrets/secrets.env", presence: "required" },
      { name: "secrets/trading.env", presence: "required" },
      { name: "secrets/backup.env", presence: "optional" },
    ],
    effects: [],
    zeroSchema: "absent_tables_and_entries",
    targetOnly: "empty_after_migration",
    async verifyRestoredData(context) {
      const secretsEnv = await context.entries.read("secrets/secrets.env");
      const tradingEnv = await context.entries.read("secrets/trading.env");
      const backupEnv = await context.entries.read("secrets/backup.env");
      if (secretsEnv === null || tradingEnv === null)
        throw new BackupCheckUnavailable("secret_unavailable");
      const keys = resolveBackupKeyInputs({ secretsEnv, tradingEnv, backupEnv });
      let data: BackupModuleStatus = "passed";
      for (const table of tables) {
        if (
          (await hasTable(context.before, table)) !==
          (context.sourceSchema !== 0 && context.sourceSchema !== null)
        )
          data = "invalid";
      }
      const equal = async (names: readonly string[]) =>
        compareBackupTables({
          before: context.before,
          after: context.after,
          policies: names.map((table) => ({
            table,
            immutable: immutableTables.includes(table),
            addedColumns: {},
          })),
        });
      if (!(await equal(tables.filter((table) => !immutableTables.includes(table)))))
        data = "invalid";
      if (!(await referencesValid(context.before)) || !(await referencesValid(context.after)))
        data = "invalid";
      const immutable = (await equal(immutableTables)) ? "passed" : "invalid";
      let secret: BackupModuleStatus = "passed";
      for (const provider of checks) {
        const before = await providerCredential(
          context.before,
          keys,
          provider,
          context.source.environment,
        );
        const after = await providerCredential(
          context.after,
          keys,
          provider,
          context.source.environment,
        );
        if (before.present !== after.present) secret = merge(secret, "invalid");
        if ((context.sourceSchema === 0 || context.sourceSchema === null) && before.present)
          data = "invalid";
        secret = merge(secret, before.status, after.status);
      }
      return {
        status: merge(data, immutable, secret),
        checks: [
          { code: "data", status: data },
          { code: "immutable", status: immutable },
          { code: "secret", status: secret },
        ],
      };
    },
  };
}

function merge(...statuses: BackupModuleStatus[]): BackupModuleStatus {
  if (statuses.includes("unsupported")) return "unsupported";
  return statuses.includes("invalid") ? "invalid" : "passed";
}
function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
async function first(query: BackupQuery, statement: string, values: readonly BackupValue[] = []) {
  for await (const row of query.rows(statement, values)) return row;
  return undefined;
}
async function hasTable(query: BackupQuery, name: string): Promise<boolean> {
  return (
    (await first(query, "select name from sqlite_schema where type='table' and name=?", [name])) !==
    undefined
  );
}
async function referencesValid(query: BackupQuery): Promise<boolean> {
  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue;
    const config = getTableConfig(value);
    if (!(await hasTable(query, config.name))) continue;
    for (const key of config.foreignKeys) {
      const { columns, foreignColumns, foreignTable } = key.reference();
      const present = columns
        .map((column) => `child.${ident(column.name)} is not null`)
        .join(" and ");
      const parent = getTableConfig(foreignTable).name;
      if (!(await hasTable(query, parent))) {
        if (
          await first(query, `select 1 from ${ident(config.name)} child where ${present} limit 1`)
        )
          return false;
        continue;
      }
      const match = columns
        .map((column, i) => `parent.${ident(foreignColumns[i]!.name)}=child.${ident(column.name)}`)
        .join(" and ");
      if (
        await first(
          query,
          `select 1 from ${ident(config.name)} child where ${present} and not exists (select 1 from ${ident(parent)} parent where ${match}) limit 1`,
        )
      )
        return false;
    }
  }
  return true;
}
async function providerCredential(
  query: BackupQuery,
  keys: Readonly<Record<string, string>>,
  provider: BackupProvider,
  environment: "preproduction" | "production",
): Promise<{ present: boolean; status: BackupModuleStatus }> {
  let payload: Readonly<Record<string, string>> | null = null;
  try {
    if (await hasTable(query, "tenant_credentials"))
      payload = await readBackupCredential(query, keys, provider.credentialPurpose);
  } catch (error) {
    if (!(error instanceof BackupCredentialReadError)) throw error;
    if (error.status === "unavailable") throw new BackupCheckUnavailable("decryption_unavailable");
    return { present: true, status: error.status };
  }
  if (payload === null) {
    const active =
      (await hasTable(query, "card_readers")) &&
      (await first(
        query,
        "select 1 from card_readers where provider=? and active=1 and deleted_at is null limit 1",
        [provider.providerId],
      )) !== undefined;
    return { present: false, status: active ? "invalid" : "passed" };
  }
  if (provider.verifyBackupCredential === undefined)
    return { present: true, status: "unsupported" };
  return {
    present: true,
    status: provider.verifyBackupCredential(payload, environment) ? "passed" : "invalid",
  };
}
