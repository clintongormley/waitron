import { userEvent } from "vitest/browser";
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
  timeLeftMs: 14.5 * 60_000,
  handle: "h1",
};
const WAITING: JoinState = {
  state: "waiting",
  code: "482913",
  primaryUrl: MAIN,
  timeLeftMs: STARTED.timeLeftMs,
  confirmed: false,
};
const CONFIRMED: JoinState = { ...WAITING, confirmed: true };
const APPROVED: JoinState = { state: "approved" };
const OPEN_MAIN =
  "Open the Servers page on the main box and choose Check beside this box's request.";

function stubApi(state: JoinState = { state: "none" }) {
  return {
    startJoin: vi.fn().mockResolvedValue(STARTED),
    joinState: vi.fn().mockResolvedValue(state),
    cancelJoin: vi.fn().mockResolvedValue(undefined),
    confirmJoin: vi.fn().mockResolvedValue(undefined),
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
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

describe("setup-connect-screen: the address as typed", () => {
  it.each([["waitron.local"], ["ftp://waitron.local/servers"]])(
    "sends an address that is not an http or https web address as typed (%s)",
    async (typed) => {
      const { el, api } = await mount();
      await type(el, typed);
      await press(el, "join");
      await vi.waitFor(() => expect(api.startJoin).toHaveBeenCalledWith(typed, undefined));
    },
  );

  it("presses Join when Enter is pressed in the address field", async () => {
    const { el, api } = await mount();
    const field = q(el, "[data-test=primaryUrl]") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await field.updateComplete;
    const input = field.shadowRoot!.querySelector("input")!;
    input.value = MAIN;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    input.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(text(el, "[data-test=code]")).toBe("482\u00a0913"));
    expect(api.startJoin).toHaveBeenCalledWith(MAIN, undefined);
  });

  it("puts back the address it opened with, unmarked, when the person discards their change", async () => {
    const { el, discard } = await mountWithLeave<SetupConnectScreen>("setup-connect-screen", {
      api: stubApi(),
    });
    await vi.waitFor(() => expect(q(el, "[data-test=primaryUrl]")).not.toBeNull());
    await press(el, "join");
    expect(q(el, "[data-test=primaryUrl]")!.hasAttribute("invalid")).toBe(true);
    await type(el, "https://typed.local");
    await discard();
    expect((q(el, "[data-test=primaryUrl]") as HTMLElement & { value: string }).value).toBe("");
    expect(q(el, "[data-test=primaryUrl]")!.hasAttribute("invalid")).toBe(false);
    expect(await bottomOf(el)).toBe("");
  });
});

const GENERIC =
  "This box could not do that just now. Check the address and that the main box is switched on, then try again.";

describe("setup-connect-screen: refusals whose details are missing or unreadable", () => {
  it.each<[{ code?: unknown; params?: Record<string, unknown> }, string]>([
    [{ code: "mirror.join_full", params: { limit: "recent" } }, GENERIC],
    [
      {
        code: "mirror.join_full",
        params: { limit: "recent", retryAt: "2026-11-23T10:00:00Z", max: 7 },
      },
      GENERIC,
    ],
    [
      { code: "mirror.join_full", params: { limit: "recent", retryAt: "", max: 7, minutes: 20 } },
      GENERIC,
    ],
    [{ code: "mirror.join_full", params: { limit: "listed", max: "4" } }, GENERIC],
    [
      { code: "mirror.join_full", params: { limit: "listed", max: 4 } },
      "The main box already has 4 other boxes asking to join. On its Servers page, dismiss any you do not recognise, then choose Join again here.",
    ],
    [
      { code: "mirror.join_full", params: { limit: "address" } },
      "The main box has had too many requests from this box's address in the last minute. Wait a minute, then choose Join again.",
    ],
    [
      {
        code: "mirror.join_full",
        params: { limit: "recent", retryAt: "soon", max: 7, minutes: 20 },
      },
      "The main box has had 7 requests to join in the last 20 minutes, counting ones ended by No or Start again, which its Servers page no longer lists. Wait until soon, then choose Join again. Dismissing a request on its Servers page frees a place sooner.",
    ],
    [
      { code: "mirror.clocks_apart", params: { primaryAt: "noon", standbyAt: "half past" } },
      "The two boxes' clocks are more than 10 minutes apart (the main box reads noon, this box half past). If this box's time is wrong, connect it to the internet for a minute so it sets its clock, then choose Join again.",
    ],
    [{ code: 409 }, GENERIC],
  ])("%o", async (refusal, words) => {
    const api = stubApi();
    api.startJoin.mockRejectedValue(refusal);
    const { el } = await mount(api);
    await type(el, MAIN);
    await press(el, "join");
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(words));
  });
});

describe("setup-connect-screen: waiting", () => {
  it("joins the origin of the typed address and shows a link to the main box's Servers page, the code and the time left", async () => {
    const { el, api } = await mount();
    const seen = handles(el);
    await type(el, `${MAIN}/dashboard?x=1`);
    await press(el, "join");
    await vi.waitFor(() => expect(text(el, "[data-test=code]")).toBe("482\u00a0913"));
    expect(api.startJoin).toHaveBeenCalledWith(MAIN, undefined);
    expect(seen).toEqual(["h1"]);
    expect(text(el, "[data-test=state]").replace(/\s+/g, " ")).toBe(OPEN_MAIN);
    expect(text(el, "[data-test=question]")).toBe("Does the main box show this code?");
    const link = q(el, "[data-test=state] a[data-test=servers-page]")!;
    expect(link.getAttribute("href")).toBe(`${MAIN}/servers`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent!.trim()).toBe("Open the Servers page on the main box");
    expect(q(el, "[data-test=addresses]")).toBeNull();
    expect(q(el, "[data-test=main]")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toMatch(/Main box:/);
    expect(text(el, "[data-test=time-left]")).toBe("Time left: 15 min");
    expect(buttons(el)).toEqual(["no", "yes"]);
    expect(text(el, "[data-test=no]")).toBe("No");
    expect(text(el, "[data-test=yes]")).toBe("Join");
    expect(q(el, "[data-test=no]")!.getAttribute("variant")).toBe("secondary");
    expect(q(el, "[data-test=yes]")!.getAttribute("variant")).toBe("primary");
    expect(el.shadowRoot!.querySelector("wt-input")).toBeNull();
  });

  it("shows the instruction without a link when the main box's address is not a web address", async () => {
    // serversPageOf answers undefined for an address with no http: or https: scheme.
    const { el } = await mount(stubApi({ ...WAITING, primaryUrl: "waitron.local" }), {
      handle: "h1",
    });
    await vi.waitFor(() => expect(text(el, "[data-test=code]")).toBe("482\u00a0913"));
    expect(q(el, "[data-test=state] a")).toBeNull();
    expect(text(el, "[data-test=state]").replace(/\s+/g, " ")).toBe(OPEN_MAIN);
  });

  it("shows the instruction without a link when the main box's address is a web address of another kind", async () => {
    const { el } = await mount(stubApi({ ...WAITING, primaryUrl: "ftp://waitron.local" }), {
      handle: "h1",
    });
    await vi.waitFor(() => expect(text(el, "[data-test=code]")).toBe("482\u00a0913"));
    expect(q(el, "[data-test=state] a")).toBeNull();
  });

  it("reads the join with this tab's handle on opening, and shows its waiting code", async () => {
    const { el, api } = await mount(stubApi(WAITING), { handle: "h1" });
    expect(api.joinState).toHaveBeenCalledWith("h1");
    expect(text(el, "[data-test=code]")).toBe("482\u00a0913");
  });

  it("never draws a code without the handle, even when an answer carries one", async () => {
    for (const state of [WAITING, APPROVED]) {
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
    api.joinState
      .mockResolvedValueOnce(WAITING)
      .mockResolvedValue({ state: "ended", reason: "dismissed" });
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
    api.joinState.mockResolvedValue({ state: "ended", reason: "dismissed" });
    await vi.waitFor(() => expect(q(el, "[data-test=start-again]")).not.toBeNull(), {
      timeout: 5_000,
    });
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
        "This box's join is open on another page or device right now. Carry on there. If that page is closed, wait 15 seconds and choose Start again here.",
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

describe("setup-connect-screen: Spanish words that name the page's buttons", () => {
  it.each([
    [
      "mirror.join_full",
      { limit: "recent", retryAt: "soon", max: 7, minutes: 20 },
      "contando las terminadas con No o Empezar de nuevo,",
    ],
    [
      "mirror.join_in_use",
      undefined,
      "Continúa allí. Si esa página está cerrada, espera 15 segundos y elige Empezar de nuevo aquí.",
    ],
  ] as const)("names No and Start again as drawn for %s", async (code, params, words) => {
    setLocale("es-ES");
    const api = stubApi();
    api.startJoin.mockRejectedValue({ code, params });
    const { el } = await mount(api);
    await type(el, MAIN);
    await press(el, "join");
    await vi.waitFor(async () => expect(await bottomOf(el)).toContain(words));
  });

  it("says to carry on where a join was started, for a Finish joining refused for its handle", async () => {
    setLocale("es-ES");
    const { el } = await mount(stubApi(APPROVED), { handle: "h1" });
    el.refusal = { code: "mirror.join_handle_invalid" };
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(
        "Esta unión se empezó en otra página o dispositivo, así que esta página no puede terminarla. Continúa allí o elige Empezar de nuevo.",
      ),
    );
  });
});

describe("setup-connect-screen: No", () => {
  it("ends the request with the handle, forgets it, and stops at the address without asking again", async () => {
    const api = stubApi(WAITING);
    const { el } = await mount(api, { handle: "h1" });
    const seen = handles(el);
    await press(el, "no");
    await vi.waitFor(() => expect(q(el, "[data-test=primaryUrl]")).not.toBeNull());
    expect(api.cancelJoin).toHaveBeenCalledExactlyOnceWith("h1");
    expect(seen).toEqual([undefined]);
    expect((q(el, "[data-test=primaryUrl]") as HTMLElement & { value: string }).value).toBe(MAIN);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.startJoin).not.toHaveBeenCalled();
    expect(buttons(el)).toEqual(["back", "join"]);
  });

  it.each([
    ["mirror.join_in_use", WAITING],
    ["mirror.join_in_use", CONFIRMED],
  ] as const)(
    "reads the join again, showing no words naming Start again over No, when No is refused with %s",
    async (code, state) => {
      const api = stubApi(state);
      api.cancelJoin.mockRejectedValue({ code });
      const { el } = await mount(api, { handle: "h1" });
      api.joinState.mockResolvedValue({ state: "replaced" });
      await press(el, "no");
      await vi.waitFor(() =>
        expect(text(el, "[data-test=state]")).toBe(
          "This page's join was ended from another page or device, so its code no longer counts. Choose Start again for a new code.",
        ),
      );
      expect(await bottomOf(el)).toBe("");
      expect(buttons(el)).toEqual(["back", "start-again"]);
    },
  );

  it("ends the request after this box's Join too", async () => {
    const api = stubApi(CONFIRMED);
    const { el } = await mount(api, { handle: "h1" });
    expect(buttons(el)).toEqual(["no"]);
    await press(el, "no");
    await vi.waitFor(() => expect(q(el, "[data-test=primaryUrl]")).not.toBeNull());
    expect(api.cancelJoin).toHaveBeenCalledExactlyOnceWith("h1");
    expect(api.startJoin).not.toHaveBeenCalled();
  });

  it.each([
    [
      "en-GB",
      "The main box is already adding this box, so the request cannot be ended from here. Wait a moment: this box then finishes joining, or this page says what went wrong.",
    ],
    ["es-ES", es["connect.refusal.join_approving"]],
  ])(
    "says so in %s when the main box is already adding this box, keeps the code and goes on reading",
    async (locale, words) => {
      setLocale(locale as "en-GB" | "es-ES");
      const api = stubApi(CONFIRMED);
      api.cancelJoin.mockRejectedValue({ code: "mirror.join_approving" });
      const { el } = await mount(api, { handle: "h1" });
      const finished = vi.fn();
      el.addEventListener("join-finish-requested", finished);
      await press(el, "no");
      await vi.waitFor(async () => expect(await bottomOf(el)).toBe(words));
      expect(text(el, "[data-test=code]")).toBe("482 913");
      api.joinState.mockResolvedValue(APPROVED);
      await vi.waitFor(() => expect(finished).toHaveBeenCalledOnce(), { timeout: 5_000 });
    },
  );
});

describe("setup-connect-screen: Join on the code", () => {
  it("sends this box's Join with the handle, then asks for Add as spare on the main box", async () => {
    const api = stubApi(WAITING);
    const { el } = await mount(api, { handle: "h1" });
    api.joinState.mockResolvedValue(CONFIRMED);
    await press(el, "yes");
    await vi.waitFor(() =>
      expect(text(el, "[data-test=question]")).toBe("Now choose Add as spare on the main box."),
    );
    expect(api.confirmJoin).toHaveBeenCalledExactlyOnceWith("h1");
    expect(text(el, "[data-test=code]")).toBe("482 913");
    expect(text(el, "[data-test=time-left]")).toBe("Time left: 15 min");
    expect(q(el, "[data-test=servers-page]")).not.toBeNull();
    expect(buttons(el)).toEqual(["no"]);
    expect(await bottomOf(el)).toBe("");
  });

  it("shows Join working and No unavailable while the Join is out, and sends it once", async () => {
    const api = stubApi(WAITING);
    let answer!: () => void;
    api.confirmJoin.mockReturnValue(new Promise<void>((resolve) => (answer = resolve)));
    const { el } = await mount(api, { handle: "h1" });
    q(el, "[data-test=yes]")!.click();
    q(el, "[data-test=yes]")!.click();
    await el.updateComplete;
    expect(api.confirmJoin).toHaveBeenCalledOnce();
    expect((q(el, "[data-test=yes]") as HTMLElement & { loading: boolean }).loading).toBe(true);
    expect(disabled(el, "no")).toBe(true);
    api.joinState.mockResolvedValue(CONFIRMED);
    answer();
    await vi.waitFor(() => expect(buttons(el)).toEqual(["no"]));
    expect(disabled(el, "no")).toBe(false);
  });

  it("shows a refused Join in the bottom message, naming no address field, and offers it again", async () => {
    const api = stubApi(WAITING);
    api.confirmJoin.mockRejectedValueOnce({ code: "mirror.bundle_fetch_failed" });
    const { el } = await mount(api, { handle: "h1" });
    await press(el, "yes");
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(
        "This box got no usable answer from the main box to its Join. Check that the main box is switched on, then choose Join again.",
      ),
    );
    setLocale("es-ES");
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(
        "Este servidor no ha recibido una respuesta útil del servidor principal a su Unirse. Comprueba que el servidor principal está encendido y vuelve a elegir Unirse.",
      ),
    );
    setLocale("en-GB");
    await el.updateComplete;
    expect(buttons(el)).toEqual(["no", "yes"]);
    expect(disabled(el, "yes")).toBe(false);
    await press(el, "yes");
    await vi.waitFor(() => expect(api.confirmJoin).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(""));
  });

  it.each(["mirror.join_in_use"])(
    "reads the join again, showing no words naming Start again over No and Join, when Join is refused with %s",
    async (code) => {
      const api = stubApi(WAITING);
      api.confirmJoin.mockRejectedValue({ code });
      const { el } = await mount(api, { handle: "h1" });
      api.joinState.mockResolvedValue({ state: "replaced" });
      await press(el, "yes");
      await vi.waitFor(() =>
        expect(text(el, "[data-test=state]")).toBe(
          "This page's join was ended from another page or device, so its code no longer counts. Choose Start again for a new code.",
        ),
      );
      expect(await bottomOf(el)).toBe("");
      expect(buttons(el)).toEqual(["back", "start-again"]);
    },
  );

  it("reads the join again, showing no error, when the request is no longer waiting", async () => {
    const api = stubApi(WAITING);
    api.confirmJoin.mockRejectedValue({
      code: "setup.request_invalid",
      params: { field: "join" },
    });
    const { el } = await mount(api, { handle: "h1" });
    api.joinState.mockResolvedValue({ state: "ended", reason: "dismissed" });
    await press(el, "yes");
    await vi.waitFor(() => expect(text(el, "[data-test=state]")).toMatch(/answered No/));
    expect(await bottomOf(el)).toBe("");
  });
});

describe("setup-connect-screen: added by the main box", () => {
  it("hands Finish joining to the shell by itself, once, however often the join is read", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const api = stubApi(WAITING);
    const { el } = await mount(api, { handle: "h1" });
    const finished = vi.fn();
    el.addEventListener("join-finish-requested", finished);
    api.joinState.mockResolvedValue(APPROVED);
    await vi.advanceTimersByTimeAsync(2_000);
    await el.updateComplete;
    expect(finished).toHaveBeenCalledOnce();
    expect(el.finishing).toBe(true);
    expect(text(el, "[data-test=state]")).toBe(
      "The main box added this box. This box is finishing joining…",
    );
    await vi.advanceTimersByTimeAsync(6_000);
    el.requestUpdate();
    await el.updateComplete;
    expect(api.joinState.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(finished).toHaveBeenCalledOnce();
    expect(q(el, "[data-test=finish]")).toBeNull();
    expect(disabled(el, "start-again")).toBe(true);
    expect(disabled(el, "back")).toBe(true);
  });

  it("does not hand it on again when a refusal comes back, but offers Try again, which does", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { el, api } = await mount(stubApi(APPROVED), { handle: "h1" });
    const finished = vi.fn();
    el.addEventListener("join-finish-requested", finished);
    el.errorMessage = "The shell's words.";
    el.refusal = { code: "mirror.vault_not_empty" };
    await el.updateComplete;
    await vi.advanceTimersByTimeAsync(6_000);
    await el.updateComplete;
    expect(api.joinState.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(finished).not.toHaveBeenCalled();
    expect(el.finishing).toBe(false);
    expect(text(el, "[data-test=state]")).toBe("The main box added this box.");
    expect(await bottomOf(el)).toBe("The shell's words.");
    expect(text(el, "[data-test=finish]")).toBe("Try again");
    expect(disabled(el, "back")).toBe(false);
    q(el, "[data-test=finish]")!.click();
    q(el, "[data-test=finish]")!.click();
    await el.updateComplete;
    expect(finished).toHaveBeenCalledOnce();
    expect(el.finishing).toBe(true);
    expect((q(el, "[data-test=finish]") as HTMLElement & { loading: boolean }).loading).toBe(true);
  });

  it("does not hand it on by itself when mounted with a refusal the shell routed back", async () => {
    const finished = vi.fn();
    document.addEventListener("join-finish-requested", finished);
    try {
      const { el } = await mount(stubApi(APPROVED), {
        handle: "h1",
        refusal: { code: "mirror.vault_not_empty" },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(finished).not.toHaveBeenCalled();
      expect(q(el, "[data-test=finish]")).not.toBeNull();
    } finally {
      document.removeEventListener("join-finish-requested", finished);
    }
  });

  it("hands Finish joining on again for a new join, which has a new handle", async () => {
    const api = stubApi(WAITING);
    const { el } = await mount(api, { handle: "h1" });
    const finished = vi.fn();
    el.addEventListener("join-finish-requested", finished);
    api.joinState.mockResolvedValue(APPROVED);
    await vi.waitFor(() => expect(finished).toHaveBeenCalledOnce(), { timeout: 5_000 });
    el.refusal = { code: "mirror.bundle_fetch_failed" };
    await el.updateComplete;
    api.joinState.mockResolvedValue({ state: "ended", reason: "stopped" });
    await vi.waitFor(() => expect(text(el, "[data-test=state]")).toMatch(/stopped partway/), {
      timeout: 5_000,
    });
    api.startJoin.mockResolvedValue({ ...STARTED, handle: "h2" });
    await press(el, "start-again");
    await vi.waitFor(() => expect(q(el, "[data-test=code]")).not.toBeNull());
    expect(api.startJoin).toHaveBeenCalledWith(MAIN, undefined);
    api.joinState.mockResolvedValue(APPROVED);
    await vi.waitFor(() => expect(finished).toHaveBeenCalledTimes(2), { timeout: 5_000 });
  });

  it("reads the join again, showing no error, when Finish joining finds it no longer approved", async () => {
    const api = stubApi(APPROVED);
    const { el } = await mount(api, { handle: "h1" });
    api.joinState.mockResolvedValue({ state: "ended", reason: "dismissed" });
    el.errorMessage = "The server rejected the details.";
    el.refusal = { code: "setup.request_invalid", params: { field: "join" } };
    await vi.waitFor(() => expect(text(el, "[data-test=state]")).toMatch(/answered No/));
    expect(await bottomOf(el)).toBe("");
    expect(q(el, "[data-test=finish]")).toBeNull();
  });

  it("shows the generic words for a routed-back refusal that comes with no words", async () => {
    const { el } = await mount(stubApi(APPROVED), { handle: "h1" });
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
      "This join was started on another page or device, so this page cannot finish it. Carry on there, or choose Start again.",
    ],
    [{ code: "mirror.vault_not_empty" }, "The shell's words."],
  ])("shows a refusal of Finish joining in the bottom message (%o)", async (refusal, words) => {
    const { el } = await mount(stubApi(APPROVED), { handle: "h1" });
    el.errorMessage = "The shell's words.";
    el.refusal = refusal;
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(words));
  });

  it("names Start again, which is drawn, when Finish joining cannot check the main box's copy", async () => {
    const { el } = await mount(stubApi(APPROVED), { handle: "h1" });
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
      `This page's join was ended from another page or device, so its code no longer counts. ${START_AGAIN_FOR_CODE}`,
    ],
    [
      { state: "ended", reason: "dismissed" },
      "On the main box, this request was dismissed or answered No. Choose Start again to ask again.",
    ],
    [
      { state: "ended", reason: "replaced" },
      `This page's join was ended from another page or device, so its code no longer counts. ${START_AGAIN_FOR_CODE}`,
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
      `The main box has had 7 requests to join in the last 20 minutes, counting ones ended by No or Start again, which its Servers page no longer lists. Wait until ${localTime(RETRY_AT)}, then choose Join again. Dismissing a request on its Servers page frees a place sooner.`,
      JOIN_ONLY,
    ],
    [
      { code: "mirror.join_waiting" },
      "This box is already waiting to join, or is still ending its last request. Choose Start again to cancel that request and make a new one.",
      START_AGAIN_TOO,
    ],
    [
      { code: "mirror.join_in_use" },
      "This box's join is open on another page or device right now. Carry on there. If that page is closed, wait 15 seconds and choose Start again here.",
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
      "This box did not accept this request from this page, so nothing changed. Reload starts setup again from its first screen; what you typed on this page is not kept.",
      JOIN_ONLY,
    ],
    [
      { code: "setup.already_provisioning" },
      "Setup is already in progress on this box.",
      JOIN_ONLY,
    ],
    [
      { code: "setup.not_ready" },
      "The box isn't ready yet. Wait a moment, then try again.",
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
    expect(q(el, "[data-test=back]")).toBeNull();
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

describe("setup-connect-screen: an answer that arrives after the screen moved on", () => {
  it("shows the address field when its first read fails, and reads no more without a handle", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const api = stubApi();
    api.joinState.mockRejectedValue({ code: "server.internal" });
    const { el } = await mount(api);
    expect(q(el, "[data-test=primaryUrl]")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.joinState).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "answers",
      (read: Deferred<JoinState>) => read.resolve({ state: "ended", reason: "cancelled" }),
    ],
    ["fails", (read: Deferred<JoinState>) => read.reject({ code: "server.internal" })],
  ] as const)(
    "keeps the new code when a read sent before No and a new Join %s afterwards",
    async (_, settle) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const api = stubApi(WAITING);
      api.startJoin.mockResolvedValue({ ...STARTED, code: "105377", handle: "h2" });
      const { el } = await mount(api, { handle: "h1" });
      const read = deferred<JoinState>();
      api.joinState.mockReturnValueOnce(read.promise).mockResolvedValue(WAITING);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(api.joinState).toHaveBeenCalledTimes(2);
      await press(el, "no");
      await vi.waitFor(() => expect(q(el, "[data-test=primaryUrl]")).not.toBeNull());
      await press(el, "join");
      await vi.waitFor(() => expect(text(el, "[data-test=code]")).toBe("105\u00a0377"));
      settle(read);
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      expect(text(el, "[data-test=code]")).toBe("105\u00a0377");
      expect(q(el, "[data-test=state]")!.textContent).not.toMatch(/cancelled/);
    },
  );

  it("keeps reading when a first read sent before the screen was taken away and shown again fails, and shows the current read's answer", async () => {
    const older = deferred<JoinState>();
    const current = deferred<JoinState>();
    const api = stubApi();
    api.joinState.mockReturnValueOnce(older.promise).mockReturnValueOnce(current.promise);
    const { el, host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {
      api,
      handle: "h1",
    });
    el.remove();
    host.appendChild(el);
    await vi.waitFor(() => expect(api.joinState).toHaveBeenCalledTimes(2));
    older.reject({ code: "server.internal" });
    await older.promise.catch(() => {});
    await el.updateComplete;
    expect(text(el, "[data-test=reading]")).toBe("Checking this box's join…");
    expect(q(el, "[data-test=primaryUrl]")).toBeNull();
    expect(await bottomOf(el)).toBe("");
    current.resolve(WAITING);
    await vi.waitFor(() => expect(text(el, "[data-test=code]")).toBe("482\u00a0913"));
    expect(q(el, "[data-test=reading]")).toBeNull();
  });

  it.each([
    ["answers", (start: Deferred<JoinStarted>) => start.resolve(STARTED)],
    [
      "is refused",
      (start: Deferred<JoinStarted>) => start.reject({ code: "mirror.join_not_found" }),
    ],
  ] as const)(
    "drops a Join whose start %s after the screen was taken away and shown again",
    async (_, settle) => {
      const api = stubApi();
      const start = deferred<JoinStarted>();
      api.startJoin.mockReturnValue(start.promise);
      const { el, host } = await mount(api);
      const seen = handles(el);
      await type(el, MAIN);
      await press(el, "join");
      el.remove();
      host.appendChild(el);
      await vi.waitFor(() => expect(api.joinState).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(q(el, "[data-test=primaryUrl]")).not.toBeNull());
      settle(start);
      await start.promise.catch(() => {});
      await el.updateComplete;
      expect(seen).toEqual([]);
      expect(q(el, "[data-test=code]")).toBeNull();
      expect(await bottomOf(el)).toBe("");
    },
  );

  it.each([
    ["ends", (cancel: Deferred<void>) => cancel.resolve()],
    ["is refused", (cancel: Deferred<void>) => cancel.reject({ code: "mirror.join_in_use" })],
  ] as const)(
    "drops a Start again whose cancel %s after the screen was taken away and shown again",
    async (_, settle) => {
      const api = stubApi({ state: "elsewhere" });
      const cancel = deferred<void>();
      api.cancelJoin.mockReturnValue(cancel.promise);
      const { el, host } = await mount(api);
      const seen = handles(el);
      await press(el, "start-again");
      el.remove();
      host.appendChild(el);
      await vi.waitFor(() => expect(api.joinState).toHaveBeenCalledTimes(2));
      settle(cancel);
      await cancel.promise.catch(() => {});
      await el.updateComplete;
      expect(seen).toEqual([]);
      expect(text(el, "[data-test=state]")).toMatch(/^A join was started from another page/);
      expect(await bottomOf(el)).toBe("");
    },
  );

  it("shows the generic words when Join is refused with nothing at all", async () => {
    const api = stubApi();
    api.startJoin.mockRejectedValue(undefined);
    const { el } = await mount(api);
    await type(el, MAIN);
    await press(el, "join");
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(
        "This box could not do that just now. Check the address and that the main box is switched on, then try again.",
      ),
    );
  });
});

describe("setup-connect-screen in Spanish", () => {
  it("shows the waiting code and its lines in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mount(stubApi(WAITING), { handle: "h1" });
    expect(text(el, "h1")).toBe("Unirse al servidor principal");
    await vi.waitFor(() => expect(text(el, "[data-test=code]")).toBe("482\u00a0913"));
    expect(text(el, "[data-test=state]").replace(/\s+/g, " ")).toBe(
      `${es["connect.waiting.open_link"]}${es["connect.waiting.open_after"]}`,
    );
    expect(text(el, "[data-test=question]")).toBe("¿El servidor principal muestra este código?");
    expect(text(el, "[data-test=servers-page]")).toBe(es["connect.waiting.open_link"]);
    expect(q(el, "[data-test=servers-page]")!.getAttribute("href")).toBe(`${MAIN}/servers`);
    expect(q(el, "[data-test=addresses]")).toBeNull();
    expect(q(el, "[data-test=main]")).toBeNull();
    expect(text(el, "[data-test=time-left]")).toBe("Tiempo restante: 15 min");
    expect(text(el, "[data-test=no]")).toBe("No");
    expect(text(el, "[data-test=yes]")).toBe("Unirse");
  });

  it("asks for Add as spare on the main box in Spanish once this box said Join", async () => {
    setLocale("es-ES");
    const { el } = await mount(stubApi(CONFIRMED), { handle: "h1" });
    expect(text(el, "[data-test=question]")).toBe(
      "Ahora elige Añadir como reserva en el servidor principal.",
    );
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

  it("steps back to the first page when the shell says the person came from there", async () => {
    const { el } = await mount(stubApi(), { backScreen: "mode" } as Partial<SetupConnectScreen>);
    const goto = vi.fn();
    el.addEventListener("setup-goto", (e) => goto((e as CustomEvent).detail));
    await press(el, "back");
    expect(goto).toHaveBeenCalledWith({ screen: "mode" });
  });
});
