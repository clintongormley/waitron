import {
  holdingsRead,
  summary,
  expectRefused,
  keptRecordsLogReason,
  notReady,
  handMade,
  venueDb,
  withoutSignIn,
  type Held,
} from "../test/start-again-held-fixture.js";
import { expectStartAgainDeleted, expectStartAgainRefused } from "../test/start-again-deleted.js";
import { heldSetup } from "../test/held-setup-database.js";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { damagePages } from "../test/damaged-database.js";

it("a legitimate held setup database beside a stopped recovery answers the summary", async () => {
  const f = await heldSetup();
  const shown = await summary(f);
  expect(shown).toEqual({
    reached: "fiscal-finished",
    recovery: {
      startedAt: expect.any(String),
      lastActiveAt: expect.any(String),
      lastActiveSource: expect.any(String),
      failed: false,
      cloud: false,
    },
  });
});

it("a held setup database with an invoice record refuses the summary kept-records, and nothing changes", async () => {
  await expectRefused(await heldSetup({ invoices: 1 }), {
    code: "setup.start_again_refused",
    params: { cause: "kept-records" },
  });
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

it.each([
  ["committed", { tradingSettings: true }, true],
  ["complete", { status: "complete", tradingSettings: true }, false],
] as const)(
  "saved trading settings beside a held database (attempt %s) refuse setup.start_again_refused trading-settings, and nothing changes",
  async (_label, options, signIn) => {
    await expectRefused(
      await heldSetup(options),
      { code: "setup.start_again_refused", params: { cause: "trading-settings" } },
      { signIn },
    );
  },
);

it("a complete attempt with no saved trading settings refuses setup.start_again_refused setup-finished, and nothing changes", async () => {
  await expectRefused(
    await heldSetup({ status: "complete" }),
    { code: "setup.start_again_refused", params: { cause: "setup-finished" } },
    { signIn: false },
  );
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
        "select name from sqlite_schema where name not like 'sqlite\\_%' escape '\\' order by name",
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
  const f = await heldSetup({ recovery: false });
  expect(nodeHoldings(f)).toEqual({
    __drizzle_migrations_node: 1,
    node_mirror_link: 0,
    node_mode: 0,
    node_primary_key: 0,
    node_recovery_key: 1,
    node_signing_key: 1,
  });
  const { ids, actions } = await withoutSignIn(f);
  await expect(actions.startAgainFirstSetup(ids)).resolves.toBeUndefined();
  await expectStartAgainDeleted(f.roots);
});

it("in the held state, a node.db whose recovery-key check names another node refuses Start again setup.not_ready, and nothing changes", async () => {
  const f = await heldSetup({ recovery: false });
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
  ["saved trading settings", "trading-settings", { recovery: false, tradingSettings: true }, true],
  ["a complete attempt", "setup-finished", { recovery: false, status: "complete" }, false],
  ["an invoice record", "kept-records", { recovery: false, invoices: 1 }, true],
] as const)(
  "%s with no recovery started refuses the summary and Start again setup.start_again_refused %s, and nothing changes",
  async (_label, cause, options, signIn) => {
    const f = await heldSetup(options);
    const refusal = { code: "setup.start_again_refused", params: { cause } };
    await expectRefused(f, refusal, { signIn });
    await expectStartAgainRefused(f, await handMade(f, signIn, false), refusal);
  },
);

it.each([
  ["unknown", {}, notReady],
  ["partial", {}, notReady],
  [
    "unknown",
    { tradingSettings: true },
    { code: "setup.start_again_refused", params: { cause: "trading-settings" } },
  ],
  [
    "partial",
    { tradingSettings: true },
    { code: "setup.start_again_refused", params: { cause: "trading-settings" } },
  ],
] as const)(
  "a database read as %s beside a stopped recovery (%o) is refused as %o, and nothing changes",
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
