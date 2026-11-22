import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, mountWithLeave } from "../widgets/test-helpers.js";
import { localTime, setLocale } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import "./connect-screen.js";
import type { SetupConnectScreen } from "./connect-screen.js";
import type { JoinStarted, JoinState } from "../api/client.js";

const q = (el: SetupConnectScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const text = (el: SetupConnectScreen, sel: string) => q(el, sel)?.textContent?.trim() ?? "";

async function type(el: SetupConnectScreen, value: string): Promise<void> {
  q(el, "[data-test=primaryUrl]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function press(el: SetupConnectScreen, button: string): Promise<void> {
  q(el, `[data-test=${button}]`)!.click();
  await el.updateComplete;
}

/** The form's one message, as `wt-form-actions` shows it. */
async function bottomOf(el: SetupConnectScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

const MAIN = "https://waitron.local";
const STARTED: JoinStarted = {
  code: "482913",
  addresses: ["192.168.1.23", "fd00::23"],
  timeLeftMs: 14.5 * 60_000,
  handle: "h1",
};
const WAITING: JoinState = {
  state: "waiting",
  code: "482913",
  addresses: ["192.168.1.23", "fd00::23"],
  primaryUrl: MAIN,
  timeLeftMs: STARTED.timeLeftMs,
};

function stubApi(state: JoinState = { state: "none" }) {
  return {
    startJoin: vi.fn().mockResolvedValue(STARTED),
    joinState: vi.fn().mockResolvedValue(state),
    cancelJoin: vi.fn().mockResolvedValue(undefined),
  };
}

async function mount(api = stubApi(), props: Partial<SetupConnectScreen> = {}) {
  const mounted = await mountWidget<SetupConnectScreen>("setup-connect-screen", {
    api,
    ...props,
  });
  await vi.waitFor(() => expect(q(mounted.el, "[data-test=reading]")).toBeNull());
  return { ...mounted, api };
}

/** The buttons drawn, in order, by their `data-test` names. */
const buttons = (el: SetupConnectScreen) =>
  [...el.shadowRoot!.querySelectorAll("wt-button")].map((b) => b.getAttribute("data-test"));

const disabled = (el: SetupConnectScreen, button: string) =>
  q(el, `[data-test=${button}]`)!.hasAttribute("disabled");

function handles(el: SetupConnectScreen): (string | undefined)[] {
  const seen: (string | undefined)[] = [];
  el.addEventListener("join-handle", (e) =>
    seen.push((e as CustomEvent<{ handle?: string }>).detail.handle),
  );
  return seen;
}

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.useRealTimers();
});

describe("setup-connect-screen: the address", () => {
  it("asks only for the main box's address: no password, email or code field", async () => {
    const { el } = await mount();
    const fields = [...el.shadowRoot!.querySelectorAll("wt-input")].map((f) =>
      f.getAttribute("name"),
    );
    expect(fields).toEqual(["primaryUrl"]);
    expect(el.shadowRoot!.querySelector("[type=password]")).toBeNull();
    expect(text(el, "[data-test=join]")).toBe("Join");
  });

  it.each([
    [
      "en-GB",
      "This box joins the main box as a spare. It keeps an up-to-date copy of the venue's data, so it can take over if the main box fails, or when you choose a planned handover.",
    ],
    ["es-ES", es["connect.intro"]],
  ] as const)(
    "says what joining does in one paragraph, with the address example as the field's placeholder (%s)",
    async (locale, intro) => {
      setLocale(locale);
      const { el } = await mount();
      expect(text(el, "[data-test=connect-intro]")).toBe(intro);
      const field = q(el, "[data-test=primaryUrl]")!;
      await (field as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
      const input = field.shadowRoot!.querySelector("input")!;
      expect(input.getAttribute("placeholder")).toBe("https://waitron.local");
      expect(input.matches(":placeholder-shown")).toBe(true);
    },
  );

  it("marks a blank address on Join and sends nothing", async () => {
    const { el, api } = await mount();
    await press(el, "join");
    expect(q(el, "[data-test=primaryUrl]")!.hasAttribute("invalid")).toBe(true);
    expect(await bottomOf(el)).toBe("Correct the highlighted fields to continue.");
    expect(api.startJoin).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "mirror.primary_url_invalid" }],
    [{ code: "setup.request_invalid", params: { field: "primaryUrl" } }],
  ])("shows a refusal of the address under the field (%o)", async (refusal) => {
    const api = stubApi();
    api.startJoin.mockRejectedValue(refusal);
    const { el } = await mount(api);
    await type(el, "https://10.0.0.1");
    await press(el, "join");
    await vi.waitFor(() =>
      expect(q(el, "[data-test=primaryUrl]")!.getAttribute("error")).toMatch(/can't be used/),
    );
    expect(await bottomOf(el)).toBe("Correct the highlighted fields to continue.");
  });
});

describe("setup-connect-screen: waiting", () => {
  it("joins the origin of the typed address and shows the code, this box's addresses, the main box and the time left", async () => {
    const { el, api } = await mount();
    const seen = handles(el);
    await type(el, `${MAIN}/dashboard?x=1`);
    await press(el, "join");
    await vi.waitFor(() => expect(text(el, "[data-test=code]")).toBe("482\u00a0913"));
    expect(api.startJoin).toHaveBeenCalledWith(MAIN, undefined);
    expect(seen).toEqual(["h1"]);
    expect(text(el, "[data-test=addresses]")).toBe(
      "The request on the main box should come from one of this box's addresses: 192.168.1.23, fd00::23",
    );
    expect(text(el, "[data-test=main]")).toBe(`Main box: ${MAIN}`);
    expect(text(el, "[data-test=time-left]")).toBe("Time left: 15 min");
    expect(q(el, "[data-test=start-again]")).not.toBeNull();
    expect(q(el, "[data-test=finish]")).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-input")).toBeNull();
  });

  it("reads the join with this tab's handle on opening, and shows its waiting code", async () => {
    const { el, api } = await mount(stubApi(WAITING), { handle: "h1" });
    expect(api.joinState).toHaveBeenCalledWith("h1");
    expect(text(el, "[data-test=code]")).toBe("482\u00a0913");
  });

  it("never draws a code without the handle, even when an answer carries one", async () => {
    for (const state of [WAITING, { state: "approved", code: "482913" } as const]) {
      const { el } = await mount(stubApi(state));
      expect(el.shadowRoot!.textContent).not.toMatch(/482/);
      expect(text(el, "[data-test=state]")).toMatch(/^A join was started from another page/);
      cleanupWidgets();
    }
  });

  it.each([[null], [""]])(
    "counts only a non-empty string as a handle (%o): no code is drawn and the read names none",
    async (handle) => {
      const { el, api } = await mount(stubApi(WAITING), {
        handle: handle as unknown as string,
      });
      expect(api.joinState).toHaveBeenCalledWith(undefined);
      expect(el.shadowRoot!.textContent).not.toMatch(/482/);
      expect(text(el, "[data-test=state]")).toMatch(/^A join was started from another page/);
    },
  );

  it("keeps the time left moving while its reads fail", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const api = stubApi({ ...WAITING, timeLeftMs: 3 * 60_000 });
    const { el } = await mount(api, { handle: "h1" });
    expect(text(el, "[data-test=time-left]")).toBe("Time left: 3 min");
    api.joinState.mockRejectedValue({ code: "server.internal" });
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 1_000);
    await el.updateComplete;
    expect(text(el, "[data-test=time-left]")).toBe("Time left: 1 min");
  });

  it("counts the time left from this box's answer, whatever the browser's clock says", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 8 * 60_000 });
    const { el } = await mount(stubApi({ ...WAITING, timeLeftMs: 15 * 60_000 }), { handle: "h1" });
    expect(text(el, "[data-test=time-left]")).toBe("Time left: 15 min");
  });

  it("treats a reopened tab's address, filled in by its read, as unchanged", async () => {
    const api = stubApi(WAITING);
    const { el, host } = await mountWithLeave<SetupConnectScreen>("setup-connect-screen", {
      api,
      handle: "h1",
    });
    await vi.waitFor(() => expect(q(el, "[data-test=code]")).not.toBeNull());
    await el.updateComplete;
    const shell = host.querySelector("setup-test-leave-shell") as HTMLElement & {
      leave: { coordinator: { isDirty(scopes?: readonly object[]): boolean } };
    };
    expect(shell.leave.coordinator.isDirty([el])).toBe(false);
  });

  it("reads the join every 2 seconds while it waits, but never while its own start is still waiting", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const api = stubApi(WAITING);
    let finishStart!: (answer: JoinStarted) => void;
    api.startJoin.mockReturnValue(new Promise((resolve) => (finishStart = resolve)));
    const { el } = await mount(api, { handle: "h0" });
    expect(api.joinState.mock.calls).toEqual([["h0"]]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(api.joinState.mock.calls).toEqual([["h0"], ["h0"]]);
    await press(el, "start-again");
    await vi.waitFor(() => expect(api.startJoin).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.joinState).toHaveBeenCalledTimes(2);
    finishStart({ ...STARTED, handle: "h2" });
    await vi.waitFor(() => expect(text(el, "[data-test=code]")).toBe("482\u00a0913"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(api.joinState.mock.calls.at(-1)).toEqual(["h2"]);
  });
});

describe("setup-connect-screen: Start again", () => {
  it("cancels with the handle, forgets it, and asks the same main box for a new code", async () => {
    const api = stubApi(WAITING);
    api.startJoin.mockResolvedValue({ ...STARTED, code: "105377", handle: "h2" });
    const { el } = await mount(api, { handle: "h1" });
    const seen = handles(el);
    await press(el, "start-again");
    await vi.waitFor(() => expect(text(el, "[data-test=code]")).toBe("105\u00a0377"));
    expect(api.cancelJoin).toHaveBeenCalledWith("h1");
    expect(api.startJoin).toHaveBeenCalledWith(MAIN, undefined);
    expect(seen).toEqual([undefined, "h2"]);
  });

  it("returns to the address when it does not know the main box", async () => {
    const { el, api } = await mount(stubApi({ state: "elsewhere" }));
    await press(el, "start-again");
    await vi.waitFor(() => expect(q(el, "[data-test=primaryUrl]")).not.toBeNull());
    expect(api.cancelJoin).toHaveBeenCalledWith(undefined);
    expect(api.startJoin).not.toHaveBeenCalled();
  });

  it("shows join_in_use's words when the other page still holds the join, and stays put", async () => {
    const api = stubApi({ state: "elsewhere" });
    api.cancelJoin.mockRejectedValue({ code: "mirror.join_in_use" });
    const { el } = await mount(api);
    await press(el, "start-again");
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(
        "This box's join is open on another page or device right now. Finish or cancel it there. If that page is closed, wait 15 seconds and choose Start again here.",
      ),
    );
    expect(text(el, "[data-test=state]")).toMatch(/^A join was started from another page/);
  });
});

describe("setup-connect-screen: the main box's join limits", () => {
  it("fills in the limits the main box sends, in Spanish too", async () => {
    expect(es["connect.refusal.join_full_listed"]).toContain("{max}");
    expect(es["connect.refusal.join_full_recent"]).toContain("{minutes}");
    setLocale("es-ES");
    const api = stubApi();
    api.startJoin
      .mockRejectedValueOnce({
        code: "mirror.join_full",
        params: { limit: "listed", retryAt: "2026-11-21T10:15:00.000Z", max: 4, minutes: 20 },
      })
      .mockRejectedValueOnce({
        code: "mirror.join_full",
        params: { limit: "recent", retryAt: "2026-11-21T10:15:00.000Z", max: 7, minutes: 20 },
      });
    const { el } = await mount(api);
    await type(el, MAIN);
    await press(el, "join");
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(es["connect.refusal.join_full_listed"].replace("{max}", "4")),
    );
    await press(el, "join");
    const recent = es["connect.refusal.join_full_recent"]
      .replace("{max}", "7")
      .replace("{minutes}", "20")
      .replace("{retryAt}", localTime("2026-11-21T10:15:00.000Z")!);
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(recent));
  });
});

describe("setup-connect-screen: Start again while the main box approves", () => {
  it.each([
    [
      "en-GB",
      "The main box is approving this join, or has just stopped approving it, so it cannot be stopped from here. Wait a moment: this page then shows the main box's answer.",
    ],
    ["es-ES", es["connect.refusal.join_approving"]],
  ])("says so in %s, keeps the code and goes on reading", async (locale, words) => {
    setLocale(locale as "en-GB" | "es-ES");
    const api = stubApi(WAITING);
    api.cancelJoin.mockRejectedValue({ code: "mirror.join_approving" });
    const { el } = await mount(api, { handle: "h1" });
    await press(el, "start-again");
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(words));
    expect(text(el, "[data-test=code]")).toBe("482\u00a0913");
    api.joinState.mockResolvedValue({ state: "approved", code: "482913" });
    await vi.waitFor(() => expect(q(el, "[data-test=finish]")).not.toBeNull(), {
      timeout: 5_000,
    });
  });
});

describe("setup-connect-screen: approved and Finish joining", () => {
  it("offers Finish joining only once approved, and hands it to the shell", async () => {
    const { el } = await mount(stubApi({ state: "approved", code: "482913" }), { handle: "h1" });
    const finished = vi.fn();
    el.addEventListener("join-finish-requested", finished);
    expect(text(el, "[data-test=state]")).toBe(
      "The main box approved a join with code 482\u00a0913. Choose Finish joining only if you tapped that code on the main box. If you did not, choose Start again here. On the main box's Servers page, choose Remove in this box's row, then Clear from list.",
    );
    await press(el, "finish");
    expect(finished).toHaveBeenCalledOnce();
  });

  it("reads the join again, showing no error, when Finish joining finds it no longer approved", async () => {
    const api = stubApi({ state: "approved", code: "482913" });
    const { el } = await mount(api, { handle: "h1" });
    api.joinState.mockResolvedValue({ state: "ended", reason: "dismissed" });
    el.errorMessage = "The server rejected the details.";
    el.refusal = { code: "setup.request_invalid", params: { field: "join" } };
    await vi.waitFor(() => expect(text(el, "[data-test=state]")).toMatch(/dismissed/));
    expect(await bottomOf(el)).toBe("");
    expect(q(el, "[data-test=finish]")).toBeNull();
  });

  it("sends Finish joining once however often it is clicked, and shows it is working until a refusal comes back", async () => {
    const { el } = await mount(stubApi({ state: "approved", code: "482913" }), { handle: "h1" });
    const finished = vi.fn();
    el.addEventListener("join-finish-requested", finished);
    q(el, "[data-test=finish]")!.click();
    q(el, "[data-test=finish]")!.click();
    await el.updateComplete;
    expect(finished).toHaveBeenCalledOnce();
    expect(el.finishing).toBe(true);
    expect(disabled(el, "finish")).toBe(true);
    expect((q(el, "[data-test=finish]") as HTMLElement & { loading: boolean }).loading).toBe(true);
    expect(disabled(el, "start-again")).toBe(true);
    expect(disabled(el, "back")).toBe(true);
    el.errorMessage = "The shell's words.";
    el.refusal = { code: "mirror.vault_not_empty" };
    await el.updateComplete;
    expect(el.finishing).toBe(false);
    expect(disabled(el, "finish")).toBe(false);
    expect(disabled(el, "back")).toBe(false);
    await press(el, "finish");
    expect(finished).toHaveBeenCalledTimes(2);
  });

  it("shows the generic words for a routed-back refusal that comes with no words", async () => {
    const { el } = await mount(stubApi({ state: "approved", code: "482913" }), { handle: "h1" });
    el.refusal = { code: "mirror.vault_not_empty" };
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(
        "This box could not do that just now. Check the address and that the main box is switched on, then try again.",
      ),
    );
  });

  it.each([
    [
      { code: "mirror.join_handle_invalid" },
      "This join was started on another page or device, so this page cannot finish it. Finish it there, or choose Start again.",
    ],
    [{ code: "mirror.vault_not_empty" }, "The shell's words."],
  ])("shows a refusal of Finish joining in the bottom message (%o)", async (refusal, words) => {
    const { el } = await mount(stubApi({ state: "approved", code: "482913" }), { handle: "h1" });
    el.errorMessage = "The shell's words.";
    el.refusal = refusal;
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(words));
  });

  it("names Start again, which is drawn, when Finish joining cannot check the main box's copy", async () => {
    const { el } = await mount(stubApi({ state: "approved", code: "482913" }), { handle: "h1" });
    el.refusal = { code: "mirror.bundle_fetch_failed" };
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(
        "This box could not get a copy from the main box that checks out, so nothing was installed. On the main box's Servers page, choose Remove in this box's row, then Clear from list. Then choose Start again here for a new code.",
      ),
    );
    expect(q(el, "[data-test=start-again]")).not.toBeNull();
    setLocale("es-ES");
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(es["connect.finish.bundle_fetch_failed"]),
    );
  });
});

const START_AGAIN_FOR_CODE = "Choose Start again for a new code.";

describe("setup-connect-screen: the words of every state", () => {
  it.each<[JoinState, string]>([
    [
      { state: "elsewhere" },
      "A join was started from another page or device. This page cannot show its code. Choose Start again to start one here; the other page's join then ends.",
    ],
    [
      { state: "replaced" },
      `This page's join was ended from another page or device, so its code no longer counts. Do not tap it on the main box. ${START_AGAIN_FOR_CODE}`,
    ],
    [
      { state: "ended", reason: "wrong_code" },
      `On the main box, a code that is not this box's was chosen, so this request has ended and nothing was sent. ${START_AGAIN_FOR_CODE}`,
    ],
    [
      { state: "ended", reason: "dismissed" },
      "The main box's Servers page dismissed this request. Choose Start again to ask again.",
    ],
    [
      { state: "ended", reason: "replaced" },
      `This page's join was ended from another page or device, so its code no longer counts. Do not tap it on the main box. ${START_AGAIN_FOR_CODE}`,
    ],
    [
      { state: "ended", reason: "cancelled" },
      `This request was cancelled, so its code no longer counts and nothing was sent. ${START_AGAIN_FOR_CODE}`,
    ],
    [
      { state: "ended", reason: "code_taken" },
      "The main box needs this box to ask again. Choose Start again.",
    ],
    [
      { state: "ended", reason: "invalid" },
      "The main box could not read this box's request. Choose Start again. If it happens again, check that both boxes run the same Waitron version.",
    ],
    [
      { state: "ended", reason: "stopped" },
      "The main box stopped partway through approving this box, so nothing was installed. On the main box's Servers page, choose Remove in this box's row, then Clear from list. Then choose Start again here.",
    ],
    [
      { state: "ended", reason: "unknown" },
      `The main box ended this request, so its code no longer counts and nothing was sent. ${START_AGAIN_FOR_CODE}`,
    ],
    [
      { state: "failed", error: "mirror.join_invalid" },
      "The main box approved this box, but the copy it sent did not check out, so nothing was installed. On the main box's Servers page, choose Remove in this box's row, then Clear from list. Then choose Start again here.",
    ],
    [
      { state: "failed", error: "mirror.join_not_found" },
      "The main box no longer has this request: it ran out of time or the main box restarted. Choose Start again.",
    ],
    [
      { state: "failed", error: "mirror.join_code_taken" },
      `This join stopped, so its code no longer counts and nothing was sent. ${START_AGAIN_FOR_CODE}`,
    ],
    [
      { state: "failed", error: "server.internal" },
      `This join stopped, so its code no longer counts and nothing was sent. ${START_AGAIN_FOR_CODE}`,
    ],
  ])("%o", async (state, words) => {
    const { el } = await mount(stubApi(state), { handle: "h1" });
    expect(text(el, "[data-test=state]")).toBe(words);
    expect(q(el, "[data-test=code]")).toBeNull();
    expect(q(el, "[data-test=finish]")).toBeNull();
    expect(q(el, "[data-test=start-again]")).not.toBeNull();
  });
});

const RETRY_AT = "2026-11-21T10:15:00.000Z";
const PRIMARY_AT = "2026-11-21T10:00:00.000Z";
const STANDBY_AT = "2026-11-21T10:30:00.000Z";

const JOIN_ONLY = ["back", "join"];
const START_AGAIN_TOO = ["back", "start-again", "join"];

describe("setup-connect-screen: the words of every refusal of Join", () => {
  it.each<[{ code: string; params?: Record<string, unknown> }, string, string[]]>([
    [
      { code: "mirror.join_address_mismatch" },
      "The main box received this box's request from a network address this box does not have, so something on the network may be passing it on. Choose Join again. If it happens again, check what is connected between the two boxes.",
      JOIN_ONLY,
    ],
    [
      { code: "mirror.join_invalid" },
      "The main box could not read this box's request. Choose Join again. If it happens again, check that both boxes run the same Waitron version.",
      JOIN_ONLY,
    ],
    [
      { code: "mirror.standby_invalid" },
      "The main box could not read this box's request. Choose Join again. If it happens again, check that both boxes run the same Waitron version.",
      JOIN_ONLY,
    ],
    [
      { code: "mirror.join_code_taken" },
      "The main box needs this box to ask again. Choose Join again.",
      JOIN_ONLY,
    ],
    [
      { code: "mirror.join_not_found" },
      "The main box no longer has this request: it ran out of time or the main box restarted. Choose Join again.",
      JOIN_ONLY,
    ],
    [
      { code: "mirror.join_full", params: { limit: "address", retryAt: RETRY_AT } },
      "The main box has had too many requests from this box's address in the last minute. Wait a minute, then choose Join again.",
      JOIN_ONLY,
    ],
    [
      { code: "mirror.join_full", params: { limit: "network", retryAt: RETRY_AT } },
      "The main box has had too many requests to join from the network in the last minute. Wait a minute, then choose Join again. If this keeps happening, something on the network is sending them.",
      JOIN_ONLY,
    ],
    [
      {
        code: "mirror.join_full",
        params: { limit: "listed", retryAt: RETRY_AT, max: 4, minutes: 20 },
      },
      "The main box already has 4 other boxes asking to join. On its Servers page, dismiss any you do not recognise, then choose Join again here.",
      JOIN_ONLY,
    ],
    [
      {
        code: "mirror.join_full",
        params: { limit: "recent", retryAt: RETRY_AT, max: 7, minutes: 20 },
      },
      `The main box has had 7 requests to join in the last 20 minutes, counting ones ended by Start again, which its Servers page no longer lists. Wait until ${localTime(RETRY_AT)}, then choose Join again. Dismissing a request on its Servers page frees a place sooner.`,
      JOIN_ONLY,
    ],
    [
      { code: "mirror.join_waiting" },
      "This box is already waiting to join, or is still ending its last request. Choose Start again to cancel that request and make a new one.",
      START_AGAIN_TOO,
    ],
    [
      { code: "mirror.join_in_use" },
      "This box's join is open on another page or device right now. Finish or cancel it there. If that page is closed, wait 15 seconds and choose Start again here.",
      START_AGAIN_TOO,
    ],
    [
      { code: "mirror.bundle_fetch_failed" },
      "This box got no usable answer from the main box at that address. Check the address and that the main box is switched on, then choose Join again.",
      JOIN_ONLY,
    ],
    [
      { code: "mirror.clocks_apart", params: { primaryAt: PRIMARY_AT, standbyAt: STANDBY_AT } },
      `The two boxes' clocks are more than 10 minutes apart (the main box reads ${localTime(PRIMARY_AT)}, this box ${localTime(STANDBY_AT)}). If this box's time is wrong, connect it to the internet for a minute so it sets its clock, then choose Join again.`,
      JOIN_ONLY,
    ],
    [
      { code: "mirror.standby_name_taken" },
      "This box picked a name another box of the venue already uses. Nothing was changed. Choose Join again: it picks a new name.",
      JOIN_ONLY,
    ],
    [
      { code: "setup.connection_insecure" },
      "This page is not using a secure connection, so this box will not join from it. Open this box's setup page at an address starting with https://, then try again.",
      JOIN_ONLY,
    ],
    [
      { code: "setup.owner_required" },
      "This server did not accept this request from this page, so nothing changed. Reload starts setup again from its first screen; what you typed on this page is not kept.",
      JOIN_ONLY,
    ],
    [
      { code: "setup.already_provisioning" },
      "Setup is already in progress on this server.",
      JOIN_ONLY,
    ],
    [
      { code: "setup.not_ready" },
      "The server isn't ready yet. Wait a moment, then try again.",
      JOIN_ONLY,
    ],
    [
      { code: "setup.adopt_incomplete" },
      "An earlier join of this box stopped partway. Reload this page to see how to clear it.",
      JOIN_ONLY,
    ],
    [
      { code: "server.internal" },
      "This box could not do that just now. Check the address and that the main box is switched on, then try again.",
      JOIN_ONLY,
    ],
  ])("%o", async (refusal, words, drawn) => {
    const api = stubApi();
    api.startJoin.mockRejectedValue(refusal);
    const { el } = await mount(api);
    await type(el, MAIN);
    await press(el, "join");
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(words));
    expect(q(el, "[data-test=primaryUrl]")!.hasAttribute("invalid")).toBe(false);
    expect(q(el, "[data-test=join]")!.hasAttribute("disabled")).toBe(false);
    expect(buttons(el)).toEqual(drawn);
  });

  it("Start again after a refusal naming it cancels the held join and asks the same main box again", async () => {
    const api = stubApi();
    api.startJoin.mockRejectedValueOnce({ code: "mirror.join_in_use" });
    const { el } = await mount(api);
    const seen = handles(el);
    await type(el, MAIN);
    await press(el, "join");
    await vi.waitFor(() => expect(q(el, "[data-test=start-again]")).not.toBeNull());
    await press(el, "start-again");
    await vi.waitFor(() => expect(text(el, "[data-test=code]")).toBe("482\u00a0913"));
    expect(api.cancelJoin).toHaveBeenCalledWith(undefined);
    expect(api.startJoin.mock.calls).toEqual([
      [MAIN, undefined],
      [MAIN, undefined],
    ]);
    expect(seen).toEqual([undefined, "h1"]);
  });

  it("redraws a refusal in the new language when the language changes", async () => {
    const api = stubApi();
    api.startJoin.mockRejectedValue({ code: "mirror.join_waiting" });
    const { el } = await mount(api);
    await type(el, MAIN);
    await press(el, "join");
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toMatch(/^This box is already waiting/),
    );
    setLocale("es-ES");
    await el.updateComplete;
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(es["connect.refusal.join_waiting"]),
    );
    expect(text(el, "[data-test=start-again]")).toBe(es["connect.start_again"]);
  });
});

describe("setup-connect-screen: nothing leaves the screen while a request is out", () => {
  it("disables Back while Join's start is out, and enables it again once it answers", async () => {
    const api = stubApi();
    let answer!: (started: JoinStarted) => void;
    api.startJoin.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { el } = await mount(api);
    await type(el, MAIN);
    expect(disabled(el, "back")).toBe(false);
    await press(el, "join");
    expect(disabled(el, "back")).toBe(true);
    answer(STARTED);
    await vi.waitFor(() => expect(q(el, "[data-test=code]")).not.toBeNull());
    expect(disabled(el, "back")).toBe(false);
  });

  it("disables Back while Start again's cancel is out", async () => {
    const api = stubApi({ state: "elsewhere" });
    let ended!: () => void;
    api.cancelJoin.mockReturnValue(new Promise<void>((resolve) => (ended = resolve)));
    const { el } = await mount(api);
    await press(el, "start-again");
    expect(disabled(el, "back")).toBe(true);
    ended();
    await vi.waitFor(() => expect(q(el, "[data-test=primaryUrl]")).not.toBeNull());
    expect(disabled(el, "back")).toBe(false);
  });
});

describe("setup-connect-screen in Spanish", () => {
  it("shows the waiting code and its lines in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mount(stubApi(WAITING), { handle: "h1" });
    expect(text(el, "h1")).toBe("Unirse al servidor principal");
    expect(text(el, "[data-test=addresses]")).toBe(
      "La solicitud en el servidor principal debe venir de una de las direcciones de este servidor: 192.168.1.23, fd00::23",
    );
    expect(text(el, "[data-test=start-again]")).toBe("Empezar de nuevo");
  });
});

describe("setup-connect-screen: Back", () => {
  it("steps back to the role screen", async () => {
    const { el } = await mount();
    const goto = vi.fn();
    el.addEventListener("setup-goto", (e) => goto((e as CustomEvent).detail));
    await press(el, "back");
    expect(goto).toHaveBeenCalledWith({ screen: "role" });
  });
});
