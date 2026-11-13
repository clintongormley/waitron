import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
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
    outbox: null,
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

function stubApi(answer: BoxHealth | Error, alerts: AlertView[] | Error = []): DashboardApi {
  return {
    getBoxNetwork: vi.fn().mockRejectedValue({ code: "box_host.unavailable" }),
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
    ["a failed alert read", () => stubApi(TROUBLED, new Error("alerts"))],
  ];
  it.each(["ready", "loading", "failed"] as const)(
    "renders the network %s accessibly",
    async (state) => {
      const network = {
        wired: { connected: true, address: "192.0.2.8" },
        wifi: { connectedSsidHex: null, savedSsidHex: null },
      };
      const api = {
        ...stubApi(health()),
        getBoxNetwork:
          state === "loading"
            ? vi.fn(() => new Promise(() => {}))
            : state === "failed"
              ? vi.fn().mockRejectedValue({ code: "box_host.failed" })
              : vi.fn().mockResolvedValue(network),
      } as unknown as DashboardApi;
      const { el, host } = await mountWidget<BoxStatusScreen>(
        "dashboard-box-status-screen",
        { api },
        theme,
      );
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=box-network]")).not.toBeNull();
      await expectNoA11yViolations(host);
    },
  );

  it.each(cases)("renders accessibly with %s", async (_name, api) => {
    const { el, host } = await mountWidget<BoxStatusScreen>(
      "dashboard-box-status-screen",
      { api: api(), canOpen: () => true },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  describe("the check of the box's clock with this device", () => {
    const STOPPED = health({ notices: [notice("clock.unusable", "error")] });

    async function mountCheck(clockChallenge: ReturnType<typeof vi.fn>) {
      const spy = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-22T18:10:20.000Z"));
      onTestFinished(() => spy.mockRestore());
      const api = Object.assign(stubApi(STOPPED), { clockChallenge });
      const mounted = await mountWidget<BoxStatusScreen>(
        "dashboard-box-status-screen",
        { api, canOpen: () => true, canCheckClock: true },
        theme,
      );
      await flush(mounted.el);
      return mounted;
    }

    const challenged = () =>
      vi.fn().mockResolvedValue({ challengeId: "ch-1", boxAt: "2026-10-22T18:10:00.000Z" });

    it("renders the Clock row's button accessibly", async () => {
      const { el, host } = await mountCheck(challenged());
      expect(el.shadowRoot!.querySelector("[data-test=clock-check]")).not.toBeNull();
      await expectNoA11yViolations(host);
    });

    it.each([
      ["agreeing times", challenged, "clock-check-close"],
      [
        "differing times",
        () => vi.fn().mockResolvedValue({ challengeId: "ch-1", boxAt: "2026-10-22T18:05:00.000Z" }),
        "clock-check-close",
      ],
      [
        "the box's own screen refused",
        () =>
          vi.fn().mockRejectedValue({
            code: "clock.set_refused",
            params: { reason: "same_machine" },
          }),
        "clock-check-close",
      ],
    ] as const)("renders the open dialog accessibly with %s", async (_name, challenge, drawn) => {
      const { el, host } = await mountCheck(challenge());
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=clock-check]")!);
      await flush(el);
      expect(el.shadowRoot!.querySelector(`[data-test=${drawn}]`)).not.toBeNull();
      await expectNoA11yViolations(host);
    });

    it.each([
      ["the question", null, "clock-set-confirm"],
      [
        "a refusal",
        { code: "clock.set_refused", params: { reason: "synchronised" } },
        "clock-set-confirm",
      ],
      ["the clock set", { confirmationId: "c-2", stepMs: 86_400_000 }, "clock-set-done"],
    ] as const)("renders the set dialog accessibly with %s", async (_name, answer, drawn) => {
      const spy = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-22T19:30:05.000Z"));
      onTestFinished(() => spy.mockRestore());
      const clockSet =
        answer === null || !("code" in answer)
          ? vi.fn().mockResolvedValue({ ...answer, confirmedAt: "2026-10-22T19:30:05.000Z" })
          : vi.fn().mockRejectedValue(answer);
      const settable = health({
        notices: [notice("clock.unusable", "error")],
        clock: {
          ...STOPPED.clock,
          sync: { synced: false, source: "timedatectl", warn: true },
        },
      });
      const api = Object.assign(stubApi(settable), { clockChallenge: challenged(), clockSet });
      const { el, host } = await mountWidget<BoxStatusScreen>(
        "dashboard-box-status-screen",
        { api, canOpen: () => true, canCheckClock: true },
        theme,
      );
      await flush(el);
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=clock-check]")!);
      await flush(el);
      if (answer !== null) {
        await userEvent.click(
          el.shadowRoot!.querySelector<HTMLElement>("[data-test=clock-set-confirm]")!,
        );
        await flush(el);
        expect(clockSet).toHaveBeenCalledOnce();
      }
      expect(el.shadowRoot!.querySelector(`[data-test=${drawn}]`)).not.toBeNull();
      await expectNoA11yViolations(host);
    });

    it.each([
      ["its host answering", true, null, "clock-check"],
      ["its host silent", false, null, "clock-confirm-help"],
      [
        "a refused confirmation",
        true,
        { code: "clock.set_refused", params: { reason: "not_stopped" } },
        "clock-confirm-refused",
      ],
    ] as const)(
      "renders a start waiting for its time accessibly with %s",
      async (_name, hostAnswers, refusal, drawn) => {
        const waiting = health({
          clock: {
            ...health().clock,
            sync: {
              synced: false,
              source: hostAnswers ? "timedatectl" : "unavailable",
              warn: true,
            },
            waiting: { boxAt: "2026-10-22T19:45:00.000Z", agreed: 1, hostAnswers },
          },
        });
        const api = Object.assign(stubApi(waiting), {
          clockChallenge: challenged(),
          clockConfirm: vi.fn().mockRejectedValue(refusal),
        });
        const { el, host } = await mountWidget<BoxStatusScreen>(
          "dashboard-box-status-screen",
          { api, canOpen: () => true, canCheckClock: true },
          theme,
        );
        await flush(el);
        if (refusal !== null) {
          await userEvent.click(
            el.shadowRoot!.querySelector<HTMLElement>("[data-test=clock-confirm]")!,
          );
          await flush(el);
        }
        expect(el.shadowRoot!.querySelector(`[data-test=${drawn}]`)).not.toBeNull();
        await expectNoA11yViolations(host);
      },
    );
  });

  describe("the restart of the box", () => {
    async function mountRestart(canRestart: boolean, restartBox: ReturnType<typeof vi.fn>) {
      const api = Object.assign(stubApi(health()), { restartBox });
      const mounted = await mountWidget<BoxStatusScreen>(
        "dashboard-box-status-screen",
        { api, canOpen: () => true, canRestart },
        theme,
      );
      await flush(mounted.el);
      return mounted;
    }
    const press = async (el: BoxStatusScreen, test: string) => {
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!);
      await flush(el);
    };

    it("omits the restart section without permission accessibly", async () => {
      const { el, host } = await mountRestart(false, vi.fn());
      expect(el.shadowRoot!.querySelector("[data-test=box-restart-section]")).toBeNull();
      await expectNoA11yViolations(host);
    });

    it("renders the button, the open dialog and the restarting note accessibly", async () => {
      const { el, host } = await mountRestart(true, vi.fn().mockResolvedValue(undefined));
      await expectNoA11yViolations(host);
      await press(el, "box-restart");
      await expectNoA11yViolations(host);
      await press(el, "box-restart-confirm");
      expect(el.shadowRoot!.querySelector("[data-test=box-restart-done]")).not.toBeNull();
      await expectNoA11yViolations(host);
    });

    it("renders a refused restart accessibly", async () => {
      const refused = vi.fn().mockRejectedValue({ code: "management_session.required" });
      const { el, host } = await mountRestart(true, refused);
      await press(el, "box-restart");
      await press(el, "box-restart-confirm");
      expect(refused).toHaveBeenCalledOnce();
      await expectNoA11yViolations(host);
    });
  });
});
