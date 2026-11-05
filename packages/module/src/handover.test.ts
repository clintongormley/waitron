import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import type { BackupQuery } from "@waitron/store";
import { checkHandoverCopy, collectHandoverSummaries } from "./handover.js";
import type { ModuleHandoverContribution } from "./handover.js";
import type { WaitronModule } from "./module.js";
import { fakeModule } from "./testing/fake-module.js";

const query: BackupQuery = {
  async *rows() {
    // Nothing to read: the seats under test answer without querying.
  },
};

function withHandover(name: string, handover?: ModuleHandoverContribution): WaitronModule {
  return { ...fakeModule(name), ...(handover === undefined ? {} : { handover }) };
}

describe("collectHandoverSummaries", () => {
  it("collects each given module's summary under its name, in name order", async () => {
    const seen: BackupQuery[] = [];
    const modules = [
      withHandover("payments", {
        summarise: async (q) => {
          seen.push(q);
          return { open: 2 };
        },
      }),
      withHandover("fiscal-verifactu", {
        summarise: async (q) => {
          seen.push(q);
          return ["chain", 7];
        },
      }),
    ];
    const summaries = await collectHandoverSummaries(modules, query);
    expect(summaries).toEqual({ "fiscal-verifactu": ["chain", 7], payments: { open: 2 } });
    expect(Object.keys(summaries)).toEqual(["fiscal-verifactu", "payments"]);
    expect(seen).toHaveLength(2);
    expect(seen.every((q) => q === query)).toBe(true);
  });

  it("skips a module without the seat", async () => {
    const modules = [
      withHandover("catalogue"),
      withHandover("payments", { summarise: async () => null }),
    ];
    expect(await collectHandoverSummaries(modules, query)).toEqual({ payments: null });
  });

  it("a module that throws fails the whole collection with handover.summary_failed naming it", async () => {
    const modules = [
      withHandover("fiscal-verifactu", { summarise: async () => 1 }),
      withHandover("payments", {
        summarise: async () => {
          throw new Error("table missing");
        },
      }),
    ];
    const error = await collectHandoverSummaries(modules, query).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAppError(error) && error.code).toBe("handover.summary_failed");
    expect(isAppError(error) && error.params).toEqual({ module: "payments" });
    expect(isAppError(error) && error.reason).toBe("table missing");
  });

  it("keeps a thrown non-Error value as the log-only reason", async () => {
    const modules = [
      withHandover("payments", {
        summarise: () => Promise.reject("no copy"),
      }),
    ];
    const error = await collectHandoverSummaries(modules, query).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAppError(error) && error.reason).toBe("no copy");
  });
});

describe("checkHandoverCopy", () => {
  it("a copy check that answers broken names its module", async () => {
    const modules = [
      withHandover("fiscal-verifactu", { summarise: async () => 1, checkCopy: async () => "ok" }),
      withHandover("payments", { summarise: async () => 1, checkCopy: async () => "broken" }),
    ];
    expect(await checkHandoverCopy(modules, query)).toEqual({ ok: false, module: "payments" });
  });

  it("answers ok when every given check answers ok, skipping modules without one", async () => {
    const asked: string[] = [];
    const modules = [
      withHandover("catalogue"),
      withHandover("payments", { summarise: async () => 1 }),
      withHandover("fiscal-verifactu", {
        summarise: async () => 1,
        checkCopy: async (q) => {
          asked.push(q === query ? "same query" : "other query");
          return "ok";
        },
      }),
    ];
    expect(await checkHandoverCopy(modules, query)).toEqual({ ok: true });
    expect(asked).toEqual(["same query"]);
  });

  it("names the first broken module in name order", async () => {
    const modules = [
      withHandover("payments", { summarise: async () => 1, checkCopy: async () => "broken" }),
      withHandover("fiscal-verifactu", {
        summarise: async () => 1,
        checkCopy: async () => "broken",
      }),
    ];
    expect(await checkHandoverCopy(modules, query)).toEqual({
      ok: false,
      module: "fiscal-verifactu",
    });
  });

  it("a copy check that throws fails with handover.copy_check_failed naming its module", async () => {
    const modules = [
      withHandover("fiscal-verifactu", { summarise: async () => 1, checkCopy: async () => "ok" }),
      withHandover("payments", {
        summarise: async () => 1,
        checkCopy: async () => {
          throw new Error("no such table");
        },
      }),
    ];
    const error = await checkHandoverCopy(modules, query).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAppError(error) && error.code).toBe("handover.copy_check_failed");
    expect(isAppError(error) && error.params).toEqual({ module: "payments" });
    expect(isAppError(error) && error.reason).toBe("no such table");
  });

  it("keeps a thrown non-Error value as the log-only reason of a copy check", async () => {
    const modules = [
      withHandover("payments", {
        summarise: async () => 1,
        checkCopy: () => Promise.reject("no copy"),
      }),
    ];
    const error = await checkHandoverCopy(modules, query).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAppError(error) && error.reason).toBe("no copy");
  });

  it("asks one module at a time, and none after the first broken one", async () => {
    const events: string[] = [];
    const check = (name: string, answer: "ok" | "broken") => async () => {
      events.push(`${name} start`);
      await new Promise((resolve) => setImmediate(resolve));
      events.push(`${name} end`);
      return answer;
    };
    const modules = [
      withHandover("c", { summarise: async () => 1, checkCopy: check("c", "ok") }),
      withHandover("b", { summarise: async () => 1, checkCopy: check("b", "broken") }),
      withHandover("a", { summarise: async () => 1, checkCopy: check("a", "ok") }),
    ];
    expect(await checkHandoverCopy(modules, query)).toEqual({ ok: false, module: "b" });
    expect(events).toEqual(["a start", "a end", "b start", "b end"]);
  });
});
