import {
  expectRefused,
  loseVenueDatabase,
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
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { reconcileFirstSetupBeforeMode } from "./first-fiscal-mode.js";
import { loadConfig } from "./config.js";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

/**
 * Takes a held setup to `complete` through the store with its claim mark left `active`, as power
 * lost between the two saves of the store's `persist` leaves it.
 */
async function interruptedCompletion(f: Held): Promise<void> {
  const mark = join(f.roots.venueDir, "first-setup-claim.json");
  let state = (await f.host.store.read())!;
  state = await f.host.store.update(state.frozen.attemptId, state.revision, {
    kind: "publication",
  });
  const aside = await mkdtemp(join(tmpdir(), "interrupted-completion-"));
  try {
    await copyFile(mark, join(aside, "mark.json"));
    await f.host.store.update(state.frozen.attemptId, state.revision, { kind: "complete" });
    await copyFile(join(aside, "mark.json"), mark);
  } finally {
    await rm(aside, { recursive: true, force: true });
  }
}

function removeVenueRows(f: Pick<Held, "roots">) {
  const db = new DatabaseSync(venueDb(f));
  try {
    db.exec("pragma foreign_keys = off");
    for (const table of ["tenants", "locations"]) {
      const triggers = db
        .prepare("select name from sqlite_schema where type = 'trigger' and tbl_name = ?")
        .all(table) as { name: string }[];
      for (const { name } of triggers) db.exec(`drop trigger "${name}"`);
      db.exec(`delete from ${table}`);
    }
    db.prepare("delete from settings where module = ?").run("venue");
  } finally {
    db.close();
  }
}

it("a setup saved as complete whose claim mark was not is kept out of trading and sent to the repair page", async () => {
  const f = await heldSetup({ tradingSettings: true, certificate: true });
  await interruptedCompletion(f);
  const pair = await f.host.store.readResumable();
  expect(pair?.state.status).toBe("complete");
  expect(pair?.publicationComplete).toBe(false);
  const entry = await resolveFirstSetupEntry(f.roots, {});
  expect(entry.kind).toBe("resolution");
  const config = loadConfig(
    { WAITRON_NODE_ID: pair!.state.frozen.nodeId },
    "/migrations",
    "/state",
  );
  expect(config.node).toBeDefined();
  await reconcileFirstSetupBeforeMode(config, f.host.store);
  expect(config.node).toBeUndefined();
});

it("a setup saved as complete whose claim mark was not: Start again deletes it", async () => {
  const f = await heldSetup({ tradingSettings: true, certificate: true });
  await interruptedCompletion(f);
  expect(await readSetupDatabase(f.roots, f.host.modules!)).toMatchObject({
    kind: "read",
    holdings: { records: 0 },
  });
  const { ids, actions } = await withoutSignIn(f);
  await expect(actions.startAgainSummary(ids)).resolves.toEqual({ reached: "fiscal-finished" });
  await expect(actions.startAgainFirstSetup(ids)).resolves.toBeUndefined();
  await expectStartAgainDeleted(f.roots);
  await noConfirmations(f);
});

it("a setup saved as complete whose claim mark was not, and with an invoice beside it, Start again refuses kept-records, and nothing changes", async () => {
  const f = await heldSetup({ tradingSettings: true, certificate: true, invoices: 1 });
  await interruptedCompletion(f);
  await expectRefused(f, { code: "setup.start_again_refused", params: { cause: "kept-records" } });
  const { ids, actions } = await withoutSignIn(f);
  await expect(actions.startAgainFirstSetup(ids)).rejects.toMatchObject({
    code: "setup.start_again_refused",
    params: { cause: "kept-records" },
  });
});

it("a setup saved as complete whose claim mark was not, with its database lost as well, is still refused setup.not_ready for the trading settings it cannot check, and nothing changes", async () => {
  const f = await heldSetup({ tradingSettings: true, certificate: true });
  await interruptedCompletion(f);
  await loseVenueDatabase(f);
  const { ids, actions } = await withoutSignIn(f);
  await expectStartAgainRefused(
    f,
    () =>
      actions.startAgainFirstSetup({
        ...ids,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown: { reached: "fiscal-finished" } },
      }),
    { code: "setup.not_ready", reason: "refused artifact: state/trading.env" },
  );
  await expectRefused(f, {
    code: "setup.not_ready",
    reason: "refused artifact: state/trading.env",
  });
});

it("a setup whose record and claim mark both say complete, with its venue rows gone, is still refused setup-finished, and nothing changes", async () => {
  const f = await heldSetup({ status: "complete", tradingSettings: true, certificate: true });
  removeVenueRows(f);
  expect(await f.host.resolution.inspectFirstSetupResolution()).toMatchObject({
    database: "no-venue-rows",
    emptyDatabase: false,
  });
  expect((await resolveFirstSetupEntry(f.roots, {})).kind).toBe("resolution");
  await expectRefused(f, {
    code: "setup.start_again_refused",
    params: { cause: "setup-finished" },
  });
});

it("a setup whose record and claim mark both say complete, with its database missing, is still refused setup-finished, and nothing changes", async () => {
  const f = await heldSetup({ status: "complete", tradingSettings: true, certificate: true });
  await loseVenueDatabase(f);
  await expectRefused(f, {
    code: "setup.start_again_refused",
    params: { cause: "setup-finished" },
  });
});
