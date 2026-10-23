import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./box-status-screen.js";
import type { BoxStatusScreen } from "./box-status-screen.js";
import type { AlertView, BoxHealth, DashboardApi } from "../api/client.js";

function health(overrides: Partial<BoxHealth> = {}): BoxHealth {
  return {
    at: "2026-10-22T19:45:00.000Z",
    sales: { lastAt: "2026-10-22T19:43:00.000Z" },
    notices: [],
    noticesUnavailable: [],
    filing: true,
    stream: { state: "off" },
    clock: {
      authority: { state: "ok", driftSeconds: 1, measuredAt: "2026-10-22T12:03:00.000Z" },
      sync: { synced: true, source: "timedatectl", warn: false },
    },
    printers: [
      { id: "p1", name: "Bar" },
      { id: "p2", name: "Kitchen" },
    ],
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
    clockStop: null,
    ...overrides,
  };
}

function notice(code: string, severity: "error" | "warning", params = {}) {
  return { key: code, code, severity, params, owner: "box" };
}

const PRINTER_ALERTS: AlertView[] = [
  {
    key: "printer.jobs_waiting:p2",
    kind: "ongoing",
    code: "printer.jobs_waiting",
    params: { count: 2, printer: "Kitchen" },
    severity: "error",
    since: "2026-10-22T19:00:00.000Z",
    area: "printing",
    screen: "printers",
  },
  {
    key: "agent.silent:a1",
    kind: "ongoing",
    code: "agent.silent",
    params: { agent: "Back office" },
    severity: "warning",
    since: "2026-10-22T19:00:00.000Z",
    area: "printing",
    screen: "printers",
  },
];

const TROUBLED = health({
  notices: [
    notice("storage.disk_full", "error"),
    notice("clock.unusable", "error"),
    notice("fiscal.records_unsent", "warning", { count: 12 }),
  ],
  noticesUnavailable: ["fiscal"],
  canFree: false,
});

const OFFERED = health({
  notices: [notice("clock.behind_chain", "error")],
  clockStop: {
    clockAt: "2026-10-22T18:10:00.000Z",
    offsetMinutes: 120,
    lastRecordAt: "2026-10-22T19:30:00.000Z",
    lastRecordOffsetMinutes: 120,
    recordId: "rec-42",
    gapMs: 4_800_000,
    restart: null,
    offer: "offered",
    proof: {
      authority: {
        kind: "authority",
        id: "aeat",
        boxAt: "2026-10-22T18:05:00.000Z",
        witnessAt: "2026-10-22T18:05:01.000Z",
        uncertaintyMs: 500,
      },
      devices: [
        {
          kind: "device",
          id: "d1",
          label: "Bar till",
          boxAt: "2026-10-22T18:08:00.000Z",
          witnessAt: "2026-10-22T18:08:00.000Z",
          uncertaintyMs: 200,
        },
      ],
    },
    contrary: { authority: null, devices: [] },
  },
});

function stubApi(answer: BoxHealth | Error, alerts: AlertView[] | Error = []): DashboardApi {
  return {
    getBoxHealth:
      answer instanceof Error
        ? vi.fn().mockRejectedValue({ code: "server.internal" })
        : vi.fn().mockResolvedValue(answer),
    listAlerts:
      alerts instanceof Error
        ? vi.fn().mockRejectedValue({ code: "storage.disk_full" })
        : vi.fn().mockResolvedValue({ visible: true, alerts }),
    freeBoxSpace: vi.fn(),
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

describe.each(["light", "dark"] as const)("box-status-screen a11y (%s theme)", (theme) => {
  const cases: [string, () => DashboardApi][] = [
    ["a quiet box", () => stubApi(health())],
    [
      "a stopped disk and clock, unsent records and printer alerts",
      () => stubApi(TROUBLED, PRINTER_ALERTS),
    ],
    ["a failed read", () => stubApi(new Error("read"))],
    ["a stop the box offers to restart", () => stubApi(OFFERED)],
    ["a failed alert read", () => stubApi(TROUBLED, new Error("alerts"))],
  ];
  it.each(cases)("renders accessibly with %s", async (_name, api) => {
    const { el, host } = await mountWidget<BoxStatusScreen>(
      "dashboard-box-status-screen",
      { api: api(), canOpen: () => true },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the open restart dialog accessibly, with a refusal", async () => {
    const api = stubApi(OFFERED);
    (api as unknown as { restartClockPayments: unknown }).restartClockPayments = vi
      .fn()
      .mockRejectedValue({ code: "clock.restart_refused", params: { reason: "record_changed" } });
    const { el, host } = await mountWidget<BoxStatusScreen>(
      "dashboard-box-status-screen",
      { api, canOpen: () => true },
      theme,
    );
    await flush(el);
    (el.shadowRoot!.querySelector("[data-test=restart]") as HTMLElement).click();
    await flush(el);
    await expectNoA11yViolations(host);
    (el.shadowRoot!.querySelector("[data-test=restart-confirm]") as HTMLElement).click();
    await flush(el);
    expect(
      el
        .shadowRoot!.querySelector("[data-test=restart-dialog]")!
        .shadowRoot!.querySelector("[data-error]"),
    ).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
