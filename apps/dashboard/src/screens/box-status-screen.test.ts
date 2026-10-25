import { page, userEvent } from "vitest/browser";
import { setHelpMode } from "@waitron/ui";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { LiveData, formatBytes } from "@waitron/dashboard-kit";
import type {
  AlertView,
  AlertsResponse,
  BoxHealth,
  ClockMisdatedView,
  DashboardApi,
  FreedSpaceView,
  MisdatedOpenView,
} from "../api/client.js";
import { formatIsoMinute } from "../date-utils.js";
import { ALERT_MESSAGES } from "../i18n/alert-messages.js";
import { alertMessage } from "../i18n/alerts.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, fill, setLocale, t } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import { cleanupWidgets, mountWidget, timesAcrossLines } from "../widgets/test-helpers.js";
import { goToLabel } from "../widgets/alert-format.js";
import { guideHref } from "../help-guide.js";
import "./box-status-screen.js";
import type { BoxStatusScreen } from "./box-status-screen.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

function health(overrides: Partial<BoxHealth> = {}, disk: Partial<BoxHealth["disk"]> = {}) {
  return {
    at: "2026-10-22T19:45:00.000Z",
    sales: { lastAt: "2026-10-22T19:43:00.000Z" },
    notices: [],
    noticesUnavailable: [],
    filing: true,
    outbox: null,
    stream: {
      state: "streaming",
      generation: "g1",
      reason: null,
      stateSince: "2026-10-22T08:00:00.000Z",
      bucketProblem: null,
      lagMs: 0,
      lastConfirmedUploadAt: "2026-10-22T19:44:00.000Z",
    },
    clock: {
      authority: { state: "ok", driftSeconds: -2, measuredAt: "2026-10-22T12:03:00.000Z" },
      sync: { synced: true, source: "unavailable", warn: false },
    },
    printers: [{ id: "p1", name: "Bar" }],
    readers: [{ id: "r1", name: "Reader 1" }],
    canFree: true,
    ...overrides,
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
      ...disk,
    },
    clockStop: null,
    clockCheckWaiting: null,
    misdatedOpen: [],
    misdatedHandledCount: 0,
  } satisfies BoxHealth;
}

function alert(code: string, area: string, overrides: Partial<AlertView> = {}): AlertView {
  return {
    key: `${code}:1`,
    kind: "ongoing",
    code,
    params: {},
    severity: "warning",
    since: "2026-10-22T19:00:00.000Z",
    area,
    ...overrides,
  };
}

const PRINTER_ALERT = alert("printer.jobs_waiting", "printing", {
  severity: "error",
  params: { count: 2, printer: "Kitchen" },
  screen: "printers",
});
const AGENT_ALERT = alert("agent.silent", "printing", {
  key: "agent.silent:a1",
  params: { agent: "Back office" },
  screen: "printers",
});
const OTHER_ALERT = alert("payment.offline_forward_declined", "payments", { kind: "event" });

const FREED: FreedSpaceView = {
  freedBytes: 45_000_000,
  deleted: 3,
  failed: 0,
  backupRunning: false,
  freeBytes: 1_845_000_000,
};

function stubApi(
  overrides: Partial<Record<keyof DashboardApi, unknown>> = {},
  answer: BoxHealth = health(),
  alerts: AlertView[] = [],
): DashboardApi {
  return {
    getBoxHealth: vi.fn().mockResolvedValue(answer),
    listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts } satisfies AlertsResponse),
    freeBoxSpace: vi.fn().mockResolvedValue(FREED),
    liveData: new LiveData(),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: BoxStatusScreen): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

async function mount(api: DashboardApi, canOpen?: (screen: string) => boolean) {
  const mounted = await mountWidget<BoxStatusScreen>("dashboard-box-status-screen", {
    api,
    ...(canOpen === undefined ? {} : { canOpen }),
  });
  await flush(mounted.el);
  return mounted;
}

const q = (el: BoxStatusScreen, selector: string) => el.shadowRoot!.querySelector(selector);
const qa = (el: BoxStatusScreen, selector: string) => [
  ...el.shadowRoot!.querySelectorAll(selector),
];
const freeButton = (el: BoxStatusScreen) => q(el, "[data-test=free]") as HTMLElement | null;
const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const size = (bytes: number) => formatBytes(bytes, currentLocale());

/** The colour a token paints, read through an element styled with it. */
function tokenColour(host: HTMLElement, token: string): string {
  const probe = document.createElement("span");
  probe.style.backgroundColor = `var(${token})`;
  host.appendChild(probe);
  const colour = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return colour;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("dashboard-box-status-screen", () => {
  it("draws the title and the seven parts in order, each with its state", async () => {
    const { el } = await mount(stubApi());
    expect(text(q(el, "h1"))).toBe(t("box_status.title"));
    const rows = qa(el, "ul.rows > li");
    expect(rows.map((row) => row.getAttribute("data-test"))).toEqual([
      "row-sales",
      "row-tax",
      "row-bucket",
      "row-printers",
      "row-readers",
      "row-clock",
      "row-disk",
    ]);
    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual(Array(7).fill("ok"));
    expect(text(q(el, "[data-test=row-disk] .name"))).toBe(t("box_status.part.disk"));
    expect(text(q(el, "[data-test=legend]"))).toContain(
      t("box_status.legend").split("·")[1]!.trim(),
    );
    expect(text(q(el, "[data-test=fillers]"))).toBe(t("box_status.fillers"));
  });

  it("paints each state's dot in its own colour and says the state in words", async () => {
    const answer = health({
      notices: [
        {
          key: "storage.disk_full",
          code: "storage.disk_full",
          severity: "error",
          params: {},
          owner: "box",
        },
      ],
    });
    const { el, host } = await mount(stubApi({}, answer, [PRINTER_ALERT]));
    const dot = (id: string) => q(el, `[data-test=row-${id}] .dot`) as HTMLElement;
    const words = (id: string) => text(q(el, `[data-test=row-${id}] .state-words`));
    expect(q(el, "[data-test=row-disk]")!.getAttribute("data-state")).toBe("stopped");
    expect(getComputedStyle(dot("disk")).backgroundColor).toBe(
      tokenColour(host, "--wt-color-danger"),
    );
    expect(words("disk")).toBe(t("box_status.state.stopped"));
    expect(getComputedStyle(dot("printers")).backgroundColor).toBe(
      tokenColour(host, "--wt-color-warning"),
    );
    expect(words("printers")).toBe(t("box_status.state.attention"));
    expect(getComputedStyle(dot("tax")).backgroundColor).toBe(
      tokenColour(host, "--wt-color-success"),
    );
    expect(words("tax")).toBe(t("box_status.state.ok"));
  });

  it("shows the figure on the free-space button, and offers it only from 1 MB", async () => {
    const big = await mount(stubApi());
    expect(text(freeButton(big.el))).toBe(fill("box_status.free", { size: size(45_000_000) }));
    expect(text(freeButton(big.el))).toBe("Free 45 MB");
    expect(freeButton(big.el)!.getAttribute("variant")).toBe("primary");
    expect(freeButton(big.el)!.hasAttribute("disabled")).toBe(false);
    cleanupWidgets();

    const least = await mount(
      stubApi({}, health({}, { reclaimable: { bytes: 500_000, backupRunning: false } })),
    );
    expect(text(freeButton(least.el))).toBe("Free 1 MB");
    expect(freeButton(least.el)!.getAttribute("variant")).toBe("primary");
    expect(freeButton(least.el)!.hasAttribute("disabled")).toBe(false);
    cleanupWidgets();

    const below = await mount(
      stubApi({}, health({}, { reclaimable: { bytes: 499_999, backupRunning: false } })),
    );
    expect(text(freeButton(below.el))).toBe(t("box_status.free_nothing"));
    expect(freeButton(below.el)!.getAttribute("variant")).toBe("secondary");
    expect(freeButton(below.el)!.hasAttribute("disabled")).toBe(true);
  });

  it("draws no row, so no free-space button, before the first read answers", async () => {
    const pending = deferred<BoxHealth>();
    const { el } = await mount(stubApi({ getBoxHealth: vi.fn().mockReturnValue(pending.promise) }));
    expect(qa(el, "ul.rows > li")).toHaveLength(0);
    expect(freeButton(el)).toBeNull();
    pending.resolve(health());
    await flush(el);
    expect(freeButton(el)!.getAttribute("variant")).toBe("primary");
  });

  it("frees once per press, stays blue and disabled while sent, then reads the box and the bell again", async () => {
    const sent = deferred<FreedSpaceView>();
    const api = stubApi({ freeBoxSpace: vi.fn().mockReturnValue(sent.promise) });
    const { el } = await mount(api);
    const reads = vi.mocked(api.getBoxHealth).mock.calls.length;
    const alertReads = vi.mocked(api.listAlerts).mock.calls.length;

    await userEvent.click(freeButton(el)!);
    await el.updateComplete;
    expect(freeButton(el)!.getAttribute("variant")).toBe("primary");
    expect(freeButton(el)!.hasAttribute("disabled")).toBe(true);
    freeButton(el)!.click();
    await el.updateComplete;
    expect(api.freeBoxSpace).toHaveBeenCalledTimes(1);

    sent.resolve(FREED);
    await flush(el);
    expect(text(q(el, "[role=status]"))).toBe(fill("box_status.freed", { size: size(45_000_000) }));
    expect(text(q(el, "[role=status]"))).toBe("Freed 45 MB.");
    expect(api.getBoxHealth).toHaveBeenCalledTimes(reads + 1);
    expect(api.listAlerts).toHaveBeenCalledTimes(alertReads + 1);
  });

  it("says a running backup's working files are not counted, under the Disk row", async () => {
    const answer = health({}, { reclaimable: { bytes: 45_000_000, backupRunning: true } });
    const { el } = await mount(stubApi({}, answer));
    expect(text(q(el, "[data-test=row-disk] [data-test=backup-running]"))).toBe(
      t("box_status.free_backup_running"),
    );
    const quiet = await mount(stubApi());
    expect(q(quiet.el, "[data-test=backup-running]")).toBeNull();
  });

  it("keeps a refused press's message through a later successful read", async () => {
    const api = stubApi({
      freeBoxSpace: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mount(api);
    await userEvent.click(freeButton(el)!);
    await flush(el);
    expect(text(q(el, "[role=alert]"))).toBe(codeMessage("authorization.not_permitted"));
    expect(freeButton(el)!.hasAttribute("disabled")).toBe(false);
    expect(q(el, "[role=status]")).toBeNull();

    const reads = vi.mocked(api.getBoxHealth).mock.calls.length;
    api.liveData.refresh();
    await flush(el);
    expect(api.getBoxHealth).toHaveBeenCalledTimes(reads + 1);
    expect(text(q(el, "[role=alert]"))).toBe(codeMessage("authorization.not_permitted"));
  });

  it("says a failed read, and clears it once a read succeeds", async () => {
    const api = stubApi({
      getBoxHealth: vi
        .fn()
        .mockRejectedValueOnce({ code: "server.internal" })
        .mockResolvedValue(health()),
    });
    const { el } = await mount(api);
    expect(text(q(el, "[role=alert]"))).toBe(t("box_status.read_error"));
    api.liveData.refresh();
    await flush(el);
    expect(q(el, "[role=alert]")).toBeNull();
    expect(qa(el, "ul.rows > li")).toHaveLength(7);
  });

  it("draws every row from the box's read when the bell's read fails, and says the alerts are missing", async () => {
    const answer = health({
      notices: [
        {
          key: "storage.disk_full",
          code: "storage.disk_full",
          severity: "error",
          params: {},
          owner: "box",
        },
      ],
    });
    const api = stubApi(
      {
        listAlerts: vi
          .fn()
          .mockRejectedValueOnce({ code: "storage.disk_full" })
          .mockResolvedValue({ visible: true, alerts: [PRINTER_ALERT, OTHER_ALERT] }),
      },
      answer,
    );
    const { el } = await mount(api);
    expect(qa(el, "ul.rows > li")).toHaveLength(7);
    expect(q(el, "[data-test=row-disk]")!.getAttribute("data-state")).toBe("stopped");
    expect(freeButton(el)!.getAttribute("variant")).toBe("primary");
    expect(freeButton(el)!.hasAttribute("disabled")).toBe(false);
    expect(text(q(el, "[data-test=alerts-unavailable]"))).toBe(t("box_status.alerts_unavailable"));
    expect(q(el, "[data-test=other]")).toBeNull();
    expect(q(el, "[role=alert]")).toBeNull();

    api.liveData.refresh();
    await flush(el);
    expect(q(el, "[data-test=alerts-unavailable]")).toBeNull();
    expect(q(el, "[data-test=row-printers]")!.getAttribute("data-state")).toBe("attention");
    expect(q(el, "[data-test=other]")).not.toBeNull();
  });

  it("keeps the bell's last alerts when a later alert read fails, and says they may be stale", async () => {
    const api = stubApi({
      listAlerts: vi
        .fn()
        .mockResolvedValueOnce({ visible: true, alerts: [PRINTER_ALERT] })
        .mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mount(api);
    api.liveData.refresh();
    await flush(el);
    expect(text(q(el, "[data-test=alerts-unavailable]"))).toBe(t("box_status.alerts_unavailable"));
    expect(q(el, "[role=alert]")).toBeNull();
    expect(q(el, "[data-test=row-printers]")!.getAttribute("data-state")).toBe("attention");
  });

  it("keeps the button quiet after a press until the box's figure is read again", async () => {
    const refreshed = deferred<BoxHealth>();
    const api = stubApi({
      getBoxHealth: vi.fn().mockResolvedValueOnce(health()).mockReturnValueOnce(refreshed.promise),
    });
    const { el } = await mount(api);
    await userEvent.click(freeButton(el)!);
    await flush(el);
    expect(text(q(el, "[role=status]"))).toBe("Freed 45 MB.");
    expect(freeButton(el)!.getAttribute("variant")).toBe("secondary");
    expect(freeButton(el)!.hasAttribute("disabled")).toBe(true);
    freeButton(el)!.click();
    await el.updateComplete;
    expect(api.freeBoxSpace).toHaveBeenCalledTimes(1);

    refreshed.resolve(health({}, { reclaimable: { bytes: 499_999, backupRunning: false } }));
    await flush(el);
    expect(text(freeButton(el))).toBe(t("box_status.free_nothing"));
  });

  it("shows a failed refresh after a press as a failed read, not a failed press", async () => {
    const api = stubApi({
      getBoxHealth: vi
        .fn()
        .mockResolvedValueOnce(health())
        .mockRejectedValueOnce({ code: "server.internal" }),
    });
    const { el } = await mount(api);
    await userEvent.click(freeButton(el)!);
    await flush(el);
    expect(text(q(el, "[role=status]"))).toBe("Freed 45 MB.");
    expect(text(q(el, "[role=alert]"))).toBe(t("box_status.read_error"));
  });

  it("words a press refused on a read-only copy with the page's own sentence", async () => {
    const api = stubApi({ freeBoxSpace: vi.fn().mockRejectedValue({ code: "node.read_only" }) });
    const { el } = await mount(api);
    await userEvent.click(freeButton(el)!);
    await flush(el);
    expect(text(q(el, "[role=alert]"))).toBe(t("box_status.free_read_only"));
  });

  it("passes the bell's own alerts, unfiltered, so a hidden list leaves every row clear", async () => {
    const api = stubApi({
      listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    });
    const { el } = await mount(api);
    expect(qa(el, "ul.rows > li")).toHaveLength(7);
    expect(q(el, "[data-test=other]")).toBeNull();
  });

  it("does not repeat the headline's alert sentence among the row's alerts", async () => {
    const { el } = await mount(stubApi({}, health(), [PRINTER_ALERT, AGENT_ALERT]));
    const printers = q(el, "[data-test=row-printers]")!;
    const first = alertMessage(PRINTER_ALERT.code, PRINTER_ALERT.params, currentLocale());
    const second = alertMessage(AGENT_ALERT.code, AGENT_ALERT.params, currentLocale());
    expect(text(printers.querySelector(".line"))).toBe(first);
    expect(
      [...printers.querySelectorAll("[data-test=row-alert]")].map((node) => text(node)),
    ).toEqual([second]);
  });

  it("opens a row's screen and the Alerts screen", async () => {
    const api = stubApi({}, health(), [PRINTER_ALERT, OTHER_ALERT]);
    const { el } = await mount(api, (screen) => screen === "printers");
    const seen: string[] = [];
    el.addEventListener("wt-alert-go-to", (event) =>
      seen.push((event as CustomEvent<{ screen: string }>).detail.screen),
    );
    const goTo = q(el, "[data-test=row-printers] [data-test=go-to]") as HTMLElement;
    expect(text(goTo)).toBe(goToLabel("printers"));
    expect(goTo.getAttribute("variant")).toBe("secondary");
    await userEvent.click(goTo);
    expect(text(q(el, "[data-test=other]"))).toContain(t("box_status.other_alerts_one"));
    await userEvent.click(q(el, "[data-test=see-all]") as HTMLElement);
    expect(seen).toEqual(["printers", "alerts"]);

    const closed = await mount(stubApi({}, health(), [PRINTER_ALERT]));
    expect(q(closed.el, "[data-test=row-printers] [data-test=go-to]")).toBeNull();
    expect(q(closed.el, "[data-test=see-all]")).toBeNull();
  });

  it("offers no Go to this page or for an alert without a screen, and counts other alerts", async () => {
    const alerts = [
      alert("storage.space_low", "box", { screen: "box-status" }),
      alert("fiscal.submission_delayed", "fiscal"),
      OTHER_ALERT,
      alert("sync.lagging", "replication"),
    ];
    const { el } = await mount(stubApi({}, health(), alerts), () => true);
    expect(q(el, "[data-test=row-disk] [data-test=go-to]")).toBeNull();
    expect(q(el, "[data-test=row-tax] [data-test=go-to]")).toBeNull();
    expect(q(el, "[data-test=row-tax]")!.getAttribute("data-state")).toBe("attention");
    expect(text(q(el, "[data-test=other]"))).toContain(
      fill("box_status.other_alerts", { count: "2" }),
    );
  });

  it("explains what free-space deletion removes in a help-mode tooltip", async () => {
    const { el } = await mount(stubApi());
    const tooltip = q(el, "[data-test=row-disk] wt-help-tooltip")!;
    expect(tooltip.getAttribute("mode")).toBe("help-mode");
    expect(tooltip.getAttribute("aria-label")).toBe(t("box_status.free_help_label"));
    expect(text(tooltip)).toBe(t("box_status.free_help"));
  });

  it.each([
    ["en", "/help/en/box-status#free-space"],
    ["es", "/help/es/box-status#free-space"],
  ])("the help tooltip links to the guide's free-space section in %s", async (locale, href) => {
    setLocale(locale);
    const { el } = await mount(stubApi());
    const tooltip = q(el, "[data-test=row-disk] wt-help-tooltip")!;
    expect(tooltip.getAttribute("guide-href")).toBe(href);
    expect(tooltip.getAttribute("guide-href")).toBe(guideHref("box-status.free-space"));
    expect(tooltip.getAttribute("guide-label")).toBe(t("box_status.free_help_guide"));
  });

  it("reads again in the background after the first read", async () => {
    const background = {
      getBoxHealth: vi.fn().mockResolvedValue(health()),
      listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [] }),
    };
    const api = stubApi({ background });
    const { el } = await mount(api);
    expect(api.getBoxHealth).toHaveBeenCalledTimes(1);
    api.liveData.refresh();
    await flush(el);
    expect(api.getBoxHealth).toHaveBeenCalledTimes(1);
    expect(background.getBoxHealth).toHaveBeenCalledTimes(1);
  });

  it("says when some checks could not be made", async () => {
    const { el } = await mount(stubApi({}, health({ noticesUnavailable: ["fiscal"] })));
    expect(text(q(el, "[data-test=checks-unavailable]"))).toBe(t("box_status.checks_unavailable"));
    const quiet = await mount(stubApi());
    expect(q(quiet.el, "[data-test=checks-unavailable]")).toBeNull();
  });

  it("draws the button quiet on a read-only copy, and says why", async () => {
    const api = stubApi({}, health({ canFree: false }));
    const { el } = await mount(api);
    expect(freeButton(el)!.getAttribute("variant")).toBe("secondary");
    expect(freeButton(el)!.hasAttribute("disabled")).toBe(true);
    expect(text(q(el, "[data-test=read-only]"))).toBe(t("box_status.free_read_only"));
    freeButton(el)!.click();
    await el.updateComplete;
    expect(api.freeBoxSpace).not.toHaveBeenCalled();
  });
});

describe("dashboard-box-status-screen's layout", () => {
  const box = (el: BoxStatusScreen, selector: string) =>
    (q(el, selector) as HTMLElement).getBoundingClientRect();

  async function mountAt(width: number, api: DashboardApi) {
    const mounted = await mount(api, () => true);
    mounted.host.style.width = `${width}px`;
    await flush(mounted.el);
    return mounted;
  }

  it("on a wide page puts the name, the words and the actions side by side, as picture 4 does", async () => {
    const { el } = await mountAt(1000, stubApi({}, health(), [PRINTER_ALERT]));
    const name = box(el, "[data-test=row-printers] .name");
    const line = box(el, "[data-test=row-printers] .line");
    const goTo = box(el, "[data-test=row-printers] [data-test=go-to]");
    expect(name.right).toBeLessThanOrEqual(line.left);
    expect(Math.abs(name.top - line.top)).toBeLessThan(name.height);
    expect(goTo.left).toBeGreaterThanOrEqual(line.right);
    expect(box(el, "[data-test=row-sales] .line").left).toBe(line.left);
  });

  it("on a phone puts the name above the words and the actions below them, across the row", async () => {
    const { el } = await mountAt(358, stubApi({}, health(), [PRINTER_ALERT]));
    const name = box(el, "[data-test=row-printers] .name");
    const line = box(el, "[data-test=row-printers] .line");
    const detail = box(el, "[data-test=row-printers] .detail");
    const goTo = box(el, "[data-test=row-printers] [data-test=go-to]");
    expect(name.bottom).toBeLessThanOrEqual(line.top);
    expect(goTo.top).toBeGreaterThanOrEqual(detail.bottom);
    expect(goTo.left).toBeGreaterThanOrEqual(line.left);
    expect(box(el, "[data-test=row-disk] [data-test=free]").top).toBeGreaterThanOrEqual(
      box(el, "[data-test=row-disk] .detail").bottom,
    );
  });

  it("draws the part's name in bold", async () => {
    const { el, host } = await mount(stubApi());
    const probe = document.createElement("span");
    probe.style.fontWeight = "var(--wt-font-weight-bold)";
    host.appendChild(probe);
    expect(getComputedStyle(q(el, "[data-test=row-disk] .name")!).fontWeight).toBe(
      getComputedStyle(probe).fontWeight,
    );
  });

  it("keeps the read-only sentence as close to the details as the details are to the line", async () => {
    const { el } = await mount(stubApi({}, health({ canFree: false })));
    const detail = box(el, "[data-test=row-disk] .detail");
    const line = box(el, "[data-test=row-disk] .line");
    const aside = box(el, "[data-test=row-disk] [data-test=read-only]");
    expect(aside.top - detail.bottom).toBe(detail.top - line.bottom);
  });
});

describe("dashboard-box-status-screen's Clock row during a payment stop", () => {
  const CLOCK_AT = "2026-10-22T18:10:00.000Z";
  const LAST_RECORD_AT = "2026-10-22T19:30:00.000Z";
  const STOP: NonNullable<BoxHealth["clockStop"]> = {
    clockAt: CLOCK_AT,
    offsetMinutes: 120,
    lastRecordAt: LAST_RECORD_AT,
    lastRecordOffsetMinutes: 120,
    recordId: "rec-42",
    gapMs: 4_800_000,
    proof: "confirmed",
    agreeing: {
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
          boxAt: "2026-10-22T18:01:00.000Z",
          witnessAt: "2026-10-22T18:01:00.000Z",
          uncertaintyMs: 200,
        },
      ],
    },
    contrary: { authority: null, devices: [] },
    confirmation: {
      id: "c-1",
      source: "devices",
      personName: null,
      confirmedAt: "2026-10-22T18:12:00.000Z",
    },
  };

  it("never breaks a written time across two lines on the Clock row", async () => {
    const { innerWidth, innerHeight } = window;
    onTestFinished(() => page.viewport(innerWidth, innerHeight));
    // With no notice the row's line is its first alert, and the second is drawn beneath it.
    const { el } = await mount(
      stubApi({}, { ...health(), clockStop: STOP }, [
        alert("clock.behind_chain_restarted", "box", {
          kind: "event",
          params: {
            clockAt: CLOCK_AT,
            lastRecordAt: LAST_RECORD_AT,
            confirmedBy: "devices",
          },
        }),
        alert("clock.disagrees", "box", {
          params: { count: 3, deviceAt: LAST_RECORD_AT, boxAt: CLOCK_AT },
        }),
      ]),
    );
    const broken: string[] = [];
    let checked = 0;
    for (let width = 320; width <= 1280; width += 8) {
      await page.viewport(width, 900);
      await el.updateComplete;
      const found = timesAcrossLines(qa(el, "[data-test=row-clock] .words p"));
      checked += found.checked;
      broken.push(...found.broken.map((time) => `${width}px: ${time}`));
    }
    // Each width checks the row's line, alert, proof and confirmation times.
    expect(checked).toBeGreaterThanOrEqual(121 * 6);
    expect(broken).toEqual([]);
  });

  // Spanish, where the verb follows the count.
  it("counts one agreeing device in the singular and two in the plural", async () => {
    setLocale("es");
    const time = formatIsoMinute("2026-10-22T18:01:00.000Z");
    const one = await mount(stubApi({}, { ...health(), clockStop: STOP }));
    const oneText = text(q(one.el, "[data-test=row-clock] .words"));
    expect(oneText).toContain(fill("box_status.clock.proof.device_one", { time }));
    expect(oneText).not.toContain(fill("box_status.clock.proof.devices", { count: "1", time }));
    cleanupWidgets();
    const device = STOP.agreeing.devices[0]!;
    const two = await mount(
      stubApi(
        {},
        {
          ...health(),
          clockStop: {
            ...STOP,
            agreeing: {
              ...STOP.agreeing,
              devices: [device, { ...device, id: "d2", label: "Terrace" }],
            },
          },
        },
      ),
    );
    expect(text(q(two.el, "[data-test=row-clock] .words"))).toContain(
      fill("box_status.clock.proof.devices", { count: "2", time }),
    );
  });

  it("draws no restart button, whatever the proof", async () => {
    for (const proof of ["none", "contrary", "ready", "confirmed"] as const) {
      const { el } = await mount(stubApi({}, { ...health(), clockStop: { ...STOP, proof } }));
      expect(q(el, "[data-test=restart]")).toBeNull();
      expect(q(el, "[data-test=restart-dialog]")).toBeNull();
      cleanupWidgets();
    }
  });
});

describe("dashboard-box-status-screen's check of the box's clock with this device", () => {
  const BOX_AT = "2026-10-22T18:10:00.000Z";
  const STOPPED: NonNullable<BoxHealth["clockStop"]> = {
    clockAt: BOX_AT,
    offsetMinutes: 120,
    lastRecordAt: "2026-10-22T19:30:00.000Z",
    lastRecordOffsetMinutes: 120,
    recordId: "rec-42",
    gapMs: 4_800_000,
    proof: "none",
    agreeing: { authority: null, devices: [] },
    contrary: { authority: null, devices: [] },
    confirmation: null,
  };
  const REFUSED = (reason: string) => ({ code: "clock.confirm_refused", params: { reason } });
  const atSeconds = (iso: string) => `${formatIsoMinute(iso)}:${iso.slice(17, 19)}`;

  function deviceNow(iso: string): void {
    const spy = vi.spyOn(Date, "now").mockReturnValue(Date.parse(iso));
    onTestFinished(() => spy.mockRestore());
  }

  function clockApi(
    answer: Partial<BoxHealth> = { clockStop: STOPPED },
    overrides: Partial<Record<keyof DashboardApi, unknown>> = {},
  ): DashboardApi {
    const api = stubApi(
      {
        clockChallenge: vi
          .fn()
          .mockResolvedValueOnce({ challengeId: "ch-1", boxAt: BOX_AT })
          .mockResolvedValue({ challengeId: "ch-2", boxAt: BOX_AT }),
        clockConfirm: vi.fn().mockResolvedValue({
          confirmationId: "c-1",
          source: "admin",
          confirmedAt: BOX_AT,
        }),
        ...overrides,
      },
      { ...health(), ...answer },
    );
    vi.spyOn(api.liveData, "refresh");
    return api;
  }

  async function mountClock(api: DashboardApi, canConfirmClock = true) {
    const mounted = await mountWidget<BoxStatusScreen>("dashboard-box-status-screen", {
      api,
      canConfirmClock,
    });
    await flush(mounted.el);
    return mounted.el;
  }

  const openButton = (el: BoxStatusScreen) =>
    q(el, "[data-test=row-clock] [data-test=clock-check]") as HTMLElement | null;
  const dialog = (el: BoxStatusScreen) =>
    q(el, "[data-test=clock-check-dialog]") as HTMLElement & { open: boolean };
  const buttons = (el: BoxStatusScreen) =>
    qa(el, "[data-test=clock-check-dialog] wt-form-actions wt-button").map((button) => [
      button.getAttribute("data-test"),
      button.getAttribute("variant"),
      text(button),
    ]);
  const footerMessage = (el: BoxStatusScreen) =>
    text(dialog(el).shadowRoot!.querySelector(".footer [data-error]"));

  async function open(el: BoxStatusScreen): Promise<void> {
    await userEvent.click(openButton(el)!);
    await flush(el);
  }

  it("offers the check only to an administrator, and only during a stop or while a check waits", async () => {
    expect(openButton(await mountClock(clockApi(), false))).toBeNull();
    cleanupWidgets();
    expect(openButton(await mountClock(clockApi({ clockStop: null })))).toBeNull();
    cleanupWidgets();
    const confirmed = {
      ...STOPPED,
      proof: "confirmed" as const,
      confirmation: {
        id: "c-1",
        source: "authority" as const,
        personName: null,
        confirmedAt: BOX_AT,
      },
    };
    expect(openButton(await mountClock(clockApi({ clockStop: confirmed })))).toBeNull();
    cleanupWidgets();
    const el = await mountClock(clockApi());
    expect(text(openButton(el))).toBe("Check with this device's time");
    expect(openButton(el)!.getAttribute("variant")).toBe("secondary");
    expect(dialog(el).open).toBe(false);
  });

  it("explains the check in a help-mode tooltip beside its button", async () => {
    const el = await mountClock(clockApi());
    const tooltip = q(el, "[data-test=row-clock] .clock-check-action wt-help-tooltip")!;
    expect(tooltip.getAttribute("mode")).toBe("help-mode");
    expect(tooltip.getAttribute("aria-label")).toBe("What this check does");
    expect(tooltip.getAttribute("aria-label")).toBe(t("box_status.clock_check_help_label"));
    expect(text(tooltip)).toBe(t("box_status.clock_check_help"));
    expect(tooltip.getAttribute("guide-label")).toBe(t("box_status.clock_check_help_guide"));
  });

  it.each([
    ["en", "/help/en/box-status#clock-behind"],
    ["es", "/help/es/box-status#clock-behind"],
  ])("the check's help tooltip links to the guide's clock section in %s", async (locale, href) => {
    setLocale(locale);
    const el = await mountClock(clockApi());
    const tooltip = q(el, "[data-test=row-clock] .clock-check-action wt-help-tooltip")!;
    expect(tooltip.getAttribute("guide-href")).toBe(href);
    expect(tooltip.getAttribute("guide-href")).toBe(guideHref("box-status.clock-behind"));
    expect(text(tooltip)).toBe(t("box_status.clock_check_help"));
  });

  it("hangs the check's help badge over its button's top trailing corner while help is on", async () => {
    setHelpMode(true);
    onTestFinished(() => setHelpMode(false));
    const el = await mountClock(clockApi());
    const button = openButton(el)!.getBoundingClientRect();
    const badge = q(el, ".clock-check-action wt-help-tooltip")!.getBoundingClientRect();
    expect(badge.width).toBeGreaterThan(0);
    const [x, y] = [badge.left + badge.width / 2, badge.top + badge.height / 2];
    expect(Math.abs(x - button.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(y - button.top)).toBeLessThanOrEqual(1);
  });

  it("offers the check while a check waits after the stop ended", async () => {
    const el = await mountClock(
      clockApi({ clockStop: null, clockCheckWaiting: { since: "2026-10-22T18:00:00.000Z" } }),
    );
    expect(text(openButton(el))).toBe(t("box_status.clock.admin.open"));
  });

  it("shows the box's time and this device's, and asks to confirm when they agree", async () => {
    deviceNow("2026-10-22T18:10:20.000Z");
    const api = clockApi();
    const el = await mountClock(api);
    await open(el);
    expect(api.clockChallenge).toHaveBeenCalledTimes(1);
    expect(dialog(el).open).toBe(true);
    expect(dialog(el).getAttribute("heading")).toBe("Check with this device's time");
    expect(text(q(el, "[data-test=clock-check-times]"))).toBe(
      `The box's clock says ${atSeconds(BOX_AT)}. This device says ${atSeconds("2026-10-22T18:10:20.000Z")}.`,
    );
    expect(text(q(el, "[data-test=clock-check-verdict]"))).toBe(
      "They agree. Confirm that the box's clock is right?",
    );
    expect(buttons(el)).toEqual([
      ["clock-check-cancel", "secondary", "Cancel"],
      ["clock-check-confirm", "primary", "Confirm"],
    ]);
  });

  it("says when the two cannot be shown to agree within a minute and offers only Close", async () => {
    deviceNow("2026-10-22T18:11:01.000Z");
    const el = await mountClock(clockApi());
    await open(el);
    expect(text(q(el, "[data-test=clock-check-verdict]"))).toBe(
      "The box could not show that its clock is within a minute of your device's. Check that your device's time is right; if it is, connect the box to the internet so it can correct its clock.",
    );
    expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
  });

  it("words the dialog in Spanish from the words file", async () => {
    setLocale("es");
    deviceNow("2026-10-22T18:10:20.000Z");
    const el = await mountClock(clockApi());
    expect(text(openButton(el))).toBe(t("box_status.clock.admin.open"));
    await open(el);
    expect(text(q(el, "[data-test=clock-check-times]"))).toBe(
      fill("box_status.clock.admin.times", {
        box: atSeconds(BOX_AT),
        device: atSeconds("2026-10-22T18:10:20.000Z"),
      }),
    );
    expect(text(q(el, "[data-test=clock-check-verdict]"))).toBe(t("box_status.clock.admin.agree"));
  });

  it("confirms with a fresh challenge answered at once with this device's time, then closes and reads again", async () => {
    deviceNow("2026-10-22T18:10:20.000Z");
    const api = clockApi();
    const el = await mountClock(api);
    await open(el);
    const closed = new Promise((resolve) =>
      dialog(el).addEventListener("wt-close", resolve, { once: true }),
    );
    await userEvent.click(q(el, "[data-test=clock-check-confirm]")!);
    await closed;
    await flush(el);
    expect(api.clockChallenge).toHaveBeenCalledTimes(2);
    expect(api.clockConfirm).toHaveBeenCalledExactlyOnceWith({
      challengeId: "ch-2",
      deviceAt: Date.parse("2026-10-22T18:10:20.000Z"),
    });
    expect(dialog(el).open).toBe(false);
    expect(api.liveData.refresh).toHaveBeenCalled();
  });

  it("shows a refused confirmation's sentence above the buttons, keeps Confirm and reads again", async () => {
    deviceNow("2026-10-22T18:10:20.000Z");
    const api = clockApi(
      { clockStop: STOPPED },
      { clockConfirm: vi.fn().mockRejectedValue(REFUSED("contrary_proof")) },
    );
    const el = await mountClock(api);
    await open(el);
    await userEvent.click(q(el, "[data-test=clock-check-confirm]")!);
    await flush(el);
    expect(dialog(el).open).toBe(true);
    expect(footerMessage(el)).toBe(t("box_status.clock.stop.contrary"));
    expect(api.liveData.refresh).toHaveBeenCalled();
    const confirm = q(el, "[data-test=clock-check-confirm]")!;
    expect(confirm.hasAttribute("disabled")).toBe(false);
    expect(confirm.getAttribute("variant")).toBe("primary");
  });

  it("words a differs refusal truthfully when the fresh times are under a minute apart", async () => {
    // The box adds half the round trip to the difference, so it can refuse times 20 s apart.
    deviceNow("2026-10-22T18:10:20.000Z");
    const el = await mountClock(
      clockApi(
        { clockStop: STOPPED },
        { clockConfirm: vi.fn().mockRejectedValue(REFUSED("differs")) },
      ),
    );
    await open(el);
    await userEvent.click(q(el, "[data-test=clock-check-confirm]")!);
    await flush(el);
    expect(text(q(el, "[data-test=clock-check-times]"))).toBe(
      `The box's clock says ${atSeconds(BOX_AT)}. This device says ${atSeconds("2026-10-22T18:10:20.000Z")}.`,
    );
    expect(text(q(el, "[data-test=clock-check-verdict]"))).toBe(
      "The box could not show that its clock is within a minute of your device's. Check that your device's time is right; if it is, connect the box to the internet so it can correct its clock.",
    );
    expect(text(q(el, "[data-test=clock-check-verdict]"))).not.toContain("more than a minute");
  });

  it("shows the fresh reading as differing, with only Close, when the box refuses it as differs", async () => {
    deviceNow("2026-10-22T18:10:20.000Z");
    const FRESH = "2026-10-22T18:08:00.000Z";
    const api = clockApi(
      { clockStop: STOPPED },
      {
        clockChallenge: vi
          .fn()
          .mockResolvedValueOnce({ challengeId: "ch-1", boxAt: BOX_AT })
          .mockResolvedValue({ challengeId: "ch-2", boxAt: FRESH }),
        clockConfirm: vi.fn().mockRejectedValue(REFUSED("differs")),
      },
    );
    const el = await mountClock(api);
    await open(el);
    await userEvent.click(q(el, "[data-test=clock-check-confirm]")!);
    await flush(el);
    expect(dialog(el).open).toBe(true);
    expect(text(q(el, "[data-test=clock-check-times]"))).toBe(
      `The box's clock says ${atSeconds(FRESH)}. This device says ${atSeconds("2026-10-22T18:10:20.000Z")}.`,
    );
    expect(text(q(el, "[data-test=clock-check-verdict]"))).toBe(t("box_status.clock.admin.differ"));
    expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
    expect(footerMessage(el)).toBe("");
    expect(api.liveData.refresh).toHaveBeenCalled();
  });

  it("says there is nothing left to confirm when the box finds no stop and no waiting check, in each language", async () => {
    for (const locale of ["en", "es"]) {
      setLocale(locale);
      deviceNow("2026-10-22T18:10:20.000Z");
      const el = await mountClock(
        clockApi(
          { clockStop: STOPPED },
          { clockConfirm: vi.fn().mockRejectedValue(REFUSED("not_stopped")) },
        ),
      );
      await open(el);
      await userEvent.click(q(el, "[data-test=clock-check-confirm]")!);
      await flush(el);
      expect(footerMessage(el)).toBe(
        locale === "en"
          ? "There is nothing left to confirm. See the Clock row."
          : es["box_status.clock.admin.refused.not_stopped"],
      );
      cleanupWidgets();
    }
  });

  it("stops asking to confirm, and offers only Close, once the box says nothing is left to confirm", async () => {
    deviceNow("2026-10-22T18:10:20.000Z");
    const api = clockApi(
      { clockStop: STOPPED },
      { clockConfirm: vi.fn().mockRejectedValue(REFUSED("not_stopped")) },
    );
    const el = await mountClock(api);
    await open(el);
    await userEvent.click(q(el, "[data-test=clock-check-confirm]")!);
    await flush(el);
    expect(dialog(el).open).toBe(true);
    expect(footerMessage(el)).toBe("There is nothing left to confirm. See the Clock row.");
    expect(q(el, "[data-test=clock-check-verdict]")).toBeNull();
    expect(q(el, "[data-test=clock-check-times]")).toBeNull();
    expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
    expect(api.liveData.refresh).toHaveBeenCalled();
  });

  it.each([
    [20_000, 40_000, true],
    [20_000, 40_001, false],
    [120_000, -60_000, true],
    [120_002, -60_001, false],
  ] as const)(
    "judges a %i ms round trip sent %i ms after the box's time by the difference plus half the trip",
    async (roundTripMs, sentAfterBoxMs, agrees) => {
      let now = Date.parse(BOX_AT) + sentAfterBoxMs;
      const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
      onTestFinished(() => spy.mockRestore());
      const clockChallenge = vi.fn(async () => {
        now += roundTripMs;
        return { challengeId: "ch-1", boxAt: BOX_AT };
      });
      const el = await mountClock(clockApi({ clockStop: STOPPED }, { clockChallenge }));
      await open(el);
      expect(text(q(el, "[data-test=clock-check-verdict]"))).toBe(
        t(agrees ? "box_status.clock.admin.agree" : "box_status.clock.admin.differ"),
      );
    },
  );

  it("words a check that is missing or took too long", async () => {
    deviceNow("2026-10-22T18:10:20.000Z");
    const el = await mountClock(
      clockApi(
        { clockStop: STOPPED },
        {
          clockConfirm: vi.fn().mockRejectedValue({ code: "clock.check_expired", params: {} }),
        },
      ),
    );
    await open(el);
    await userEvent.click(q(el, "[data-test=clock-check-confirm]")!);
    await flush(el);
    expect(footerMessage(el)).toBe("The check took too long. Try again.");
    expect(q(el, "[data-test=clock-check-confirm]")).not.toBeNull();
  });

  it("words any other refusal by its code", async () => {
    deviceNow("2026-10-22T18:10:20.000Z");
    const el = await mountClock(
      clockApi(
        { clockStop: STOPPED },
        { clockConfirm: vi.fn().mockRejectedValue(REFUSED("a_new_reason")) },
      ),
    );
    await open(el);
    await userEvent.click(q(el, "[data-test=clock-check-confirm]")!);
    await flush(el);
    expect(footerMessage(el)).toBe(codeMessage("clock.confirm_refused"));
  });

  it("says at once that the box's own screen cannot confirm its clock", async () => {
    const api = clockApi(
      { clockStop: STOPPED },
      { clockChallenge: vi.fn().mockRejectedValue(REFUSED("same_machine")) },
    );
    const el = await mountClock(api);
    await open(el);
    expect(dialog(el).open).toBe(true);
    expect(footerMessage(el)).toBe(
      "This screen is the box itself, so its clock is the box's own. Confirm from your phone or another computer.",
    );
    expect(q(el, "[data-test=clock-check-times]")).toBeNull();
    expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
    expect(api.liveData.refresh).toHaveBeenCalled();
  });

  it("words the box's own screen in Spanish from the words file", async () => {
    setLocale("es");
    const el = await mountClock(
      clockApi(
        { clockStop: STOPPED },
        { clockChallenge: vi.fn().mockRejectedValue(REFUSED("same_machine")) },
      ),
    );
    await open(el);
    expect(footerMessage(el)).toBe(t("box_status.clock.admin.refused.same_machine"));
  });

  it("closes on Escape", async () => {
    deviceNow("2026-10-22T18:10:20.000Z");
    const el = await mountClock(clockApi());
    await open(el);
    const closed = new Promise((resolve) =>
      dialog(el).addEventListener("wt-close", resolve, { once: true }),
    );
    await userEvent.keyboard("{Escape}");
    await closed;
    await vi.waitFor(() => expect(dialog(el).open).toBe(false));
  });
});

describe("dashboard-box-status-screen's sales dated wrongly", () => {
  const OPEN: MisdatedOpenView = {
    incidentId: "i1",
    confirmationId: "c1",
    count: 2,
    from: "2026-10-22T19:00:00.000Z",
    fromOffsetMinutes: 120,
    to: "2026-10-22T19:05:00.000Z",
    toOffsetMinutes: 120,
    partial: false,
    unconfirmed: false,
  };
  const UNCONFIRMED: MisdatedOpenView = {
    incidentId: "i2",
    confirmationId: "c2",
    count: 0,
    from: "2026-10-22T17:00:00.000Z",
    fromOffsetMinutes: 120,
    partial: false,
    unconfirmed: true,
  };
  const LISTS: ClockMisdatedView = {
    lists: [
      {
        confirmationId: "c1",
        records: [
          { recordId: "r1", series: "T1", number: 7, at: OPEN.from, offsetMinutes: 120 },
          { recordId: "r2", series: "T1", number: 8, at: OPEN.to!, offsetMinutes: 120 },
        ],
      },
    ],
  };
  const MISDATED = ALERT_MESSAGES["clock.records_misdated"]!;

  const section = (el: BoxStatusScreen) => q(el, "[data-test=misdated]");
  const tableRows = (el: BoxStatusScreen) => [
    ...(q(el, "[data-test=misdated-table]")?.shadowRoot?.querySelectorAll("tbody tr") ?? []),
  ];
  const cells = (el: BoxStatusScreen) =>
    tableRows(el).map((row) => [...row.querySelectorAll("td")].map((cell) => text(cell)));
  const headings = (el: BoxStatusScreen) => [
    ...q(el, "[data-test=misdated-table]")!.shadowRoot!.querySelectorAll("thead th"),
  ];

  function withOpen(open: MisdatedOpenView[], lists: unknown = LISTS) {
    return stubApi(
      {
        clockMisdated:
          lists instanceof Error
            ? vi.fn().mockRejectedValue(lists)
            : vi.fn().mockResolvedValue(lists),
      },
      { ...health(), misdatedOpen: open },
    );
  }

  it("lists each sale's invoice and the time it was recorded, under the title and what to do", async () => {
    const { el } = await mount(withOpen([OPEN]));
    expect(text(q(el, "[data-test=misdated] h2"))).toBe(t("box_status.misdated.title"));
    expect(text(q(el, "[data-test=misdated-line]"))).toBe(t("box_status.misdated.line"));
    expect(headings(el).map((th) => text(th))).toEqual([
      t("box_status.misdated.col_invoice"),
      t("box_status.misdated.col_at"),
    ]);
    expect(cells(el)).toEqual([
      ["T1/7", formatIsoMinute(OPEN.from)],
      ["T1/8", formatIsoMinute(OPEN.to!)],
    ]);
    expect(q(el, "[data-test=misdated-sentence]")).toBeNull();
    expect(qa(el, "ul.rows > li")).toHaveLength(7);
  });

  it("draws its words in Spanish from the strings tables", async () => {
    setLocale("es");
    const { el } = await mount(withOpen([{ ...OPEN, partial: true }]));
    expect(text(q(el, "[data-test=misdated] h2"))).toBe(t("box_status.misdated.title"));
    expect(text(q(el, "[data-test=misdated-line]"))).toBe(t("box_status.misdated.line"));
    expect(headings(el).map((th) => text(th))).toEqual([
      t("box_status.misdated.col_invoice"),
      t("box_status.misdated.col_at"),
    ]);
    expect(text(q(el, "[data-test=misdated-sentence]"))).toBe(MISDATED.variants!.partial!.es);
  });

  it.each(["en", "es"])("names the bell's own button word in what to do, in %s", (locale) => {
    setLocale(locale);
    const button = t("alerts.mark_handled").split(" ").at(-1)!.toLocaleLowerCase(locale);
    expect(t("box_status.misdated.line").toLocaleLowerCase(locale)).toContain(button);
  });

  it("says a list may be short when the box restarted during the stop", async () => {
    const { el } = await mount(withOpen([{ ...OPEN, partial: true }]));
    expect(text(q(el, "[data-test=misdated-sentence]"))).toBe(MISDATED.variants!.partial!.en);
    expect(cells(el)).toHaveLength(2);
  });

  it("says the box cannot tell, with no table and no count, and reads no list for it", async () => {
    const api = withOpen([UNCONFIRMED]);
    const { el } = await mount(api);
    const sentence = alertMessage("clock.records_misdated", { ...UNCONFIRMED });
    expect(sentence).toBe(
      MISDATED.variants!.unconfirmed!.en.replace(
        "{from:minute}",
        formatIsoMinute(UNCONFIRMED.from),
      ),
    );
    expect(text(q(el, "[data-test=misdated-sentence]"))).toBe(sentence);
    expect(q(el, "[data-test=misdated-table]")).toBeNull();
    expect(text(section(el))).toBe(
      [t("box_status.misdated.title"), t("box_status.misdated.line"), sentence].join(" "),
    );
    expect(api.clockMisdated).not.toHaveBeenCalled();
  });

  it("labels each table by its times when two are drawn, and by the title when one is", async () => {
    const SECOND = {
      ...OPEN,
      incidentId: "i3",
      confirmationId: "c3",
      from: "2026-10-22T20:00:00.000Z",
      to: "2026-10-22T20:10:00.000Z",
    };
    const lists: ClockMisdatedView = {
      lists: [
        ...LISTS.lists,
        {
          confirmationId: "c3",
          records: [
            { recordId: "r3", series: "T1", number: 9, at: SECOND.from, offsetMinutes: 120 },
          ],
        },
      ],
    };
    const labels = (el: BoxStatusScreen) =>
      qa(el, "[data-test=misdated-table]").map((table) => table.getAttribute("aria-label"));
    const one = await mount(withOpen([OPEN], lists));
    expect(labels(one.el)).toEqual(["Sales dated wrongly"]);
    cleanupWidgets();
    const two = await mount(withOpen([OPEN, SECOND], lists));
    const range = (open: MisdatedOpenView) => [
      formatIsoMinute(open.from),
      formatIsoMinute(open.to!),
    ];
    expect(labels(two.el)).toEqual(
      [OPEN, SECOND].map((open) => {
        const [from, to] = range(open);
        return `Sales dated wrongly from ${from} to ${to}`;
      }),
    );
    cleanupWidgets();
    setLocale("es");
    const spanish = await mount(withOpen([OPEN, SECOND], lists));
    const [from, to] = range(OPEN);
    expect(labels(spanish.el)[0]).toBe(
      es["box_status.misdated.table_range"].replace("{from}", from!).replace("{to}", to!),
    );
  });

  it("draws a table for a found list beside a sentence for one that cannot tell", async () => {
    const { el } = await mount(withOpen([UNCONFIRMED, OPEN]));
    expect(qa(el, "[data-test=misdated-entry]")).toHaveLength(2);
    expect(qa(el, "[data-test=misdated-table]")).toHaveLength(1);
    expect(cells(el)).toHaveLength(2);
  });

  it("shows a sale with no whole number by its series alone", async () => {
    const lists: ClockMisdatedView = {
      lists: [
        {
          confirmationId: "c1",
          records: [
            { recordId: "r9", series: "ODD", number: null, at: OPEN.from, offsetMinutes: 120 },
          ],
        },
      ],
    };
    const { el } = await mount(withOpen([{ ...OPEN, count: 1 }], lists));
    expect(cells(el)).toEqual([["ODD", formatIsoMinute(OPEN.from)]]);
  });

  it("draws nothing once the alert is handled", async () => {
    const api = stubApi({
      getBoxHealth: vi
        .fn()
        .mockResolvedValueOnce({ ...health(), misdatedOpen: [OPEN] })
        .mockResolvedValue(health()),
      clockMisdated: vi.fn().mockResolvedValue(LISTS),
    });
    const { el } = await mount(api);
    expect(section(el)).not.toBeNull();
    api.liveData.refresh();
    await flush(el);
    expect(section(el)).toBeNull();
    expect(qa(el, "ul.rows > li")).toHaveLength(7);
  });

  it("draws nothing when no alert is open, and reads no list", async () => {
    const api = withOpen([]);
    const { el } = await mount(api);
    expect(section(el)).toBeNull();
    expect(api.clockMisdated).not.toHaveBeenCalled();
  });

  it("says the list could not be read, and still draws the rest of the page", async () => {
    const { el } = await mount(withOpen([OPEN, UNCONFIRMED], new Error("down")));
    expect(text(q(el, "[data-test=misdated-unavailable]"))).toBe(
      t("box_status.misdated.read_error"),
    );
    expect(q(el, "[data-test=misdated-table]")).toBeNull();
    expect(text(q(el, "[data-test=misdated] h2"))).toBe(t("box_status.misdated.title"));
    expect(qa(el, "[data-test=misdated-sentence]")).toHaveLength(1);
    expect(qa(el, "[data-test=misdated-entry]")).toHaveLength(1);
    expect(qa(el, "ul.rows > li")).toHaveLength(7);
    expect(q(el, "[role=alert]")).toBeNull();
  });

  it("reads a list a later refresh brings through the background client", async () => {
    const background = {
      getBoxHealth: vi.fn().mockResolvedValue({ ...health(), misdatedOpen: [OPEN] }),
      listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [] }),
      clockMisdated: vi.fn().mockResolvedValue(LISTS),
    };
    const api = stubApi({ background, clockMisdated: vi.fn().mockResolvedValue(LISTS) });
    const { el } = await mount(api);
    expect(section(el)).toBeNull();
    api.liveData.refresh();
    await flush(el);
    expect(cells(el)).toHaveLength(2);
    expect(background.clockMisdated).toHaveBeenCalledTimes(1);
    expect(api.clockMisdated).not.toHaveBeenCalled();
  });

  it("leaves the bell's full sentence to the Clock row, not the section", async () => {
    const sentence = alertMessage("clock.records_misdated", { ...OPEN });
    const api = stubApi(
      { clockMisdated: vi.fn().mockResolvedValue(LISTS) },
      { ...health(), misdatedOpen: [OPEN] },
      [alert("clock.records_misdated", "box", { kind: "event", params: { ...OPEN } })],
    );
    const { el } = await mount(api);
    expect(text(q(el, "[data-test=row-clock] .words"))).toContain(sentence);
    expect(text(section(el))).not.toContain(sentence);
    expect(cells(el)).toHaveLength(2);
  });

  it("draws no empty block for an entry whose list is gone from a loaded answer", async () => {
    const { el } = await mount(withOpen([OPEN, UNCONFIRMED], { lists: [] }));
    expect(qa(el, "[data-test=misdated-entry]")).toHaveLength(1);
    expect(q(el, "[data-test=misdated-sentence]")).not.toBeNull();
  });

  it("reads a list the first health answer brings through the foreground client", async () => {
    const background = {
      getBoxHealth: vi.fn().mockResolvedValue({ ...health(), misdatedOpen: [OPEN] }),
      listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [] }),
      clockMisdated: vi.fn().mockResolvedValue(LISTS),
    };
    const api = stubApi(
      { background, clockMisdated: vi.fn().mockResolvedValue(LISTS) },
      { ...health(), misdatedOpen: [OPEN] },
    );
    const { el } = await mount(api);
    expect(cells(el)).toHaveLength(2);
    expect(api.clockMisdated).toHaveBeenCalledTimes(1);
    expect(background.clockMisdated).not.toHaveBeenCalled();
  });

  it("reads a list in the background when it comes after a failed first health read", async () => {
    const background = {
      getBoxHealth: vi.fn().mockResolvedValue({ ...health(), misdatedOpen: [OPEN] }),
      listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [] }),
      clockMisdated: vi.fn().mockResolvedValue(LISTS),
    };
    const api = stubApi({
      background,
      getBoxHealth: vi.fn().mockRejectedValue({ code: "server.internal" }),
      clockMisdated: vi.fn().mockResolvedValue(LISTS),
    });
    const { el } = await mount(api);
    expect(text(q(el, "[role=alert]"))).toBe(t("box_status.read_error"));
    api.liveData.refresh();
    await flush(el);
    expect(cells(el)).toHaveLength(2);
    expect(background.clockMisdated).toHaveBeenCalledTimes(1);
    expect(api.clockMisdated).not.toHaveBeenCalled();
  });

  it("draws no section when no entry has anything left to show", async () => {
    const { el } = await mount(withOpen([OPEN], { lists: [] }));
    expect(section(el)).toBeNull();
    expect(qa(el, "ul.rows > li")).toHaveLength(7);
  });

  it("still says a failed list read when the only entry is plain", async () => {
    const { el } = await mount(withOpen([OPEN], new Error("down")));
    expect(text(q(el, "[data-test=misdated-unavailable]"))).toBe(
      t("box_status.misdated.read_error"),
    );
    expect(q(el, "[data-test=misdated-entry]")).toBeNull();
  });
});
