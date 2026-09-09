import { describe, expect, it, vi } from "vitest";
import { fiscalDrainEnabled, runFiscalDrain } from "./onboarding-policy.js";

describe("fiscalDrainEnabled", () => {
  it.each(["demo", "prepare"] as const)(
    "never drains %s records, even when the integration-test switch is enabled",
    (onboardingIntent) => {
      expect(
        fiscalDrainEnabled({
          environment: "preproduction",
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
