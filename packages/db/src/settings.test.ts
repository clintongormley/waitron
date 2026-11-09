import { defineSettingsDocument, readSettings, saveSettings, type SettingsParse } from "./index.js";
import { withTransaction } from "./tenancy.js";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS } from "./migrations.js";
import { useVenueDb } from "./testing/venue-db.js";
import { checkFailed, triggerRaised } from "./constraint-target.js";
import { persons } from "./schema/identity/persons.js";

describe("the settings table", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  function insert(
    module = "probe",
    doc = "{}",
    version = 1,
    revision = 1,
    saver: string | null = null,
  ) {
    return suite.db
      .execute(sql`insert into settings (module, version, revision, doc, updated_at, updated_by)
      values (${module}, ${version}, ${revision}, ${doc}, '2026-11-09T12:00:00.000Z', ${saver})`);
  }
  function refuses(run: () => unknown, constraint: string) {
    let error: unknown;
    try {
      run();
    } catch (caught) {
      error = caught;
    }
    expect(checkFailed(error, constraint)).toBe(true);
  }
  it("refuses a key that is not a lowercase name", () => {
    for (const key of ["Venue", "business-day", "", "_x"])
      refuses(() => insert(key), "settings_module_ck");
    insert("business_day");
    expect(suite.db.execute(sql`select module from settings`).rows).toEqual([
      { module: "business_day" },
    ]);
  });
  it("refuses a document that is not a JSON object", () => {
    for (const doc of ["not json", "[1]", '"s"'])
      refuses(() => insert("probe", doc), "settings_doc_ck");
    insert();
    expect(suite.db.execute(sql`select doc from settings`).rows).toEqual([{ doc: "{}" }]);
  });
  it("refuses a version or revision below 1", () => {
    refuses(() => insert("probe", "{}", 0), "settings_version_ck");
    refuses(() => insert("probe", "{}", 1, 0), "settings_revision_ck");
    insert();
    expect(suite.db.execute(sql`select version, revision from settings`).rows).toEqual([
      { version: 1, revision: 1 },
    ]);
  });
  it("refuses a module key twice", () => {
    insert();
    expect(() => insert()).toThrow(/UNIQUE constraint failed: settings.module/);
  });
  it("names its saver by a real person", async () => {
    expect(() => insert("probe", "{}", 1, 1, "missing")).toThrow(/FOREIGN KEY/);
    const [person] = await suite.db.insert(persons).values({ displayName: "Owner" }).returning();
    insert("probe", "{}", 1, 1, person!.id);
    insert("system");
    expect(() => suite.db.execute(sql`delete from persons where id = ${person!.id}`)).toThrow(
      /FOREIGN KEY/,
    );
    expect(
      suite.db.execute(sql`select updated_by from settings where module = 'system'`).rows,
    ).toEqual([{ updated_by: null }]);
  });
  it("holds exactly the four named CHECKs", () => {
    const rows = suite.db.execute<{ sql: string }>(
      sql`select sql from sqlite_schema where name = 'settings'`,
    ).rows;
    const text = rows[0]?.sql ?? "";
    expect(
      [...text.matchAll(/CONSTRAINT\s+["`]?([\w]+)["`]?\s+CHECK/gi)].map((m) => m[1]).sort(),
    ).toEqual([
      "settings_doc_ck",
      "settings_module_ck",
      "settings_revision_ck",
      "settings_version_ck",
    ]);
    expect(text.match(/\bcheck\s*\(/gi)).toHaveLength(4);
  });
});

describe("settings documents", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const definition = {
    module: "probe",
    version: 1,
    defaults: () => ({ size: 0, unit: "cm" }),
    transfers: false,
    parse(doc: unknown): SettingsParse<Probe> {
      if (typeof doc !== "object" || doc === null) return { ok: false, field: "doc" };
      const value = doc as Record<string, unknown>;
      for (const key of Object.keys(value))
        if (key !== "size" && key !== "unit") return { ok: false, field: key };
      if (
        !Number.isInteger(value.size) ||
        (value.size as number) < 0 ||
        (value.size as number) > 10
      )
        return { ok: false, field: "size" };
      if (typeof value.unit !== "string" || !["cm", "in"].includes(value.unit.trim()))
        return { ok: false, field: "unit" };
      return { ok: true, doc: { size: value.size as number, unit: value.unit.trim() } };
    },
  };
  function probe() {
    return defineSettingsDocument(definition);
  }
  function save(
    doc: Probe = { size: 2, unit: "cm" },
    expectedRevision = 0,
    personId: string | null = null,
  ) {
    return withTransaction(suite.db, (tx) =>
      saveSettings(tx, probe(), { doc, expectedRevision, personId }),
    );
  }
  function raw(doc: string, version = 1) {
    suite.db.execute(
      sql`insert into settings values ('probe', ${version}, 3, ${doc}, '2026-11-09T12:00:00.000Z', null)`,
    );
  }
  it("defines a valid document unchanged and refuses invalid keys and versions", () => {
    expect(defineSettingsDocument(definition)).toBe(definition);
    for (const module of ["Probe", "business-day", "", "_x"])
      expect(() => defineSettingsDocument({ ...definition, module })).toThrow(/module/);
    for (const version of [0, 1.5])
      expect(() => defineSettingsDocument({ ...definition, version })).toThrow(/version/);
  });
  it("reads independent defaults at revision zero", async () => {
    const first = await readSettings(suite.db, probe());
    expect(first).toEqual({ doc: { size: 0, unit: "cm" }, revision: 0 });
    first.doc.size = 9;
    expect(await readSettings(suite.db, probe())).toEqual({
      doc: { size: 0, unit: "cm" },
      revision: 0,
    });
  });
  it("reads the stored document and revision", async () => {
    raw('{"size":2,"unit":"in"}');
    expect(await readSettings(suite.db, probe())).toEqual({
      doc: { size: 2, unit: "in" },
      revision: 3,
    });
  });
  it("refuses another stored version instead of reading defaults", async () => {
    raw('{"size":2,"unit":"cm"}', 2);
    await expect(readSettings(suite.db, probe())).rejects.toMatchObject({
      code: "settings.invalid",
      params: { module: "probe", field: "version", version: 2 },
    });
  });
  it("refuses a stored document its checker rejects", async () => {
    raw('{"size":99,"unit":"cm"}');
    await expect(readSettings(suite.db, probe())).rejects.toMatchObject({
      code: "settings.invalid",
      params: { module: "probe", field: "size" },
    });
  });
  it("stores the checked document and the saver with the server time", async () => {
    const [person] = await suite.db.insert(persons).values({ displayName: "Owner" }).returning();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T12:00:00.000Z"));
    try {
      expect(await save({ size: 2, unit: " cm " }, 0, person!.id)).toEqual({
        doc: { size: 2, unit: "cm" },
        revision: 1,
      });
      expect(suite.db.execute(sql`select * from settings`).rows).toEqual([
        {
          module: "probe",
          version: 1,
          revision: 1,
          doc: '{"size":2,"unit":"cm"}',
          updated_at: "2026-11-09T12:00:00.000Z",
          updated_by: person!.id,
        },
      ]);
      vi.setSystemTime(new Date("2026-11-09T13:00:00.000Z"));
      expect(await save({ size: 3, unit: "in" }, 1)).toEqual({
        doc: { size: 3, unit: "in" },
        revision: 2,
      });
      expect(
        suite.db.execute(sql`select version, revision, doc, updated_at, updated_by from settings`)
          .rows,
      ).toEqual([
        {
          version: 1,
          revision: 2,
          doc: '{"size":3,"unit":"in"}',
          updated_at: "2026-11-09T13:00:00.000Z",
          updated_by: null,
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
  it("refuses a clashing create or update and preserves the first save", async () => {
    await save();
    for (const expectedRevision of [0, 4])
      await expect(save({ size: 8, unit: "in" }, expectedRevision)).rejects.toMatchObject({
        code: "settings.out_of_date",
        params: { module: "probe", revision: 1 },
      });
    expect(await readSettings(suite.db, probe())).toEqual({
      doc: { size: 2, unit: "cm" },
      revision: 1,
    });
  });
  it("refuses an update of an absent document without writing", async () => {
    await expect(save(undefined, 5)).rejects.toMatchObject({
      code: "settings.out_of_date",
      params: { module: "probe", revision: 0 },
    });
    expect(suite.db.execute(sql`select * from settings`).rows).toEqual([]);
  });
  it("refuses invalid input without writing", async () => {
    await expect(save({ size: 2, unit: "bad" })).rejects.toMatchObject({
      code: "settings.invalid",
      params: { module: "probe", field: "unit" },
    });
    expect(suite.db.execute(sql`select * from settings`).rows).toEqual([]);
  });
  it("refuses a caller's invalid revision", async () => {
    for (const revision of [-1, 1.5])
      await expect(save(undefined, revision)).rejects.toBeInstanceOf(RangeError);
  });
});

interface Probe {
  size: number;
  unit: string;
}

describe("a per-module rule on settings", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS],
    setup(db) {
      for (const [event, suffix] of [
        ["insert", "insert"],
        ["update of doc", "update"],
      ]) {
        db.execute(
          sql.raw(`create trigger settings_probe_size_${suffix} before ${event} on settings
        when new.module = 'probe' and json_extract(new.doc, '$.size') > 3
        begin select raise(abort, 'probe.too_big'); end`),
        );
      }
    },
  });
  const definition = (module = "probe") =>
    defineSettingsDocument({
      module,
      version: 1,
      transfers: false,
      defaults: () => ({ size: 0 }),
      parse: (doc: unknown) => ({ ok: true as const, doc: doc as { size: number } }),
    });
  const save = (size: number, expectedRevision = 0, module = "probe") =>
    withTransaction(suite.db, (tx) =>
      saveSettings(tx, definition(module), { doc: { size }, expectedRevision, personId: null }),
    );
  it("refuses the module's bad document through saveSettings", async () => {
    for (const revision of [0, 1]) {
      if (revision === 1) await save(2);
      let error: unknown;
      try {
        await save(4, revision);
      } catch (caught) {
        error = caught;
      }
      expect(triggerRaised(error, "probe.too_big")).toBe(true);
    }
    expect(await readSettings(suite.db, definition())).toEqual({ doc: { size: 2 }, revision: 1 });
  });
  it("leaves the module's good document and another module's alone", async () => {
    expect(await save(3)).toEqual({ doc: { size: 3 }, revision: 1 });
    expect(await save(4, 0, "other")).toEqual({ doc: { size: 4 }, revision: 1 });
    expect(await save(5, 1, "other")).toEqual({ doc: { size: 5 }, revision: 2 });
  });
});
