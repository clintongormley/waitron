import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  CREDENTIALS_MIGRATIONS,
  loadKeyRing,
  putCredential,
  type Purpose,
} from "@waitron/credentials";
import { openBackupQuery } from "@waitron/store";
import { validateBackupVerificationContribution } from "@waitron/module";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import * as api from "./index.js";
import * as store from "./store.js";
import * as reconcile from "./reconcile.js";

const migrations = [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, PAYMENTS_MIGRATIONS];
const original = useVenueDb({ migrations });
const restored = useVenueDb({ migrations });
const absent = useVenueDb({ migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS] });
const key = Buffer.alloc(32, 7).toString("base64");
const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: key, WAITRON_CREDENTIALS_KEY_VERSION: "1" });
const stripe = {
  secretKey: "rk_test_synthetic",
  webhookSecret: "whsec_synthetic",
  successUrl: "https://example.test/success?session={CHECKOUT_SESSION_ID}",
  cancelUrl: "http://localhost:3000/cancel",
};
const sumup = { apiKey: "synthetic", merchantCode: "M1", affiliateAppId: "-", affiliateKey: "-" };
const passed = {
  status: "passed",
  checks: [
    { code: "data", status: "passed" },
    { code: "immutable", status: "passed" },
    { code: "secret", status: "passed" },
  ],
};
const tables = [
  "payments",
  "payment_refunds",
  "payment_resolutions",
  "payment_holds",
  "payment_hold_outcomes",
  "payment_policy",
  "card_readers",
  "device_card_readers",
  "device_profile_card_readers",
  "card_reader_holders",
];

beforeEach(() => {
  for (const db of [original.db, restored.db]) {
    db.run(
      sql`insert into locations (id,name,invoice_locales,operation_description) values ('venue','Venue','["en"]','Hospitality')`,
    );
    db.run(
      sql`insert into nodes (id,location_id,name,created_at) values ('source','venue','Source','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into invoice_series (id,node_id,code,next_number) values ('series','source','TEST',2)`,
    );
    db.run(
      sql`insert into sales (id,source,series_id,node_id,invoice_number,issued_at,issued_offset_minutes,total,vat_breakdown,locale,invoice_locales,fiscal_backend,fiscal_state) values ('sale','operator_script','series','source',1,'2026-10-20T08:00:00.000Z',0,1000,'[]','en','["en"]','none','not_applicable')`,
    );
    db.run(
      sql`insert into device_profiles (id,name,form_factor,capabilities,created_at,updated_at) values ('profile','Counter','till','[]','2026-10-20T08:00:00.000Z','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into devices (id,location_id,device_profile_id,label,token_hash,created_at,enrolled_at) values ('device','venue','profile','Till','synthetic','2026-10-20T08:00:00.000Z','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into working_orders (id,source,location_id,order_number,opened_at) values ('order','operator_script','venue',1,'2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into card_readers (id,provider,provider_ref,name,active,created_at) values ('reader','stripe','terminal_synthetic','Retained reader',0,'2026-10-20T08:00:00.000Z'),('other-reader','stripe','other','Other reader',0,'2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into payments (id,working_order_id,source,sale_id,node_id,reader_id,provider,payment_ref,amount,state,created_at,updated_at) values ('payment','order','operator_script','sale','source','reader','stripe','ref',1000,'captured','2026-10-20T08:00:00.000Z','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into payment_refunds (id,payment_id,provider,payment_ref,amount,state,created_at) values ('refund','payment','stripe','ref',100,'succeeded','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into payment_resolutions (id,payment_id,working_order_id,outcome,cancelled_at_provider,provider_status,resolved_at) values ('resolution','payment','order','captured',0,'succeeded','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into payment_holds (id,payment_id,provider_amount,found_at) values ('hold','payment',999,'2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into payment_hold_outcomes (id,hold_id,outcome,note,person_id,recorded_at) values ('outcome','hold','kept','Retained note','manager','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into payment_policy (id,offline_mode,offline_amount_cap,created_at,updated_at) values (1,'cash_only',0,'2026-10-20T08:00:00.000Z','2026-10-20T08:00:00.000Z')`,
    );
    db.run(sql`insert into device_card_readers (device_id,reader_id) values ('device','reader')`);
    db.run(
      sql`insert into device_profile_card_readers (device_profile_id,reader_id,position,is_default) values ('profile','reader',0,1)`,
    );
    db.run(
      sql`insert into card_reader_holders (reader_id,device_id,held_at) values ('reader','device','2026-10-20T08:00:00.000Z')`,
    );
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function path(db: Database) {
  return db
    .all<{ file: string }>(sql`pragma database_list`)
    .find((r) => r.file.endsWith("venue.db"))!.file;
}
async function run(
  options: {
    absentBefore?: boolean;
    sourceSchema?: number | null;
    missingEntry?: string;
    secrets?: string;
    trading?: string;
    backup?: string;
    credentialFailure?: Error;
    providerUsable?: boolean;
    unsupportedProvider?: boolean;
  } = {},
) {
  expect(api.paymentsBackupVerification).toBeTypeOf("function");
  const providers = [
    {
      providerId: "stripe",
      credentialPurpose: "payments.stripe" as const,
      verifyBackupCredential: options.unsupportedProvider
        ? undefined
        : () => options.providerUsable ?? true,
    },
    {
      providerId: "sumup",
      credentialPurpose: "payments.sumup" as const,
      verifyBackupCredential: () => true,
    },
  ];
  const owner = api.paymentsBackupVerification(providers);
  const before = await openBackupQuery(path(options.absentBefore ? absent.db : original.db));
  try {
    const after = await openBackupQuery(path(restored.db));
    try {
      const env: Record<string, string> = {
        "secrets/secrets.env":
          options.secrets ?? `WAITRON_CREDENTIALS_KEY=${key}\nWAITRON_CREDENTIALS_KEY_VERSION=1`,
        "secrets/trading.env": options.trading ?? "",
      };
      if (options.backup !== undefined) env["secrets/backup.env"] = options.backup;
      return await owner.verifyRestoredData({
        before:
          options.credentialFailure === undefined
            ? before.query
            : {
                async *rows(statement, values) {
                  if (statement.startsWith("select purpose,")) throw options.credentialFailure;
                  yield* before.query.rows(statement, values);
                },
              },
        after: after.query,
        entries: {
          async read(name) {
            if (options.missingEntry === name || env[name] === undefined) return null;
            return Buffer.from(env[name]);
          },
        },
        source: {
          nodeId: "source",
          locationId: "venue",
          environment: "preproduction",
          createdAt: "2026-10-20T08:00:00.000Z",
        },
        sourceSchema: options.sourceSchema === undefined ? 1 : options.sourceSchema,
        targetSchema: 1,
        signal: new AbortController().signal,
      });
    } finally {
      await after.close();
    }
  } finally {
    await before.close();
  }
}
async function credential(
  purpose: Purpose,
  value: Record<string, string>,
  dbs = [original.db, restored.db],
) {
  for (const db of dbs)
    await withTransaction(db, (tx) => putCredential(tx, ring, { purpose, value }));
}
function corrupt(db: Database, statement: string) {
  const triggers = db.all<{ name: string; sql: string }>(
    sql`select name,sql from sqlite_schema where type='trigger'`,
  );
  for (const row of triggers) db.run(sql.raw(`drop trigger "${row.name.replaceAll('"', '""')}"`));
  db.run(sql`pragma foreign_keys=off`);
  try {
    db.run(sql.raw(statement));
  } finally {
    db.run(sql`pragma foreign_keys=on`);
    for (const row of triggers) db.run(sql.raw(row.sql));
  }
}

it("preserves refund, hold, resolution and outcome evidence without payment or network effects", async () => {
  await credential("payments.stripe", stripe);
  await credential("payments.sumup", sumup);
  const forbidden = () => {
    throw new Error("Payment action during verification");
  };
  const capture = vi.spyOn(store, "insertCapturedPayment").mockImplementation(forbidden);
  const refund = vi.spyOn(store, "recordRefund").mockImplementation(forbidden);
  const poller = vi.spyOn(reconcile, "reconcilePayments").mockImplementation(forbidden);
  const network = vi.fn(forbidden);
  vi.stubGlobal("fetch", network);
  const snapshot = (db: Database) => tables.map((t) => db.all(sql.raw(`select * from "${t}"`)));
  const before = snapshot(original.db),
    after = snapshot(restored.db);
  expect(await run()).toEqual(passed);
  expect(snapshot(original.db)).toEqual(before);
  expect(snapshot(restored.db)).toEqual(after);
  for (const action of [capture, refund, poller, network]) expect(action).not.toHaveBeenCalled();
});
it("declares every classified table, its immutable evidence, private inputs and no effects", () => {
  const owner = validateBackupVerificationContribution(
    api.paymentsBackupVerification([
      {
        providerId: "stripe",
        credentialPurpose: "payments.stripe",
        verifyBackupCredential: () => true,
      },
      {
        providerId: "sumup",
        credentialPurpose: "payments.sumup",
        verifyBackupCredential: () => true,
      },
    ]),
  );
  expect(owner.data).toEqual({
    kind: "custom",
    tables,
    immutableTables: ["payment_resolutions", "payment_holds", "payment_hold_outcomes"],
    checks: ["data", "immutable", "secret"],
  });
  expect(owner.secrets).toEqual(["vault:payments.stripe", "vault:payments.sumup"]);
  expect(owner.entries).toEqual([
    { name: "secrets/secrets.env", presence: "required" },
    { name: "secrets/trading.env", presence: "required" },
    { name: "secrets/backup.env", presence: "optional" },
  ]);
  expect([owner.effects, owner.publicEvidenceDigest, owner.zeroSchema, owner.targetOnly]).toEqual([
    [],
    null,
    "absent_tables_and_entries",
    "empty_after_migration",
  ]);
});
it.each([
  ["payments", "amount=1001"],
  ["payment_refunds", "amount=101"],
  ["payment_resolutions", "provider_status='changed'"],
  ["payment_holds", "provider_amount=1001"],
  ["payment_hold_outcomes", "note='Changed note'"],
  ["payment_policy", "offline_amount_cap=101"],
  ["card_readers", "name='Changed reader'"],
  ["device_card_readers", "reader_id='other-reader'"],
  ["device_profile_card_readers", "position=1"],
  ["card_reader_holders", "held_at='2026-10-21T08:00:00.000Z'"],
])("detects a same-count value change in %s", async (table, change) => {
  expect(await run()).toEqual(passed);
  corrupt(restored.db, `update "${table}" set ${change}`);
  expect(await run()).toMatchObject({ status: "invalid" });
});
it.each(["sale_id", "reader_id", "node_id", "working_order_id"])(
  "checks the payment's %s reference even when both copies match",
  async (column) => {
    for (const db of [original.db, restored.db]) {
      corrupt(db, `update payments set "${column}"='missing'`);
    }
    expect(await run()).toMatchObject({ status: "invalid" });
  },
);
it.each([
  ["payment_refunds", "payment_id"],
  ["payment_resolutions", "payment_id"],
  ["payment_resolutions", "working_order_id"],
  ["payment_holds", "payment_id"],
  ["payment_hold_outcomes", "hold_id"],
  ["device_card_readers", "device_id"],
  ["device_card_readers", "reader_id"],
  ["device_profile_card_readers", "device_profile_id"],
  ["device_profile_card_readers", "reader_id"],
  ["card_reader_holders", "reader_id"],
  ["card_reader_holders", "device_id"],
])("checks the %s.%s reference in matching damaged copies", async (table, column) => {
  for (const db of [original.db, restored.db])
    corrupt(db, `update "${table}" set "${column}"='missing'`);
  expect(await run()).toMatchObject({ status: "invalid" });
});
it("permits disconnected providers and historical readers without sealed credentials", async () => {
  expect(await run()).toEqual(passed);
});
it.each(["stripe", "sumup"])(
  "requires a usable credential for an active %s reader",
  async (provider) => {
    for (const db of [original.db, restored.db])
      db.run(sql`update card_readers set active=1,provider=${provider}`);
    expect(await run()).toMatchObject({ status: "invalid" });
    await credential(
      provider === "stripe" ? "payments.stripe" : "payments.sumup",
      provider === "stripe" ? stripe : sumup,
    );
    expect(await run()).toEqual(passed);
  },
);
it("does not require provider credentials for an active simulator", async () => {
  for (const db of [original.db, restored.db])
    db.run(sql`update card_readers set active=1,provider='simulator'`);
  expect(await run()).toEqual(passed);
});
it("allows a deleted reader to remain as payment history after disconnect", async () => {
  for (const db of [original.db, restored.db])
    db.run(sql`update card_readers set active=1,deleted_at='2026-10-21T08:00:00.000Z'`);
  expect(await run()).toEqual(passed);
});
it.each(["attempting", "accepted_offline", "initiated"])(
  "keeps in-flight %s work as data",
  async (state) => {
    for (const db of [original.db, restored.db])
      db.run(sql`update payments set state=${state},sale_id=null`);
    expect(await run()).toEqual(passed);
    expect(restored.db.all(sql`select state,sale_id from payments`)).toEqual([
      { state, sale_id: null },
    ]);
  },
);
it.each(["payments.stripe", "payments.sumup"] as const)(
  "checks present %s payloads even with no active reader",
  async (purpose) => {
    await credential(purpose, purpose === "payments.stripe" ? stripe : sumup);
    expect(await run()).toEqual(passed);
    restored.db.run(sql`delete from tenant_credentials where purpose=${purpose}`);
    expect(await run()).toMatchObject({
      status: "invalid",
      checks: expect.arrayContaining([{ code: "secret", status: "invalid" }]),
    });
  },
);
it.each(["secretKey", "webhookSecret", "successUrl", "cancelUrl"])(
  "refuses malformed stored Stripe field %s",
  async (field) => {
    await credential("payments.stripe", stripe);
    // A correctly authenticated but unusable payload must fail its real reader as well.
    const { seal, aadFor } = await import("@waitron/credentials/src/cipher.js");
    const encrypted = seal(
      ring.current.key,
      aadFor("payments.stripe"),
      JSON.stringify({ ...stripe, [field]: "" }),
    );
    for (const db of [original.db, restored.db])
      db.run(
        sql`update tenant_credentials set ciphertext=${encrypted.ciphertext},iv=${encrypted.iv},auth_tag=${encrypted.authTag} where purpose='payments.stripe'`,
      );
    expect(await run()).toMatchObject({ status: "invalid" });
  },
);
it("reports a wrong vault key as unavailable, without returning decrypted input", async () => {
  await credential("payments.stripe", stripe);
  await expect(
    run({
      secrets: `WAITRON_CREDENTIALS_KEY=${Buffer.alloc(32, 8).toString("base64")}\nWAITRON_CREDENTIALS_KEY_VERSION=1`,
    }),
  ).rejects.toMatchObject({ name: "BackupCheckUnavailable", reason: "decryption_unavailable" });
});
it("keeps unexpected credential-reader failures inconclusive", async () => {
  const failure = new Error("Private reader failure");
  await expect(run({ credentialFailure: failure })).rejects.toBe(failure);
});
it("opens retained provider credentials with the previous captured vault key", async () => {
  await credential("payments.sumup", sumup);
  expect(
    await run({
      secrets: `WAITRON_CREDENTIALS_KEY=${Buffer.alloc(32, 8).toString("base64")}\nWAITRON_CREDENTIALS_KEY_VERSION=2\nWAITRON_CREDENTIALS_KEY_PREVIOUS=${key}\nWAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION=1`,
    }),
  ).toEqual(passed);
});
it.each(["secrets/secrets.env", "secrets/trading.env"])(
  "refuses missing private input %s",
  async (missingEntry) => {
    await expect(run({ missingEntry })).rejects.toMatchObject({
      name: "BackupCheckUnavailable",
      reason: "secret_unavailable",
    });
  },
);
it("uses captured file precedence, including the optional backup override", async () => {
  await credential("payments.sumup", { ...sumup, affiliateAppId: "app", affiliateKey: "secret" });
  const wrong = `WAITRON_CREDENTIALS_KEY=${Buffer.alloc(32, 8).toString("base64")}\nWAITRON_CREDENTIALS_KEY_VERSION=1`;
  expect(
    await run({ secrets: wrong, trading: wrong, backup: `WAITRON_CREDENTIALS_KEY=${key}` }),
  ).toEqual(passed);
});
it.each([0, null])("refuses source-owned tables hidden by schema %s", async (sourceSchema) => {
  expect(await run({ sourceSchema })).toMatchObject({ status: "invalid" });
});
it.each([0, null])(
  "accepts an absent source and empty migrated target for schema %s",
  async (sourceSchema) => {
    // Recreate only the schema; the existing helper still owns the database and teardown.
    for (const db of [restored.db]) {
      for (const table of [
        "card_reader_holders",
        "device_profile_card_readers",
        "device_card_readers",
        "payment_policy",
        "payment_hold_outcomes",
        "payment_holds",
        "payment_resolutions",
        "payment_refunds",
        "payments",
        "card_readers",
      ])
        corrupt(db, `delete from "${table}"`);
    }
    expect(await run({ absentBefore: true, sourceSchema })).toEqual(passed);
  },
);
it("refuses invented target rows when the source module was absent", async () => {
  expect(await run({ absentBefore: true, sourceSchema: 0 })).toMatchObject({ status: "invalid" });
});
it("refuses a positive source schema with missing payment tables", async () => {
  expect(await run({ absentBefore: true })).toMatchObject({ status: "invalid" });
});
it("refuses a missing restored payment table", async () => {
  const definition = restored.db.all<{ sql: string }>(
    sql`select sql from sqlite_schema where type='table' and name='payment_policy'`,
  )[0]!.sql;
  restored.db.run(sql`drop table payment_policy`);
  try {
    expect(await run()).toMatchObject({ status: "invalid" });
  } finally {
    restored.db.run(sql.raw(definition));
  }
});

it("refuses a payload the owning provider cannot use offline", async () => {
  await credential("payments.stripe", stripe);
  expect(await run({ providerUsable: false })).toMatchObject({ status: "invalid" });
});
it("does not certify present provider credentials without offline semantics", async () => {
  await credential("payments.stripe", stripe);
  expect(await run({ unsupportedProvider: true })).toMatchObject({ status: "unsupported" });
});
