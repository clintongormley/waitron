import { userEvent } from "vitest/browser";
import { setHelpMode } from "@waitron/ui";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { LiveData, formatBytes } from "@waitron/dashboard-kit";
import type {
  AlertView,
  AlertsResponse,
  BoxHealth,
  DashboardApi,
  FreedSpaceView,
} from "../api/client.js";
import { formatIsoMinute } from "../date-utils.js";
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
const OTHER_ALERT = alert("payment.refund_unresolved", "payments", { kind: "event" });

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
    getBoxNetwork: vi.fn().mockRejectedValue({ code: "box_host.unavailable" }),
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
  it("shows the spare copy limit and receives freshness through the passive page refresh", async () => {
    const spare = {
      peerNodeId: "spare",
      generation: "gen-1-main-20261114T120000Z",
      state: "rebuilding" as const,
      appliedTXID: null,
      uploadedTXID: null,
      lagMs: null,
      lastAppliedAt: null,
      clockAt: null,
    };
    const api = stubApi({
      getBoxHealth: vi
        .fn()
        .mockResolvedValueOnce(health({ spare, stream: { state: "off", toSpare: true } }))
        .mockResolvedValue(
          health({
            stream: { state: "off", toSpare: true },
            spare: {
              ...spare,
              state: "following",
              appliedTXID: "0000000000000002",
              uploadedTXID: "0000000000000002",
              lagMs: 0,
              lastAppliedAt: "2026-11-14T12:00:00.000Z",
            },
          }),
        ),
    });
    const { el } = await mount(api);
    expect(q(el, "[data-test=row-bucket]")).toBeNull();
    expect(text(q(el, "[data-test=row-spare]"))).toContain("Rebuilding the copy");
    expect(text(q(el, "[data-test=row-spare]"))).toContain(
      "Switching still uses the copy taken when this spare joined.",
    );
    api.liveData.refresh();
    await flush(el);
    expect(text(q(el, "[data-test=row-spare]"))).toContain("Up to date");
  });

  it.each(["en", "es"] as const)(
    "explains exhausted cleanup without sending someone else to fix it (%s)",
    async (locale) => {
      setLocale(locale);
      const api = stubApi(
        {},
        health({}, { freeBytes: 0, reclaimable: { bytes: 0, backupRunning: false } }),
      );
      const { el } = await mount(api);
      expect(text(freeButton(el))).toBe(t("box_status.free_nothing"));
      expect(freeButton(el)!.hasAttribute("disabled")).toBe(true);
      const guidance = text(q(el, "[data-test=fillers]"));
      expect(guidance).toContain(t("backup.title"));
      if (locale === "en") {
        expect(guidance).toContain(
          "only after a new backup succeeds, or before a backup that is short of room",
        );
        expect(guidance).toContain("cannot free a full disk now");
        expect(guidance).toContain("Leave without changes to stop");
        expect(guidance).toContain("database, recovery keys and saved backups");
        expect(guidance).not.toMatch(/installer|installed|support/i);
      } else {
        expect(guidance).toBe(es["box_status.fillers"]);
        expect(guidance).toContain("solo se borran después de guardar una nueva");
        expect(guidance).toContain("o antes de una copia si falta sitio");
        expect(guidance).toContain("no libera espacio de inmediato en un disco lleno");
        expect(guidance).toContain("Sal sin hacer cambios para parar");
        expect(guidance).toContain(
          "Conserva la base de datos, las claves de recuperación y las copias guardadas",
        );
        expect(guidance).not.toMatch(/instal|soporte|encargad|gerente|responsable/i);
      }
      cleanupWidgets();
      expect(api.freeBoxSpace).not.toHaveBeenCalled();
    },
  );

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

  it("never breaks the Updated line's time across two lines", async () => {
    const { el } = await mount(stubApi());
    const legend = q(el, "[data-test=legend]") as HTMLElement;
    const broken: string[] = [];
    let checked = 0;
    for (let width = 260; width >= 40; width -= 1) {
      legend.style.width = `${width}px`;
      const found = timesAcrossLines([legend]);
      checked += found.checked;
      broken.push(...found.broken.map((time) => `${width}px: ${time}`));
    }
    expect(checked).toBe(221);
    expect(broken).toEqual([]);
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

describe("dashboard-box-status-screen's check of the box's clock with this device", () => {
  const BOX_AT = "2026-10-22T18:10:00.000Z";
  const CLOCK_UNUSABLE = {
    key: "clock.unusable",
    code: "clock.unusable",
    severity: "error" as const,
    params: { clockAt: "2023-01-01T00:00:00.000Z", offsetMinutes: 60 },
    owner: "fiscal-verifactu",
  };
  const REFUSED = (reason: string) => ({ code: "clock.set_refused", params: { reason } });
  const atSeconds = (iso: string) => `${formatIsoMinute(iso)}:${iso.slice(17, 19)}`;

  function deviceNow(iso: string): void {
    const spy = vi.spyOn(Date, "now").mockReturnValue(Date.parse(iso));
    onTestFinished(() => spy.mockRestore());
  }

  function clockApi(
    answer: Partial<BoxHealth> = { notices: [CLOCK_UNUSABLE] },
    overrides: Partial<Record<keyof DashboardApi, unknown>> = {},
  ): DashboardApi {
    const api = stubApi(
      {
        clockChallenge: vi
          .fn()
          .mockResolvedValueOnce({ challengeId: "ch-1", boxAt: BOX_AT })
          .mockResolvedValue({ challengeId: "ch-2", boxAt: BOX_AT }),
        ...overrides,
      },
      { ...health(), ...answer },
    );
    vi.spyOn(api.liveData, "refresh");
    return api;
  }

  async function mountClock(api: DashboardApi, canCheckClock = true) {
    const mounted = await mountWidget<BoxStatusScreen>("dashboard-box-status-screen", {
      api,
      canCheckClock,
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

  it("offers the check only to an administrator, and only while the clock reads before 28-10-2024", async () => {
    expect(openButton(await mountClock(clockApi(), false))).toBeNull();
    cleanupWidgets();
    expect(openButton(await mountClock(clockApi({ notices: [] })))).toBeNull();
    cleanupWidgets();
    const el = await mountClock(clockApi());
    expect(text(openButton(el))).toBe("Check with this device's time");
    expect(openButton(el)!.getAttribute("variant")).toBe("secondary");
    expect(dialog(el).open).toBe(false);
  });

  it("offers a manager an administrator sign-in in place of the check", async () => {
    const signIn = (el: BoxStatusScreen) =>
      q(el, "[data-test=row-clock] [data-test=clock-admin-sign-in]") as HTMLElement | null;
    expect(signIn(await mountClock(clockApi({ notices: [] }), false))).toBeNull();
    cleanupWidgets();
    const admin = await mountClock(clockApi());
    expect(signIn(admin)).toBeNull();
    expect(q(admin, "[data-test=row-clock] [data-test=clock-admin-hint]")).toBeNull();
    cleanupWidgets();
    const el = await mountClock(clockApi(), false);
    expect(openButton(el)).toBeNull();
    expect(text(signIn(el))).toBe(t("staff.sign_in_as_admin"));
    expect(text(q(el, "[data-test=row-clock] [data-test=clock-admin-hint]"))).toBe(
      "Only an administrator can confirm or correct the box's date and time. Signing in as one signs you out here first.",
    );
    const asked = vi.fn();
    document.body.addEventListener("admin-sign-in", asked);
    try {
      await userEvent.click(signIn(el)!);
    } finally {
      document.body.removeEventListener("admin-sign-in", asked);
    }
    expect(asked).toHaveBeenCalledOnce();
  });

  it("explains the check in a help-mode tooltip beside its button", async () => {
    const el = await mountClock(clockApi());
    const tooltip = q(el, "[data-test=row-clock] .clock-check-action wt-help-tooltip")!;
    expect(tooltip.getAttribute("mode")).toBe("help-mode");
    expect(tooltip.getAttribute("aria-label")).toBe("What this check does");
    expect(tooltip.getAttribute("aria-label")).toBe(t("box_status.clock_check_help_label"));
    expect(text(tooltip)).toBe(
      "Compares the box's clock with this device's. While payments wait for the box's time, a match within a minute confirms it and payments start again; otherwise, if the box can set its own clock, you can set it from this device. Check that this device shows the right time first. It does not work on the box's own screen.",
    );
    expect(tooltip.getAttribute("guide-label")).toBe(t("box_status.clock_check_help_guide"));
  });

  it.each([
    ["en", "/help/en/box-status#clock-own-device"],
    ["es", "/help/es/box-status#clock-own-device"],
  ])("the check's help tooltip links to the guide's clock section in %s", async (locale, href) => {
    setLocale(locale);
    const el = await mountClock(clockApi());
    const tooltip = q(el, "[data-test=row-clock] .clock-check-action wt-help-tooltip")!;
    expect(tooltip.getAttribute("guide-href")).toBe(href);
    expect(tooltip.getAttribute("guide-href")).toBe(guideHref("box-status.clock-own-device"));
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

  it("shows the box's time and this device's, and offers only Close when they agree", async () => {
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
    expect(q(el, "[data-test=clock-check-verdict]")).toBeNull();
    expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
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
    expect(q(el, "[data-test=clock-check-verdict]")).toBeNull();
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
      const el = await mountClock(clockApi({ notices: [CLOCK_UNUSABLE] }, { clockChallenge }));
      await open(el);
      const verdict = q(el, "[data-test=clock-check-verdict]");
      if (agrees) expect(verdict).toBeNull();
      else expect(text(verdict)).toBe(t("box_status.clock.admin.differ"));
    },
  );

  it("says at once that the box's own screen cannot check its clock", async () => {
    const api = clockApi(
      { notices: [CLOCK_UNUSABLE] },
      { clockChallenge: vi.fn().mockRejectedValue(REFUSED("same_machine")) },
    );
    const el = await mountClock(api);
    await open(el);
    expect(dialog(el).open).toBe(true);
    expect(footerMessage(el)).toBe(
      "This screen is the box itself, so its clock is the box's own. Use your phone or another computer.",
    );
    expect(q(el, "[data-test=clock-check-times]")).toBeNull();
    expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
    expect(api.liveData.refresh).toHaveBeenCalled();
  });

  it("words the box's own screen in Spanish from the words file", async () => {
    setLocale("es");
    const el = await mountClock(
      clockApi(
        { notices: [CLOCK_UNUSABLE] },
        { clockChallenge: vi.fn().mockRejectedValue(REFUSED("same_machine")) },
      ),
    );
    await open(el);
    expect(footerMessage(el)).toBe(t("box_status.clock.admin.set.refused.same_machine"));
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

  describe("when the box can set its own clock", () => {
    const SETTABLE: BoxHealth["clock"] = {
      ...health().clock,
      sync: { synced: false, source: "timedatectl", warn: true },
    };
    const DEVICE_AT = "2026-10-22T19:30:05.000Z";
    const SET_REFUSED = (reason: string) => ({ code: "clock.set_refused", params: { reason } });
    const QUESTION = `The box's clock says ${atSeconds(BOX_AT)}. Your device says ${atSeconds(DEVICE_AT)}. Use your device's time?`;
    const UNUSABLE = {
      key: "clock.unusable",
      code: "clock.unusable",
      severity: "error" as const,
      params: { clockAt: "2023-01-01T00:00:00.000Z", offsetMinutes: 60 },
      owner: "fiscal-verifactu",
    };

    function setApi(
      answer: Partial<BoxHealth> = { notices: [UNUSABLE], clock: SETTABLE },
      overrides: Partial<Record<keyof DashboardApi, unknown>> = {},
    ): DashboardApi {
      return clockApi(answer, {
        clockSet: vi.fn().mockResolvedValue({
          confirmationId: "c-2",
          stepMs: 600_000,
          confirmedAt: DEVICE_AT,
        }),
        ...overrides,
      });
    }

    async function useThisTime(el: BoxStatusScreen): Promise<void> {
      await userEvent.click(q(el, "[data-test=clock-set-confirm]")!);
      await flush(el);
    }

    it("asks to use this device's time when the box can set its clock and the times differ", async () => {
      deviceNow(DEVICE_AT);
      const el = await mountClock(setApi());
      await open(el);
      expect(text(q(el, "[data-test=clock-set-question]"))).toBe(QUESTION);
      expect(q(el, "[data-test=clock-check-verdict]")).toBeNull();
      expect(buttons(el)).toEqual([
        ["clock-check-cancel", "secondary", "Cancel"],
        ["clock-set-confirm", "primary", "Use this time"],
      ]);
    });

    it("offers only Close when the box can set its clock and the times agree", async () => {
      deviceNow("2026-10-22T18:10:20.000Z");
      const el = await mountClock(setApi());
      await open(el);
      expect(q(el, "[data-test=clock-set-question]")).toBeNull();
      expect(q(el, "[data-test=clock-check-verdict]")).toBeNull();
      expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
    });

    it.each([
      [
        "has no time service the box can set",
        { synced: false, source: "unavailable", warn: false },
      ],
      ["is kept in time over the internet", { synced: true, source: "timedatectl", warn: false }],
    ] as const)(
      "shows today's differing sentence and Close only when the box %s",
      async (_, sync) => {
        deviceNow(DEVICE_AT);
        const el = await mountClock(
          setApi({ notices: [UNUSABLE], clock: { ...SETTABLE, sync: { ...sync } } }),
        );
        await open(el);
        expect(q(el, "[data-test=clock-set-question]")).toBeNull();
        expect(text(q(el, "[data-test=clock-check-verdict]"))).toBe(
          t("box_status.clock.admin.differ"),
        );
        expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
      },
    );

    it("offers the check, and this device's time, while the box's clock reads before 28-10-2024", async () => {
      deviceNow(DEVICE_AT);
      const el = await mountClock(setApi({ notices: [UNUSABLE], clock: SETTABLE }));
      expect(text(openButton(el))).toBe(t("box_status.clock.admin.open"));
      await open(el);
      expect(text(q(el, "[data-test=clock-set-question]"))).toBe(QUESTION);
    });

    it("sets the clock with a fresh challenge answered at once with this device's time, says so and reads again", async () => {
      deviceNow(DEVICE_AT);
      const api = setApi();
      const el = await mountClock(api);
      await open(el);
      await useThisTime(el);
      expect(api.clockChallenge).toHaveBeenCalledTimes(2);
      expect(api.clockSet).toHaveBeenCalledExactlyOnceWith({
        challengeId: "ch-2",
        deviceAt: Date.parse(DEVICE_AT),
      });
      expect(dialog(el).open).toBe(true);
      expect(text(q(el, "[data-test=clock-set-done]"))).toBe("The box's clock is set.");
      expect(q(el, "[data-test=clock-set-question]")).toBeNull();
      expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
      expect(api.liveData.refresh).toHaveBeenCalled();
    });

    it.each([
      [30 * 60_000, false],
      [-(30 * 60_000), false],
      [30 * 60_000 + 1, true],
      [-(30 * 60_000 + 1), true],
    ])(
      "after a step of %i ms asks to sign in again only past the 30-minute idle limit",
      async (stepMs, signInAgain) => {
        deviceNow(DEVICE_AT);
        const api = setApi(undefined, {
          clockSet: vi
            .fn()
            .mockResolvedValue({ confirmationId: "c-2", stepMs, confirmedAt: DEVICE_AT }),
        });
        const el = await mountClock(api);
        await open(el);
        await useThisTime(el);
        expect(text(q(el, "[data-test=clock-set-done]"))).toBe(
          signInAgain
            ? "The box's clock is set. Sign in again to go on."
            : "The box's clock is set.",
        );
      },
    );

    it("reads again at once after a step that signs this session out", async () => {
      deviceNow(DEVICE_AT);
      const api = setApi(undefined, {
        clockSet: vi
          .fn()
          .mockResolvedValue({ confirmationId: "c-2", stepMs: 86_400_000, confirmedAt: DEVICE_AT }),
      });
      const el = await mountClock(api);
      await open(el);
      vi.mocked(api.liveData.refresh).mockClear();
      await useThisTime(el);
      expect(api.liveData.refresh).toHaveBeenCalledOnce();
    });

    const REFUSAL_WORDS = [
      [
        "synchronised",
        "box_status.clock.admin.set.refused.synchronised",
        "The box keeps its clock in time over the internet and says it is right, so it does not take a time from a device. If your device's time is right, check the box's internet connection.",
        false,
      ],
      [
        "stale",
        "box_status.clock.admin.set.refused.stale",
        "The box's clock changed while this was being checked. Close this and check again.",
        true,
      ],
      [
        "host_unavailable",
        "box_status.clock.admin.set.refused.host_unavailable",
        "This box cannot set its own clock: the part of the box that does that is not answering. If the box can reach the internet, its time service may still put the clock right by itself. Close this and check again in a few minutes.",
        false,
      ],
      [
        "target_invalid",
        "box_status.clock.admin.set.refused.target_invalid",
        "Your device's date is not one the box can take. Check your device's date and time.",
        false,
      ],
      [
        "pending_step",
        "box_status.clock.admin.set.refused.pending_step",
        "The box has not finished saving its last clock change. Try again in a minute.",
        false,
      ],
      [
        "same_machine",
        "box_status.clock.admin.set.refused.same_machine",
        "This screen is the box itself, so its clock is the box's own. Use your phone or another computer.",
        true,
      ],
      [
        "not_stopped",
        "box_status.clock.admin.set.refused.not_stopped",
        "The box's clock no longer needs setting. See the Clock row.",
        true,
      ],
    ] as const;

    it.each(REFUSAL_WORDS)(
      "words a set refused as %s above the buttons and reads again",
      async (reason, _key, words, onlyClose) => {
        deviceNow(DEVICE_AT);
        const api = setApi(undefined, { clockSet: vi.fn().mockRejectedValue(SET_REFUSED(reason)) });
        const el = await mountClock(api);
        await open(el);
        await useThisTime(el);
        expect(dialog(el).open).toBe(true);
        expect(footerMessage(el)).toBe(words);
        expect(api.liveData.refresh).toHaveBeenCalled();
        expect(buttons(el)).toEqual(
          onlyClose
            ? [["clock-check-close", "secondary", "Close"]]
            : [
                ["clock-check-cancel", "secondary", "Cancel"],
                ["clock-set-confirm", "primary", "Use this time"],
              ],
        );
      },
    );

    it.each(REFUSAL_WORDS)("words a set refused as %s in Spanish", async (reason, key) => {
      setLocale("es");
      deviceNow(DEVICE_AT);
      const el = await mountClock(
        setApi(undefined, { clockSet: vi.fn().mockRejectedValue(SET_REFUSED(reason)) }),
      );
      await open(el);
      await useThisTime(el);
      expect(footerMessage(el)).toBe(es[key]);
    });

    it.each([
      [
        "refused",
        "box_status.clock.admin.set.failed.refused",
        "The box could not set its clock. Close this and check again.",
      ],
      [
        "unverified",
        "box_status.clock.admin.set.failed.unverified",
        "The box moved its clock but could not confirm it landed on your device's time. Close this and check again.",
      ],
    ] as const)("words a set that failed as %s, in each language", async (reason, key, words) => {
      for (const locale of ["en", "es"]) {
        setLocale(locale);
        deviceNow(DEVICE_AT);
        const api = setApi(undefined, {
          clockSet: vi.fn().mockRejectedValue({ code: "clock.set_failed", params: { reason } }),
        });
        const el = await mountClock(api);
        await open(el);
        await useThisTime(el);
        expect(footerMessage(el)).toBe(locale === "en" ? words : es[key]);
        expect(buttons(el)).toEqual([["clock-check-close", "secondary", t("action.close")]]);
        expect(api.liveData.refresh).toHaveBeenCalled();
        cleanupWidgets();
      }
    });

    it.each([["same_machine", "box_status.clock.admin.set.refused.same_machine"]] as const)(
      "words a challenge refused as %s during a set as a refused set, leaving Close",
      async (reason, key) => {
        deviceNow(DEVICE_AT);
        const api = setApi(undefined, {
          clockChallenge: vi
            .fn()
            .mockResolvedValueOnce({ challengeId: "ch-1", boxAt: BOX_AT })
            .mockRejectedValue(REFUSED(reason)),
        });
        const el = await mountClock(api);
        await open(el);
        await useThisTime(el);
        expect(api.clockSet).not.toHaveBeenCalled();
        expect(footerMessage(el)).toBe(t(key));
        expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
      },
    );

    it("names the tax agency Hacienda in every Spanish clock sentence", () => {
      const clockKeys = Object.keys(es).filter((key) => key.startsWith("box_status.clock"));
      expect(clockKeys.length).toBeGreaterThan(0);
      for (const key of clockKeys)
        expect(es[key as keyof typeof es], key).not.toContain("Agencia Tributaria");
    });

    it("words the question and its button in Spanish from the words file", async () => {
      setLocale("es");
      deviceNow(DEVICE_AT);
      const el = await mountClock(
        setApi(undefined, { clockSet: vi.fn().mockRejectedValue(SET_REFUSED("synchronised")) }),
      );
      await open(el);
      expect(text(q(el, "[data-test=clock-set-question]"))).toBe(
        fill("box_status.clock.admin.set.question", {
          box: atSeconds(BOX_AT),
          device: atSeconds(DEVICE_AT),
        }),
      );
      expect(text(q(el, "[data-test=clock-set-confirm]"))).toBe(
        es["box_status.clock.admin.set.confirm"],
      );
    });

    it("shows the times with only Close when the box finds the fresh times agree", async () => {
      deviceNow(DEVICE_AT);
      const api = setApi(undefined, { clockSet: vi.fn().mockRejectedValue(SET_REFUSED("agrees")) });
      const el = await mountClock(api);
      await open(el);
      vi.mocked(api.liveData.refresh).mockClear();
      await useThisTime(el);
      expect(api.liveData.refresh).toHaveBeenCalled();
      expect(footerMessage(el)).toBe("");
      expect(q(el, "[data-test=clock-check-verdict]")).toBeNull();
      expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
    });

    it("stops offering this device's time once the box says nothing is left to set", async () => {
      deviceNow(DEVICE_AT);
      const el = await mountClock(
        setApi(undefined, { clockSet: vi.fn().mockRejectedValue(SET_REFUSED("not_stopped")) }),
      );
      await open(el);
      await useThisTime(el);
      expect(q(el, "[data-test=clock-set-question]")).toBeNull();
      expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
    });

    it("words any other refusal by its code", async () => {
      deviceNow(DEVICE_AT);
      const el = await mountClock(
        setApi(undefined, { clockSet: vi.fn().mockRejectedValue(SET_REFUSED("a_new_reason")) }),
      );
      await open(el);
      await useThisTime(el);
      expect(footerMessage(el)).toBe("The box's clock was not set. See the Clock row.");
      expect(footerMessage(el)).toBe(codeMessage("clock.set_refused"));
      expect(q(el, "[data-test=clock-set-confirm]")).not.toBeNull();
    });

    it("sends one set per press and holds both buttons while it is sent", async () => {
      deviceNow(DEVICE_AT);
      const pending = deferred<unknown>();
      const api = setApi(undefined, { clockSet: vi.fn(() => pending.promise) });
      const el = await mountClock(api);
      await open(el);
      await userEvent.click(q(el, "[data-test=clock-set-confirm]")!);
      await flush(el);
      const confirm = q(el, "[data-test=clock-set-confirm]")!;
      expect(confirm.hasAttribute("disabled")).toBe(true);
      expect(confirm.hasAttribute("loading")).toBe(true);
      expect(q(el, "[data-test=clock-check-cancel]")!.hasAttribute("disabled")).toBe(true);
      (confirm as HTMLElement).click();
      await flush(el);
      expect(api.clockSet).toHaveBeenCalledTimes(1);
      pending.resolve({ confirmationId: "c-2", stepMs: 1_000, confirmedAt: DEVICE_AT });
      await flush(el);
      expect(text(q(el, "[data-test=clock-set-done]"))).toBe("The box's clock is set.");
    });

    it("asks afresh, not 'set', when the check is opened again after a set", async () => {
      deviceNow(DEVICE_AT);
      const el = await mountClock(setApi());
      await open(el);
      await useThisTime(el);
      await userEvent.click(q(el, "[data-test=clock-check-close]")!);
      await flush(el);
      await open(el);
      expect(q(el, "[data-test=clock-set-done]")).toBeNull();
      expect(text(q(el, "[data-test=clock-set-question]"))).toBe(QUESTION);
    });
  });

  describe("while the start waits for its time", () => {
    const WAITING_CLOCK: BoxHealth["clock"] = {
      ...health().clock,
      sync: { synced: false, source: "timedatectl", warn: true },
      waiting: { boxAt: BOX_AT, agreed: 1, hostAnswers: true },
    };
    const SILENT_CLOCK: BoxHealth["clock"] = {
      ...health().clock,
      sync: { synced: false, source: "unavailable", warn: false },
      waiting: { boxAt: BOX_AT, agreed: 0, hostAnswers: false },
    };
    const CONFIRMED = { confirmationId: null, stepMs: 0, confirmedAt: BOX_AT };
    const confirmButton = (el: BoxStatusScreen) =>
      q(el, "[data-test=row-clock] [data-test=clock-confirm]") as HTMLElement | null;

    function waitingApi(
      clock: BoxHealth["clock"] = WAITING_CLOCK,
      overrides: Partial<Record<keyof DashboardApi, unknown>> = {},
    ): DashboardApi {
      return clockApi(
        { notices: [], clock },
        {
          clockConfirm: vi.fn().mockResolvedValue(CONFIRMED),
          clockSet: vi.fn().mockResolvedValue({
            confirmationId: "c-2",
            stepMs: 172_800_000,
            confirmedAt: BOX_AT,
          }),
          ...overrides,
        },
      );
    }

    it("offers the confirmation, with its help, and the check with this device's time", async () => {
      const el = await mountClock(waitingApi());
      expect(q(el, "[data-test=row-clock]")!.getAttribute("data-state")).toBe("stopped");
      expect(text(confirmButton(el))).toBe("The date and time are right");
      expect(text(q(el, "[data-test=row-clock] [data-test=clock-confirm-help]"))).toBe(
        "Press this only if the date and time above match a clock you trust. If they do not, use “Check with this device's time”.",
      );
      expect(text(openButton(el))).toBe(t("box_status.clock.admin.open"));
    });

    it("confirms the box's time as shown, and the row goes once the box is read again", async () => {
      const api = waitingApi();
      vi.mocked(api.getBoxHealth)
        .mockResolvedValueOnce({ ...health(), clock: WAITING_CLOCK })
        .mockResolvedValue(health());
      const el = await mountClock(api);
      await userEvent.click(confirmButton(el)!);
      await flush(el);
      expect(api.clockConfirm).toHaveBeenCalledExactlyOnceWith({
        challengeId: "ch-1",
        asShown: true,
      });
      expect(api.liveData.refresh).toHaveBeenCalled();
      await vi.waitFor(() =>
        expect(q(el, "[data-test=row-clock]")!.getAttribute("data-state")).toBe("ok"),
      );
      expect(confirmButton(el)).toBeNull();
      expect(openButton(el)).toBeNull();
    });

    it("shows a confirmation refused because the clock changed beside its button", async () => {
      const el = await mountClock(
        waitingApi(WAITING_CLOCK, { clockConfirm: vi.fn().mockRejectedValue(REFUSED("stale")) }),
      );
      await userEvent.click(confirmButton(el)!);
      await flush(el);
      const refusal = q(el, "[data-test=row-clock] [data-test=clock-confirm-refused]");
      expect(refusal!.getAttribute("role")).toBe("alert");
      expect(text(refusal)).toBe(
        "The box's clock changed while this was being sent. Check the date and time above again, then press the button again.",
      );
      expect(confirmButton(el)!.hasAttribute("disabled")).toBe(false);
    });

    it.each([
      ["en", "/help/en/box-status#clock-waiting"],
      ["es", "/help/es/box-status#clock-waiting"],
    ])(
      "the check's help tooltip links to the guide's waiting section in %s",
      async (locale, href) => {
        setLocale(locale);
        const el = await mountClock(waitingApi());
        const tooltip = q(el, "[data-test=row-clock] .clock-check-action wt-help-tooltip")!;
        expect(tooltip.getAttribute("guide-href")).toBe(href);
      },
    );

    it("does not confirm, and says the clock changed, when the box's time is two days off the row's", async () => {
      const api = waitingApi(WAITING_CLOCK, {
        clockChallenge: vi.fn().mockResolvedValue({
          challengeId: "ch-1",
          boxAt: new Date(Date.parse(BOX_AT) + 2 * 24 * 60 * 60_000).toISOString(),
        }),
      });
      const el = await mountClock(api);
      vi.mocked(api.liveData.refresh).mockClear();
      await userEvent.click(confirmButton(el)!);
      await flush(el);
      expect(api.clockConfirm).not.toHaveBeenCalled();
      expect(text(q(el, "[data-test=row-clock] [data-test=clock-confirm-refused]"))).toBe(
        "The box's time has changed since this page showed it. Check the time on the Clock row, then press the button again.",
      );
      expect(api.liveData.refresh).toHaveBeenCalled();
    });

    it("says in Spanish that the box's time changed since the page showed it", async () => {
      setLocale("es");
      const el = await mountClock(
        waitingApi(WAITING_CLOCK, {
          clockChallenge: vi.fn().mockResolvedValue({
            challengeId: "ch-1",
            boxAt: new Date(Date.parse(BOX_AT) + 2 * 24 * 60 * 60_000).toISOString(),
          }),
        }),
      );
      await userEvent.click(confirmButton(el)!);
      await flush(el);
      expect(text(q(el, "[data-test=row-clock] [data-test=clock-confirm-refused]"))).toBe(
        "La hora del servidor ha cambiado desde que esta página la mostró. Comprueba la hora en la fila Reloj y pulsa el botón otra vez.",
      );
    });

    it.each([
      [30_000, true],
      [61_000, false],
    ])("with the box's time %i ms off the row's, confirms: %s", async (offMs, confirms) => {
      const api = waitingApi(WAITING_CLOCK, {
        clockChallenge: vi.fn().mockResolvedValue({
          challengeId: "ch-1",
          boxAt: new Date(Date.parse(BOX_AT) + offMs).toISOString(),
        }),
      });
      const el = await mountClock(api);
      await userEvent.click(confirmButton(el)!);
      await flush(el);
      expect(vi.mocked(api.clockConfirm).mock.calls.length).toBe(confirms ? 1 : 0);
    });

    describe("pressed ten minutes after the row was read", () => {
      const LATER_MS = 10 * 60_000;
      async function pressLater(freshAt: number) {
        let steady = 5_000;
        const spy = vi.spyOn(performance, "now").mockImplementation(() => steady);
        onTestFinished(() => spy.mockRestore());
        const api = waitingApi(WAITING_CLOCK, {
          clockChallenge: vi
            .fn()
            .mockResolvedValue({ challengeId: "ch-1", boxAt: new Date(freshAt).toISOString() }),
        });
        const el = await mountClock(api);
        steady += LATER_MS;
        await userEvent.click(confirmButton(el)!);
        await flush(el);
        return { api, el };
      }

      it("confirms when the box's clock ran on by those ten minutes", async () => {
        const { api } = await pressLater(Date.parse(BOX_AT) + LATER_MS);
        expect(api.clockConfirm).toHaveBeenCalledExactlyOnceWith({
          challengeId: "ch-1",
          asShown: true,
        });
      });

      it("does not confirm when the box's clock still reads the row's time", async () => {
        const { api, el } = await pressLater(Date.parse(BOX_AT));
        expect(api.clockConfirm).not.toHaveBeenCalled();
        expect(q(el, "[data-test=row-clock] [data-test=clock-confirm-refused]")).not.toBeNull();
      });
    });

    it("forgets a refused confirmation once a read shows the wait has ended", async () => {
      const api = waitingApi(WAITING_CLOCK, {
        clockConfirm: vi.fn().mockRejectedValue(REFUSED("stale")),
      });
      vi.mocked(api.getBoxHealth)
        .mockResolvedValueOnce({ ...health(), clock: WAITING_CLOCK })
        .mockResolvedValueOnce({ ...health(), clock: WAITING_CLOCK })
        .mockResolvedValueOnce(health())
        .mockResolvedValue({ ...health(), clock: WAITING_CLOCK });
      const el = await mountClock(api);
      await userEvent.click(confirmButton(el)!);
      await flush(el);
      expect(q(el, "[data-test=clock-confirm-refused]")).not.toBeNull();
      api.liveData.refresh();
      await flush(el);
      expect(confirmButton(el)).toBeNull();
      api.liveData.refresh();
      await flush(el);
      expect(confirmButton(el)).not.toBeNull();
      expect(q(el, "[data-test=clock-confirm-refused]")).toBeNull();
    });

    it("holds the check with this device's time while the confirmation is sent", async () => {
      let answer: (value: unknown) => void = () => undefined;
      const el = await mountClock(
        waitingApi(WAITING_CLOCK, {
          clockConfirm: vi.fn(() => new Promise((resolve) => (answer = resolve))),
        }),
      );
      await userEvent.click(confirmButton(el)!);
      await flush(el);
      expect(openButton(el)!.hasAttribute("disabled")).toBe(true);
      answer(CONFIRMED);
      await flush(el);
      expect(openButton(el)?.hasAttribute("disabled") ?? false).toBe(false);
    });

    it("sets the clock from this device when it is two days off the box's", async () => {
      deviceNow("2026-10-24T18:10:00.000Z");
      const api = waitingApi();
      const el = await mountClock(api);
      await open(el);
      await userEvent.click(q(el, "[data-test=clock-set-confirm]")!);
      await flush(el);
      expect(api.clockSet).toHaveBeenCalledExactlyOnceWith({
        challengeId: "ch-2",
        deviceAt: Date.parse("2026-10-24T18:10:00.000Z"),
      });
      expect(api.clockConfirm).not.toHaveBeenCalled();
      expect(text(q(el, "[data-test=clock-set-done]"))).toBe(
        "The box's clock is set. Sign in again to go on.",
      );
    });

    it("confirms the box's time when this device agrees within a minute", async () => {
      deviceNow("2026-10-22T18:10:20.000Z");
      const api = waitingApi();
      const el = await mountClock(api);
      await open(el);
      expect(api.clockConfirm).toHaveBeenCalledExactlyOnceWith({
        challengeId: "ch-1",
        asShown: true,
      });
      expect(api.clockSet).not.toHaveBeenCalled();
      expect(text(q(el, "[data-test=clock-confirmed]"))).toBe(
        "This device agrees, so the box's time is confirmed.",
      );
      expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
      expect(api.liveData.refresh).toHaveBeenCalled();
    });

    it("offers the confirmation and the check with this device's time, and says why it waits, when the box's clock service is silent", async () => {
      const el = await mountClock(waitingApi(SILENT_CLOCK));
      expect(text(openButton(el))).toBe("Check with this device's time");
      expect(text(confirmButton(el))).toBe(t("box_status.clock.confirm"));
      expect(text(q(el, "[data-test=row-clock] .line"))).toBe(
        `${fill("box_status.clock.waiting", { agreed: "0", boxAt: formatIsoMinute(BOX_AT) })} It cannot see its internet time, because the part of the box that reads it is not answering, so it waits like this at every start.`,
      );
      expect(text(q(el, "[data-test=row-clock] [data-test=clock-confirm-help]"))).toBe(
        "Press this only if the date and time above match a clock you trust, or use “Check with this device's time” to compare them. If they do not match, the box cannot correct its clock while the part that reads its internet time is not answering, so payments keep waiting.",
      );
    });

    it("confirms the box's time when this device agrees within a minute, while the box's clock service is silent", async () => {
      deviceNow("2026-10-22T18:10:20.000Z");
      const api = waitingApi(SILENT_CLOCK);
      const el = await mountClock(api);
      await open(el);
      expect(api.clockConfirm).toHaveBeenCalledExactlyOnceWith({
        challengeId: "ch-1",
        asShown: true,
      });
      expect(api.clockSet).not.toHaveBeenCalled();
      expect(text(q(el, "[data-test=clock-confirmed]"))).toBe(
        "This device agrees, so the box's time is confirmed.",
      );
      expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
    });

    it.each([
      ["no time service to read", SILENT_CLOCK],
      [
        "a time service read apart from the start's look",
        { ...SILENT_CLOCK, sync: { synced: false, source: "timedatectl" as const, warn: true } },
      ],
    ])(
      "offers no set, and says the time cannot be corrected, when this device is two days off while the box's clock service is silent (%s)",
      async (_label, clock) => {
        deviceNow("2026-10-24T18:10:00.000Z");
        const api = waitingApi(clock);
        const el = await mountClock(api);
        await open(el);
        expect(q(el, "[data-test=clock-set-question]")).toBeNull();
        expect(text(q(el, "[data-test=clock-check-times]"))).toBe(
          `The box's clock says ${atSeconds(BOX_AT)}. This device says ${atSeconds("2026-10-24T18:10:00.000Z")}.`,
        );
        expect(text(q(el, "[data-test=clock-check-verdict]"))).toBe(
          "The box could not show that its clock is within a minute of your device's, and its time cannot be corrected until the part of the box that reads its internet time answers, so payments keep waiting.",
        );
        expect(buttons(el)).toEqual([["clock-check-close", "secondary", "Close"]]);
        expect(api.clockConfirm).not.toHaveBeenCalled();
        expect(api.clockSet).not.toHaveBeenCalled();
      },
    );

    it("offers the check with this device's time, but not the confirmation, while the clock reads before 28-10-2024", async () => {
      const el = await mountClock(clockApi({ notices: [CLOCK_UNUSABLE], clock: WAITING_CLOCK }));
      expect(openButton(el)).not.toBeNull();
      expect(confirmButton(el)).toBeNull();
      expect(q(el, "[data-test=row-clock] [data-test=clock-confirm-help]")).toBeNull();
    });

    it("offers a manager an administrator sign-in in place of both", async () => {
      const el = await mountClock(waitingApi(), false);
      expect(confirmButton(el)).toBeNull();
      expect(openButton(el)).toBeNull();
      expect(q(el, "[data-test=row-clock] [data-test=clock-admin-sign-in]")).not.toBeNull();
    });

    it("offers neither once the start is confirmed", async () => {
      const el = await mountClock(waitingApi({ ...WAITING_CLOCK, waiting: undefined }));
      expect(q(el, "[data-test=row-clock]")!.getAttribute("data-state")).toBe("ok");
      expect(confirmButton(el)).toBeNull();
      expect(openButton(el)).toBeNull();
    });
  });
});

describe("dashboard-box-status-screen's restart of the box", () => {
  async function mountRestart(api: DashboardApi, canRestart = true) {
    const mounted = await mountWidget<BoxStatusScreen>("dashboard-box-status-screen", {
      api,
      canRestart,
    });
    await flush(mounted.el);
    return mounted.el;
  }

  const restartApi = (restartBox: unknown = vi.fn().mockResolvedValue(undefined)) =>
    stubApi({ restartBox });
  const dialog = (el: BoxStatusScreen) =>
    q(el, "[data-test=box-restart-dialog]") as HTMLElement & { open: boolean };
  const buttons = (el: BoxStatusScreen) =>
    qa(el, "[data-test=box-restart-dialog] wt-form-actions wt-button").map((button) => [
      button.getAttribute("data-test"),
      button.getAttribute("variant"),
      text(button),
    ]);

  async function openConfirm(el: BoxStatusScreen): Promise<void> {
    await userEvent.click(q(el, "[data-test=box-restart]")!);
    await flush(el);
  }

  it("offers an administrator Restart the box, which asks first, with Stop and Restart", async () => {
    const el = await mountRestart(restartApi());
    expect(text(q(el, "[data-test=box-restart-section] h2"))).toBe(t("box_status.restart.title"));
    expect(text(q(el, "[data-test=box-restart]"))).toBe(t("box_status.restart.title"));
    expect(dialog(el).open).toBe(false);
    await openConfirm(el);
    expect(dialog(el).open).toBe(true);
    expect(dialog(el).getAttribute("heading")).toBe(t("box_status.restart.question"));
    expect(text(q(el, "[data-test=box-restart-what]"))).toBe(t("box_status.restart.what"));
    expect(buttons(el)).toEqual([
      ["box-restart-stop", "secondary", t("box_status.restart.stop")],
      ["box-restart-confirm", "primary", t("box_status.restart.confirm")],
    ]);
  });

  it("asks the box to restart once, closes, and says the box is restarting", async () => {
    const api = restartApi();
    const el = await mountRestart(api);
    await openConfirm(el);
    await userEvent.click(q(el, "[data-test=box-restart-confirm]")!);
    await flush(el);
    expect(api.restartBox).toHaveBeenCalledOnce();
    expect(dialog(el).open).toBe(false);
    const note = q(el, "[data-test=box-restart-done]");
    expect(note?.getAttribute("role")).toBe("status");
    expect(text(note)).toBe(t("box_status.restart.done"));
  });

  async function restartAccepted(getBoxHealth: ReturnType<typeof vi.fn>) {
    const api = stubApi({ restartBox: vi.fn().mockResolvedValue(undefined), getBoxHealth });
    const el = await mountRestart(api);
    await openConfirm(el);
    await userEvent.click(q(el, "[data-test=box-restart-confirm]")!);
    await flush(el);
    expect(q(el, "[data-test=box-restart-done]")).not.toBeNull();
    const read = async () => {
      api.liveData.refresh();
      await flush(el);
    };
    return { el, read };
  }

  it("keeps saying the box is restarting through the outage, and stops once the box answers again", async () => {
    const { el, read } = await restartAccepted(
      vi
        .fn()
        .mockResolvedValueOnce(health())
        // The old process can still answer before it stops.
        .mockResolvedValueOnce(health())
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue(health()),
    );
    await read();
    expect(q(el, "[data-test=box-restart-done]")).not.toBeNull();
    await read();
    expect(text(q(el, "[role=alert]"))).toBe(t("box_status.read_error"));
    expect(q(el, "[data-test=box-restart-done]")).not.toBeNull();
    await read();
    expect(q(el, "[role=alert]")).toBeNull();
    expect(qa(el, "ul.rows > li")).toHaveLength(7);
    expect(q(el, "[data-test=box-restart-done]")).toBeNull();
  });

  it("stops saying the box is restarting at a read 30 seconds on, when no read caught the box away", async () => {
    let now = Date.now();
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    onTestFinished(() => spy.mockRestore());
    const { el, read } = await restartAccepted(vi.fn().mockResolvedValue(health()));
    const at = now;
    now = at + 29_999;
    await read();
    expect(q(el, "[data-test=box-restart-done]")).not.toBeNull();
    now = at + 30_000;
    await read();
    expect(q(el, "[data-test=box-restart-done]")).toBeNull();
  });

  it("starts the wait again when the box accepts a second restart", async () => {
    const { el, read } = await restartAccepted(
      vi
        .fn()
        .mockResolvedValueOnce(health())
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue(health()),
    );
    await read();
    expect(q(el, "[data-test=box-restart-done]")).not.toBeNull();
    await openConfirm(el);
    await userEvent.click(q(el, "[data-test=box-restart-confirm]")!);
    await flush(el);
    await read();
    expect(q(el, "[data-test=box-restart-done]")).not.toBeNull();
  });

  it("does not count a read that failed before the restart as the box being away", async () => {
    const { el, read } = await restartAccepted(
      vi.fn().mockRejectedValueOnce({ code: "connection.failed" }).mockResolvedValue(health()),
    );
    await read();
    expect(q(el, "[data-test=box-restart-done]")).not.toBeNull();
  });

  it.each(["en", "es"] as const)(
    "says a mirror cannot be restarted from here when the box refuses it as read-only (%s)",
    async (locale) => {
      setLocale(locale);
      const el = await mountRestart(
        restartApi(vi.fn().mockRejectedValue({ code: "node.read_only", params: {} })),
      );
      await openConfirm(el);
      await userEvent.click(q(el, "[data-test=box-restart-confirm]")!);
      await flush(el);
      expect(dialog(el).open).toBe(true);
      expect(text(dialog(el).shadowRoot!.querySelector(".footer [data-error]"))).toBe(
        locale === "en"
          ? "This box only keeps a read-only copy of another box, so it can't be restarted from here."
          : "Este servidor solo guarda una copia de solo lectura de otro servidor, así que no se puede reiniciar desde aquí.",
      );
      expect(q(el, "[data-test=box-restart-done]")).toBeNull();
    },
  );

  it("closes on Stop without asking the box anything", async () => {
    const api = restartApi();
    const el = await mountRestart(api);
    await openConfirm(el);
    await userEvent.click(q(el, "[data-test=box-restart-stop]")!);
    await flush(el);
    expect(dialog(el).open).toBe(false);
    expect(api.restartBox).not.toHaveBeenCalled();
    expect(q(el, "[data-test=box-restart-done]")).toBeNull();
  });

  it("shows a refused restart's sentence above the buttons and keeps the dialog open", async () => {
    const refused = { code: "authorization.not_permitted", params: { permission: "person.admin" } };
    const el = await mountRestart(restartApi(vi.fn().mockRejectedValue(refused)));
    await openConfirm(el);
    await userEvent.click(q(el, "[data-test=box-restart-confirm]")!);
    await flush(el);
    expect(dialog(el).open).toBe(true);
    expect(text(dialog(el).shadowRoot!.querySelector(".footer [data-error]"))).toBe(
      codeMessage("authorization.not_permitted"),
    );
    expect(q(el, "[data-test=box-restart-done]")).toBeNull();
  });

  it("omits restart controls when the screen is mounted without restart permission", async () => {
    const el = await mountRestart(restartApi(), false);
    expect(q(el, "[data-test=box-restart]")).toBeNull();
    expect(q(el, "[data-test=box-restart-section]")).toBeNull();
    expect(q(el, "[data-test=box-restart-dialog]")).toBeNull();
  });

  it("is offered while the box's own read fails", async () => {
    const el = await mountRestart(
      stubApi({ getBoxHealth: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
    );
    expect(q(el, "[data-test=box-restart]")).not.toBeNull();
  });

  it("links its help to the guide's restart section", async () => {
    const el = await mountRestart(restartApi());
    const tooltip = q(el, "[data-test=box-restart-section] wt-help-tooltip")!;
    expect(tooltip.getAttribute("mode")).toBe("help-mode");
    expect(tooltip.getAttribute("guide-href")).toBe(guideHref("box-status.restart"));
    expect(guideHref("box-status.restart")).toBe("/help/en/box-status#restart");
  });

  it("words the section and the dialog in Spanish from the words file", async () => {
    setLocale("es");
    const el = await mountRestart(restartApi());
    await openConfirm(el);
    expect(text(q(el, "[data-test=box-restart]"))).toBe(es["box_status.restart.title"]);
    expect(text(q(el, "[data-test=box-restart-what]"))).toBe(es["box_status.restart.what"]);
    expect(text(q(el, "[data-test=box-restart-confirm]"))).toBe(es["box_status.restart.confirm"]);
  });
});

describe("backup preparation space choices", () => {
  it.each(["en", "es"])(
    "allows leaving without cleanup and an explicit cleanup in %s",
    async (locale) => {
      setLocale(locale);
      const api = stubApi();
      const first = await mount(api);
      expect(freeButton(first.el)!.hasAttribute("disabled")).toBe(false);
      expect(text(freeButton(first.el))).toBe(fill("box_status.free", { size: size(45_000_000) }));
      cleanupWidgets();
      expect(api.freeBoxSpace).not.toHaveBeenCalled();
      const second = await mount(api);
      await userEvent.click(freeButton(second.el)!);
      await flush(second.el);
      expect(api.freeBoxSpace).toHaveBeenCalledTimes(1);
      expect(text(q(second.el, "[role=status]"))).toBe(
        fill("box_status.freed", { size: size(45_000_000) }),
      );
    },
  );
});
