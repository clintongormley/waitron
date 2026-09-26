import { BOOKINGS_MIGRATIONS } from "@waitron/bookings";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CREDENTIALS_MIGRATIONS } from "@waitron/credentials";
import { CORE_ALERTS, CORE_MIGRATIONS } from "@waitron/db";
import { FISCAL_NONE_MIGRATIONS } from "@waitron/fiscal-none";
import { describe, expect, it } from "vitest";
import {
  FISCAL_PROVISIONING,
  FISCAL_RESTORE,
  FISCAL_SLOT,
  FISCAL_MIGRATIONS,
  FISCAL_VOCABULARY,
  FISCAL_ALERTS,
} from "@waitron/fiscal-verifactu";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { MEDIA_MIGRATIONS } from "@waitron/media";
import { manifestSets } from "@waitron/migrations";
import { orderedMigrationSets } from "@waitron/module";
import { PAYMENTS_ALERTS, PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { SCHEDULER_MIGRATIONS } from "@waitron/scheduler";
import { WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { WORKFORCE_ES_MIGRATIONS, WORKFORCE_ES_VOCABULARY } from "@waitron/workforce-es";
import {
  VENUE_SERVICE,
  VENUE_SERVICE_PERMISSIONS,
  VENUE_SERVICE_PROVISIONING,
  VENUE_SERVICE_MIGRATIONS,
  VENUE_SERVICE_ROUTES,
} from "@waitron/venue-service";
import { ALL_MODULES } from "./modules.js";

describe("ALL_MODULES is the migration source of truth", () => {
  it("derives exactly the manifest's sets, in order", () => {
    expect(orderedMigrationSets(ALL_MODULES)).toEqual(manifestSets());
  });
  it("lists the manifest's module names in order", () => {
    expect(ALL_MODULES.map((m) => m.name)).toEqual(manifestSets().map((s) => s.name));
  });
});

describe("the migration manifest", () => {
  it("names the same journal tables the packages themselves declare", () => {
    // Every *_MIGRATIONS descriptor computes migrationsFolder from its OWN import.meta.url, which
    // collapses onto the bundle's directory under esbuild, so the manifest supplies the folder. Its
    // TABLE could then drift from the package's; a rename fails here rather than by re-running old
    // migrations against a journal nobody reads. It lives in this package, not in
    // @waitron/migrations, because naming every module from there makes a dependency loop.
    const byName = Object.fromEntries(manifestSets().map((set) => [set.name, set.table]));
    expect(byName).toEqual({
      core: CORE_MIGRATIONS.migrationsTable,
      catalogue: CATALOGUE_MIGRATIONS.migrationsTable,
      media: MEDIA_MIGRATIONS.migrationsTable,
      "venue-service": VENUE_SERVICE_MIGRATIONS.migrationsTable,
      identity: IDENTITY_MIGRATIONS.migrationsTable,
      workforce: WORKFORCE_MIGRATIONS.migrationsTable,
      "workforce-es": WORKFORCE_ES_MIGRATIONS.migrationsTable,
      "fiscal-verifactu": FISCAL_MIGRATIONS.migrationsTable,
      "fiscal-none": FISCAL_NONE_MIGRATIONS.migrationsTable,
      payments: PAYMENTS_MIGRATIONS.migrationsTable,
      scheduler: SCHEDULER_MIGRATIONS.migrationsTable,
      credentials: CREDENTIALS_MIGRATIONS.migrationsTable,
      bookings: BOOKINGS_MIGRATIONS.migrationsTable,
    });
  });
});

describe("ALL_MODULES backup contribution", () => {
  it("fiscal declares its restore hook, by reference", () => {
    const fiscal = ALL_MODULES.find((m) => m.name === "fiscal-verifactu")!;
    expect(FISCAL_RESTORE).toBeTypeOf("function");
    expect(fiscal.backup?.restore).toBe(FISCAL_RESTORE);
  });

  it("image bytes belong to classified database state, not non-DB state", () => {
    const core = ALL_MODULES.find((m) => m.name === "core");
    expect(core?.backup?.nonDbState).toBeUndefined();
    expect(
      ALL_MODULES.find((module) => module.name === "media")?.classification?.map(
        (table) => table.table,
      ),
    ).toEqual(["media_images", "media_image_data"]);
  });
  it("a module may omit backup (open contribution set)", () => {
    const identity = ALL_MODULES.find((m) => m.name === "identity");
    expect(identity?.backup).toBeUndefined();
  });
});

describe("ALL_MODULES configuration transfer contribution", () => {
  it("makes every module explicitly opt in or declare no transferable configuration", () => {
    expect(ALL_MODULES.map((module) => [module.name, module.configurationTransfer?.kind])).toEqual(
      ALL_MODULES.map((module) => [module.name, expect.stringMatching(/^(none|tables)$/)]),
    );
  });

  it("has no route from preparation sales, fiscal history, credentials or account tokens", () => {
    const names = ALL_MODULES.flatMap((module) =>
      module.configurationTransfer?.kind === "tables"
        ? module.configurationTransfer.tables.map((table) => table.name)
        : [],
    );
    for (const forbidden of [
      "sales",
      "tenders",
      "payments",
      "payment_refunds",
      "tenant_credentials",
      "management_account_actions",
      "management_sessions",
      "sessions",
      "bookings",
      "time_entries",
      // A published version's document holds ids an import does not remap.
      "menu_versions",
      "menu_publications",
      "menu_version_images",
    ]) {
      expect(names).not.toContain(forbidden);
    }
    expect(
      ALL_MODULES.find((module) => module.name === "fiscal-verifactu")?.configurationTransfer,
    ).toEqual({ kind: "none" });
  });

  it("removes active order links and hardware authenticators from copied configuration", () => {
    const tables = ALL_MODULES.flatMap((module) =>
      module.configurationTransfer?.kind === "tables" ? module.configurationTransfer.tables : [],
    );
    expect(tables.find((table) => table.name === "dining_tables")?.omit).toContain("tab_id");
    expect(tables.find((table) => table.name === "print_agents")?.omit).toEqual(
      expect.arrayContaining(["token_hash", "last_seen_at"]),
    );
    expect(tables.find((table) => table.name === "printers")?.omit).toContain("poll_token_hash");
  });
});

describe("ALL_MODULES vocabulary seat", () => {
  it("fiscal declares the fiscal module's own vocabulary, by reference", () => {
    const fiscal = ALL_MODULES.find((m) => m.name === "fiscal-verifactu");
    expect(fiscal?.vocabulary).toBe(FISCAL_VOCABULARY);
  });
  it("workforce-es declares the Spain labour module's own vocabulary, by reference", () => {
    const wfes = ALL_MODULES.find((m) => m.name === "workforce-es");
    expect(wfes?.vocabulary).toBe(WORKFORCE_ES_VOCABULARY);
  });
});

describe("ALL_MODULES provisioning and fiscal seats", () => {
  it("venue service declares its service, provisioning, route, and permission seats", () => {
    const venueService = ALL_MODULES.find((module) => module.name === "venue-service");
    expect(venueService?.venueService).toBe(VENUE_SERVICE);
    expect(venueService?.provisioning).toBe(VENUE_SERVICE_PROVISIONING);
    expect(venueService?.routes).toBe(VENUE_SERVICE_ROUTES);
    expect(venueService?.permissions).toBe(VENUE_SERVICE_PERMISSIONS);
  });

  it("fiscal declares its provisioning contribution and fills the fiscal slot, by reference", () => {
    const fiscal = ALL_MODULES.find((m) => m.name === "fiscal-verifactu");
    expect(fiscal?.provisioning).toBe(FISCAL_PROVISIONING);
    expect(fiscal?.fiscal).toBe(FISCAL_SLOT);
  });
  it("the two modules that fill the fiscal slot, in order", () => {
    expect(ALL_MODULES.filter((m) => m.fiscal !== undefined).map((m) => m.name)).toEqual([
      "fiscal-verifactu",
      "fiscal-none",
    ]);
  });
});

describe("ALL_MODULES fiscal-none member", () => {
  it('fills the fiscal slot with the no-regime contribution (`id === "none"`)', () => {
    const none = ALL_MODULES.find((m) => m.name === "fiscal-none");
    expect(none?.fiscal?.id).toBe("none");
    expect(none?.tier).toBe("provision-only");
  });
  it("declares no provisioning or vocabulary — it owns nothing beyond the slot", () => {
    const none = ALL_MODULES.find((m) => m.name === "fiscal-none");
    expect(none?.provisioning).toBeUndefined();
    expect(none?.vocabulary).toBeUndefined();
    expect(none?.backup).toBeUndefined();
  });
});

describe("ALL_MODULES alerts seat", () => {
  it("core, payments and fiscal-verifactu carry their event-code claims, by reference", () => {
    expect(ALL_MODULES.find((m) => m.name === "core")?.alerts).toBe(CORE_ALERTS);
    expect(ALL_MODULES.find((m) => m.name === "payments")?.alerts).toBe(PAYMENTS_ALERTS);
    expect(ALL_MODULES.find((m) => m.name === "fiscal-verifactu")?.alerts).toBe(FISCAL_ALERTS);
  });
});
