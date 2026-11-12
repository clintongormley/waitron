import {
  openVenueDatabase,
  nodes,
  persons,
  readActivityForSubject,
  withTransaction,
} from "@waitron/db";
import { buildConfigurationBundle, importConfigurationTables } from "./configuration-transfer.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import {
  holdingsRead,
  askStartAgain,
  expectRefused,
  keptRecordsLogReason,
  notReadyBecause,
  handMade,
  venueDb,
  withoutSignIn,
  type Held,
} from "../test/start-again-held-fixture.js";
import {
  expectStartAgainDeleted,
  expectStartAgainRefused,
  noConfirmations,
} from "../test/start-again-deleted.js";
import { heldSetup } from "../test/held-setup-database.js";
import { readSetupDatabase } from "./first-setup-database-holdings.js";
import { expectedSchemaVersion, manifestSets } from "@waitron/migrations";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { damagePages } from "../test/damaged-database.js";

it("a held setup database with an invoice record refuses the summary kept-records, and nothing changes", async () => {
  await expectRefused(await heldSetup({ invoices: 1 }), {
    code: "setup.start_again_refused",
    params: { cause: "kept-records" },
  });
});

it("a held setup with its certificate row: nothing is kept, and Start again deletes everything", async () => {
  const f = await heldSetup({ certificate: true });
  expect(await readSetupDatabase(f.roots, f.host.modules!)).toMatchObject({
    kind: "read",
    holdings: { kept: 0, records: 0 },
  });
  const { ids, actions } = await withoutSignIn(f);
  await expect(actions.startAgainSummary(ids)).resolves.toEqual({ reached: "fiscal-finished" });
  await expect(actions.startAgainFirstSetup(ids)).resolves.toBeUndefined();
  await expectStartAgainDeleted(f.roots);
  await noConfirmations(f);
});

/** What the setup database would keep with its certificate rows gone, read from a copy. */
async function keptWithoutCertificates(f: Held) {
  const aside = await mkdtemp(join(tmpdir(), "held-without-certificates-"));
  try {
    await copyFile(venueDb(f), join(aside, "venue.db"));
    const copy = new DatabaseSync(join(aside, "venue.db"));
    try {
      const triggers = copy
        .prepare(
          "select name from sqlite_schema where type = 'trigger' and tbl_name = 'fiscal_certificate_installs'",
        )
        .all() as { name: string }[];
      for (const { name } of triggers) copy.exec(`drop trigger "${name}"`);
      copy.exec("delete from fiscal_certificate_installs");
    } finally {
      copy.close();
    }
    const read = await readSetupDatabase(
      { venueDir: aside, stateDir: f.roots.stateDir },
      f.host.modules!,
    );
    return read.kind === "read" ? read.holdings.kept : undefined;
  } finally {
    await rm(aside, { recursive: true, force: true });
  }
}

it("a held setup with its certificate row and an invoice refuses kept-records, keeping only what the invoice keeps, and nothing changes", async () => {
  const f = await heldSetup({ certificate: true, invoices: 1 });
  await expectRefused(f, {
    code: "setup.start_again_refused",
    params: { cause: "kept-records" },
  });
  const kept = /kept=(\d+)/.exec(String(await keptRecordsLogReason(f)))?.[1];
  expect(Number(kept)).toBe(await keptWithoutCertificates(f));
});

it("the summary's kept-records refusal logs the counts, not the answer", async () => {
  expect(await keptRecordsLogReason(await heldSetup({ invoices: 1 }))).toMatch(
    /^rows=\d+ kept=\d+ records=1 accepted=0$/,
  );
});

it("a kept-records refusal after a damaged read logs the damage's code after the counts", async () => {
  const f = await heldSetup({ invoices: 1 });
  damagePages(venueDb(f), "tenants");
  expect(await keptRecordsLogReason(f)).toMatch(
    /^rows=\d+ kept=[1-9]\d* records=\d+ accepted=\d+ damaged=errcode 11$/,
  );
});

it("saved trading settings and the certificate beside a held database: the summary says fiscal-finished and Start again deletes everything", async () => {
  const f = await heldSetup({ tradingSettings: true, certificate: true });
  expect(await readSetupDatabase(f.roots, f.host.modules!)).toMatchObject({
    kind: "read",
    holdings: { records: 0 },
  });
  const { ids, actions } = await withoutSignIn(f);
  await expect(actions.startAgainSummary(ids)).resolves.toEqual({ reached: "fiscal-finished" });
  await expect(actions.startAgainFirstSetup(ids)).resolves.toBeUndefined();
  await expectStartAgainDeleted(f.roots);
});

it("a complete attempt with saved trading settings refuses setup.start_again_refused setup-finished, and nothing changes", async () => {
  await expectRefused(await heldSetup({ status: "complete", tradingSettings: true }), {
    code: "setup.start_again_refused",
    params: { cause: "setup-finished" },
  });
});

it("a complete attempt with no saved trading settings refuses setup.start_again_refused setup-finished, and nothing changes", async () => {
  await expectRefused(await heldSetup({ status: "complete" }), {
    code: "setup.start_again_refused",
    params: { cause: "setup-finished" },
  });
});

it("a held summary the disk check refuses is refused before what the setup database holds is read, and nothing changes", async () => {
  const f = await heldSetup();
  const node = new DatabaseSync(join(f.roots.venueDir, "node.db"));
  node.exec("create table t(x)");
  node.close();
  holdingsRead.calls = 0;
  await expectRefused(f, { code: "setup.not_ready", reason: "node.db holds a table" });
  expect(holdingsRead.calls).toBe(0);
});

/** node.db's tables, and the rows each holds. */
function nodeHoldings(f: Pick<Held, "roots">) {
  const node = new DatabaseSync(join(f.roots.venueDir, "node.db"), { readOnly: true });
  try {
    const names = node
      .prepare(
        "select name from sqlite_schema where type = 'table' and name not like 'sqlite\\_%' escape '\\' order by name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    return Object.fromEntries(
      names.map((name) => [
        name,
        (node.prepare(`select count(*) as n from "${name}"`).get() as { n: number }).n,
      ]),
    );
  } finally {
    node.close();
  }
}

it("in the held state, Start again deletes a node.db holding the node set's tables and the attempt's recovery-key check and signing key", async () => {
  const f = await heldSetup();
  expect(nodeHoldings(f)).toEqual({
    __drizzle_migrations_node: expectedSchemaVersion(
      manifestSets().find((set) => set.name === "node")!,
      null,
    ),
    node_handover_events: 0,
    node_handover_operations: 0,
    node_handover_restriction: 0,
    node_mirror_link: 0,
    node_mode: 0,
    node_pair_link: 0,
    node_primary_key: 0,
    node_recovery_key: 1,
    node_signing_key: 1,
  });
  const { ids, actions } = await withoutSignIn(f);
  await expect(actions.startAgainFirstSetup(ids)).resolves.toBeUndefined();
  await expectStartAgainDeleted(f.roots);
});

it("in the held state, a node.db whose recovery-key check names another node refuses Start again setup.not_ready, and nothing changes", async () => {
  const f = await heldSetup();
  const node = new DatabaseSync(join(f.roots.venueDir, "node.db"));
  node.exec(`update node_recovery_key set node_id = '${crypto.randomUUID()}'`);
  node.close();
  expect(nodeHoldings(f)).toMatchObject({ node_recovery_key: 1 });
  holdingsRead.calls = 0;
  await expectRefused(f, {
    code: "setup.not_ready",
    reason: "node.db holds another node's row: node_recovery_key",
  });
  expect(holdingsRead.calls).toBe(0);
});

it("in the held state, a node.db holding a mirror link refuses Start again setup.not_ready, and nothing changes", async () => {
  const f = await heldSetup();
  const node = new DatabaseSync(join(f.roots.venueDir, "node.db"));
  node.exec(
    `insert into node_mirror_link values ('${crypto.randomUUID()}', 'https://relay.test', 'box', 'pem', '${crypto.randomUUID()}', '2026-10-31T00:00:00.000Z')`,
  );
  node.close();
  holdingsRead.calls = 0;
  await expectRefused(f, {
    code: "setup.not_ready",
    reason: "node.db holds a row: node_mirror_link",
  });
  expect(holdingsRead.calls).toBe(0);
});

it.each([
  [
    "saved trading settings, the certificate and an invoice",
    "kept-records",
    { tradingSettings: true, certificate: true, invoices: 1 },
  ],
  ["a complete attempt", "setup-finished", { status: "complete" }],
  ["an invoice record", "kept-records", { invoices: 1 }],
] as const)(
  "%s refuses the summary and Start again setup.start_again_refused %s, and nothing changes",
  async (_label, cause, options) => {
    const f = await heldSetup(options);
    const refusal = { code: "setup.start_again_refused", params: { cause } };
    await expectRefused(f, refusal);
    await expectStartAgainRefused(f, await handMade(f), refusal);
  },
);

it.each([
  ["unknown", {}, notReadyBecause("unreadable")],
  ["partial", {}, notReadyBecause("unreadable")],
  ["unknown", { tradingSettings: true }, notReadyBecause("unreadable")],
  ["partial", { tradingSettings: true }, notReadyBecause("unreadable")],
] as const)(
  "a database read as %s (%o) is refused as %o, and nothing changes",
  async (database, options, refusal) => {
    const f = await heldSetup(options);
    const inspect = f.host.resolution.inspectFirstSetupResolution;
    const host = {
      ...f.host,
      resolution: {
        ...f.host.resolution,
        inspectFirstSetupResolution: async () => ({ ...(await inspect()), database }),
      },
    } as Held["host"];
    await expectRefused(f, refusal, { host });
  },
);

it("a held setup whose database the inspection shows empty refuses the summary setup.not_ready may-have-filed, and nothing changes", async () => {
  const f = await heldSetup();
  const inspect = f.host.resolution.inspectFirstSetupResolution;
  const host = {
    ...f.host,
    resolution: {
      ...f.host.resolution,
      inspectFirstSetupResolution: async () => ({
        ...(await inspect()),
        database: "no-venue-rows" as const,
        emptyDatabase: true,
      }),
    },
  } as Held["host"];
  await expectRefused(f, notReadyBecause("may-have-filed"), { host });
});

it("imported settings history does not block Start again for a held setup", async () => {
  const f = await heldSetup();
  const held = await openVenueDatabase(f.roots.venueDir);
  try {
    const versions = await schemaVersionsByModule(held, f.host.modules);
    const [node] = await held.venue.select({ id: nodes.id }).from(nodes).limit(1);
    const [operator] = await held.venue.select({ id: persons.id }).from(persons).limit(1);
    const bundle = await buildConfigurationBundle(
      held.venue,
      { nodeId: node!.id, sourceOperatorId: operator!.id },
      f.host.modules,
      new Date("2026-11-09T12:00:00.000Z"),
      versions,
    );
    await withTransaction(held.venue, (tx) =>
      importConfigurationTables(
        tx,
        {
          ...bundle,
          settings: {
            ...bundle.settings,
            adjustments: { version: 1, doc: { maxBillComp: 4000 } },
          },
        },
        f.host.modules,
        versions,
      ),
    );
    expect(
      (await readActivityForSubject(held.venue, { kind: "settings", id: "adjustments" })).map(
        ({ personId, data }) => ({ personId, data }),
      ),
    ).toEqual([{ personId: null, data: { revision: 1 } }]);
  } finally {
    await held.close();
  }
  const attempt = await askStartAgain(f);
  await expect(attempt.run()).resolves.toBeUndefined();
  await expectStartAgainDeleted(f.roots);
});
