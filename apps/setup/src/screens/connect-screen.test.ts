import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { localTime, setLocale } from "../i18n/t.js";
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
  expiresAt: new Date(Date.now() + 14.5 * 60_000).toISOString(),
  handle: "h1",
};
const WAITING: JoinState = {
  state: "waiting",
  code: "482913",
  addresses: ["192.168.1.23", "fd00::23"],
  primaryUrl: MAIN,
  expiresAt: STARTED.expiresAt,
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

describe("setup-connect-screen: approved and Finish joining", () => {
  it("offers Finish joining only once approved, and hands it to the shell", async () => {
    const { el } = await mount(stubApi({ state: "approved", code: "482913" }), { handle: "h1" });
    const finished = vi.fn();
    el.addEventListener("join-finish-requested", finished);
    expect(text(el, "[data-test=state]")).toBe(
      "The main box approved a join with code 482\u00a0913. Choose Finish joining only if you tapped that code on the main box. If you did not, choose Start again.",
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
      { state: "ended", reason: "unknown" },
      `The main box ended this request, so its code no longer counts and nothing was sent. ${START_AGAIN_FOR_CODE}`,
    ],
    [
      { state: "failed", error: "mirror.join_invalid" },
      "The main box could not read this box's request. Choose Start again. If it happens again, check that both boxes run the same Waitron version.",
    ],
    [
      { state: "failed", error: "mirror.join_not_found" },
      "The main box no longer has this request: it ran out of time or the main box restarted. Choose Start again.",
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

describe("setup-connect-screen: the words of every refusal of Join", () => {
  it.each<[{ code: string; params?: Record<string, unknown> }, string]>([
    [
      { code: "mirror.join_address_mismatch" },
      "The main box received this box's request from a network address this box does not have, so something on the network may be passing it on. Choose Start again. If it happens again, check what is connected between the two boxes.",
    ],
    [
      { code: "mirror.join_invalid" },
      "The main box could not read this box's request. Choose Start again. If it happens again, check that both boxes run the same Waitron version.",
    ],
    [
      { code: "mirror.standby_invalid" },
      "The main box could not read this box's request. Choose Start again. If it happens again, check that both boxes run the same Waitron version.",
    ],
    [
      { code: "mirror.join_code_taken" },
      "The main box needs this box to ask again. Choose Start again.",
    ],
    [
      { code: "mirror.join_not_found" },
      "The main box no longer has this request: it ran out of time or the main box restarted. Choose Start again.",
    ],
    [
      { code: "mirror.join_full", params: { limit: "address", retryAt: RETRY_AT } },
      "The main box has had too many requests from this box's address in the last minute. Wait a minute, then choose Start again.",
    ],
    [
      { code: "mirror.join_full", params: { limit: "network", retryAt: RETRY_AT } },
      "The main box has had too many requests to join from the network in the last minute. Wait a minute, then choose Start again. If this keeps happening, something on the network is sending them.",
    ],
    [
      { code: "mirror.join_full", params: { limit: "listed", retryAt: RETRY_AT } },
      "Three other boxes are already asking to join the main box. On its Servers page, dismiss any you do not recognise, then choose Start again here.",
    ],
    [
      { code: "mirror.join_full", params: { limit: "recent", retryAt: RETRY_AT } },
      `The main box has had six requests to join in the last 15 minutes, counting ones ended by Start again, which its Servers page no longer lists. Wait until ${localTime(RETRY_AT)}, then choose Start again. Dismissing a request on its Servers page frees a place sooner.`,
    ],
    [
      { code: "mirror.join_waiting" },
      "This box is already waiting to join. Choose Start again to cancel that request and make a new one.",
    ],
    [
      { code: "mirror.join_in_use" },
      "This box's join is open on another page or device right now. Finish or cancel it there. If that page is closed, wait 15 seconds and choose Start again here.",
    ],
    [
      { code: "mirror.bundle_fetch_failed" },
      "This box got no usable answer from the main box at that address. Check the address and that the main box is switched on, then choose Join again.",
    ],
    [
      { code: "mirror.clocks_apart", params: { primaryAt: PRIMARY_AT, standbyAt: STANDBY_AT } },
      `The two boxes' clocks are more than 10 minutes apart (the main box reads ${localTime(PRIMARY_AT)}, this box ${localTime(STANDBY_AT)}). If this box's time is wrong, connect it to the internet for a minute so it sets its clock, then choose Join again.`,
    ],
    [
      { code: "mirror.standby_name_taken" },
      "This box picked a name another box of the venue already uses. Nothing was changed. Choose Join again: it picks a new name.",
    ],
    [
      { code: "setup.connection_insecure" },
      "This page is not using a secure connection, so this box will not join from it. Open this box's setup page at an address starting with https://, then try again.",
    ],
    [
      { code: "setup.owner_required" },
      "This server did not accept this request from this page, so nothing changed. Reload starts setup again from its first screen; what you typed on this page is not kept.",
    ],
    [{ code: "setup.already_provisioning" }, "Setup is already in progress on this server."],
    [{ code: "setup.not_ready" }, "The server isn't ready yet. Wait a moment, then try again."],
    [
      { code: "setup.adopt_incomplete" },
      "An earlier join of this box stopped partway. Reload this page to see how to clear it.",
    ],
    [
      { code: "server.internal" },
      "This box could not do that just now. Check the address and that the main box is switched on, then try again.",
    ],
  ])("%o", async (refusal, words) => {
    const api = stubApi();
    api.startJoin.mockRejectedValue(refusal);
    const { el } = await mount(api);
    await type(el, MAIN);
    await press(el, "join");
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(words));
    expect(q(el, "[data-test=primaryUrl]")!.hasAttribute("invalid")).toBe(false);
    expect(q(el, "[data-test=join]")!.hasAttribute("disabled")).toBe(false);
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
