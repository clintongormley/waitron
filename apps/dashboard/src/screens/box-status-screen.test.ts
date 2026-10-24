import { page, userEvent } from "vitest/browser";
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

  it("draws no restart button, whatever the proof", async () => {
    for (const proof of ["none", "contrary", "ready", "confirmed"] as const) {
      const { el } = await mount(stubApi({}, { ...health(), clockStop: { ...STOP, proof } }));
      expect(qa(el, "[data-test=row-clock] wt-button").map(text)).toEqual([]);
      expect(q(el, "wt-dialog")).toBeNull();
      cleanupWidgets();
    }
  });
});

describe("dashboard-box-status-screen's sales dated wrongly", () => {
  const OPEN: MisdatedOpenView = {
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
});
