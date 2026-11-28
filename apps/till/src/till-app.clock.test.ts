import { liveReadFixture } from "../test/live-connection.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { SessionActivity } from "./session-activity.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import { en } from "./i18n/strings.js";
import { ServerRouter } from "./api/server-router.js";
import type { MyShift, TillClockState } from "./api/attendance-api.js";
import {
  clockApp,
  clockPage,
  clockState,
  deferred,
  pageButton,
  shellAction,
  signIn,
  working,
} from "../test/clock-app.js";
const originalLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  localStorage.clear();
  setLocale(originalLocale);
});

describe("till clocking integration", () => {
  it("keeps the clock-in page open under the WiFi notice", async () => {
    const router = new ServerRouter({
      origin: "https://box.example.test",
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const { el } = await clockApp({ props: { router } });
    await signIn(el);
    await vi.waitFor(() => expect(clockPage(el)).not.toBeNull());
    const opened = clockPage(el);
    await router.probeNow();
    await el.updateComplete;
    expect(clockPage(el)).toBe(opened);
    expect(el.shadowRoot!.querySelector(".banner[role='status']")?.textContent).toContain(
      t("server.none_answering"),
    );
  });

  it("shows every notice on the clock-in page, words only, with no Open drawer", async () => {
    const openDrawer = vi.fn().mockResolvedValue(undefined);
    const f = await clockApp({
      api: {
        openDrawer,
        getDeviceEquipment: vi.fn().mockResolvedValue({
          roles: [],
          opensDrawer: true,
          notices: [
            {
              owner: "box",
              key: "storage.disk_full",
              code: "storage.disk_full",
              severity: "error",
              params: {},
            },
            {
              owner: "drawers",
              key: "drawer",
              code: "print_job.drawer_expired",
              severity: "warning",
              params: {},
            },
          ],
        }),
      },
    });
    await signIn(f.el);
    await vi.waitFor(() => expect(clockPage(f.el)).not.toBeNull());
    await vi.waitFor(() =>
      expect(
        f.el.shadowRoot!.querySelector("till-notice-strip")?.shadowRoot?.textContent,
      ).toContain("Tell a manager"),
    );
    expect(f.el.shadowRoot!.querySelector("till-shell")).toBeNull();
    expect(
      (f.el as unknown as { deviceEquipment: { opensDrawer?: boolean } | null }).deviceEquipment
        ?.opensDrawer,
    ).toBe(true);
    const strip = f.el.shadowRoot!.querySelector("till-notice-strip")!.shadowRoot!;
    strip.querySelector<HTMLButtonElement>('[aria-controls="notice-list"]')!.click();
    await vi.waitFor(() =>
      expect(strip.textContent).toContain(en["staff_notice.print_job.drawer_expired"]),
    );
    expect(strip.querySelector("[data-open-drawer]")).toBeNull();
    expect(strip.querySelector("wt-button")).toBeNull();
    f.el
      .shadowRoot!.querySelector("till-notice-strip")!
      .dispatchEvent(new CustomEvent("till-open-drawer", { bubbles: true, composed: true }));
    await f.el.updateComplete;
    expect(openDrawer).not.toHaveBeenCalled();
  });

  it("shows a clock notice on the clock-in page with no Check time, though the box offers it", async () => {
    const f = await clockApp({
      api: {
        getDeviceEquipment: vi.fn().mockResolvedValue({
          roles: [],
          notices: [
            {
              owner: "box-clock",
              key: "clock.check_time",
              code: "clock.check_time",
              severity: "notice",
              params: {},
            },
            {
              owner: "box",
              key: "clock.unusable",
              code: "clock.unusable",
              severity: "error",
              params: {},
            },
          ],
        }),
      },
    });
    await signIn(f.el);
    await vi.waitFor(() => expect(clockPage(f.el)).not.toBeNull());
    await vi.waitFor(() =>
      expect(
        f.el.shadowRoot!.querySelector("till-notice-strip")?.shadowRoot?.textContent,
      ).toContain(en["staff_notice.clock.unusable"]),
    );
    expect((f.el as unknown as { checkTimeOffered: boolean }).checkTimeOffered).toBe(true);
    const host = f.el.shadowRoot!.querySelector("till-notice-strip")!;
    const strip = host.shadowRoot!;
    expect(strip.querySelector("[data-check-time]")).toBeNull();
    expect(strip.querySelector("wt-button")).toBeNull();
    expect(strip.textContent).not.toContain(en["staff_notice.see_box_status"]);
    host.dispatchEvent(new CustomEvent("till-check-time", { bubbles: true, composed: true }));
    await f.el.updateComplete;
    expect(f.el.shadowRoot!.querySelector("till-box-time-dialog")).toBeNull();
  });

  it("the initial clock page's idle deadline is not reset when work data finally loads", async () => {
    let now = 0;
    let next = 0;
    const timers = new Map<number, { at: number; fire: () => void }>();
    const activity = new SessionActivity({
      now: () => now,
      setTimer: (fire, ms) => {
        const id = ++next;
        timers.set(id, { at: now + ms, fire });
        return id;
      },
      clearTimer: (id) => {
        timers.delete(id);
      },
      wakeLock: { request: async () => ({ released: false, release: async () => {} }) },
    });
    const f = await clockApp({ timeoutSeconds: 60, props: { sessionActivity: activity } });
    const original = await f.api.listDefaultZoneOffers();
    const held = deferred<import("./api/menu-api.js").ZoneOffers>();
    f.api.listDefaultZoneOffers.mockReturnValueOnce(held.promise);
    await signIn(f.el);
    await vi.waitFor(() => expect(clockPage(f.el)).not.toBeNull());
    expect([...timers.values()][0]!.at).toBe(60_000);
    now = 40_000;
    held.resolve(original);
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-clock-in-screen")).not.toBeNull(),
    );
    await Promise.resolve();
    await f.el.updateComplete;
    expect([...timers.values()][0]!.at).toBe(60_000);
    now = 60_000;
    [...timers.values()][0]!.fire();
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
    );
    expect(f.api.clockOut).not.toHaveBeenCalled();
  });
  it("a clock refusal for one person does not disable the next admitted person's clock", async () => {
    const f = await clockApp();
    f.api.getClockState.mockRejectedValueOnce({ code: "attendance.not_permitted" });
    await signIn(f.el);
    await working(f.el);
    expect(clockPage(f.el)).toBeNull();
    await shellAction(f.el, ".logout");
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
    );
    f.api.login.mockImplementationOnce(async (personId) => {
      f.setState(clockState("out", null, personId));
      return { personId, displayName: "Bea", permissions: [], locale: null };
    });
    await signIn(f.el, "p2");
    await vi.waitFor(() => expect(clockPage(f.el)).not.toBeNull());
    await pageButton(f.el, "[data-clock-in]");
    await working(f.el);
    expect(f.state().personId).toBe("p2");
    expect(f.state().state).toBe("working");
  });

  it("Not now skips clocking in and the next sign-in asks again", async () => {
    const f = await clockApp();
    await signIn(f.el);
    await pageButton(f.el, "[data-cancel]");
    await working(f.el);
    expect(f.api.clockIn).not.toHaveBeenCalled();
    await shellAction(f.el, ".logout");
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
    );
    await signIn(f.el);
    await vi.waitFor(() => expect(clockPage(f.el)).not.toBeNull());
    expect(f.api.login).toHaveBeenCalledWith("p1", "5555");
  });

  it("Clock in opens the chosen work destination without exposing it behind the page", async () => {
    history.replaceState(null, "", "/till/tabs/floor");
    const f = await clockApp();
    await signIn(f.el);
    await vi.waitFor(() => expect(clockPage(f.el)).not.toBeNull());
    expect(f.el.shadowRoot!.querySelector("till-shell")).toBeNull();
    await pageButton(f.el, "[data-clock-in]");
    await working(f.el);
    expect(
      f.el.shadowRoot!.querySelector("till-shell")!.getAttribute("activeScreen") ??
        (f.el.shadowRoot!.querySelector("till-shell") as unknown as { activeScreen: string })
          .activeScreen,
    ).toBe("floor");
    expect(f.api.clockIn).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(f.api.getTablesState).toHaveBeenCalled());
  });

  it("Clock in works while the roster is pending", async () => {
    const f = await clockApp();
    const pending = deferred<MyShift[]>();
    f.api.listMyShifts.mockReturnValueOnce(pending.promise);
    await signIn(f.el);
    await vi.waitFor(() => expect(f.api.listMyShifts).toHaveBeenCalledTimes(1));
    await pageButton(f.el, "[data-clock-in]");
    await working(f.el);
    pending.resolve([]);
    expect(f.state().state).toBe("working");
  });

  it("ignores a late shift from the previous sign-in", async () => {
    const f = await clockApp();
    const pending = deferred<MyShift[]>();
    f.api.listMyShifts.mockReturnValueOnce(pending.promise);
    await signIn(f.el);
    await vi.waitFor(() => expect(f.api.listMyShifts).toHaveBeenCalledTimes(1));
    await pageButton(f.el, "[data-cancel]");
    await working(f.el);
    await shellAction(f.el, ".logout");
    await vi.waitFor(() => expect(f.el.shadowRoot!.querySelector("till-lock-screen")).toBeTruthy());
    await signIn(f.el, "p2");
    await vi.waitFor(() => expect(f.api.listMyShifts).toHaveBeenCalledTimes(2));
    const next = clockPage(f.el)!;
    const now = Date.now();
    pending.resolve([
      {
        id: "earlier-operator",
        startsAt: new Date(now - 60_000).toISOString(),
        startsOffsetMinutes: 60,
        endsAt: new Date(now + 60_000).toISOString(),
        endsOffsetMinutes: 60,
        description: "Previous shift",
        rosterVersionId: "published",
      },
    ]);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(clockPage(f.el)).toBe(next);
    expect(next.shadowRoot!.textContent).not.toContain("Previous shift");
    expect(next.shadowRoot!.querySelector("[data-rota]")).toBeNull();
    await pageButton(f.el, "[data-clock-in]");
    await working(f.el);
    expect(f.state().personId).toBe("p2");
  });

  it.each([clockState("working", "in"), clockState("out", "out", "p1", false)])(
    "already working or a completed shift today skips the page (%j)",
    async (state) => {
      const f = await clockApp({ state });
      await signIn(f.el);
      await working(f.el);
      expect(clockPage(f.el)).toBeNull();
      const shell = f.el.shadowRoot!.querySelector("till-shell")!;
      expect(
        shell.shadowRoot!.querySelector(
          `[data-clock-action="${state.state === "out" ? "in" : "break-start"}"]`,
        ),
      ).not.toBeNull();
    },
  );

  it("Log out keeps the record open", async () => {
    const f = await clockApp({ state: clockState("working", "in") });
    await signIn(f.el);
    await working(f.el);
    await shellAction(f.el, ".logout");
    expect(f.api.clockOut).not.toHaveBeenCalled();
    expect(f.state().state).toBe("working");
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
    );
  });

  it.each([false, true])(
    "resumes work after End break is confirmed (lost reply=%s)",
    async (lostReply) => {
      const f = await clockApp({ state: clockState("on_break", "break") });
      if (lostReply) {
        f.api.endBreak.mockImplementationOnce(async () => {
          f.setState(clockState("working", "saved"));
          throw new TypeError("lost response");
        });
      }
      await signIn(f.el);
      await vi.waitFor(() =>
        expect(clockPage(f.el)?.shadowRoot?.querySelector("[data-end-break]")).toBeTruthy(),
      );
      expect(f.el.shadowRoot!.querySelector("till-shell")).toBeNull();
      await pageButton(f.el, "[data-end-break]");
      await working(f.el);
      expect(f.api.endBreak).toHaveBeenCalledExactlyOnceWith("break", {
        signal: expect.any(AbortSignal),
      });
      expect(f.state().state).toBe("working");
    },
  );

  it("resumes work when Retry reads that the break already ended", async () => {
    const f = await clockApp({ state: clockState("on_break", "break") });
    f.api.endBreak.mockRejectedValueOnce({ code: "attendance.state_changed" });
    await signIn(f.el);
    await vi.waitFor(() =>
      expect(clockPage(f.el)?.shadowRoot?.querySelector("[data-end-break]")).toBeTruthy(),
    );
    await pageButton(f.el, "[data-end-break]");
    await vi.waitFor(() =>
      expect(clockPage(f.el)?.shadowRoot?.querySelector("[data-retry]")).toBeTruthy(),
    );
    f.setState(clockState("working", "ended-elsewhere"));
    await pageButton(f.el, "[data-retry]");
    await working(f.el);
    expect(f.api.endBreak).toHaveBeenCalledTimes(1);
  });

  it("Clock out on a break records the finish and locks even when server logout fails", async () => {
    const f = await clockApp({ state: clockState("on_break", "break") });
    f.api.logout.mockRejectedValue(new TypeError("offline"));
    await signIn(f.el);
    await vi.waitFor(() =>
      expect(clockPage(f.el)?.shadowRoot?.querySelector("[data-end-break]")).toBeTruthy(),
    );
    await pageButton(f.el, "[data-cancel]");
    await working(f.el);
    expect(f.api.endBreak).not.toHaveBeenCalled();
    await shellAction(f.el, '[data-clock-action="out"]');
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
    );
    expect(f.api.clockOut).toHaveBeenCalledWith("break", { signal: expect.any(AbortSignal) });
    expect(f.el.shadowRoot!.querySelector("[data-clocked-out]")!.textContent).toContain(
      t("clock.recorded_out"),
    );
    expect(f.el.shadowRoot!.querySelector("till-shell")).toBeNull();
  });

  it("saved Clock out with hanging logout stays locked; a new operator clears the notice", async () => {
    const f = await clockApp({ state: clockState("working", "in") });
    const logout = deferred<void>();
    f.api.logout.mockReturnValueOnce(logout.promise);
    await signIn(f.el);
    await working(f.el);
    await shellAction(f.el, '[data-clock-action="out"]');
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
    );
    f.api.login.mockImplementationOnce(async (personId) => {
      f.setState(clockState("out", null, personId));
      return { personId, permissions: [], locale: "es-ES" };
    });
    await signIn(f.el, "p2");
    await pageButton(f.el, "[data-cancel]");
    await working(f.el);
    logout.resolve();
    await Promise.resolve();
    await f.el.updateComplete;
    expect(f.el.shadowRoot!.querySelector("[data-clocked-out]")).toBeNull();
    expect(
      f.el.shadowRoot!.querySelector("till-shell")!.shadowRoot!.querySelector(".operator")!
        .textContent,
    ).toContain("Luis");
    expect(currentLocale()).toBe("es-ES");
  });

  it("a late Clock out never logs out the next operator", async () => {
    const f = await clockApp({ state: clockState("working", "in") });
    const old = deferred<TillClockState>();
    f.api.clockOut.mockReturnValueOnce(old.promise);
    await signIn(f.el);
    await working(f.el);
    await shellAction(f.el, '[data-clock-action="out"]');
    await shellAction(f.el, ".logout");
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
    );
    await signIn(f.el, "p2");
    await pageButton(f.el, "[data-cancel]");
    await working(f.el);
    old.resolve(clockState("out", "late"));
    await Promise.resolve();
    await f.el.updateComplete;
    expect(f.el.shadowRoot!.querySelector("till-lock-screen")).toBeNull();
    expect(f.api.logout).toHaveBeenCalledTimes(1);
  });

  it("Cancel clears a held first read so its late answer and polling never reopen the page", async () => {
    const f = await clockApp();
    const held = deferred<TillClockState>();
    f.api.getClockState.mockReturnValueOnce(held.promise);
    await signIn(f.el);
    await pageButton(f.el, "[data-cancel]");
    await working(f.el);
    held.resolve(clockState());
    await Promise.resolve();
    await f.el.updateComplete;
    expect(clockPage(f.el)).toBeNull();
  });

  it.each([false, true])(
    "disabled module or profile makes no clock request (module disabled=%s)",
    async (moduleOff) => {
      const f = await clockApp({ enabled: !moduleOff, action: moduleOff });
      await signIn(f.el);
      await working(f.el);
      expect(clockPage(f.el)).toBeNull();
      expect(f.api.getClockState).not.toHaveBeenCalled();
    },
  );

  it("a lost Clock in response continues from the initial page only after its read confirms", async () => {
    const f = await clockApp();
    f.api.clockIn.mockImplementationOnce(async () => {
      f.setState(clockState("working", "saved"));
      throw new TypeError("lost response");
    });
    await signIn(f.el);
    await pageButton(f.el, "[data-clock-in]");
    await working(f.el);
    expect(f.api.clockIn).toHaveBeenCalledTimes(1);
    expect(f.api.getClockState).toHaveBeenCalledTimes(2);
    expect(clockPage(f.el)).toBeNull();
  });

  it("a lost Clock out response still finishes logout", async () => {
    const f = await clockApp({ state: clockState("working", "in") });
    f.api.clockOut.mockImplementationOnce(async () => {
      f.setState(clockState("out", "saved"));
      throw new TypeError("lost response");
    });
    await signIn(f.el);
    await working(f.el);
    await shellAction(f.el, '[data-clock-action="out"]');
    await vi.waitFor(() => expect(f.api.logout).toHaveBeenCalledTimes(1));
    expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull();
    expect(f.api.clockOut).toHaveBeenCalledTimes(1);
  });

  it.each(["in", "out"] as const)(
    "first reconciliation read fails then Retry read completes %s",
    async (action) => {
      const f = await clockApp({
        state: action === "in" ? clockState() : clockState("working", "in"),
      });
      f.api.getClockState
        .mockResolvedValueOnce(f.state())
        .mockRejectedValueOnce(new TypeError("read lost"));
      const method = action === "in" ? f.api.clockIn : f.api.clockOut;
      method.mockImplementationOnce(async () => {
        f.setState(clockState(action === "in" ? "working" : "out", "saved"));
        throw new TypeError("write lost");
      });
      await signIn(f.el);
      if (action === "in") {
        await pageButton(f.el, "[data-clock-in]");
        await vi.waitFor(() =>
          expect(clockPage(f.el)!.shadowRoot!.querySelector("[data-retry]")).not.toBeNull(),
        );
        await pageButton(f.el, "[data-retry]");
        await working(f.el);
      } else {
        await working(f.el);
        await shellAction(f.el, '[data-clock-action="out"]');
        await vi.waitFor(() =>
          expect(
            f.el
              .shadowRoot!.querySelector("till-shell")!
              .shadowRoot!.querySelector("[data-clock-retry]"),
          ).not.toBeNull(),
        );
        await shellAction(f.el, "[data-clock-retry]");
        await vi.waitFor(() =>
          expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
        );
      }
      expect(method).toHaveBeenCalledTimes(1);
    },
  );

  it("Cancel clears lost Clock in continuation intent", async () => {
    const f = await clockApp();
    const recovery = deferred<TillClockState>();
    f.api.getClockState.mockResolvedValueOnce(clockState()).mockReturnValueOnce(recovery.promise);
    f.api.clockIn.mockRejectedValueOnce(new TypeError("lost"));
    await signIn(f.el);
    await pageButton(f.el, "[data-clock-in]");
    await vi.waitFor(() => expect(f.api.getClockState).toHaveBeenCalledTimes(2));
    await pageButton(f.el, "[data-cancel]");
    await working(f.el);
    recovery.resolve(clockState("working", "saved"));
    await Promise.resolve();
    await f.el.updateComplete;
    expect(clockPage(f.el)).toBeNull();
    expect(f.api.logout).not.toHaveBeenCalled();
  });

  it("an unconfirmed read cannot complete a future unrelated transition", async () => {
    const f = await clockApp();
    f.api.clockIn.mockRejectedValueOnce(new TypeError("lost"));
    await signIn(f.el);
    await pageButton(f.el, "[data-clock-in]");
    await vi.waitFor(() => expect(f.api.getClockState).toHaveBeenCalledTimes(2));
    expect(clockPage(f.el)).not.toBeNull();
    f.setState(clockState("working", "future"));
    await pageButton(f.el, "[data-clock-in]");
    await working(f.el);
    expect(f.api.clockIn).toHaveBeenCalledTimes(2);
  });

  it("server switches invalidate a clock read before the new sign-in", async () => {
    const router = new ServerRouter({
      origin: "https://one.test",
      fetchImpl: vi.fn().mockResolvedValue(new Response('{"acceptingSales":true,"term":1}')),
      storage: { getItem: () => null, setItem: () => {} },
    });
    const f = await clockApp({ props: { router } });
    const old = deferred<TillClockState>();
    f.api.getClockState.mockReturnValueOnce(old.promise);
    await signIn(f.el);
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-attendance-questions")).not.toBeNull(),
    );
    expect(clockPage(f.el)).toBeNull();
    router.dispatchEvent(new CustomEvent("server-changed", { detail: { from: "one", to: "two" } }));
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
    );
    old.resolve(clockState("working", "old"));
    await Promise.resolve();
    await f.el.updateComplete;
    expect(clockPage(f.el)).toBeNull();
    expect(f.api.clockIn).not.toHaveBeenCalled();
    router.stop();
  });

  it("old person reads never paint the next person's dot", async () => {
    const f = await clockApp();
    const old = deferred<TillClockState>();
    f.api.getClockState.mockReturnValueOnce(old.promise);
    await signIn(f.el);
    await pageButton(f.el, "[data-cancel]");
    await working(f.el);
    await shellAction(f.el, ".logout");
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
    );
    f.setState(clockState("on_break", "luis-break", "p2"));
    await signIn(f.el, "p2");
    await vi.waitFor(() =>
      expect(clockPage(f.el)?.shadowRoot?.querySelector("[data-end-break]")).toBeTruthy(),
    );
    await pageButton(f.el, "[data-cancel]");
    await working(f.el);
    old.resolve(clockState("working", "ana-in"));
    await Promise.resolve();
    await f.el.updateComplete;
    const shell = f.el.shadowRoot!.querySelector("till-shell")!;
    expect(shell.shadowRoot!.querySelector(".operator")!.textContent).toContain("Luis");
    expect(shell.shadowRoot!.querySelector("[data-clock-state]")!.textContent).toBe(
      t("clock.on_break"),
    );
  });

  it("a profile change invalidates Clock out before the replacement profile finishes loading", async () => {
    const f = await clockApp({ state: clockState("working", "in") });
    const old = deferred<TillClockState>();
    const profile = deferred<import("./api/device-session-api.js").TillInfo>();
    f.api.clockOut.mockReturnValueOnce(old.promise);
    await signIn(f.el);
    await working(f.el);
    await shellAction(f.el, '[data-clock-action="out"]');
    f.api.getTill.mockReturnValueOnce(profile.promise);
    await shellAction(f.el, ".profile");
    const chooser = f.el.shadowRoot!.querySelector("till-profile-dialog")!;
    chooser.dispatchEvent(
      new CustomEvent("profile-switch", {
        detail: { profileId: "other" },
        bubbles: true,
        composed: true,
      }),
    );
    await vi.waitFor(() => expect(f.api.getTill).toHaveBeenCalledTimes(2));
    old.resolve(clockState("out", "old-out"));
    await Promise.resolve();
    await f.el.updateComplete;
    expect(f.api.logout).not.toHaveBeenCalled();
    profile.resolve({ ...f.info, capabilities: [] });
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-profile-dialog")).toBeNull(),
    );
    expect(f.el.shadowRoot!.querySelector("till-lock-screen")).toBeNull();
    expect(f.api.getClockState).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ code: "storage.disk_full", status: 507 }, codeMessage("storage.disk_full")],
    [{ code: "server.internal", status: 500 }, codeMessage("server.internal")],
    [{ status: 500 }, t("clock.write_error")],
  ])(
    "a Clock in refused %o shows that refusal's sentence on the clock page",
    async (refused, shown) => {
      const f = await clockApp();
      f.api.clockIn.mockRejectedValueOnce(refused);
      await signIn(f.el);
      await pageButton(f.el, "[data-clock-in]");
      await vi.waitFor(() =>
        expect(
          clockPage(f.el)!.shadowRoot!.querySelector("[role=status]")?.textContent?.trim(),
        ).toBe(shown),
      );
    },
  );
});

it("the signed-in clock follows live time entries on the device connection", async () => {
  const stream = liveReadFixture();
  const f = await clockApp({ api: { readLiveEvents: stream.read } });
  await signIn(f.el);
  await vi.waitFor(() => expect(clockPage(f.el)).not.toBeNull());
  const reads = f.api.getClockState.mock.calls.length;
  stream.event("ready");
  await vi.waitFor(() => expect(f.api.getClockState.mock.calls.length).toBeGreaterThan(reads));
  await vi.waitFor(() =>
    expect((clockPage(f.el) as HTMLElement & { reading: boolean }).reading).toBe(false),
  );
  f.setState(clockState("working", "other-till"));
  stream.event("change", '[{"type":"time_entries"}]');
  await vi.waitFor(() =>
    expect((clockPage(f.el) as HTMLElement & { canAct: boolean }).canAct).toBe(false),
  );
  expect(stream.reads.at(-1)!.types).toContain("time_entries");
});
