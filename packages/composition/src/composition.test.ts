import { FISCAL_NONE_BACKUP_VERIFICATION } from "@waitron/fiscal-none";
import {
  ADJUSTMENTS_CHANGE_SOURCES,
  ADJUSTMENTS_CONFIGURATION_TRANSFER,
  ADJUSTMENTS_PERMISSIONS,
  ADJUSTMENTS_PERSONAL_DATA,
  ADJUSTMENTS_PROVISIONING,
  ADJUSTMENTS_ROUTES,
  ADJUSTMENTS_SETTINGS,
} from "@waitron/adjustments";
import { BOOKINGS_MIGRATIONS } from "@waitron/bookings";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { CORE_ALERTS, CORE_MIGRATIONS } from "@waitron/db";
import { FISCAL_NONE_MIGRATIONS } from "@waitron/fiscal-none";
import { describe, expect, it } from "vitest";
import {
  FISCAL_PROVISIONING,
  FISCAL_RESTORE,
  FISCAL_ROUTES,
  FISCAL_SLOT,
  FISCAL_MIGRATIONS,
  FISCAL_VOCABULARY,
  FISCAL_ALERTS,
  FISCAL_STAFF_NOTICES,
  VERIFACTU_HANDOVER,
} from "@waitron/fiscal-verifactu";
import {
  IDENTITY_BACKUP_VERIFICATION,
  IDENTITY_PERSONAL_DATA,
  PERMISSIONS,
  registerModulePermissions,
  roleHasPermission,
} from "@waitron/identity";
import { manifestSets } from "@waitron/migrations";
import {
  modulesWithSets,
  orderedMigrationSets,
  personalDataParts,
  selectTimeRecordExport,
  validatePersonalDataParts,
} from "@waitron/module";
import { PAYMENTS_ALERTS, PAYMENTS_HANDOVER, PAYMENTS_MIGRATIONS } from "@waitron/payments";
import {
  STAFFING_CHANGE_SOURCES,
  STAFFING_CONFIGURATION_TRANSFER,
  STAFFING_PERMISSIONS,
  STAFFING_PERSONAL_DATA,
  STAFFING_ROUTES,
  describeShifts,
} from "@waitron/staffing";
import { WORKFORCE_MIGRATIONS, WORKFORCE_PERSONAL_DATA } from "@waitron/workforce";
import {
  WORKFORCE_ES_MIGRATIONS,
  WORKFORCE_ES_VOCABULARY,
  WORKFORCE_ES_CHANGE_SOURCES,
  WORKFORCE_ES_RECORD_EXPORT,
} from "@waitron/workforce-es";
import {
  VENUE_SERVICE,
  VENUE_SERVICE_ALERTS,
  VENUE_SERVICE_PERMISSIONS,
  VENUE_SERVICE_PROVISIONING,
  VENUE_SERVICE_ROUTES,
} from "@waitron/venue-service";
import { ALL_MODULES } from "./modules.js";
import { ADJUSTMENTS_TABLES } from "@waitron/adjustments";
import { CATALOGUE_TABLES } from "@waitron/catalogue";
import { CREDENTIALS_TABLES } from "@waitron/credentials";
import { HANDOVER_TABLES } from "@waitron/handover";
import { IDENTITY_TABLES } from "@waitron/identity";
import { MEDIA_TABLES } from "@waitron/media";
import { STAFFING_TABLES } from "@waitron/staffing";
import { VENUE_SERVICE_TABLES } from "@waitron/venue-service";

it("declares merged permissions once and retains their default holders", () => {
  const modulePermissions = ALL_MODULES.flatMap((module) => module.permissions ?? []);
  const declared = [...PERMISSIONS, ...modulePermissions.map((entry) => entry.permission)];
  expect(declared.length).toBe(new Set(declared).size);
  registerModulePermissions(modulePermissions);
  const roles = ["staff", "supervisor", "manager", "admin"] as const;
  for (const [permission, holders] of [
    ["payment.take", [true, true, true, true]],
    ["hardware.manage", [false, false, true, true]],
    ["venue.configure", [false, false, true, true]],
    ["schedule.manage", [false, false, true, true]],
    ["system.manage", [false, false, true, true]],
    ["catalogue.manage", [false, false, true, true]],
  ] as const) {
    expect(roles.map((role) => roleHasPermission(role, permission))).toEqual(holders);
  }
});

it("only workforce grants correction decisions to supervisors and higher", () => {
  const workforce = ALL_MODULES.find((m) => m.name === "workforce")!;
  expect(workforce.permissions).toEqual([
    { permission: "workforce.correct", defaultHolders: ["supervisor", "manager"] },
    { permission: "workforce.self_approve", defaultHolders: [] },
  ]);
  expect(
    ALL_MODULES.filter((m) => m.permissions?.some((p) => p.permission === "workforce.correct")),
  ).toEqual([workforce]);
  registerModulePermissions(workforce.permissions!);
  expect(
    ["staff", "supervisor", "manager", "admin"].map((role) =>
      roleHasPermission(role as "staff" | "supervisor" | "manager" | "admin", "workforce.correct"),
    ),
  ).toEqual([false, true, true, true]);
});

describe("ALL_MODULES is the migration source of truth", () => {
  it("derives exactly the manifest's sets, in order", () => {
    expect(orderedMigrationSets(ALL_MODULES)).toEqual(manifestSets());
  });
  it("lists the manifest's sets in the order of the modules that own them", () => {
    expect(modulesWithSets(ALL_MODULES).map((m) => m.name)).toEqual(
      manifestSets().map((s) => s.name),
    );
  });
});

describe("a module's tables live in exactly one set", () => {
  it("every module has exactly one of its own set and a tablesIn naming another's", () => {
    expect(
      ALL_MODULES.filter((m) => (m.migrations === undefined) === (m.tablesIn === undefined)).map(
        (m) => m.name,
      ),
    ).toEqual([]);
  });
  it("a tablesIn names a module that has a set of its own", () => {
    const withSets = new Set(modulesWithSets(ALL_MODULES).map((m) => m.name));
    expect(
      ALL_MODULES.filter((m) => m.tablesIn !== undefined && !withSets.has(m.tablesIn)).map(
        (m) => m.name,
      ),
    ).toEqual([]);
  });
  it("a module with no set of its own carries no classification", () => {
    expect(
      ALL_MODULES.filter((m) => m.migrations === undefined && m.classification !== undefined).map(
        (m) => m.name,
      ),
    ).toEqual([]);
  });
});

describe("the eight sets", () => {
  it("are exactly core, node, workforce, workforce-es, payments, bookings and the two fiscal sets", () => {
    expect(
      orderedMigrationSets(ALL_MODULES)
        .map((set) => set.name)
        .sort(),
    ).toEqual(
      [
        "core",
        "node",
        "workforce",
        "workforce-es",
        "payments",
        "bookings",
        "fiscal-verifactu",
        "fiscal-none",
      ].sort(),
    );
  });

  it("each set's manifest entry is what the descriptors produce", () => {
    const descriptors = new Map(orderedMigrationSets(ALL_MODULES).map((set) => [set.name, set]));
    for (const entry of manifestSets()) expect(descriptors.get(entry.name)).toEqual(entry);
    expect(manifestSets()).toHaveLength(descriptors.size);
  });

  it("each set classifies exactly its own module's tables and those of every module hosted in it", () => {
    // A hosted module names its tables in a plain list; the host's own share is what its own backup
    // check covers, which the verifier requires to match the set's classification once combined.
    const hostedTables: Record<string, readonly string[]> = {
      catalogue: CATALOGUE_TABLES,
      "venue-service": VENUE_SERVICE_TABLES,
      media: MEDIA_TABLES,
      adjustments: ADJUSTMENTS_TABLES,
      credentials: CREDENTIALS_TABLES,
      identity: IDENTITY_TABLES,
      handover: HANDOVER_TABLES,
      staffing: STAFFING_TABLES,
    };
    expect(
      ALL_MODULES.filter((m) => m.tablesIn !== undefined)
        .map((m) => m.name)
        .sort(),
    ).toEqual(Object.keys(hostedTables).sort());
    for (const host of modulesWithSets(ALL_MODULES)) {
      const members = ALL_MODULES.filter((m) => m.tablesIn === host.name);
      const expected = [
        ...(host.backup?.verification?.data.tables ?? []),
        ...members.flatMap((m) => hostedTables[m.name]!),
      ].sort();
      expect({
        set: host.name,
        tables: (host.classification ?? []).map((c) => c.table).sort(),
      }).toEqual({ set: host.name, tables: expected });
    }
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
      node: NODE_MIGRATIONS.migrationsTable,
      workforce: WORKFORCE_MIGRATIONS.migrationsTable,
      "workforce-es": WORKFORCE_ES_MIGRATIONS.migrationsTable,
      "fiscal-verifactu": FISCAL_MIGRATIONS.migrationsTable,
      "fiscal-none": FISCAL_NONE_MIGRATIONS.migrationsTable,
      payments: PAYMENTS_MIGRATIONS.migrationsTable,
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
    expect(ALL_MODULES.find((module) => module.name === "media")?.tablesIn).toBe("core");
    expect(
      core?.classification
        ?.map((table) => table.table)
        .filter((table) => (MEDIA_TABLES as readonly string[]).includes(table)),
    ).toEqual(["media_images", "media_image_data", "media_image_blobs", "media_image_edits"]);
  });
  it("identity declares its offline verification owner", () => {
    const identity = ALL_MODULES.find((m) => m.name === "identity");
    expect(identity?.backup?.verification).toBe(IDENTITY_BACKUP_VERIFICATION);
  });
  it("migration composition still accepts a module without a backup contribution", () => {
    const modules = ALL_MODULES.map((module) =>
      module.name === "identity" ? { ...module, backup: undefined } : module,
    );
    expect(modules.find((module) => module.name === "identity")?.backup).toBeUndefined();
    expect(orderedMigrationSets(modules)).toEqual(manifestSets());
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
      "outgoing_mail",
      "management_account_actions",
      "management_sessions",
      "sessions",
      "bookings",
      "time_entries",
      // A published version's document holds ids an import does not remap.
      "menu_versions",
      "menu_publications",
      "menu_version_images",
      "menu_scheduled_publications",
    ]) {
      expect(names).not.toContain(forbidden);
    }
    expect(
      ALL_MODULES.find((module) => module.name === "fiscal-verifactu")?.configurationTransfer,
    ).toEqual({ kind: "none" });
  });

  it("never copies a table's short-name key, which the import derives", () => {
    const tables = ALL_MODULES.flatMap((module) =>
      module.configurationTransfer?.kind === "tables" ? module.configurationTransfer.tables : [],
    );
    expect(tables.find((table) => table.name === "dining_tables")?.omit).toContain(
      "short_name_key",
    );
  });

  it("removes clearing marks, hardware authenticators, and the exporting machine's node, addresses and last-seen time from copied configuration", () => {
    const tables = ALL_MODULES.flatMap((module) =>
      module.configurationTransfer?.kind === "tables" ? module.configurationTransfer.tables : [],
    );
    expect(tables.find((table) => table.name === "dining_tables")?.omit).toContain(
      "needs_clearing_since",
    );
    expect(tables.find((table) => table.name === "print_agents")?.omit).toEqual(
      expect.arrayContaining([
        "token_hash",
        "last_seen_at",
        "host",
        "node_id",
        "setup_url",
        "setup_port",
      ]),
    );
    expect(tables.find((table) => table.name === "printers")?.omit).toContain("poll_token_hash");
  });

  it("the core module refuses an invalid theme row and still runs its own checks", () => {
    const core = ALL_MODULES.find((module) => module.name === "core")?.configurationTransfer;
    if (core?.kind !== "tables" || !core.validate) throw new Error("core transfers no tables");
    const validate = core.validate;
    const theme = {
      id: "theme-1",
      name: "Lemon",
      name_key: "lemon",
      in_use: 1,
      theme: '{"tokens":{}}',
      updated_at: "2026-10-21T10:00:00.000Z",
    };
    expect(() => validate({ custom_themes: [theme] })).toThrow(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "custom_themes.theme" },
      }),
    );
    expect(() => validate({ kitchen_stations: [{ colour: "invalid-colour" }] })).toThrow(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "kitchen_stations.colour" },
      }),
    );
  });
});

describe("ALL_MODULES handover seat", () => {
  it("fiscal-verifactu and payments declare their handover contributions, by reference, and no other module does", () => {
    const declared = ALL_MODULES.filter((m) => m.handover !== undefined).map((m) => [
      m.name,
      m.handover,
    ]);
    expect(declared).toEqual([
      ["payments", PAYMENTS_HANDOVER],
      ["fiscal-verifactu", VERIFACTU_HANDOVER],
    ]);
    expect(ALL_MODULES.find((m) => m.name === "payments")?.handover).toBe(PAYMENTS_HANDOVER);
    expect(ALL_MODULES.find((m) => m.name === "fiscal-verifactu")?.handover).toBe(
      VERIFACTU_HANDOVER,
    );
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
    expect(wfes?.changes).toBe(WORKFORCE_ES_CHANGE_SOURCES);
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

  it("no two modules declare the same settings document key", () => {
    const keys = ALL_MODULES.flatMap((module) => module.settings ?? []).map(
      (definition) => definition.module,
    );
    expect(keys).toHaveLength(new Set(keys).size);
  });

  it("adjustments is mandatory and declares its tables, route, permission and transfer seats", () => {
    const adjustments = ALL_MODULES.find((module) => module.name === "adjustments");
    expect(adjustments?.tier).toBe("mandatory");
    expect(adjustments?.tablesIn).toBe("core");
    const adjustmentTables = [
      "adjustment_reasons",
      "adjustments",
      "adjustment_refunds",
      "adjustment_lines",
    ];
    expect([...ADJUSTMENTS_TABLES]).toEqual(adjustmentTables);
    expect(
      ALL_MODULES.find((module) => module.name === "core")
        ?.classification?.map((c) => c.table)
        .filter((table) => adjustmentTables.includes(table)),
    ).toEqual(adjustmentTables);
    expect(adjustments?.settings).toEqual([ADJUSTMENTS_SETTINGS]);
    expect(adjustments?.changes).toBe(ADJUSTMENTS_CHANGE_SOURCES);
    expect(adjustments?.routes).toBe(ADJUSTMENTS_ROUTES);
    expect(adjustments?.permissions).toBe(ADJUSTMENTS_PERMISSIONS);
    expect(adjustments?.configurationTransfer).toBe(ADJUSTMENTS_CONFIGURATION_TRANSFER);
  });

  it("adjustments declares its provisioning seat, by reference", () => {
    const adjustments = ALL_MODULES.find((module) => module.name === "adjustments");
    expect(adjustments?.provisioning).toBe(ADJUSTMENTS_PROVISIONING);
  });

  it("staffing is toggleable, needs identity, venue-service and workforce, and declares its seats", () => {
    const staffing = ALL_MODULES.find((module) => module.name === "staffing");
    expect(staffing?.tier).toBe("toggleable");
    expect(staffing?.requires).toEqual({
      core: "*",
      modules: { identity: "*", "venue-service": "*", workforce: "*" },
    });
    expect(staffing?.migrations).toBeUndefined();
    expect(staffing?.tablesIn).toBe("workforce");
    expect(
      ALL_MODULES.find((module) => module.name === "workforce")
        ?.classification?.map((c) => c.table)
        .filter((table) => (STAFFING_TABLES as readonly string[]).includes(table)),
    ).toEqual([...STAFFING_TABLES]);
    expect(staffing?.changes).toBe(STAFFING_CHANGE_SOURCES);
    expect(staffing?.routes).toBe(STAFFING_ROUTES);
    expect(staffing?.describeShifts).toBe(describeShifts);
    expect(staffing?.permissions).toBe(STAFFING_PERMISSIONS);
    expect(staffing?.configurationTransfer).toBe(STAFFING_CONFIGURATION_TRANSFER);
  });

  it("fiscal declares its provisioning contribution and fills the fiscal slot, by reference", () => {
    const fiscal = ALL_MODULES.find((m) => m.name === "fiscal-verifactu");
    expect(fiscal?.provisioning).toBe(FISCAL_PROVISIONING);
    expect(fiscal?.fiscal).toBe(FISCAL_SLOT);
    expect(fiscal?.routes).toBe(FISCAL_ROUTES);
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
  it("declares no provisioning or vocabulary and explicitly verifies its empty backup obligations", () => {
    const none = ALL_MODULES.find((m) => m.name === "fiscal-none");
    expect(none?.provisioning).toBeUndefined();
    expect(none?.vocabulary).toBeUndefined();
    expect(none?.backup).toEqual({ verification: FISCAL_NONE_BACKUP_VERIFICATION });
  });
});

describe("ALL_MODULES alerts seat", () => {
  it("core, payments and fiscal-verifactu carry their event-code claims, by reference", () => {
    expect(ALL_MODULES.find((m) => m.name === "core")?.alerts).toBe(CORE_ALERTS);
    expect(ALL_MODULES.find((m) => m.name === "payments")?.alerts).toBe(PAYMENTS_ALERTS);
    expect(ALL_MODULES.find((m) => m.name === "fiscal-verifactu")?.alerts).toBe(FISCAL_ALERTS);
  });

  it("venue-service carries its route. claim, by reference", () => {
    expect(ALL_MODULES.find((m) => m.name === "venue-service")?.alerts).toBe(VENUE_SERVICE_ALERTS);
  });
});

describe("ALL_MODULES staff-notices seat", () => {
  it("fiscal-verifactu carries its notices, by reference", () => {
    expect(ALL_MODULES.find((m) => m.name === "fiscal-verifactu")?.staffNotices).toBe(
      FISCAL_STAFF_NOTICES,
    );
  });

  it("no other module carries the seat", () => {
    expect(ALL_MODULES.filter((m) => m.staffNotices !== undefined).map((m) => m.name)).toEqual([
      "fiscal-verifactu",
    ]);
  });
});

describe("ALL_MODULES personal-data seat", () => {
  it("identity carries its part, by reference", () => {
    expect(ALL_MODULES.find((m) => m.name === "identity")?.personalData).toBe(
      IDENTITY_PERSONAL_DATA,
    );
  });

  it("workforce and staffing carry their parts, by reference", () => {
    expect(ALL_MODULES.find((m) => m.name === "workforce")?.personalData).toBe(
      WORKFORCE_PERSONAL_DATA,
    );
    expect(ALL_MODULES.find((m) => m.name === "staffing")?.personalData).toBe(
      STAFFING_PERSONAL_DATA,
    );
  });

  it("adjustments carries its part, by reference", () => {
    expect(ALL_MODULES.find((m) => m.name === "adjustments")?.personalData).toBe(
      ADJUSTMENTS_PERSONAL_DATA,
    );
  });

  it("no other module carries the seat", () => {
    expect(ALL_MODULES.filter((m) => m.personalData !== undefined).map((m) => m.name)).toEqual([
      "identity",
      "workforce",
      "adjustments",
      "staffing",
    ]);
  });

  it("every module's file names are valid and unique", () => {
    expect(() => validatePersonalDataParts(personalDataParts(ALL_MODULES))).not.toThrow();
  });
});

it("selects the Spain time-record exporter only from enabled contributions", () => {
  expect(selectTimeRecordExport(ALL_MODULES)).toBe(WORKFORCE_ES_RECORD_EXPORT);
  expect(
    selectTimeRecordExport(ALL_MODULES.filter((m) => m.name !== "workforce-es")),
  ).toBeUndefined();
  expect(ALL_MODULES.filter((m) => m.timeRecordExport !== undefined).map((m) => m.name)).toEqual([
    "workforce-es",
  ]);
});

it("Start again may discard only activity history and the fiscal activation", () => {
  expect(
    ALL_MODULES.filter((m) => m.startAgainDeletable !== undefined).map((m) => [
      m.name,
      m.startAgainDeletable,
    ]),
  ).toEqual([
    ["core", ["activity_log"]],
    ["fiscal-verifactu", ["fiscal_allocations", "fiscal_certificate_installs"]],
  ]);
  expect(() => orderedMigrationSets(ALL_MODULES)).not.toThrow();
});
