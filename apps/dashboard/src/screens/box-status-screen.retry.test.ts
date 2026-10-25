import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import { setHelpMode } from "@waitron/ui";
import type {
  AlertView,
  AlertsResponse,
  BoxHealth,
  DashboardApi,
  FiscalRetryView,
} from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { es } from "../i18n/strings.js";
import { fill, setLocale, t } from "../i18n/t.js";
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
    clockStop: null,
    clockCheckWaiting: null,
    misdatedOpen: [],
    misdatedHandledCount: 0,
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

async function mount(api: DashboardApi, canOpen: (screen: string) => boolean = () => false) {
  const mounted = await mountWidget<BoxStatusScreen>("dashboard-box-status-screen", {
    api,
    canOpen,
  });
  await flush(mounted.el);
  return mounted;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
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
    expect(q(el, "[data-test=row-tax] [data-test=awaiting-certificate]")).toBeNull();
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
    expect(q(el, "[data-test=row-tax] [data-test=awaiting-certificate]")).toBeNull();
  });

  it("draws Retry now before the row's Go to buttons", async () => {
    const certificate = { ...CERTIFICATE_ALERT, screen: "venue-settings" };
    const { el } = await mount(
      stubApi(
        health({ outbox: outbox({ waiting: 12, awaitingCertificate: true }), notices: [UNSENT] }),
        [certificate],
      ),
      (screen) => screen === "venue-settings",
    );
    const actions = [...q(el, "[data-test=row-tax] .actions")!.children];
    const retry = actions.findIndex((child) => child.querySelector("[data-test=retry]") !== null);
    const goTo = actions.findIndex((child) => child.matches("[data-test=go-to]"));
    expect(retry).toBeGreaterThanOrEqual(0);
    expect(goTo).toBeGreaterThanOrEqual(0);
    expect(retry).toBeLessThan(goTo);
  });

  it("hangs each help badge over its own button's top trailing corner while help is on", async () => {
    setHelpMode(true);
    try {
      const { el } = await mount(
        stubApi(health({ outbox: outbox({ waiting: 12 }), notices: [UNSENT] })),
      );
      for (const action of ["retry", "free"]) {
        const button = q(el, `[data-test=${action}]`)!.getBoundingClientRect();
        const badge = q(el, `.${action} wt-help-tooltip`)!.getBoundingClientRect();
        expect(badge.width).toBeGreaterThan(0);
        const [x, y] = [badge.left + badge.width / 2, badge.top + badge.height / 2];
        expect(Math.abs(x - button.right)).toBeLessThanOrEqual(1);
        expect(Math.abs(y - button.top)).toBeLessThanOrEqual(1);
      }
    } finally {
      setHelpMode(false);
    }
  });

  it("keeps Retry now's help badge clear of the Go to beside it", async () => {
    setHelpMode(true);
    try {
      const { el } = await mount(
        stubApi(
          health({ outbox: outbox({ waiting: 12, awaitingCertificate: true }), notices: [UNSENT] }),
          [{ ...CERTIFICATE_ALERT, screen: "venue-settings" }],
        ),
        (screen) => screen === "venue-settings",
      );
      const badge = q(el, ".retry wt-help-tooltip")!.getBoundingClientRect();
      const goTo = q(el, "[data-test=row-tax] [data-test=go-to]")!.getBoundingClientRect();
      expect(badge.width).toBeGreaterThan(0);
      expect(badge.right).toBeLessThanOrEqual(goTo.left);
    } finally {
      setHelpMode(false);
    }
  });

  it("lines a lone Retry now up with Free at the row's end on a wide page", async () => {
    const { el, host } = await mount(
      stubApi(health({ outbox: outbox({ waiting: 12 }), notices: [UNSENT] })),
    );
    host.style.width = "1000px";
    await flush(el);
    expect(q(el, "[data-test=row-tax] [data-test=go-to]")).toBeNull();
    const retry = q(el, "[data-test=retry]")!.getBoundingClientRect();
    const free = q(el, "[data-test=free]")!.getBoundingClientRect();
    expect(retry.width).toBeGreaterThan(0);
    expect(retry.right).toBe(free.right);
  });

  describe("pressed", () => {
    const ready = () => health({ outbox: outbox({ waiting: 12 }), notices: [UNSENT] });
    const answerOf = (el: BoxStatusScreen) => q(el, "[data-test=row-tax] .words [role=status]");
    const refusalOf = (el: BoxStatusScreen) => q(el, "[data-test=row-tax] .words [role=alert]");

    it("sends once, stays blue and busy while sent, then says the answer and reads again", async () => {
      const sent = deferred<FiscalRetryView>();
      const refreshed = deferred<BoxHealth>();
      const api = stubApi(ready());
      vi.mocked(api.getBoxHealth)
        .mockResolvedValueOnce(ready())
        .mockReturnValueOnce(refreshed.promise);
      vi.mocked(api.retryFiscalSubmissions).mockReturnValue(sent.promise);
      const refresh = vi.spyOn(api.liveData, "refresh");
      const { el } = await mount(api);
      const reads = vi.mocked(api.getBoxHealth).mock.calls.length;

      await userEvent.click(retryButton(el)!);
      await el.updateComplete;
      expect(retryButton(el)!.getAttribute("variant")).toBe("primary");
      expect(retryButton(el)!.hasAttribute("loading")).toBe(true);
      expect(retryButton(el)!.hasAttribute("disabled")).toBe(true);
      retryButton(el)!.click();
      await el.updateComplete;
      expect(api.retryFiscalSubmissions).toHaveBeenCalledTimes(1);

      sent.resolve({ waiting: 12 });
      await flush(el);
      expect(text(answerOf(el))).toBe(
        "12 records will be tried again as soon as the tax agency allows the next send.",
      );
      expect(text(answerOf(el))).toBe(fill("box_status.retried", { count: "12" }));
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(api.getBoxHealth).toHaveBeenCalledTimes(reads + 1);
      expect(retryButton(el)!.hasAttribute("loading")).toBe(false);
      expect(retryButton(el)!.getAttribute("variant")).toBe("secondary");
      expect(retryButton(el)!.hasAttribute("disabled")).toBe(true);
      retryButton(el)!.click();
      await el.updateComplete;
      expect(api.retryFiscalSubmissions).toHaveBeenCalledTimes(1);

      refreshed.resolve(ready());
      await flush(el);
      expect(retryButton(el)!.getAttribute("variant")).toBe("primary");
      expect(retryButton(el)!.hasAttribute("disabled")).toBe(false);
    });

    it.each([
      [1, "1 record will be tried again as soon as the tax agency allows the next send."],
      [0, "No record was waiting to be tried again."],
    ])("words an answer of %i waiting", async (waiting, words) => {
      const api = stubApi(ready());
      vi.mocked(api.retryFiscalSubmissions).mockResolvedValue({ waiting });
      const { el } = await mount(api);
      await userEvent.click(retryButton(el)!);
      await flush(el);
      expect(text(answerOf(el))).toBe(words);
      expect(text(answerOf(el))).toBe(
        t(waiting === 1 ? "box_status.retried_one" : "box_status.retried_none"),
      );
    });

    describe("once the box reads again", () => {
      const sent = () => health({ outbox: outbox({ waiting: 0 }), notices: [] });

      it.each([
        ["nothing waits", sent()],
        ["records wait but no send has failed", health({ outbox: outbox({ waiting: 12 }) })],
        [
          "the unsent notice stays but nothing waits",
          health({ outbox: outbox({ waiting: 0 }), notices: [UNSENT] }),
        ],
      ])("drops the answer when the read shows %s", async (_name, after) => {
        const api = stubApi(ready());
        vi.mocked(api.getBoxHealth).mockResolvedValueOnce(ready()).mockResolvedValue(after);
        const { el } = await mount(api);
        await userEvent.click(retryButton(el)!);
        await flush(el);
        expect(answerOf(el)).toBeNull();
      });

      it("keeps the answer when the read could not check the notices", async () => {
        const unchecked = health({
          outbox: outbox({ waiting: 12 }),
          notices: [],
          noticesUnavailable: ["fiscal"],
        });
        const api = stubApi(ready());
        vi.mocked(api.getBoxHealth).mockResolvedValueOnce(ready()).mockResolvedValue(unchecked);
        const { el } = await mount(api);
        await userEvent.click(retryButton(el)!);
        await flush(el);
        expect(text(answerOf(el))).toBe(fill("box_status.retried", { count: "12" }));
      });

      it("keeps the answer while the read still shows records waiting after a failed send", async () => {
        const { el } = await mount(stubApi(ready()));
        await userEvent.click(retryButton(el)!);
        await flush(el);
        expect(text(answerOf(el))).toBe(fill("box_status.retried", { count: "12" }));
      });

      it("says nothing will be tried when nothing waited by the time the press is answered, staying blue while sent", async () => {
        const pending = deferred<FiscalRetryView>();
        const api = stubApi(ready());
        // The read after the answer never lands, so only the read taken while sent can drop it.
        vi.mocked(api.getBoxHealth)
          .mockResolvedValueOnce(ready())
          .mockResolvedValueOnce(sent())
          .mockReturnValue(new Promise<BoxHealth>(() => undefined));
        vi.mocked(api.retryFiscalSubmissions).mockReturnValue(pending.promise);
        const { el } = await mount(api);
        await userEvent.click(retryButton(el)!);
        api.liveData.refresh();
        await flush(el);
        expect(retryButton(el)!.getAttribute("variant")).toBe("primary");
        expect(retryButton(el)!.hasAttribute("loading")).toBe(true);
        expect(retryButton(el)!.hasAttribute("disabled")).toBe(true);

        pending.resolve({ waiting: 12 });
        await flush(el);
        expect(answerOf(el)).toBeNull();
      });

      it("says nothing was waiting when that answer lands after a read showing nothing waiting", async () => {
        const pending = deferred<FiscalRetryView>();
        const api = stubApi(ready());
        vi.mocked(api.getBoxHealth).mockResolvedValueOnce(ready()).mockResolvedValue(sent());
        vi.mocked(api.retryFiscalSubmissions).mockReturnValue(pending.promise);
        const { el } = await mount(api);
        await userEvent.click(retryButton(el)!);
        api.liveData.refresh();
        await flush(el);
        pending.resolve({ waiting: 0 });
        await flush(el);
        expect(text(answerOf(el))).toBe(t("box_status.retried_none"));
      });

      it("keeps the answer that nothing was waiting", async () => {
        const api = stubApi(ready());
        vi.mocked(api.getBoxHealth).mockResolvedValueOnce(ready()).mockResolvedValue(sent());
        vi.mocked(api.retryFiscalSubmissions).mockResolvedValue({ waiting: 0 });
        const { el } = await mount(api);
        await userEvent.click(retryButton(el)!);
        await flush(el);
        expect(text(answerOf(el))).toBe(t("box_status.retried_none"));
      });
    });

    it.each(["fiscal.not_filing", "fiscal.awaiting_certificate"])(
      "shows a press refused with %s on the row, kept through a failed read and beside a refused Free",
      async (code) => {
        const api = stubApi(ready());
        vi.mocked(api.retryFiscalSubmissions).mockRejectedValue({ code });
        vi.mocked(api.freeBoxSpace).mockRejectedValue({ code: "authorization.not_permitted" });
        const { el } = await mount(api);
        await userEvent.click(retryButton(el)!);
        await flush(el);
        expect(text(refusalOf(el))).toBe(codeMessage(code));
        expect(answerOf(el)).toBeNull();
        expect(retryButton(el)!.getAttribute("variant")).toBe("primary");
        expect(retryButton(el)!.hasAttribute("disabled")).toBe(false);

        vi.mocked(api.getBoxHealth).mockRejectedValueOnce({ code: "server.internal" });
        api.liveData.refresh();
        await flush(el);
        expect(text(q(el, "p.error[role=alert]"))).toBe(t("box_status.read_error"));
        expect(text(refusalOf(el))).toBe(codeMessage(code));

        api.liveData.refresh();
        await flush(el);
        expect(q(el, "p.error[role=alert]")).toBeNull();
        expect(text(refusalOf(el))).toBe(codeMessage(code));

        await userEvent.click(q(el, "[data-test=free]") as HTMLElement);
        await flush(el);
        expect(text(q(el, "p.error[role=alert]"))).toBe(codeMessage("authorization.not_permitted"));
        expect(text(refusalOf(el))).toBe(codeMessage(code));
      },
    );

    it("reads and answers in Spanish", async () => {
      setLocale("es");
      const { el } = await mount(stubApi(ready()));
      expect(text(retryButton(el))).toBe(es["box_status.retry"]);
      await userEvent.click(retryButton(el)!);
      await flush(el);
      expect(text(answerOf(el))).toBe(es["box_status.retried"].replace("{count}", "12"));
    });
  });
});
