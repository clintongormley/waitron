import {
  holdingsRead,
  summary,
  expectRefused,
  keptRecordsLogReason,
  notReady,
  expectStartAgainRefused,
  handMade,
  venueDb,
  type Held,
} from "../test/start-again-held-fixture.js";
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
