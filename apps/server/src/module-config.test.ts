import { CORE_MIGRATIONS, readSettings } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { isEnabled, parseModuleConfig } from "@waitron/module";
import { readModuleConfig, writeModuleConfig } from "./module-config.js";
import { ALL_MODULES, MODULES_SETTINGS } from "./modules.js";

const TOGGLEABLE = ALL_MODULES.find((m) => m.tier === "toggleable")!.name;
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function saved(modules: Record<string, boolean>) {
  await suite.db.execute(sql`insert into settings (module, version, revision, doc, updated_at)
    values ('modules', 1, 1, ${JSON.stringify({ modules })}, ${new Date().toISOString()})`);
}

describe("readModuleConfig", () => {
  it("absent row → everything enabled", async () => {
    const c = await readModuleConfig(suite.db);
    expect(isEnabled(c, "fiscal-verifactu")).toBe(true);
    expect(isEnabled(c, "payments")).toBe(true);
  });
  it("reads and validates a present row", async () => {
    await saved({ payments: false });
    const c = await readModuleConfig(suite.db);
    expect(isEnabled(c, "payments")).toBe(false);
  });
  it("an unknown module name in the row throws module.config_unknown", async () => {
    await saved({ nope: false });
    const err = await readModuleConfig(suite.db).catch((e) => e);
    expect(isAppError(err) && err.code).toBe("module.config_unknown");
  });
  it("a row naming scheduler throws module.config_unknown: it is part of payments, not a module", async () => {
    await saved({ scheduler: false });
    const err = await readModuleConfig(suite.db).catch((e) => e);
    expect(isAppError(err) && err.code).toBe("module.config_unknown");
  });
});

describe("writeModuleConfig ↔ readModuleConfig", () => {
  it("writes a config that reads back to the same enabled set", async () => {
    const config = parseModuleConfig({ modules: { [TOGGLEABLE]: false } }, ALL_MODULES);

    await writeModuleConfig(suite.db, config, null);
    expect((await readSettings(suite.db, MODULES_SETTINGS)).doc).toEqual({
      modules: { [TOGGLEABLE]: false },
    });

    const roundTripped = await readModuleConfig(suite.db);
    expect(isEnabled(roundTripped, TOGGLEABLE)).toBe(false);
    // Every other module stays enabled.
    for (const m of ALL_MODULES) {
      if (m.name !== TOGGLEABLE) expect(isEnabled(roundTripped, m.name)).toBe(true);
    }
  });

  it("writes an empty config that reads back as all-enabled", async () => {
    await writeModuleConfig(suite.db, parseModuleConfig({}, ALL_MODULES), null);

    const raw = (await readSettings(suite.db, MODULES_SETTINGS)).doc;
    expect(raw).toEqual({ modules: {} });

    const roundTripped = await readModuleConfig(suite.db);
    for (const m of ALL_MODULES) expect(isEnabled(roundTripped, m.name)).toBe(true);
  });
});
