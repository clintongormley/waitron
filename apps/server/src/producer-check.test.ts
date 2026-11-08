import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import type { FiscalContribution } from "@waitron/fiscal";
import type { WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { checkFiscalSettings } from "./producer-check.js";
import { TEST_PRODUCER } from "./testing/test-producer.js";

function output() {
  const log: string[] = [];
  const error: string[] = [];
  return {
    log,
    error,
    out: { log: (line: string) => log.push(line), error: (line: string) => error.push(line) },
  };
}

function withFiscal(id: string, refuseSettings?: FiscalContribution["refuseSettings"]) {
  return { fiscal: { id, ...(refuseSettings ? { refuseSettings } : {}) } } as WaitronModule;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkFiscalSettings, with the real modules", () => {
  function stubProducer(values: Partial<Record<keyof typeof TEST_PRODUCER, string>>) {
    for (const name of Object.keys(TEST_PRODUCER) as (keyof typeof TEST_PRODUCER)[])
      vi.stubEnv(name, values[name] ?? "");
  }

  it("passes the made-up producer, printing no value", () => {
    stubProducer(TEST_PRODUCER);
    const { out, log, error } = output();
    expect(checkFiscalSettings(ALL_MODULES, out)).toBe(0);
    expect(log).toEqual(["verifactu: the settings pass"]);
    expect(error).toEqual([]);
  });

  it("refuses an address of spaces alone with the shared check's code", () => {
    stubProducer({ ...TEST_PRODUCER, WAITRON_PRODUCER_ADDRESS: "   " });
    const { out, log, error } = output();
    expect(checkFiscalSettings(ALL_MODULES, out)).toBe(1);
    expect(log).toEqual([]);
    expect(error).toEqual([
      "verifactu: software_producer.invalid (setting WAITRON_PRODUCER_ADDRESS, reason missing)",
    ]);
  });

  it("refuses a wrong check letter with Veri*Factu's code, printing no value", () => {
    stubProducer({ ...TEST_PRODUCER, WAITRON_PRODUCER_TAX_ID: "00000000A" });
    const { out, error } = output();
    expect(checkFiscalSettings(ALL_MODULES, out)).toBe(1);
    expect(error).toEqual([
      "verifactu: sif.producer_invalid (setting WAITRON_PRODUCER_TAX_ID, reason check_failed)",
    ]);
  });

  it("refuses an image with no producer as a production start does", () => {
    stubProducer({});
    const { out, error } = output();
    expect(checkFiscalSettings(ALL_MODULES, out)).toBe(1);
    expect(error).toEqual(["verifactu: sif.producer_unset"]);
  });
});

describe("checkFiscalSettings, with stand-in modules", () => {
  it("asks each fiscal module that checks its settings, for production", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { out, log } = output();
    const modules = [withFiscal("one", first), {} as WaitronModule, withFiscal("two", second)];
    expect(checkFiscalSettings(modules, out)).toBe(0);
    expect(first).toHaveBeenCalledExactlyOnceWith("production");
    expect(second).toHaveBeenCalledExactlyOnceWith("production");
    expect(log).toEqual(["one: the settings pass", "two: the settings pass"]);
  });

  it("fails when one of several refuses, reporting each", () => {
    const refused = () => {
      throw new AppError("sif.producer_unset", { environment: "production" });
    };
    const { out, log, error } = output();
    expect(checkFiscalSettings([withFiscal("one", refused), withFiscal("two", vi.fn())], out)).toBe(
      1,
    );
    expect(error).toEqual(["one: sif.producer_unset"]);
    expect(log).toEqual(["two: the settings pass"]);
  });

  it("prints a refusal's setting and reason, and none of its other parameters", () => {
    const refused = () => {
      throw new AppError("software_producer.invalid", {
        setting: "WAITRON_PRODUCER_NAME",
        reason: "too_long",
        value: "SECRET VALUE",
      } as never);
    };
    const { out, error } = output();
    expect(checkFiscalSettings([withFiscal("one", refused)], out)).toBe(1);
    expect(error).toEqual([
      "one: software_producer.invalid (setting WAITRON_PRODUCER_NAME, reason too_long)",
    ]);
  });

  it("names only an unexpected failure's kind, never its message", () => {
    const failed = () => {
      throw new RangeError("SECRET VALUE");
    };
    const { out, error } = output();
    expect(checkFiscalSettings([withFiscal("one", failed)], out)).toBe(1);
    expect(error).toEqual(["one: an unexpected RangeError"]);
  });

  it("names a thrown non-error as unexpected too", () => {
    const failed = () => {
      throw "SECRET VALUE";
    };
    const { out, error } = output();
    expect(checkFiscalSettings([withFiscal("one", failed)], out)).toBe(1);
    expect(error).toEqual(["one: an unexpected failure"]);
  });

  it("fails when no fiscal module checks its settings", () => {
    const { out, error } = output();
    expect(checkFiscalSettings([withFiscal("one"), {} as WaitronModule], out)).toBe(1);
    expect(error).toEqual(["no fiscal module checks its settings"]);
  });
});
