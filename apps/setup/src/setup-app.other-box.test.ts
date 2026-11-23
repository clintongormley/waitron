import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupApp, type Screen } from "./setup-app.js";
import type { SetupApi, VenueNameState } from "./api/client.js";
import type { SetupModeScreen } from "./screens/mode-screen.js";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "./i18n/t.js";

type State = { screen: Screen };

const mounted: HTMLElement[] = [];

// Only timeouts are faked: Lit renders on microtasks and nothing here waits on an animation frame.
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => {
  for (const host of mounted.splice(0)) host.remove();
  vi.useRealTimers();
  setLocale("en-GB");
});

function stubApi(getDiscovery: ReturnType<typeof vi.fn>): SetupApi {
  return {
    firstSetupStatus: vi.fn().mockResolvedValue({ claimed: false }),
    firstSetupOfferings: vi.fn().mockResolvedValue({ modules: [] }),
    getDiscovery,
    getStatus: vi.fn().mockResolvedValue({ environment: "preproduction", needs: ["venue"] }),
  } as unknown as SetupApi;
}

const answers = (...states: VenueNameState[]) => {
  const fn = vi.fn();
  for (const venueName of states)
    fn.mockResolvedValueOnce({ caDownloadAvailable: false, venueName });
  return fn.mockResolvedValue({ caDownloadAvailable: false, venueName: states.at(-1) });
};

async function settle(el: SetupApp): Promise<void> {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
  await el.updateComplete;
}

async function mount(getDiscovery: ReturnType<typeof vi.fn>): Promise<SetupApp> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  mounted.push(host);
  const el = document.createElement("setup-app") as SetupApp;
  el.api = stubApi(getDiscovery);
  host.appendChild(el);
  await settle(el);
  return el;
}

async function modeScreen(el: SetupApp): Promise<SetupModeScreen> {
  const mode = el.shadowRoot!.querySelector<SetupModeScreen>("setup-mode-screen")!;
  await mode.updateComplete;
  return mode;
}

const otherBoxLine = async (el: SetupApp) =>
  (await modeScreen(el)).shadowRoot!.querySelector("[data-test=other-box]");

async function press(el: SetupApp, screen: string, button: string): Promise<void> {
  const owner = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<boolean> }>(
    `[data-test=screen-${screen}]`,
  )!;
  await owner.updateComplete;
  owner.shadowRoot!.querySelector<HTMLElement>(`[data-test=${button}]`)!.click();
  await settle(el);
}

const answer = (venueName: VenueNameState) => ({ caDownloadAvailable: false, venueName });

function held(): {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function wait(el: SetupApp, ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle(el);
}

describe("setup's first page and another box answering the venue's name", () => {
  it("leads with Join it as a spare when the load's read says another box answers", async () => {
    const getDiscovery = answers("other-box-answers");
    const el = await mount(getDiscovery);
    expect((el as unknown as State).screen).toBe("mode");
    expect(await otherBoxLine(el)).not.toBeNull();
    await wait(el, 10_000);
    expect(getDiscovery).toHaveBeenCalledOnce();
  });

  it("still says so on the first page drawn for a screen name outside the wizard's list", async () => {
    const el = await mount(answers("other-box-answers"));
    el.shadowRoot!.querySelector("main")!.dispatchEvent(
      new CustomEvent("setup-goto", {
        detail: { screen: "no-such-screen" },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(el);
    expect((el as unknown as State).screen).toBe("no-such-screen");
    expect(await otherBoxLine(el)).not.toBeNull();
  });

  it("Join it as a spare opens the join page and Recover a restaurant the join-or-recover choice page", async () => {
    for (const [choice, screen] of [
      ["choose-join-spare", "connect"],
      ["choose-recover", "role"],
    ] as const) {
      const el = await mount(answers("other-box-answers"));
      (await modeScreen(el))
        .shadowRoot!.querySelector<HTMLElement>(`[data-test=${choice}]`)!
        .click();
      await settle(el);
      expect((el as unknown as State).screen).toBe(screen);
      expect(el.shadowRoot!.querySelector(`[data-test=screen-${screen}]`)).not.toBeNull();
    }
  });

  it.each(["no-other-box", "ask-failed"] as const)(
    "shows the ordinary page and reads no more when the answer is %s",
    async (state) => {
      const getDiscovery = answers(state);
      const el = await mount(getDiscovery);
      expect(await otherBoxLine(el)).toBeNull();
      expect((await modeScreen(el)).shadowRoot!.querySelectorAll(".choices")).toHaveLength(1);
      await wait(el, 10_000);
      expect(getDiscovery).toHaveBeenCalledOnce();
    },
  );

  it("reads again each second while the first ask has not finished, and stops once answered", async () => {
    const getDiscovery = answers("not-asked", "not-asked", "other-box-answers");
    const el = await mount(getDiscovery);
    expect(await otherBoxLine(el)).toBeNull();
    await wait(el, 1_000);
    expect(getDiscovery).toHaveBeenCalledTimes(2);
    expect(await otherBoxLine(el)).toBeNull();
    await wait(el, 1_000);
    expect(getDiscovery).toHaveBeenCalledTimes(3);
    expect(await otherBoxLine(el)).not.toBeNull();
    await wait(el, 10_000);
    expect(getDiscovery).toHaveBeenCalledTimes(3);
  });

  it("stops after three more reads when the box never asks (its answer on the network is off)", async () => {
    const getDiscovery = answers("not-asked");
    const el = await mount(getDiscovery);
    await wait(el, 3_000);
    expect(getDiscovery).toHaveBeenCalledTimes(4);
    await wait(el, 60_000);
    expect(getDiscovery).toHaveBeenCalledTimes(4);
    expect(await otherBoxLine(el)).toBeNull();
  });

  it("keeps reading past a failed read, within the same bound", async () => {
    // The first call is the load's; the rejection is the first re-read.
    const getDiscovery = vi
      .fn()
      .mockResolvedValueOnce({ caDownloadAvailable: false, venueName: "not-asked" })
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValue({ caDownloadAvailable: false, venueName: "other-box-answers" });
    const el = await mount(getDiscovery);
    await wait(el, 1_000);
    expect(getDiscovery).toHaveBeenCalledTimes(2);
    await wait(el, 1_000);
    expect(getDiscovery).toHaveBeenCalledTimes(3);
    expect(await otherBoxLine(el)).not.toBeNull();
  });

  it("stops reading when the page is taken away", async () => {
    const getDiscovery = answers("not-asked");
    const el = await mount(getDiscovery);
    await wait(el, 1_000);
    expect(getDiscovery).toHaveBeenCalledTimes(2);
    el.remove();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getDiscovery).toHaveBeenCalledTimes(2);
  });

  it("stops reading when the person leaves the first page", async () => {
    const getDiscovery = answers("not-asked");
    const el = await mount(getDiscovery);
    (await modeScreen(el))
      .shadowRoot!.querySelector<HTMLElement>("[data-test=choose-existing]")!
      .click();
    await settle(el);
    expect((el as unknown as State).screen).toBe("role");
    await wait(el, 10_000);
    expect(getDiscovery).toHaveBeenCalledOnce();
  });

  it("reads nothing more while the connection question is showing, and starts when the first page does", async () => {
    const getDiscovery = vi
      .fn()
      .mockResolvedValue({ caDownloadAvailable: true, venueName: "not-asked" });
    const el = await mount(getDiscovery);
    expect((el as unknown as State).screen).toBe("connection");
    await wait(el, 10_000);
    expect(getDiscovery).toHaveBeenCalledOnce();
    getDiscovery.mockResolvedValue({ caDownloadAvailable: true, venueName: "other-box-answers" });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=screen-connection]")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!
      .click();
    await settle(el);
    expect((el as unknown as State).screen).toBe("mode");
    await wait(el, 1_000);
    expect(getDiscovery).toHaveBeenCalledTimes(2);
    expect(await otherBoxLine(el)).not.toBeNull();
  });

  it.each([
    [
      "said no other box answers",
      () => Promise.resolve({ caDownloadAvailable: true, venueName: "no-other-box" }),
    ],
    ["failed", () => Promise.reject(Object.assign(new Error("unavailable"), { status: 503 }))],
  ] as const)(
    "reads afresh on Continue to the first page when the load's read %s",
    async (_, first) => {
      const getDiscovery = vi
        .fn()
        .mockImplementationOnce(first)
        .mockResolvedValue(answer("other-box-answers"));
      const el = await mount(getDiscovery);
      expect((el as unknown as State).screen).toBe("connection");
      await press(el, "connection", "continue");
      expect((el as unknown as State).screen).toBe("mode");
      expect(getDiscovery).toHaveBeenCalledTimes(2);
      expect(await otherBoxLine(el)).not.toBeNull();
      await wait(el, 10_000);
      expect(getDiscovery).toHaveBeenCalledTimes(2);
    },
  );

  it("reads afresh on Back to the first page, once", async () => {
    const getDiscovery = answers("no-other-box", "other-box-answers");
    const el = await mount(getDiscovery);
    expect(await otherBoxLine(el)).toBeNull();
    await press(el, "mode", "choose-existing");
    await press(el, "role", "back");
    expect((el as unknown as State).screen).toBe("mode");
    expect(getDiscovery).toHaveBeenCalledTimes(2);
    expect(await otherBoxLine(el)).not.toBeNull();
    await wait(el, 10_000);
    expect(getDiscovery).toHaveBeenCalledTimes(2);
  });

  it("keeps the last answer when the read on returning fails, and reads no more", async () => {
    const getDiscovery = vi
      .fn()
      .mockResolvedValueOnce(answer("other-box-answers"))
      .mockRejectedValue(new TypeError("network"));
    const el = await mount(getDiscovery);
    await press(el, "mode", "choose-recover");
    await press(el, "role", "back");
    expect(getDiscovery).toHaveBeenCalledTimes(2);
    expect(await otherBoxLine(el)).not.toBeNull();
    await wait(el, 10_000);
    expect(getDiscovery).toHaveBeenCalledTimes(2);
  });

  it("drops an answer an earlier visit asked for once the person has left and come back", async () => {
    const earlier = held();
    const getDiscovery = vi
      .fn()
      .mockResolvedValueOnce(answer("not-asked"))
      .mockReturnValueOnce(earlier.promise)
      .mockResolvedValue(answer("no-other-box"));
    const el = await mount(getDiscovery);
    await wait(el, 1_000);
    expect(getDiscovery).toHaveBeenCalledTimes(2);
    await press(el, "mode", "choose-existing");
    await press(el, "role", "back");
    expect(getDiscovery).toHaveBeenCalledTimes(3);
    expect(await otherBoxLine(el)).toBeNull();
    earlier.resolve(answer("other-box-answers"));
    await settle(el);
    expect(await otherBoxLine(el)).toBeNull();
  });

  it("drops a failure an earlier visit's read met, so it starts no reads of its own", async () => {
    const earlier = held();
    const getDiscovery = vi
      .fn()
      .mockResolvedValueOnce(answer("not-asked"))
      .mockReturnValueOnce(earlier.promise)
      .mockResolvedValue(answer("not-asked"));
    const el = await mount(getDiscovery);
    await wait(el, 1_000);
    await press(el, "mode", "choose-existing");
    await press(el, "role", "back");
    expect(getDiscovery).toHaveBeenCalledTimes(3);
    earlier.reject(new TypeError("network"));
    await wait(el, 60_000);
    // The load's read, the held one, the return's read and its three re-reads.
    expect(getDiscovery).toHaveBeenCalledTimes(6);
  });

  it.each([
    ["the first page's Join it as a spare", ["mode", "choose-join-spare"], "mode"],
    [
      "the join-or-recover choice page",
      ["mode", "choose-recover", "role", "choose-mirror"],
      "role",
    ],
  ] as const)("Back on the join page reached from %s returns there", async (_, route, back) => {
    const el = await mount(answers("other-box-answers"));
    for (let i = 0; i < route.length; i += 2) await press(el, route[i]!, route[i + 1]!);
    expect((el as unknown as State).screen).toBe("connect");
    await press(el, "connect", "back");
    expect((el as unknown as State).screen).toBe(back);
  });
});
