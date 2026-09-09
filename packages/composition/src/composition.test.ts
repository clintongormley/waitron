import { describe, expect, it } from "vitest";
import {
  FISCAL_PROVISIONING,
  FISCAL_RESTORE,
  FISCAL_SLOT,
  FISCAL_VOCABULARY,
} from "@waitron/fiscal-verifactu";
import { manifestSets } from "@waitron/migrations";
import { orderedMigrationSets } from "@waitron/module";
import { WORKFORCE_ES_VOCABULARY } from "@waitron/workforce-es";
import { ALL_MODULES } from "./modules.js";

describe("ALL_MODULES is the migration source of truth", () => {
  it("derives exactly the manifest's sets, in order", () => {
    expect(orderedMigrationSets(ALL_MODULES)).toEqual(manifestSets());
  });
  it("lists the manifest's module names in order", () => {
    expect(ALL_MODULES.map((m) => m.name)).toEqual(manifestSets().map((s) => s.name));
  });
});

describe("ALL_MODULES backup contribution", () => {
  it("fiscal declares its restore hook, by reference", () => {
    const fiscal = ALL_MODULES.find((m) => m.name === "fiscal-verifactu")!;
    expect(FISCAL_RESTORE).toBeTypeOf("function");
    expect(fiscal.backup?.restore).toBe(FISCAL_RESTORE);
  });

  it("core declares the media store as non-DB backup state", () => {
    const core = ALL_MODULES.find((m) => m.name === "core");
    expect(core?.backup?.nonDbState).toEqual([{ kind: "content-addressed-dir", source: "media" }]);
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
    expect(names).not.toEqual(
      expect.arrayContaining([
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
      ]),
    );
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
