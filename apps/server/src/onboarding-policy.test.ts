import { describe, expect, it, vi } from "vitest";
import type { FiscalCertificateSeat } from "@waitron/fiscal";
import type { AlertSource } from "@waitron/module";
import {
  alertSourcesFor,
  certificateDutiesEnabled,
  fiscalDrainEnabled,
  runFiscalDrain,
} from "./onboarding-policy.js";

describe("fiscalDrainEnabled", () => {
  it.each(["demo", "prepare"] as const)(
    "never drains %s records, regardless of environment or integration-test switch",
    (onboardingIntent) => {
      expect(
        fiscalDrainEnabled({
          environment: "production",
          onboardingIntent,
          fiscalTestSubmissions: true,
        }),
      ).toBe(false);
    },
  );

  it("does not drain preproduction by default", () => {
    expect(
      fiscalDrainEnabled({
        environment: "preproduction",
        onboardingIntent: undefined,
        fiscalTestSubmissions: false,
      }),
    ).toBe(false);
  });

  it("allows an explicit, non-onboarding preproduction integration target", () => {
    expect(
      fiscalDrainEnabled({
        environment: "preproduction",
        onboardingIntent: undefined,
        fiscalTestSubmissions: true,
      }),
    ).toBe(true);
  });

  it("always drains production", () => {
    expect(
      fiscalDrainEnabled({
        environment: "production",
        onboardingIntent: "live",
        fiscalTestSubmissions: false,
      }),
    ).toBe(true);
  });

  it("returns an empty pass without invoking the fiscal regime when disabled", async () => {
    const drain = vi.fn();
    const result = await runFiscalDrain(
      {
        environment: "preproduction",
        onboardingIntent: "prepare",
        fiscalTestSubmissions: true,
      },
      drain,
      new Date("2026-09-09T10:00:00Z"),
    );
    expect(drain).not.toHaveBeenCalled();
    expect(result).toMatchObject({ tenantsWithWork: 0, recordsSubmitted: 0, nextDueAt: null });
  });

  it("invokes the supplied regime drain when enabled", async () => {
    const expected = {
      tenantsWithWork: 0,
      batchesSent: 0,
      recordsSubmitted: 0,
      recordsAccepted: 0,
      recordsHalted: 0,
      incidentsRaised: 0,
      skipped: [],
      nextDueAt: null,
    };
    const drain = vi.fn(async () => expected);
    const now = new Date("2026-09-09T10:00:00Z");
    await expect(
      runFiscalDrain(
        {
          environment: "production",
          onboardingIntent: "live",
          fiscalTestSubmissions: false,
        },
        drain,
        now,
      ),
    ).resolves.toBe(expected);
    expect(drain).toHaveBeenCalledWith(now);
  });
});

describe("certificateDutiesEnabled", () => {
  const seat = {} as FiscalCertificateSeat;
  const filing = {
    environment: "preproduction" as const,
    onboardingIntent: undefined,
    fiscalTestSubmissions: true,
  };

  it("is off when the fiscal module has no certificate seat, even where records are filed", () => {
    expect(certificateDutiesEnabled({}, filing)).toBe(false);
  });

  it("is off when the seat exists but records are not filed", () => {
    expect(
      certificateDutiesEnabled({ certificate: seat }, { ...filing, fiscalTestSubmissions: false }),
    ).toBe(false);
    expect(
      certificateDutiesEnabled({ certificate: seat }, { ...filing, onboardingIntent: "demo" }),
    ).toBe(false);
  });

  it("is on when the seat exists and records are filed", () => {
    expect(certificateDutiesEnabled({ certificate: seat }, filing)).toBe(true);
  });
});

describe("alertSourcesFor", () => {
  const filingOnlyRead = vi.fn(async () => []);
  const filingOnlySource: AlertSource = {
    area: "fiscal",
    permission: "fiscal.view",
    filingOnly: true,
    read: filingOnlyRead,
  };
  const fiscalSource: AlertSource = {
    area: "fiscal",
    permission: "fiscal.view",
    read: async () => [],
  };
  const otherSource: AlertSource = {
    area: "kitchen",
    permission: "kitchen.view",
    read: async () => [],
  };
  const ctx = { tx: {} as never, now: new Date("2026-09-09T10:00:00Z") };

  it.each([
    ["demo", { environment: "production", onboardingIntent: "demo", fiscalTestSubmissions: true }],
    [
      "prepare",
      { environment: "production", onboardingIntent: "prepare", fiscalTestSubmissions: true },
    ],
    [
      "preproduction without test submissions",
      { environment: "preproduction", onboardingIntent: undefined, fiscalTestSubmissions: false },
    ],
  ] as const)(
    "leaves out a filing-only source, never reading it, and keeps the others on a %s box",
    async (_, policy) => {
      filingOnlyRead.mockClear();
      const kept = alertSourcesFor([filingOnlySource, fiscalSource, otherSource], policy);
      for (const source of kept) await source.read(ctx);
      expect(filingOnlyRead).not.toHaveBeenCalled();
      expect(kept).toHaveLength(2);
      expect(kept[0]).toBe(fiscalSource);
      expect(kept[1]).toBe(otherSource);
    },
  );

  it.each([
    [
      "production",
      { environment: "production", onboardingIntent: "live", fiscalTestSubmissions: false },
    ],
    [
      "preproduction with test submissions",
      { environment: "preproduction", onboardingIntent: undefined, fiscalTestSubmissions: true },
    ],
  ] as const)("keeps every source on a %s box", (_, policy) => {
    const sources = [filingOnlySource, fiscalSource, otherSource];
    expect(alertSourcesFor(sources, policy)).toBe(sources);
  });
});
