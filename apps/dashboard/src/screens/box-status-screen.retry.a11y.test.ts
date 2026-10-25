import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./box-status-screen.js";
import type { BoxStatusScreen } from "./box-status-screen.js";
import type { BoxHealth, DashboardApi } from "../api/client.js";

const UNSENT = {
  key: "fiscal.records_unsent",
  code: "fiscal.records_unsent",
  severity: "warning" as const,
  params: { count: 12 },
  owner: "box",
};

function health(outbox: NonNullable<BoxHealth["outbox"]>): BoxHealth {
  return {
    at: "2026-10-22T19:45:00.000Z",
    sales: { lastAt: "2026-10-22T19:43:00.000Z" },
    notices: [UNSENT],
    noticesUnavailable: [],
    filing: true,
    clockStop: null,
    clockCheckWaiting: null,
    misdatedOpen: [],
    misdatedHandledCount: 0,
    outbox,
    stream: { state: "off" },
    clock: {
      authority: { state: "ok", driftSeconds: 1, measuredAt: "2026-10-22T12:03:00.000Z" },
      sync: { synced: true, source: "timedatectl", warn: false },
    },
    printers: [{ id: "p1", name: "Bar" }],
    readers: [],
    canFree: true,
    disk: {
      freeBytes: 1_800_000_000,
      totalBytes: 32_000_000_000,
      databaseBytes: 120_000_000,
      backupsBytes: 300_000_000,
      logBytes: 40_000_000,
      otherBytes: 29_740_000_000,
      stoppedSince: null,
      lowSince: null,
      reclaimable: { bytes: 45_000_000, backupRunning: false },
    },
  };
}

const LAST = "2026-10-22T18:00:00.000Z";

function stubApi(answer: BoxHealth): DashboardApi {
  return {
    getBoxHealth: vi.fn().mockResolvedValue(answer),
    listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [] }),
    freeBoxSpace: vi.fn(),
    retryFiscalSubmissions: vi.fn().mockResolvedValue({ waiting: 12 }),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
}

async function flush(el: BoxStatusScreen): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)(
  "box-status-screen Retry now a11y (%s theme)",
  (theme) => {
    // The last entry presses Retry now before axe runs.
    const cases: [string, BoxHealth, string, boolean][] = [
      [
        "Retry now enabled",
        health({ lastAcceptedAt: LAST, waiting: 12, awaitingCertificate: false }),
        "[data-test=row-tax] [data-test=retry]:not([disabled])",
        false,
      ],
      [
        "Retry now disabled",
        health({ lastAcceptedAt: LAST, waiting: 0, awaitingCertificate: false }),
        "[data-test=row-tax] [data-test=retry][disabled]",
        false,
      ],
      [
        "the certificate aside",
        health({ lastAcceptedAt: null, waiting: 12, awaitingCertificate: true }),
        "[data-test=row-tax] [data-test=awaiting-certificate]",
        false,
      ],
      [
        "the answer shown",
        health({ lastAcceptedAt: LAST, waiting: 12, awaitingCertificate: false }),
        "[data-test=row-tax] [role=status]",
        true,
      ],
    ];
    it.each(cases)(
      "renders the Tax agency row accessibly with %s",
      async (_name, answer, drawn, press) => {
        const { el, host } = await mountWidget<BoxStatusScreen>(
          "dashboard-box-status-screen",
          { api: stubApi(answer), canOpen: () => true },
          theme,
        );
        await flush(el);
        if (press) {
          await userEvent.click(
            el.shadowRoot!.querySelector("[data-test=row-tax] [data-test=retry]") as HTMLElement,
          );
          await flush(el);
        }
        expect(el.shadowRoot!.querySelector(drawn)).not.toBeNull();
        await expectNoA11yViolations(host);
      },
    );
  },
);
