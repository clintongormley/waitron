import { captureError, checkFailed, triggerRaised, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../../test/migrations.js";
import { seedTenantNodeSif } from "../../test/fixtures.js";
import { keptDeclarations } from "./kept.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, setup: seedTenantNodeSif });

const T0 = new Date("2026-11-01T09:00:00.000Z");
const T1 = new Date("2026-11-02T09:00:00.000Z");
const T2 = new Date("2026-11-03T09:00:00.000Z");

function keep(version: string, text: string, at: Date) {
  return withTransaction(suite.db, (tx) => keptDeclarations.keep(tx, { version, text, at }));
}

function versions() {
  return withTransaction(suite.db, (tx) => keptDeclarations.versions(tx));
}

function text(version: string) {
  return withTransaction(suite.db, (tx) => keptDeclarations.text(tx, version));
}

describe("keptDeclarations", () => {
  it("keeps a version's text once", async () => {
    await keep("1.0.0", "A", T1);
    await keep("1.0.0", "B", T2);
    expect(await versions()).toEqual(["1.0.0"]);
    expect(await text("1.0.0")).toBe("A");
    const { rows } = await suite.db.execute<{ first_started_at: string }>(
      sql`select first_started_at from declaraciones_responsables`,
    );
    expect(rows).toEqual([{ first_started_at: T1.toISOString() }]);
  });

  it("lists every kept version", async () => {
    await keep("1.10.0", "ten", T1);
    await keep("1.2.0", "two", T2);
    await keep("1.9.0", "nine", T0);
    const kept = await versions();
    expect([...kept].sort()).toEqual(["1.10.0", "1.2.0", "1.9.0"]);
  });

  it("answers null for a version never kept", async () => {
    expect(await versions()).toEqual([]);
    expect(await text("9.9.9")).toBeNull();
  });

  it("refuses to change or remove a kept row", async () => {
    await keep("1.0.0", "A", T1);
    const update = await captureError(async () =>
      suite.db.execute(sql`update declaraciones_responsables set text = 'changed'`),
    );
    expect(triggerRaised(update, "declaraciones_responsables is append-only")).toBe(true);
    const remove = await captureError(async () =>
      suite.db.execute(sql`delete from declaraciones_responsables`),
    );
    expect(triggerRaised(remove, "declaraciones_responsables is append-only")).toBe(true);
    expect(await text("1.0.0")).toBe("A");
  });

  it.each(["1.0", "1.0.0-dev", "1..0", "a.b.c", "", "1.0.0.0", ".1.0", "1.0."])(
    "refuses %j, which is not a release version",
    async (version) => {
      const error = await captureError(() => keep(version, "A", T1));
      expect(checkFailed(error, "declaraciones_responsables_version_ck")).toBe(true);
    },
  );

  it("keeps release versions", async () => {
    await keep("1.0.0", "A", T1);
    await keep("10.20.30", "B", T1);
    expect([...(await versions())].sort()).toEqual(["1.0.0", "10.20.30"]);
  });

  it("keeps the text's bytes exactly", async () => {
    const original = "«Declaración» de España\n\nSegundo párrafo, año.\n";
    await keep("1.0.0", original, T1);
    expect(await text("1.0.0")).toBe(original);
  });
});
