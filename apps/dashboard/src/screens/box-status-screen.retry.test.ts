import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type {
  AlertView,
  AlertsResponse,
  BoxHealth,
  DashboardApi,
  FiscalRetryView,
} from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { guideHref } from "../help-guide.js";
import "./box-status-screen.js";
import type { BoxStatusScreen } from "./box-status-screen.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

type Outbox = NonNullable<BoxHealth["outbox"]>;

const UNSENT = {
  key: "fiscal.records_unsent",
  code: "fiscal.records_unsent",
  severity: "warning" as const,
  params: { count: 12 },
  owner: "box",
};

function health(overrides: Partial<BoxHealth> = {}): BoxHealth {
  return {
    at: "2026-10-22T19:45:00.000Z",
    sales: { lastAt: "2026-10-22T19:43:00.000Z" },
    notices: [],
    noticesUnavailable: [],
    filing: true,
    outbox: null,
    stream: { state: "off" },
    clock: {
      authority: { state: "ok", driftSeconds: -2, measuredAt: "2026-10-22T12:03:00.000Z" },
      sync: { synced: true, source: "unavailable", warn: false },
    },
    printers: [{ id: "p1", name: "Bar" }],
    readers: [{ id: "r1", name: "Reader 1" }],
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
    ...overrides,
  };
}

function outbox(overrides: Partial<Outbox> = {}): Outbox {
  return {
    lastAcceptedAt: "2026-10-22T18:00:00.000Z",
    waiting: 12,
    awaitingCertificate: false,
    ...overrides,
  };
}

const CERTIFICATE_ALERT: AlertView = {
  key: "fiscal.awaiting_certificate:1",
  kind: "ongoing",
  code: "fiscal.awaiting_certificate",
  params: {},
  severity: "warning",
  since: "2026-10-22T19:00:00.000Z",
  area: "fiscal",
};

function stubApi(answer: BoxHealth, alerts: AlertView[] = []): DashboardApi {
  return {
    getBoxHealth: vi.fn().mockResolvedValue(answer),
    listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts } satisfies AlertsResponse),
    freeBoxSpace: vi.fn(),
    retryFiscalSubmissions: vi.fn().mockResolvedValue({ waiting: 12 } satisfies FiscalRetryView),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
}

async function flush(el: BoxStatusScreen): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

async function mount(api: DashboardApi) {
  const mounted = await mountWidget<BoxStatusScreen>("dashboard-box-status-screen", { api });
  await flush(mounted.el);
  return mounted;
}

const q = (el: BoxStatusScreen, selector: string) => el.shadowRoot!.querySelector(selector);
const retryButton = (el: BoxStatusScreen) =>
  q(el, "[data-test=row-tax] [data-test=retry]") as HTMLElement | null;
const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("box-status-screen Retry now", () => {
  it("draws no Retry now and no help on the Tax agency row when the box has no outbox", async () => {
    const { el } = await mount(stubApi(health({ notices: [UNSENT] })));
    expect(q(el, "[data-test=row-tax]")).not.toBeNull();
    expect(retryButton(el)).toBeNull();
    expect(q(el, "[data-test=row-tax] wt-help-tooltip")).toBeNull();
  });

  it("is quiet and disabled while nothing waits, even with the unsent notice", async () => {
    const { el } = await mount(
      stubApi(health({ outbox: outbox({ waiting: 0 }), notices: [UNSENT] })),
    );
    const button = retryButton(el)!;
    expect(text(button)).toBe("Retry now");
    expect(button.getAttribute("variant")).toBe("secondary");
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("is quiet and disabled while records wait but no send has failed", async () => {
    const { el } = await mount(stubApi(health({ outbox: outbox({ waiting: 12 }) })));
    const button = retryButton(el)!;
    expect(button.getAttribute("variant")).toBe("secondary");
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  describe("while the box waits for its certificate", () => {
    const waiting = () =>
      health({ outbox: outbox({ waiting: 12, awaitingCertificate: true }), notices: [UNSENT] });

    it("is quiet and disabled, and the row says why when the bell has not", async () => {
      const { el } = await mount(stubApi(waiting()));
      const button = retryButton(el)!;
      expect(button.getAttribute("variant")).toBe("secondary");
      expect(button.hasAttribute("disabled")).toBe(true);
      const aside = q(el, "[data-test=row-tax] [data-test=awaiting-certificate]");
      expect(text(aside)).toBe(
        "Nothing can be sent until the tax agency's certificate is installed.",
      );
      expect(text(aside)).toBe(t("box_status.retry_awaiting_certificate"));
    });

    it("draws no aside when the bell's alert already says so on the row", async () => {
      const { el } = await mount(stubApi(waiting(), [CERTIFICATE_ALERT]));
      const button = retryButton(el)!;
      expect(button.getAttribute("variant")).toBe("secondary");
      expect(button.hasAttribute("disabled")).toBe(true);
      expect(q(el, "[data-test=row-tax] [data-test=row-alert]")).not.toBeNull();
      expect(q(el, "[data-test=row-tax] [data-test=awaiting-certificate]")).toBeNull();
    });
  });

  it("is drawn in its own colour and enabled once records wait after a failed send", async () => {
    const { el } = await mount(
      stubApi(health({ outbox: outbox({ waiting: 12 }), notices: [UNSENT] })),
    );
    const button = retryButton(el)!;
    expect(button.getAttribute("variant")).toBe("primary");
    expect(button.hasAttribute("disabled")).toBe(false);
    const tooltip = q(el, "[data-test=row-tax] wt-help-tooltip")!;
    expect(tooltip.getAttribute("mode")).toBe("help-mode");
    expect(tooltip.getAttribute("guide-href")).toBe(guideHref("box-status.retry-now"));
    expect(tooltip.getAttribute("guide-label")).toBe(t("box_status.retry_help_guide"));
    expect(tooltip.getAttribute("aria-label")).toBe(t("box_status.retry_help_label"));
    expect(text(tooltip)).toBe(t("box_status.retry_help"));
  });
});
