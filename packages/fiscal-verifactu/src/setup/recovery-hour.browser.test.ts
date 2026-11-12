import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens, LeaveController } from "@waitron/ui";
import { LitElement, html } from "lit";
import type { Mock } from "vitest";
import type {
  ModuleRecoveryEntry,
  ModulePromotionEntry,
} from "@waitron/module/src/setup-contract.js";
import { FISCAL_SETUP } from "./first-fiscal-screen.js";
import { isMinuteIdentity } from "../hour-identity.js";
import { seriesMatchBases } from "../allocation-identity.js";

const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "browser-recovery",
  sourceId: "archive-digest",
  targetNodeId: "node-1",
};
const selection = {
  sourceId: "stream:venue:generation",
  taxId: "B12345674",
  environment: "production" as const,
  nodeId: "node-1",
  keyName: "Caja principal",
  country: "ES",
  fiscalTerritory: "common",
  timeZone: "Europe/Madrid",
};
const instant = Date.parse("2026-10-18T12:30:00Z");
const clock = {
  usable: ["box", "browser", "internet"].map((source) => ({
    source,
    lowerMs: instant,
    upperMs: instant,
  })),
  unavailable: [] as { source: string; result: "unavailable"; reason: string }[],
  secondClock: true,
  disagreement: false,
  releaseBlocked: false,
  rangeBlocked: false,
};
const selected = {
  status: "selected",
  identity: "0CSQW",
  binding,
  input: {
    allocation: {
      installationIdentity: "0CSQW",
      series: [
        { code: "A-0CSQW", purpose: "standard" },
        { code: "FF-0CSQW", purpose: "full" },
        { code: "R-0CSQW", purpose: "rectificative" },
      ],
    },
  },
};
type Entry = LitElement & ModuleRecoveryEntry;
const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  vi.restoreAllMocks();
});
async function mount(
  prepare: Mock<(request: { proposal: unknown }) => Promise<unknown>> = vi.fn(
    async (request: { proposal: unknown }) => {
      const action = (request.proposal as { action: string }).action;
      if (action === "clock-challenge")
        return { id: "challenge", boxInstantMs: instant, expiresInMs: 5000 };
      if (action === "compare-clocks") return { id: "comparison", clock };
      if (action === "select") return selected;
      throw new Error("unexpected proposal");
    },
  ),
) {
  const factory = FISCAL_SETUP.createRecovery;
  expect(factory, "the fiscal contribution offers an hour recovery form").toBeTypeOf("function");
  const host = document.createElement("main");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = factory!({
    locale: "en",
    selection: { ...selection },
    binding: { ...binding },
    prepare,
  }) as Entry;
  host.append(el);
  await el.updateComplete;
  return { el, prepare, host };
}
function check(el: LitElement, name: string, value = true) {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  expect(input, `visible ${name} declaration`).not.toBeNull();
  input!.checked = value;
  input!.dispatchEvent(new Event("change", { bubbles: true }));
}
async function enterKey(el: Entry) {
  const key = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
  await key.updateComplete;
  for (const [name, value] of [
    ["printed-recovery-key", "06r9 t4fh m4h3 599j eemm 5d5d abtv 2rsx 6qdq we8m c"],
  ]) {
    const field = key.shadowRoot!.querySelector<LitElement>(`[name="${name}"]`)!;
    await field.updateComplete;
    const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
    input.value = value!;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }
}
/** The key, both statements and the details tick, which on their own send nothing. */
async function fill(el: Entry) {
  await enterKey(el);
  check(el, "recovery-old-box-stopped");
  check(el, "recovery-sole-operation");
  check(el, "recovery-details-confirmed");
  await el.updateComplete;
}
/** The page's one button's words, or undefined when it draws none. */
const action = (el: LitElement) =>
  el.shadowRoot!.querySelector("[data-test=compare]")?.textContent?.trim();
async function proceed(el: LitElement) {
  await vi.waitFor(() => {
    expect(["Proceed", "Continuar"]).toContain(action(el));
    expect(button(el, "compare").disabled).toBe(false);
  });
  await userEvent.click(button(el, "compare"));
  await el.updateComplete;
}
async function ready(el: Entry) {
  await fill(el);
  await proceed(el);
}
function button(el: LitElement, name: string) {
  const value = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    `[data-test="${name}"]`,
  );
  expect(value, `${name} action`).not.toBeNull();
  return value!;
}
const text = (el: LitElement) => el.shadowRoot!.textContent!.replace(/\s+/g, " ");
const remaining = (el: Entry) =>
  el.shadowRoot!.querySelector("[data-test=remaining]")?.textContent?.trim();
const actionsOf = (prepare: Mock<(request: { proposal: unknown }) => Promise<unknown>>) =>
  prepare.mock.calls.map(([r]) => (r.proposal as { action: string }).action);
const quiet = (el: Entry) => {
  const action = button(el, "compare") as HTMLElement & { disabled: boolean; variant: string };
  return { disabled: action.disabled, variant: action.variant };
};
const fakeClock = () =>
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
const WHY_WAIT = "Waiting to confirm the time, so no invoice series is ever repeated.";
const NOTHING_TO_DO = "Nothing to do; keep this page open.";
const WHY_SECOND =
  "So no invoice series is ever repeated, the box's time is compared with another device's or the internet's.";
const ON_BOX = "This screen is on the box itself, so it does not count.";
const RESTORE_DO =
  "Connect the box to the internet, or open this page on a phone or laptop on the venue's network that has the backup.";
const RESTORE_ENDS =
  "It carries on by itself once the box reaches the internet, or on the other device if you carry on there.";
const WHY_REFUSED = "No invoice series is created without a confirmed time";
const DIFFER = "It is very important that the server time is set correctly. Which time is correct:";
const noSecondClock = {
  ...clock,
  usable: clock.usable.filter((r) => r.source === "box"),
  unavailable: [
    { source: "browser", result: "unavailable" as const, reason: "same_machine" },
    { source: "internet", result: "unavailable" as const, reason: "offline" },
  ],
  secondClock: false,
};
/** A prepare double whose clock decision, held comparison and refusals a case can change. */
function scripted(answers: unknown[] = [selected]) {
  const state = {
    decision: clock as typeof clock,
    hold: undefined as Promise<void> | undefined,
    fail: false,
    refusal: undefined as unknown,
  };
  let compared = 0;
  const prepare = vi.fn(async (request: { proposal: unknown }) => {
    const action = (request.proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "select") {
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      if (answer instanceof Error || (answer as { code?: string })?.code) throw answer;
      return answer;
    }
    if (state.hold) await state.hold;
    if (state.refusal !== undefined) throw state.refusal;
    if (state.fail) {
      state.fail = false;
      throw new TypeError("Failed to fetch");
    }
    return { id: `comparison-${++compared}`, clock: state.decision };
  });
  return { state, prepare };
}
it("decodes the printed key and sends independent recovery declarations before selecting", async () => {
  const { el, prepare } = await mount();
  expect(el.shadowRoot!.querySelector("wt-textarea")).toBeNull();
  expect(el.readCredentials()).toBeNull();
  await ready(el);
  const requests = prepare.mock.calls.map(([r]) => r as unknown as Record<string, unknown>);
  expect(requests[0]).toEqual({
    binding,
    context: { selectedSourceId: selection.sourceId, oldBoxGone: true, soleRecovery: true },
    nodeRecoverySecret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    proposal: { action: "clock-challenge" },
  });
  expect(requests[1]).toMatchObject({
    proposal: {
      action: "compare-clocks",
      browser: { challengeId: "challenge", instantMs: expect.any(Number) },
    },
  });
  await vi.waitFor(() =>
    expect(el.readCredentials()).toEqual({
      recoveryOperation: { binding, input: selected.input },
      nodeRecoverySecret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
      recoveryContext: {
        selectedSourceId: selection.sourceId,
        oldBoxGone: true,
        soleRecovery: true,
      },
    }),
  );
  expect(prepare.mock.calls.at(-1)?.[0].proposal).toEqual({
    action: "select",
    comparisonId: "comparison",
  });
  expect(el.shadowRoot!.textContent).toContain("0CSQW");
  expect(el.shadowRoot!.textContent).not.toContain("AbCdEfGhIjKlMnOpQrStUvWxYz012345");
});
it.each([
  ["the old box has stopped", "recovery-old-box-stopped", "recovery-sole-operation"],
  ["this is the only restore", "recovery-sole-operation", "recovery-old-box-stopped"],
])(
  "with the key and the details tick in, Proceed needs the statement that %s, and a press without it sends nothing",
  async (_what, missing, given) => {
    const { el, prepare } = await mount();
    fakeClock();
    try {
      await enterKey(el);
      check(el, "recovery-details-confirmed");
      check(el, given);
      await el.updateComplete;
      const compare = button(el, "compare");
      await (compare as unknown as LitElement).updateComplete;
      expect(action(el)).toBe("Proceed");
      expect(compare.disabled).toBe(true);
      compare.shadowRoot!.querySelector("button")!.click();
      vi.advanceTimersByTime(200_000);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(prepare).not.toHaveBeenCalled();
      check(el, missing);
      await el.updateComplete;
      expect(button(el, "compare").disabled).toBe(false);
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  },
);
it.each([
  ["en", "These details are correct."],
  ["es", "Estos datos son correctos."],
] as const)(
  "%s: Proceed also needs the details tick, and ticking it sends nothing",
  async (locale, words) => {
    const { el, prepare } = await mount();
    el.locale = locale;
    await el.updateComplete;
    const tick = el.shadowRoot!.querySelector<HTMLInputElement>(
      'input[name="recovery-details-confirmed"]',
    )!;
    expect(tick.closest("label")!.textContent!.replace(/\s+/g, " ").trim()).toBe(`${words} *`);
    await enterKey(el);
    check(el, "recovery-old-box-stopped");
    check(el, "recovery-sole-operation");
    await el.updateComplete;
    expect(button(el, "compare").disabled).toBe(true);
    expect(el.readCredentials()).toBeNull();
    check(el, "recovery-details-confirmed");
    await el.updateComplete;
    expect(button(el, "compare").disabled).toBe(false);
    check(el, "recovery-details-confirmed", false);
    await el.updateComplete;
    expect(button(el, "compare").disabled).toBe(true);
    expect(prepare).not.toHaveBeenCalled();
  },
);
const RESTORE_SERIES_LINE =
  "When you press Proceed, Waitron creates new invoice series for this box, so its invoice numbers never repeat the old box's. The invoice series is the code at the start of every invoice number: for example, in A-0CSQW/1 the series is A-0CSQW.";
const seriesLine = (el: Entry) =>
  el.shadowRoot!.querySelector("[data-test=series-line]")?.textContent?.replace(/\s+/g, " ").trim();
it("the key, both statements and the details tick send nothing until Proceed, and the page says what Proceed does", async () => {
  const { prepare } = scripted();
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await fill(el);
    vi.advanceTimersByTime(200_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(prepare).not.toHaveBeenCalled();
    expect(seriesLine(el)).toBe(RESTORE_SERIES_LINE);
    await proceed(el);
    await vi.waitFor(() => expect(selects(prepare)).toHaveLength(1));
    await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
    expect(el.shadowRoot!.querySelector("[data-test=series-line]")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
it("the page says what Proceed does only while the button reads Proceed, not during the wait after it", async () => {
  const { prepare } = scripted([
    { status: "waiting", targetMs: instant + 84_000, remainingMs: 84_000 },
    selected,
  ]);
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await fill(el);
    expect(seriesLine(el)).toBe(RESTORE_SERIES_LINE);
    await proceed(el);
    await vi.waitFor(() => expect(remaining(el)).toBe("1:24"));
    expect(el.shadowRoot!.querySelector("[data-test=series-line]")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
const REFUSED_KEY = { code: "promotion.break_glass_invalid", params: {}, status: 403 };
/** The words under the printed key's own field. */
async function keyFieldError(el: Entry) {
  const key = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
  await key.updateComplete;
  const field = key.shadowRoot!.querySelector<LitElement & { error: string }>(
    '[name="printed-recovery-key"]',
  )!;
  await field.updateComplete;
  return field.error;
}
/** Proceed's enabled state, read on the host and on the native button inside it. */
async function proceedEnabled(el: Entry) {
  await el.updateComplete;
  const compare = button(el, "compare");
  await (compare as unknown as LitElement).updateComplete;
  expect(action(el)).toBe("Proceed");
  const native = compare.shadowRoot!.querySelector("button")!.disabled;
  expect(native).toBe(compare.disabled);
  return !compare.disabled;
}
it("after the box refuses the key, Proceed stays enabled, and pressing it sends the key again and makes the series", async () => {
  const { prepare } = scripted();
  prepare.mockImplementationOnce(async () => {
    throw REFUSED_KEY;
  });
  const { el } = await mount(prepare);
  await ready(el);
  await vi.waitFor(async () =>
    expect(await keyFieldError(el)).toBe("Check the key for this backup."),
  );
  expect(await proceedEnabled(el)).toBe(true);
  expect(prepare).toHaveBeenCalledTimes(1);
  await userEvent.click(button(el, "compare"));
  await vi.waitFor(() => expect(selects(prepare)).toHaveLength(1));
  await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
  expect(actionsOf(prepare)).toEqual([
    "clock-challenge",
    "clock-challenge",
    "compare-clocks",
    "select",
  ]);
});
it.each([
  ["a statement", "recovery-sole-operation"],
  ["the details tick", "recovery-details-confirmed"],
])(
  "after the box refuses the key, unticking %s disables Proceed and ticking it again enables it, and the key's error stays under the key until the key changes",
  async (_what, name) => {
    const { prepare } = scripted();
    prepare.mockImplementation(async () => {
      throw REFUSED_KEY;
    });
    const { el } = await mount(prepare);
    await ready(el);
    await vi.waitFor(async () =>
      expect(await keyFieldError(el)).toBe("Check the key for this backup."),
    );
    expect(await proceedEnabled(el)).toBe(true);
    check(el, name, false);
    expect(await proceedEnabled(el)).toBe(false);
    expect(await keyFieldError(el)).toBe("Check the key for this backup.");
    check(el, name, true);
    expect(await proceedEnabled(el)).toBe(true);
    expect(await keyFieldError(el)).toBe("Check the key for this backup.");
    expect(prepare).toHaveBeenCalledTimes(1);
    await userEvent.click(button(el, "compare"));
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () =>
      expect(await keyFieldError(el)).toBe("Check the key for this backup."),
    );
    await enterKey(el);
    expect(await keyFieldError(el)).toBe("");
    expect(await proceedEnabled(el)).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(2);
  },
);
it("while Proceed's request is sent, Proceed stays on screen in its own colour, busy, and a second press sends nothing", async () => {
  const { state, prepare } = scripted();
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => (release = resolve));
  const { el } = await mount(prepare);
  await ready(el);
  const compare = button(el, "compare") as HTMLElement & {
    disabled: boolean;
    loading: boolean;
    variant: string;
  };
  await vi.waitFor(() => expect(compare.loading).toBe(true));
  expect(action(el)).toBe("Proceed");
  expect(compare.variant).toBe("primary");
  await (compare as unknown as LitElement).updateComplete;
  expect(compare.shadowRoot!.querySelector("button")!.disabled).toBe(true);
  expect(compare.shadowRoot!.querySelector("button")!.getAttribute("aria-busy")).toBe("true");
  compare.click();
  await el.updateComplete;
  expect(actionsOf(prepare)).toEqual(["clock-challenge", "compare-clocks"]);
  release();
  await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
  expect(actionsOf(prepare)).toEqual(["clock-challenge", "compare-clocks", "select"]);
  expect(el.shadowRoot!.querySelector("[data-test=compare]")).toBeNull();
});
it("once the series are made, the page's one button is gone", async () => {
  const { el } = await mount();
  await ready(el);
  await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=compare]")).toBeNull();
});
it("asks no last-hour question and offers no clock confirmation", async () => {
  const { el } = await mount();
  await ready(el);
  expect(el.shadowRoot!.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  expect(el.shadowRoot!.querySelector("fieldset")).toBeNull();
  expect(el.shadowRoot!.querySelector('[name="recovery-clock-confirmed"]')).toBeNull();
  expect(text(el)).not.toContain("UTC hour");
});
it("keeps the server's wait", async () => {
  const prepare = vi.fn(async (request: { proposal: unknown }) => {
    const action = (request.proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks") return { id: "comparison", clock };
    return {
      status: "waiting",
      targetMs: Date.parse("2026-10-18T13:00:00Z"),
      remainingMs: 1_800_000,
    };
  });
  const { el } = await mount(prepare);
  await ready(el);
  await vi.waitFor(() => expect(remaining(el)).toBe("30:00"));
  expect(prepare.mock.calls.at(-1)?.[0].proposal).toEqual({
    action: "select",
    comparisonId: "comparison",
  });
  expect(el.readCredentials()).toBeNull();
  expect(action(el)).toBeUndefined();
});
it.each(["key", "isolation", "clear", "disconnect"])(
  "invalidates the selected input after %s changes",
  async (fault) => {
    const { el } = await mount();
    await ready(el);
    await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
    if (fault === "key") {
      const key = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
      const field = key.shadowRoot!.querySelector<LitElement>('[name="printed-recovery-key"]')!;
      const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
      input.value = "bad";
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    if (fault === "isolation") check(el, "recovery-sole-operation", false);
    if (fault === "clear") el.clear();
    if (fault === "disconnect") el.remove();
    expect(el.readCredentials()).toBeNull();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-clock=read]")).toBeNull();
  },
);
it("keeps a refused named key beside its native field and leaves Proceed enabled to send it again", async () => {
  const prepare = vi.fn(async () => {
    throw { code: "setup.request_invalid", params: { field: "nodeRecoverySecret" }, status: 400 };
  });
  const { el } = await mount(prepare);
  await ready(el);
  await vi.waitFor(() =>
    expect(
      (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
    ).toBe("Could not complete this step."),
  );
  const key = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
  await key.updateComplete;
  const field = key.shadowRoot!.querySelector<LitElement & { error: string }>(
    '[name="printed-recovery-key"]',
  )!;
  await field.updateComplete;
  expect(field.error).toBe("Check the key for this backup.");
  expect(button(el, "compare").disabled).toBe(false);
});
it("does not accept selected material for a different operation", async () => {
  const prepare = vi.fn(async (request: { proposal: unknown }) => {
    const action = (request.proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks") return { id: "comparison", clock };
    return { ...selected, binding: { ...binding, sourceId: "another-copy" } };
  });
  const { el } = await mount(prepare);
  await ready(el);
  await vi.waitFor(() =>
    expect(
      (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
    ).toBe("Could not complete this step."),
  );
  expect(el.readCredentials()).toBeNull();
});
it.each([[null], [{ code: "", purpose: "full" }], [{ purpose: "full" }]])(
  "does not accept selected material whose series entries are not usable: %j",
  async (entry) => {
    const { prepare } = scripted([
      { ...selected, input: { allocation: { ...selected.input.allocation, series: [entry] } } },
    ]);
    const { el } = await mount(prepare);
    await ready(el);
    await vi.waitFor(() =>
      expect(
        (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
      ).toBe("Could not complete this step."),
    );
    expect(action(el)).toBe("Try again");
    expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).toBeNull();
    expect(el.readCredentials()).toBeNull();
  },
);
it("ignores a selected response after the sole-recovery declaration changes", async () => {
  let release!: (value: unknown) => void;
  const held = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const prepare = vi.fn(async (request: { proposal: unknown }) => {
    const action = (request.proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks") return { id: "comparison", clock };
    return held;
  });
  const { el } = await mount(prepare);
  await enterKey(el);
  check(el, "recovery-old-box-stopped");
  check(el, "recovery-sole-operation");
  check(el, "recovery-details-confirmed");
  await proceed(el);
  await vi.waitFor(() =>
    expect(prepare.mock.calls.at(-1)?.[0].proposal).toEqual({
      action: "select",
      comparisonId: "comparison",
    }),
  );
  check(el, "recovery-sole-operation", false);
  release(selected);
  await held;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await el.updateComplete;
  expect(el.readCredentials()).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).toBeNull();
});
it("marks each missing declaration after an attempted recovery", async () => {
  const { el } = await mount();
  expect(el.readCredentials()).toBeNull();
  await el.updateComplete;
  for (const name of [
    "recovery-old-box-stopped",
    "recovery-sole-operation",
    "recovery-details-confirmed",
  ]) {
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(
      el
        .shadowRoot!.querySelector(`#${input.getAttribute("aria-describedby")}`)!
        .textContent!.trim(),
    ).not.toBe("");
  }
});
it("clears a parent request's key refusal when the printed control is edited", async () => {
  const { el } = await mount();
  await ready(el);
  el.errorMessage = "This backup needs its older key.";
  el.refusedField = "nodeRecoverySecret";
  await el.updateComplete;
  const edited: string[] = [];
  el.addEventListener("recovery-field-edited", (event) =>
    edited.push((event as CustomEvent).detail.field),
  );
  const key = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
  await key.updateComplete;
  const field = key.shadowRoot!.querySelector<LitElement & { error: string }>(
    '[name="printed-recovery-key"]',
  )!;
  await field.updateComplete;
  expect(field.error).toBe("This backup needs its older key.");
  expect(
    (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
  ).not.toContain("This backup needs its older key.");
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.value = input.value.toUpperCase();
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  await key.updateComplete;
  await field.updateComplete;
  expect(field.error).toBe("");
  expect(edited).toEqual(["nodeRecoverySecret"]);
});
it("drops a late selected answer after the matching printed key changes", async () => {
  let release!: (value: unknown) => void;
  const held = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const prepare = vi.fn(async (request: { proposal: unknown }) => {
    const action = (request.proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks") return { id: "comparison", clock };
    return held;
  });
  const { el } = await mount(prepare);
  await enterKey(el);
  check(el, "recovery-old-box-stopped");
  check(el, "recovery-sole-operation");
  check(el, "recovery-details-confirmed");
  await proceed(el);
  await vi.waitFor(() =>
    expect(prepare.mock.calls.at(-1)?.[0].proposal).toEqual({
      action: "select",
      comparisonId: "comparison",
    }),
  );
  const key = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
  const field = key.shadowRoot!.querySelector<LitElement>('[name="printed-recovery-key"]')!;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.value = "bad";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  release(selected);
  await held;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await el.updateComplete;
  expect(el.readCredentials()).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).toBeNull();
});
it("both actions expose a visible native button", async () => {
  const { el } = await mount();
  for (const name of ["compare", "clear"]) {
    const action = button(el, name) as LitElement & { disabled: boolean };
    await action.updateComplete;
    const native = action.shadowRoot!.querySelector("button")!;
    expect(native.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(native.getBoundingClientRect().height).toBeGreaterThan(0);
  }
});
it("explains a missing key at its real field and focuses it after an attempted recovery", async () => {
  const { el } = await mount();
  el.readCredentials();
  await el.updateComplete;
  const key = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
  await key.updateComplete;
  const field = key.shadowRoot!.querySelector<LitElement & { error: string }>(
    '[name="printed-recovery-key"]',
  )!;
  await field.updateComplete;
  expect(field.error).not.toBe("");
  await vi.waitFor(() =>
    expect(field.shadowRoot!.activeElement).toBe(field.shadowRoot!.querySelector("input")),
  );
});
class RecoveryShell extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<slot></slot
      >${this.leave.render({ heading: "Discard?", message: "Unsaved recovery", keepLabel: "Keep editing", discardLabel: "Discard" })}`;
  }
}
customElements.define("recovery-hour-test-shell", RecoveryShell);
it("tracks declarations and clears native fields and selected input on Discard", async () => {
  const shell = document.createElement("recovery-hour-test-shell") as RecoveryShell;
  document.body.append(shell);
  hosts.push(shell);
  await shell.updateComplete;
  const { el } = await mount();
  shell.append(el);
  await el.updateComplete;
  await ready(el);
  await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
  expect(shell.leave.coordinator.isDirty([el])).toBe(true);
  const pending = shell.leave.coordinator.request({
    scopes: [el],
    reason: "navigation",
    proceed() {},
  });
  await shell.updateComplete;
  shell.shadowRoot!.querySelector("wt-unsaved-changes")!.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(await pending).toBe("proceeded");
  await el.updateComplete;
  expect(el.readCredentials()).toBeNull();
  const key = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
  await key.updateComplete;
  const field = key.shadowRoot!.querySelector<LitElement>('[name="printed-recovery-key"]')!;
  await field.updateComplete;
  expect(field.shadowRoot!.querySelector<HTMLInputElement>("input")!.value).toBe("");
  expect(
    el.shadowRoot!.querySelector<HTMLInputElement>('[name="recovery-old-box-stopped"]')!.checked,
  ).toBe(false);
  expect(shell.leave.coordinator.isDirty([el])).toBe(false);
});
it("places the recovery authenticator's real refusal beside the key and leaves Proceed enabled to send it again", async () => {
  const { el } = await mount(
    vi.fn(async () => {
      throw { code: "promotion.break_glass_invalid", params: {}, status: 403 };
    }),
  );
  await ready(el);
  await vi.waitFor(() =>
    expect(
      (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
    ).not.toBe(""),
  );
  const key = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
  await key.updateComplete;
  const field = key.shadowRoot!.querySelector<LitElement & { error: string }>(
    '[name="printed-recovery-key"]',
  )!;
  await field.updateComplete;
  expect(field.error).toBe("Check the key for this backup.");
  expect(button(el, "compare").disabled).toBe(false);
});
it.each([
  { releaseBlocked: true, rangeBlocked: false },
  { releaseBlocked: false, rangeBlocked: true },
])("sends no select while the clock has a blocking condition %j", async (blocking) => {
  const prepare = vi.fn(async (request: { proposal: unknown }) =>
    (request.proposal as { action: string }).action === "clock-challenge"
      ? { id: "challenge" }
      : { id: "comparison", clock: { ...clock, ...blocking } },
  );
  const { el } = await mount(prepare);
  await ready(el);
  expect(selects(prepare)).toEqual([]);
});
it("a box clock before this release shows only the release line", async () => {
  const prepare = vi.fn(async (request: { proposal: unknown }) => {
    const action = (request.proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks")
      return { id: "comparison", clock: { ...clock, releaseBlocked: true } };
    throw { code: "sif.allocation_invalid", params: { reason: "clock_unconfirmed" } };
  });
  const { el } = await mount(prepare);
  await ready(el);
  await vi.waitFor(() => expect(button(el, "compare").disabled).toBe(false));
  expect(text(el)).toContain("Box time precedes this Waitron release.");
  expect(formError(el)).toBe("");
});
it("sends no installation code", async () => {
  const { el, prepare } = await mount();
  await ready(el);
  await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
  expect(prepare.mock.calls.at(-1)?.[0].proposal).toEqual({
    action: "select",
    comparisonId: "comparison",
  });
});

it("has no installation-code field", async () => {
  const { el } = await mount();
  expect(el.shadowRoot!.querySelector('[name="recovery-installation-codes"]')).toBeNull();
});

const selects = (prepare: Mock<(request: { proposal: unknown }) => Promise<unknown>>) =>
  prepare.mock.calls
    .map(([r]) => r.proposal as { action: string })
    .filter((p) => p.action === "select");
it("explains a waiting restore with a countdown that goes back to the server at zero", async () => {
  const { prepare } = scripted([
    { status: "waiting", targetMs: instant + 84_000, remainingMs: 84_000 },
    selected,
  ]);
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(remaining(el)).toBeDefined());
    vi.advanceTimersByTime(0);
    await el.updateComplete;
    expect(text(el)).toContain(WHY_WAIT);
    expect(text(el)).toContain(NOTHING_TO_DO);
    expect(text(el)).toContain("Continues in 1:24");
    expect(
      el.shadowRoot!.querySelector("[data-test=remaining]")!.closest("[role=timer]"),
    ).not.toBeNull();
    vi.advanceTimersByTime(1_000);
    await el.updateComplete;
    expect(remaining(el)).toBe("1:23");
    expect(el.readCredentials()).toBeNull();
    vi.advanceTimersByTime(83_000);
    await vi.waitFor(() => expect(selects(prepare)).toHaveLength(2));
    const sequence = actionsOf(prepare);
    const first = sequence.indexOf("select"),
      second = sequence.lastIndexOf("select");
    expect(sequence.slice(first + 1, second)).toEqual(["clock-challenge", "compare-clocks"]);
    expect(selects(prepare)).toEqual([
      { action: "select", comparisonId: "comparison-1" },
      { action: "select", comparisonId: "comparison-2" },
    ]);
    await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
    expect(text(el)).toContain("0CSQW");
  } finally {
    vi.useRealTimers();
  }
});
it("a countdown reaching zero accepts nothing the server did not select", async () => {
  const { prepare } = scripted([
    { status: "waiting", targetMs: instant + 1_000, remainingMs: 1_000 },
    { status: "waiting", targetMs: instant + 31_000, remainingMs: 30_000 },
  ]);
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(remaining(el)).toBe("0:01"));
    vi.advanceTimersByTime(1_000);
    await vi.waitFor(() => expect(selects(prepare)).toHaveLength(2));
    await vi.waitFor(() => expect(remaining(el)).toBeDefined());
    vi.advanceTimersByTime(0);
    await el.updateComplete;
    expect(remaining(el)).toBe("0:30");
    expect(el.readCredentials()).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
it("clocks that differ explain the refusal, not a failure", async () => {
  const { state, prepare } = scripted();
  state.decision = {
    ...clock,
    usable: [
      { source: "box", lowerMs: instant, upperMs: instant },
      { source: "browser", lowerMs: instant + 45_000, upperMs: instant + 45_000 },
    ],
    disagreement: true,
  };
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(text(el)).toContain(DIFFER));
    expect(text(el)).not.toContain(WHY_REFUSED);
    expect(text(el)).not.toMatch(/ask for help/);
    expect(
      (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
    ).toBe("");
    const before = prepare.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    await el.updateComplete;
    expect(prepare.mock.calls).toHaveLength(before);
    expect(quiet(el)).toEqual({ disabled: false, variant: "primary" });
  } finally {
    vi.useRealTimers();
  }
});
it("with no second clock it explains itself and carries on when the internet arrives", async () => {
  const { state, prepare } = scripted();
  state.decision = noSecondClock;
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(text(el)).toContain(RESTORE_DO));
    expect(text(el)).toContain(WHY_SECOND);
    expect(text(el)).toContain(ON_BOX);
    expect(text(el)).toContain(RESTORE_ENDS);
    expect(
      (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
    ).toBe("");
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
    expect(selects(prepare)).toHaveLength(0);
    state.decision = clock;
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(selects(prepare)).toHaveLength(1));
    await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
  } finally {
    vi.useRealTimers();
  }
});
it("a phone with no second clock does not say it is the box", async () => {
  const { state, prepare } = scripted();
  state.decision = {
    ...noSecondClock,
    unavailable: [
      { source: "browser", result: "unavailable" as const, reason: "challenge" },
      { source: "internet", result: "unavailable" as const, reason: "offline" },
    ],
  };
  const { el } = await mount(prepare);
  await ready(el);
  await vi.waitFor(() => expect(text(el)).toContain(RESTORE_DO));
  expect(text(el)).toContain(WHY_SECOND);
  expect(text(el)).not.toContain(ON_BOX);
});
it("a clock refusal shows each clock's reading and no countdown, and waits for Compare the clocks again", async () => {
  const { state, prepare } = scripted();
  state.decision = {
    ...clock,
    usable: [
      { source: "box", lowerMs: instant, upperMs: instant },
      { source: "browser", lowerMs: instant + 45_000, upperMs: instant + 45_000 },
    ],
    unavailable: [{ source: "internet", result: "unavailable" as const, reason: "offline" }],
    disagreement: true,
  };
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(text(el)).toContain(DIFFER));
    expect(text(el)).not.toContain(WHY_REFUSED);
    expect(text(el)).not.toMatch(/ask for help/);
    expect(detailRows(el, "clock-times")).toEqual([
      ["Server time", "18 October 2026 at 14:30:00"],
      ["This device", "18 October 2026 at 14:30:45"],
    ]);
    expect(text(el)).not.toContain(new Date(instant).toISOString());
    expect(text(el)).not.toContain(new Date(instant + 45_000).toISOString());
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
    expect(selects(prepare)).toHaveLength(0);
    const before = prepare.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    await el.updateComplete;
    expect(prepare.mock.calls).toHaveLength(before);
    expect(button(el, "compare").textContent?.trim()).toBe("Compare the clocks again");
    await userEvent.click(button(el, "compare"));
    await vi.waitFor(() => expect(prepare.mock.calls.length).toBeGreaterThan(before));
    expect(actionsOf(prepare).slice(before)).toEqual(
      expect.arrayContaining(["clock-challenge", "compare-clocks"]),
    );
  } finally {
    vi.useRealTimers();
  }
});
it("a clock refusal from the server explains itself the same way", async () => {
  const { prepare } = scripted([
    { code: "sif.allocation_invalid", params: { reason: "clock_disagreement" } },
  ]);
  const { el } = await mount(prepare);
  await ready(el);
  await vi.waitFor(() => expect(text(el)).toContain(DIFFER));
  expect(text(el)).not.toMatch(/ask for help/);
});
it("a missing second clock reported by the server starts the 15-second check", async () => {
  const { prepare } = scripted([
    { code: "sif.allocation_invalid", params: { reason: "second_clock_missing" } },
    selected,
  ]);
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(text(el)).toContain(RESTORE_DO));
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(selects(prepare)).toHaveLength(2));
    await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
  } finally {
    vi.useRealTimers();
  }
});
it("a later minute in use is explained and does not count down", async () => {
  const { prepare } = scripted([
    {
      code: "sif.allocation_invalid",
      params: { reason: "minute_not_later", allowedFromMs: Date.parse("2026-10-18T20:04:00Z") },
    },
  ]);
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() =>
      expect(text(el)).toContain(
        "The invoice series cannot be created yet: this box's clock is earlier than a time it has already used for invoice series.",
      ),
    );
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
    vi.advanceTimersByTime(60_000);
    await el.updateComplete;
    expect(selects(prepare)).toHaveLength(1);
    expect(el.readCredentials()).toBeNull();
    expect(button(el, "compare").disabled).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
it("a minute in use shows one countdown, checks again quietly and keeps saying why", async () => {
  const { prepare } = scripted([
    {
      code: "sif.allocation_invalid",
      params: {
        reason: "minute_in_use",
        allowedFromMs: instant + 180_000,
        remainingMs: 180_000,
        recheckInMs: 30_000,
      },
    },
    { status: "waiting", targetMs: instant + 180_000, remainingMs: 150_000 },
  ]);
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    const taken = () =>
      el
        .shadowRoot!.querySelector("[data-test=minute-taken]")
        ?.textContent?.replace(/\s+/g, " ")
        .trim();
    await vi.waitFor(() =>
      expect(taken()).toBe(
        "This invoice series code has already been used. Waitron creates a new one by itself when the countdown ends.",
      ),
    );
    expect(remaining(el)).toBe("03:00");
    expect(text(el)).toContain("New invoice series in 03:00");
    vi.advanceTimersByTime(30_000);
    await vi.waitFor(() => expect(selects(prepare)).toHaveLength(2));
    await el.updateComplete;
    expect(taken()).toBe(
      "This invoice series code has already been used. Waitron creates a new one by itself when the countdown ends.",
    );
    expect(remaining(el)).toBe("02:30");
    expect(el.shadowRoot!.querySelector("[data-test=minute-in-use]")).toBeNull();
    expect(el.readCredentials()).toBeNull();
    expect(action(el)).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});
it("a lost re-check during a taken minute keeps counting and checks again", async () => {
  const { prepare } = scripted([
    {
      code: "sif.allocation_invalid",
      params: {
        reason: "minute_in_use",
        allowedFromMs: instant + 180_000,
        remainingMs: 180_000,
        recheckInMs: 30_000,
      },
    },
    new TypeError("Failed to fetch"),
    { status: "waiting", targetMs: instant + 180_000, remainingMs: 135_000 },
  ]);
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(remaining(el)).toBe("03:00"));
    vi.advanceTimersByTime(30_000);
    await vi.waitFor(() => expect(selects(prepare)).toHaveLength(2));
    vi.advanceTimersByTime(1_000);
    await el.updateComplete;
    expect(remaining(el)).toBe("02:29");
    expect(text(el)).toContain(
      "This invoice series code has already been used. Waitron creates a new one by itself when the countdown ends.",
    );
    expect(
      (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
    ).toBe("");
    vi.advanceTimersByTime(14_000);
    await vi.waitFor(() => expect(selects(prepare)).toHaveLength(3));
    await el.updateComplete;
    expect(remaining(el)).toBe("02:15");
    expect(text(el)).toContain(
      "This invoice series code has already been used. Waitron creates a new one by itself when the countdown ends.",
    );
  } finally {
    vi.useRealTimers();
  }
});
it("an answer it cannot read during a taken minute shows the failure", async () => {
  const { prepare } = scripted([
    {
      code: "sif.allocation_invalid",
      params: {
        reason: "minute_in_use",
        allowedFromMs: instant + 180_000,
        remainingMs: 180_000,
        recheckInMs: 30_000,
      },
    },
    { status: "waiting", targetMs: "soon", remainingMs: 150_000 },
  ]);
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(remaining(el)).toBe("03:00"));
    vi.advanceTimersByTime(30_000);
    await vi.waitFor(() =>
      expect(
        (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
      ).not.toBe(""),
    );
    expect(remaining(el)).toBeUndefined();
    vi.advanceTimersByTime(60_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(selects(prepare)).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});
it("keeps the countdown's explanation on screen while its re-check is in flight", async () => {
  const { state, prepare } = scripted([
    { status: "waiting", targetMs: instant + 1_000, remainingMs: 1_000 },
  ]);
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(remaining(el)).toBe("0:01"));
    let release!: () => void;
    state.hold = new Promise((resolve) => {
      release = resolve;
    });
    vi.advanceTimersByTime(1_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(text(el)).toContain(WHY_WAIT);
    release();
  } finally {
    vi.useRealTimers();
  }
});
it("keeps checking for a second clock after one automatic re-check is lost", async () => {
  const { state, prepare } = scripted();
  state.decision = noSecondClock;
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(text(el)).toContain(RESTORE_DO));
    let release!: () => void;
    state.hold = new Promise((resolve) => {
      release = resolve;
    });
    const before = prepare.mock.calls.length;
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(prepare.mock.calls.length).toBeGreaterThan(before));
    await el.updateComplete;
    expect(text(el)).toContain(RESTORE_DO);
    state.fail = true;
    release();
    await vi.waitFor(() => expect(state.fail).toBe(false));
    state.hold = undefined;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(text(el)).toContain(RESTORE_DO);
    state.decision = clock;
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(selects(prepare)).toHaveLength(1));
  } finally {
    vi.useRealTimers();
  }
});
it("stops checking for a second clock when a re-check is refused, and shows the failure", async () => {
  const { state, prepare } = scripted();
  state.decision = noSecondClock;
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(text(el)).toContain(RESTORE_DO));
    state.refusal = { code: "setup.attempt_conflict" };
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() =>
      expect(
        (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
      ).not.toBe(""),
    );
    await el.updateComplete;
    expect(text(el)).not.toContain(RESTORE_ENDS);
    expect(quiet(el)).toEqual({ disabled: false, variant: "primary" });
    const after = prepare.mock.calls.length;
    vi.advanceTimersByTime(45_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prepare.mock.calls).toHaveLength(after);
  } finally {
    vi.useRealTimers();
  }
});
it("an answer it cannot read while waiting for a second clock shows the failure", async () => {
  const { state, prepare } = scripted();
  state.decision = noSecondClock;
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(text(el)).toContain(RESTORE_DO));
    // A comparison with no readings lists, which `readClocks` refuses as "invalid comparison".
    state.decision = {} as typeof clock;
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() =>
      expect(
        (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
      ).not.toBe(""),
    );
    await el.updateComplete;
    expect(text(el)).not.toContain(RESTORE_ENDS);
    expect(quiet(el)).toEqual({ disabled: false, variant: "primary" });
    const after = prepare.mock.calls.length;
    vi.advanceTimersByTime(45_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prepare.mock.calls).toHaveLength(after);
  } finally {
    vi.useRealTimers();
  }
});
it("an edit to a declaration stops the wait, and putting it back sends nothing until Proceed", async () => {
  const { prepare } = scripted([
    { status: "waiting", targetMs: instant + 1_000, remainingMs: 1_000 },
    selected,
  ]);
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(remaining(el)).toBe("0:01"));
    check(el, "recovery-old-box-stopped", false);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
    check(el, "recovery-old-box-stopped");
    await el.updateComplete;
    vi.advanceTimersByTime(200_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(selects(prepare)).toHaveLength(1);
    await proceed(el);
    await vi.waitFor(() => expect(selects(prepare)).toHaveLength(2));
  } finally {
    vi.useRealTimers();
  }
});
it("an edit to the details tick stops the wait, and putting it back sends nothing until Proceed, as a statement does", async () => {
  const { prepare } = scripted([
    { status: "waiting", targetMs: instant + 1_000, remainingMs: 1_000 },
    selected,
  ]);
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(remaining(el)).toBe("0:01"));
    check(el, "recovery-details-confirmed", false);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
    expect(el.readCredentials()).toBeNull();
    check(el, "recovery-details-confirmed");
    await el.updateComplete;
    vi.advanceTimersByTime(200_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(selects(prepare)).toHaveLength(1);
    await proceed(el);
    await vi.waitFor(() => expect(selects(prepare)).toHaveLength(2));
  } finally {
    vi.useRealTimers();
  }
});
it("explains each wait in Spanish with the restore page's words", async () => {
  const { state, prepare } = scripted([
    { status: "waiting", targetMs: instant + 84_000, remainingMs: 84_000 },
  ]);
  const { el } = await mount(prepare);
  state.decision = noSecondClock;
  el.locale = "es";
  await el.updateComplete;
  expect(seriesLine(el)).toBe(
    "Cuando pulses Continuar, Waitron creará series de facturas nuevas para este servidor, para que sus números de factura nunca repitan los del servidor anterior. La serie de facturas es el código al principio de cada número de factura: por ejemplo, en A-0CSQW/1 la serie es A-0CSQW.",
  );
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() =>
      expect(text(el)).toContain(
        "Conecta el servidor a internet, o abre esta página desde un móvil o un portátil del local que tenga la copia.",
      ),
    );
    expect(text(el)).toContain(
      "Para que ninguna serie de facturas se repita, la hora del servidor se compara con la de otro aparato o con internet.",
    );
    expect(text(el)).toContain("Esta pantalla está en el propio servidor y no cuenta.");
    expect(text(el)).toContain(
      "Sigue sola cuando el servidor tenga internet, o en el otro aparato si sigues allí.",
    );
    state.decision = {
      ...clock,
      usable: [
        { source: "box", lowerMs: instant, upperMs: instant },
        { source: "browser", lowerMs: instant + 45_000, upperMs: instant + 45_000 },
      ],
      disagreement: true,
    };
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() =>
      expect(text(el)).toContain(
        "Es muy importante que la hora del servidor sea correcta. ¿Cuál es la correcta?",
      ),
    );
    expect(text(el)).not.toMatch(/pide ayuda/);
    expect(text(el)).not.toContain("Sin una hora confirmada");
    expect(button(el, "compare").textContent?.trim()).toBe("Volver a comparar los relojes");
    state.decision = clock;
    await userEvent.click(button(el, "compare"));
    await vi.waitFor(() => expect(remaining(el)).toBeDefined());
    expect(text(el)).toContain(
      "Esperamos a confirmar la hora para que ninguna serie de facturas se repita.",
    );
    expect(text(el)).toContain("No hace falta hacer nada; deja esta página abierta.");
    expect(text(el)).toContain("Sigue en");
  } finally {
    vi.useRealTimers();
  }
});
it("says in Spanish that the series code already exists, with the countdown", async () => {
  const { prepare } = scripted([
    {
      code: "sif.allocation_invalid",
      params: {
        reason: "minute_in_use",
        allowedFromMs: instant + 180_000,
        remainingMs: 180_000,
        recheckInMs: 30_000,
      },
    },
  ]);
  const { el } = await mount(prepare);
  el.locale = "es";
  await el.updateComplete;
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() =>
      expect(text(el)).toContain(
        "Este código de serie de facturas ya se ha usado. Waitron creará otro por sí solo cuando termine la cuenta atrás.",
      ),
    );
    expect(text(el)).toContain("Nueva serie de facturas en 03:00");
  } finally {
    vi.useRealTimers();
  }
});
it.each([
  [
    "en",
    "The invoice series cannot be created. This is a fault in Waitron. Reload this page and start the restore again: a new restore creates new invoice series.",
  ],
  [
    "es",
    "No se pueden crear las series de facturas. Es un fallo de Waitron. Recarga esta página y vuelve a empezar la restauración: una restauración nueva crea series de facturas nuevas.",
  ],
] as const)(
  "a stored pick found taken names the fault and how to start the restore again (%s)",
  async (locale, words) => {
    const { prepare } = scripted([
      { code: "sif.allocation_invalid", params: { reason: "minute_in_use" } },
    ]);
    const { el } = await mount(prepare);
    el.locale = locale;
    await el.updateComplete;
    await ready(el);
    await vi.waitFor(() =>
      expect(
        el
          .shadowRoot!.querySelector("[data-test=minute-in-use]")
          ?.textContent?.replace(/\s+/g, " ")
          .trim(),
      ).toBe(words),
    );
  },
);
it.each([
  ["en", "The invoice series cannot be created. This is a fault in Waitron."],
  ["es", "No se pueden crear las series de facturas. Es un fallo de Waitron."],
] as const)(
  "a handover start found taken names the fault and never sends the person to a restore (%s)",
  async (locale, words) => {
    const host = document.createElement("main");
    applyTokens(host);
    document.body.append(host);
    hosts.push(host);
    const el = FISCAL_SETUP.createPromotion!({
      locale,
      timeZone: "UTC",
      binding: promotionBinding,
      prepare: async (proposal) => {
        const action = (proposal as { action: string }).action;
        if (action === "clock-challenge") return { id: "challenge" };
        if (action === "compare-clocks") return { id: "comparison", clock };
        throw { code: "sif.allocation_invalid", params: { reason: "minute_in_use" } };
      },
    }) as LitElement & ModulePromotionEntry;
    host.append(el);
    await el.updateComplete;
    check(el, "recovery-details-confirmed");
    await proceed(el);
    await vi.waitFor(() =>
      expect(
        el
          .shadowRoot!.querySelector("[data-test=minute-in-use]")
          ?.textContent?.replace(/\s+/g, " ")
          .trim(),
      ).toBe(words),
    );
  },
);
it("says in Spanish that the series cannot be made yet", async () => {
  const { prepare } = scripted([
    {
      code: "sif.allocation_invalid",
      params: { reason: "minute_not_later", allowedFromMs: Date.parse("2026-10-18T20:04:00Z") },
    },
  ]);
  const { el } = await mount(prepare);
  el.locale = "es";
  await el.updateComplete;
  await ready(el);
  await vi.waitFor(() =>
    expect(text(el)).toContain(
      "Todavía no se pueden crear las series de facturas: la hora de este servidor es anterior a una hora que ya usó para series de facturas.",
    ),
  );
});
it("keeps the 15-second rhythm when a re-check again finds no second clock", async () => {
  const { state, prepare } = scripted();
  state.decision = noSecondClock;
  const { el } = await mount(prepare);
  fakeClock();
  try {
    await ready(el);
    await vi.waitFor(() => expect(text(el)).toContain(RESTORE_DO));
    let release!: () => void;
    state.hold = new Promise((resolve) => {
      release = resolve;
    });
    const compares = () => actionsOf(prepare).filter((a) => a === "compare-clocks").length;
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(compares()).toBe(2));
    vi.advanceTimersByTime(10_000);
    state.hold = undefined;
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(text(el)).toContain(RESTORE_DO);
    vi.advanceTimersByTime(5_000);
    await vi.waitFor(() => expect(compares()).toBe(3));
  } finally {
    vi.useRealTimers();
  }
});

const formError = (el: Entry) =>
  (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error;

it.each([
  ["challenge", { challenge: { id: 7 } }, ["clock-challenge"]],
  [
    "comparison",
    { comparison: { id: "comparison", clock: {} } },
    ["clock-challenge", "compare-clocks"],
  ],
])(
  "a malformed %s from the box fails the comparison and shows no readings",
  async (_name, answers, sent) => {
    const prepare = vi.fn(async (request: { proposal: unknown }) => {
      const action = (request.proposal as { action: string }).action;
      if (action === "clock-challenge")
        return (answers as { challenge?: unknown }).challenge ?? { id: "challenge" };
      if (action === "compare-clocks")
        return (answers as { comparison?: unknown }).comparison ?? { id: "comparison", clock };
      throw new Error("unexpected proposal");
    });
    const { el } = await mount(prepare);
    await ready(el);
    await vi.waitFor(() => expect(formError(el)).not.toBe(""));
    expect(el.shadowRoot!.querySelector("[data-clock=read]")).toBeNull();
    expect(actionsOf(prepare)).toEqual(sent);
    expect(el.readCredentials()).toBeNull();
  },
);

it("a wait from the box with no target fails instead of counting down", async () => {
  const { prepare } = scripted([{ status: "waiting", remainingMs: 90_000 }]);
  const { el } = await mount(prepare);
  await ready(el);
  await vi.waitFor(() => expect(formError(el)).not.toBe(""));
  expect(remaining(el)).toBeUndefined();
  expect(text(el)).not.toContain(WHY_WAIT);
  expect(el.readCredentials()).toBeNull();
});

it("a fiscal refusal that is not about the clock fails without explaining a wait", async () => {
  const { prepare } = scripted([
    { code: "sif.allocation_invalid", params: { reason: "event_mismatch" } },
  ]);
  const { el } = await mount(prepare);
  await ready(el);
  await vi.waitFor(() => expect(formError(el)).not.toBe(""));
  expect(text(el)).not.toContain(WHY_WAIT);
  expect(text(el)).not.toContain(WHY_REFUSED);
  expect(text(el)).not.toContain(RESTORE_DO);
  expect(el.readCredentials()).toBeNull();
});
it("names the box's own clock reading «Servidor» in Spanish, apart from a till", async () => {
  const { el } = await pressed(undefined, { ...clock, disagreement: true });
  el.locale = "es";
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=clock-times]")).not.toBeNull(),
  );
  const labels = [...el.shadowRoot!.querySelectorAll("[data-test=clock-times] dt")].map((dt) =>
    dt.textContent!.trim(),
  );
  expect(labels).toEqual(["Hora del servidor", "Este dispositivo", "Internet"]);
});

const observationKey = 'waitron.invoiceEvidence.v1:["B12345674","production","A-0CNNY"]';
const observation = {
  taxpayerId: "B12345674",
  environment: "production",
  series: "A-0CNNY",
  invoiceNumber: "A-0CNNY/9007199254740993",
  issuedDate: "2026-10-16",
  recordEvidence: "A".repeat(64),
};
afterEach(() => localStorage.removeItem(observationKey));

it("the invoices seen on this device keep their plain list; only Check this venue's rows sit in a label and value grid", async () => {
  localStorage.setItem(observationKey, JSON.stringify(observation));
  const { el } = await mount();
  const style = (selector: string) => getComputedStyle(el.shadowRoot!.querySelector(selector)!);
  expect(style("[data-test=device-invoices] dl > dd").textAlign).toBe("start");
  expect(style("[data-test=device-invoices] dl > dd").minWidth).toBe("auto");
  expect(style("[data-test=venue-review]").display).toBe("grid");
  expect(style("[data-test=venue-review] > div").display).toBe("contents");
  expect(style("[data-test=venue-review] dd").textAlign).toBe("start");
  const space = getComputedStyle(el).getPropertyValue("--wt-space-3").trim();
  expect(space).toMatch(/px$/);
  for (const list of ["[data-test=device-invoices] dl", "[data-test=venue-review]"]) {
    expect(style(list).marginBlockStart, list).toBe(space);
    expect(style(list).marginBlockEnd, list).toBe(space);
  }
});
it("shows the returning device's old-series observation without sending it as recovery authority", async () => {
  localStorage.setItem(observationKey, JSON.stringify(observation));
  const { el, prepare } = await mount();
  const report = el.shadowRoot!.querySelector("[data-test=device-invoices]");
  expect(report, "the recovery form reports this browser's retained invoice").not.toBeNull();
  expect(report!.textContent).toContain("A-0CNNY/9007199254740993");
  expect(report!.textContent).toContain("2026-10-16");
  expect(report!.textContent).toContain("A".repeat(64));
  expect(report!.textContent).toContain("Invoices seen on this device");
  expect(report!.textContent).toContain("The list may be incomplete");
  expect(report!.textContent).not.toContain("Recovery still uses new invoice series");
  expect(report!.textContent).not.toContain("invoice series");
  expect(report!.querySelectorAll("input, wt-input, wt-select, button, wt-button")).toHaveLength(0);
  await ready(el);
  await vi.waitFor(() => expect(text(el)).toContain("0CSQW"));
  expect(el.readCredentials()).toEqual({
    recoveryOperation: { binding, input: selected.input },
    nodeRecoverySecret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    recoveryContext: { selectedSourceId: selection.sourceId, oldBoxGone: true, soleRecovery: true },
  });
  expect(JSON.stringify(prepare.mock.calls)).not.toContain("9007199254740993");
  expect(localStorage.getItem(observationKey)).toBe(JSON.stringify(observation));
});

it.each(["missing", "corrupt", "blocked"])(
  "allows recovery with %s device invoice storage",
  async (kind) => {
    if (kind === "corrupt") localStorage.setItem(observationKey, "{");
    if (kind === "blocked")
      vi.spyOn(Storage.prototype, "length", "get").mockImplementation(() => {
        throw new Error("site data unavailable");
      });
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("[data-test=device-invoices]")).toBeNull();
    await ready(el);
    await vi.waitFor(() => expect(text(el)).toContain("0CSQW"));
    expect(el.readCredentials()?.recoveryOperation?.input).toEqual(selected.input);
  },
);

it("drops a returning device's report when the selected backup scope changes", async () => {
  localStorage.setItem(observationKey, JSON.stringify(observation));
  const { el } = await mount();
  expect(el.shadowRoot!.querySelector("[data-test=device-invoices]")).not.toBeNull();
  const recovery = el as Entry & {
    context: Parameters<NonNullable<typeof FISCAL_SETUP.createRecovery>>[0];
  };
  const context = recovery.context;
  recovery.context = { ...context, selection: { ...selection, taxId: "OTHER" } };
  await recovery.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=device-invoices]")).toBeNull();
  recovery.context = {
    ...context,
    selection: { ...selection, environment: "preproduction" },
  };
  await recovery.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=device-invoices]")).toBeNull();
  recovery.context = context;
  await recovery.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=device-invoices]")!.textContent).toContain(
    observation.invoiceNumber,
  );
});

type Promotion = LitElement & ModulePromotionEntry;
const promotionBinding = { ...binding, action: "promote" };
const promotionSelected = { ...selected, binding: promotionBinding };
async function mountPromotion(prepare: Mock<(proposal: unknown) => Promise<unknown>>) {
  const host = document.createElement("main");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = FISCAL_SETUP.createPromotion!({
    locale: "en",
    timeZone: "America/New_York",
    binding: promotionBinding,
    prepare,
  }) as Promotion;
  host.append(el);
  await el.updateComplete;
  return el;
}
const promotionActions = (prepare: Mock<(proposal: unknown) => Promise<unknown>>) =>
  prepare.mock.calls.map(([proposal]) => (proposal as { action: string }).action);
const HANDOVER_DO = "open this handover page on another phone or laptop";

it("a handover start shows the details tick and Proceed, sends nothing before Proceed, then carries on by itself to the series", async () => {
  let decision = noSecondClock;
  let compared = 0;
  const prepare = vi.fn(async (proposal: unknown) => {
    const action = (proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks") return { id: `comparison-${++compared}`, clock: decision };
    if (action === "select") return promotionSelected;
    throw new Error("unexpected promotion proposal");
  });
  const el = await mountPromotion(prepare);
  const ready: boolean[] = [];
  el.addEventListener("promotion-change", (event) =>
    ready.push((event as CustomEvent<{ ready: boolean }>).detail.ready),
  );
  fakeClock();
  try {
    expect(
      [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(
        (input) => input.name,
      ),
    ).toEqual(["recovery-details-confirmed"]);
    expect(text(el)).toContain("These details are correct.");
    expect(action(el)).toBe("Proceed");
    expect(button(el, "compare").disabled).toBe(true);
    check(el, "recovery-details-confirmed");
    await el.updateComplete;
    vi.advanceTimersByTime(200_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(prepare).not.toHaveBeenCalled();
    expect(el.readOperation()).toBeNull();
    expect(ready).not.toContain(true);
    await proceed(el);
    await vi.waitFor(() => expect(text(el)).toContain(HANDOVER_DO));
    expect(promotionActions(prepare)).not.toContain("select");
    expect(action(el)).toBeUndefined();
    decision = clock;
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() =>
      expect(el.readOperation()).toEqual({ binding: promotionBinding, input: selected.input }),
    );
    expect(ready.at(-1)).toBe(true);
    expect(promotionActions(prepare)).toEqual([
      "clock-challenge",
      "compare-clocks",
      "clock-challenge",
      "compare-clocks",
      "select",
    ]);
    expect(prepare.mock.calls.at(-1)?.[0]).toEqual({
      action: "select",
      comparisonId: "comparison-2",
    });
    await el.updateComplete;
    expect(action(el)).toBeUndefined();
    expect(text(el)).toContain("A-0CSQW");
  } finally {
    vi.useRealTimers();
  }
});

it("compares and selects a promotion without a recovery key or recovery declarations, after the details tick and Proceed", async () => {
  let decision = clock;
  const prepare = vi.fn(async (proposal: unknown) => {
    const action = (proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks") return { id: "comparison", clock: decision };
    if (action === "select") return promotionSelected;
    throw new Error("unexpected promotion proposal");
  });
  const factory = Reflect.get(FISCAL_SETUP, "createPromotion") as
    | undefined
    | ((context: {
        locale: "en" | "es";
        timeZone: string;
        binding: typeof promotionBinding;
        prepare: typeof prepare;
      }) => Entry & {
        readOperation(): { binding: typeof promotionBinding; input: unknown } | null;
      });
  expect(factory, "the fiscal contribution offers the shared promotion clock form").toBeTypeOf(
    "function",
  );
  const host = document.createElement("main");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = factory!({
    locale: "en",
    timeZone: "America/New_York",
    binding: promotionBinding,
    prepare,
  });
  host.append(el);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("vf-recovery-key")).toBeNull();
  expect(
    [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(
      (input) => input.name,
    ),
  ).toEqual(["recovery-details-confirmed"]);
  expect(el.shadowRoot!.querySelector('[data-test="device-invoices"]')).toBeNull();
  expect(button(el, "compare").disabled).toBe(true);
  expect(el.readOperation()).toBeNull();
  check(el, "recovery-details-confirmed");
  await el.updateComplete;
  expect(button(el, "compare").disabled).toBe(false);
  await proceed(el);
  await vi.waitFor(() =>
    expect(el.readOperation()).toEqual({ binding: promotionBinding, input: selected.input }),
  );
  expect(prepare.mock.calls.map(([proposal]) => (proposal as { action: string }).action)).toEqual([
    "clock-challenge",
    "compare-clocks",
    "select",
  ]);
  el.clear();
  await el.updateComplete;
  expect(el.readOperation()).toBeNull();
  decision = noSecondClock;
  check(el, "recovery-details-confirmed");
  await proceed(el);
  await vi.waitFor(() => expect(text(el)).toContain(HANDOVER_DO));
  expect(text(el)).not.toContain("has the backup");
  el.clear();
  await el.updateComplete;
  prepare.mockRejectedValue({ code: "password.invalid", params: {} });
  check(el, "recovery-details-confirmed");
  await proceed(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent).toContain(
      "Check your password and code",
    ),
  );
  expect(button(el, "compare").disabled).toBe(false);
});

it.each([
  [{ code: "password.throttled", params: {} }, "Wait before trying your password again"],
  [
    { code: "authorization.not_permitted", params: {} },
    "Use an administrator account allowed to hand over",
  ],
  [
    { code: "sif.allocation_invalid", params: { reason: "clock_stale" } },
    "The clock check is too old",
  ],
  [{ code: "promotion.break_glass_invalid", params: {} }, "Check your password and code"],
] as const)("explains the promotion preparation refusal: %s", async (refusal, message) => {
  const host = document.createElement("main");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = FISCAL_SETUP.createPromotion!({
    locale: "en",
    timeZone: "UTC",
    binding: { ...binding, action: "promote" },
    prepare: async () => {
      throw refusal;
    },
  }) as LitElement & ModulePromotionEntry;
  host.append(el);
  await el.updateComplete;
  check(el, "recovery-details-confirmed");
  await proceed(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toContain(message),
  );
  expect(button(el, "compare").disabled).toBe(false);
});

it("no handover refusal tells the person to compare clocks again", () => {
  const causes = [
    { code: "password.invalid", params: {} },
    { code: "password.throttled", params: {} },
    { code: "authorization.not_permitted", params: {} },
    { code: "sif.allocation_invalid", params: { reason: "clock_stale" } },
    { code: "promotion.break_glass_invalid", params: {} },
  ];
  for (const locale of ["en", "es"] as const) {
    const el = FISCAL_SETUP.createPromotion!({
      locale,
      timeZone: "UTC",
      binding: { ...binding, action: "promote" },
      prepare: async () => ({}),
    }) as LitElement & ModulePromotionEntry;
    for (const cause of causes)
      expect(el.refusalMessage(cause)).not.toMatch(
        /compare (the )?clocks|compara(r)? los relojes/i,
      );
  }
});

it("a Spanish handover start calls the box «servidor», never «equipo»", async () => {
  const host = document.createElement("main");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = FISCAL_SETUP.createPromotion!({
    locale: "es",
    timeZone: "Europe/Madrid",
    binding: promotionBinding,
    prepare: async (proposal) => {
      const action = (proposal as { action: string }).action;
      if (action === "clock-challenge") return { id: "challenge" };
      if (action === "compare-clocks") return { id: "comparison", clock: noSecondClock };
      throw new Error("unexpected promotion proposal");
    },
  }) as Promotion;
  host.append(el);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("h3")!.textContent).toBe("Iniciar el local en este servidor");
  expect(text(el)).toContain("Estos datos son correctos.");
  check(el, "recovery-details-confirmed");
  await proceed(el);
  await vi.waitFor(() =>
    expect(text(el)).toContain(
      "Conecta el servidor a internet o abre esta página de traspaso en otro móvil o portátil.",
    ),
  );
  expect(text(el)).not.toMatch(/equipo/i);
  expect(el.refusalMessage({ code: "authorization.not_permitted", params: {} })).toContain(
    "la dirección HTTPS de este servidor",
  );
});

const differing = {
  ...clock,
  usable: [
    { source: "box", lowerMs: instant, upperMs: instant },
    { source: "browser", lowerMs: instant + 45_000, upperMs: instant + 45_000 },
  ],
  disagreement: true,
};
/** Mounts with `scripted`'s double, gives the key and both statements and presses Proceed. */
async function pressed(answers?: unknown[], decision: typeof clock = clock) {
  const { state, prepare } = scripted(answers);
  state.decision = decision;
  const { el } = await mount(prepare);
  await ready(el);
  return { el, prepare, state };
}
const waitingAnswer = { status: "waiting", targetMs: instant + 61_000, remainingMs: 61_000 };
it.each<[string, string | undefined, boolean, () => Promise<Entry>]>([
  ["nothing is in yet", "Proceed", true, async () => (await mount()).el],
  [
    "the key and one statement are in",
    "Proceed",
    true,
    async () => {
      const { el } = await mount();
      await enterKey(el);
      check(el, "recovery-old-box-stopped");
      return el;
    },
  ],
  [
    "the key and both statements are in, without the details tick",
    "Proceed",
    true,
    async () => {
      const { el } = await mount();
      await enterKey(el);
      check(el, "recovery-old-box-stopped");
      check(el, "recovery-sole-operation");
      return el;
    },
  ],
  [
    "the key, both statements and the details tick are in",
    "Proceed",
    false,
    async () => {
      const { el } = await mount();
      await fill(el);
      return el;
    },
  ],
  [
    "the clocks differ after a press",
    "Compare the clocks again",
    false,
    async () => {
      const { el } = await pressed(undefined, differing);
      await vi.waitFor(() => expect(text(el)).toContain(DIFFER));
      return el;
    },
  ],
  [
    "the box time is before this release",
    "Compare the clocks again",
    false,
    async () => {
      const { el } = await pressed(undefined, { ...clock, releaseBlocked: true });
      await vi.waitFor(() => expect(text(el)).toContain("Box time precedes this Waitron release."));
      return el;
    },
  ],
  [
    "the date is out of range",
    "Compare the clocks again",
    false,
    async () => {
      const { el } = await pressed(undefined, { ...clock, rangeBlocked: true });
      await vi.waitFor(() => expect(text(el)).toContain("outside the range"));
      return el;
    },
  ],
  [
    "a later minute is already in use",
    "Compare the clocks again",
    false,
    async () => {
      const { el } = await pressed([
        { code: "sif.allocation_invalid", params: { reason: "minute_not_later" } },
      ]);
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-test=minute-not-later]")).not.toBeNull(),
      );
      return el;
    },
  ],
  [
    "a run after a press failed",
    "Try again",
    false,
    async () => {
      const { el } = await pressed([{ code: "setup.attempt_conflict" }]);
      await vi.waitFor(() => expect(formError(el)).not.toBe(""));
      return el;
    },
  ],
  [
    "the box refused the key",
    "Proceed",
    false,
    async () => {
      const { el } = await mount(
        vi.fn(async () => {
          throw { code: "promotion.break_glass_invalid", params: {}, status: 403 };
        }),
      );
      await ready(el);
      await vi.waitFor(() => expect(formError(el)).not.toBe(""));
      return el;
    },
  ],
  [
    "this attempt's own name is found taken",
    undefined,
    false,
    async () => {
      const { el } = await pressed([
        { code: "sif.allocation_invalid", params: { reason: "minute_in_use" } },
      ]);
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-test=minute-in-use]")).not.toBeNull(),
      );
      return el;
    },
  ],
  [
    "the page is sending Proceed's request",
    "Proceed",
    true,
    async () => {
      const { el } = await pressed([new Promise(() => {})]);
      return el;
    },
  ],
  [
    "a countdown after a press",
    undefined,
    false,
    async () => {
      const { el } = await pressed([waitingAnswer]);
      await vi.waitFor(() => expect(remaining(el)).toBe("1:01"));
      return el;
    },
  ],
  [
    "a wait for a second clock after a press",
    undefined,
    false,
    async () => {
      const { el } = await pressed(undefined, noSecondClock);
      await vi.waitFor(() => expect(text(el)).toContain(RESTORE_ENDS));
      return el;
    },
  ],
  [
    "the series are made",
    undefined,
    false,
    async () => {
      const { el } = await pressed();
      await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
      return el;
    },
  ],
  [
    "the details tick changed since a press",
    "Proceed",
    true,
    async () => {
      const { el } = await pressed([waitingAnswer]);
      await vi.waitFor(() => expect(remaining(el)).toBe("1:01"));
      check(el, "recovery-details-confirmed", false);
      return el;
    },
  ],
  [
    "a statement changed since a press",
    "Proceed",
    true,
    async () => {
      const { el } = await pressed([waitingAnswer]);
      await vi.waitFor(() => expect(remaining(el)).toBe("1:01"));
      check(el, "recovery-sole-operation", false);
      return el;
    },
  ],
])("while %s the restore page's one button reads %s", async (_state, label, disabled, reach) => {
  const el = await reach();
  await el.updateComplete;
  expect(action(el)).toBe(label);
  if (label) expect(button(el, "compare").disabled).toBe(disabled);
});
it("names the restore page's buttons in Spanish", async () => {
  const first = await mount();
  first.el.locale = "es";
  await first.el.updateComplete;
  expect(action(first.el)).toBe("Continuar");
  const { state, prepare } = scripted([{ code: "setup.attempt_conflict" }]);
  state.decision = differing;
  const { el } = await mount(prepare);
  el.locale = "es";
  await el.updateComplete;
  await ready(el);
  await vi.waitFor(() => expect(action(el)).toBe("Volver a comparar los relojes"));
  state.decision = clock;
  await userEvent.click(button(el, "compare"));
  await vi.waitFor(() => expect(action(el)).toBe("Volver a intentarlo"));
  expect(formError(el)).toBe("No se pudo completar este paso.");
});
it("says only that the step could not be completed when it fails", async () => {
  const { el } = await pressed([{ code: "setup.attempt_conflict" }]);
  await vi.waitFor(() => expect(formError(el)).toBe("Could not complete this step."));
});
it("Compare the clocks again after Proceed carries on to the series once the clocks agree", async () => {
  const { el, prepare, state } = await pressed(undefined, differing);
  await vi.waitFor(() => expect(action(el)).toBe("Compare the clocks again"));
  expect(selects(prepare)).toEqual([]);
  state.decision = clock;
  await userEvent.click(button(el, "compare"));
  await vi.waitFor(() => expect(selects(prepare)).toHaveLength(1));
  await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
});
it.each([
  ["en", "We've created these series"],
  ["es", "Hemos creado estas series"],
] as const)(
  "%s: the made series are listed by code under the invoice series heading, with no bare name",
  async (locale, heading) => {
    const { el } = await mount();
    el.locale = locale;
    await el.updateComplete;
    await ready(el);
    await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
    const section = el.shadowRoot!.querySelector("[data-test=selected-hour]")!;
    expect(section.querySelector("h4")!.textContent!.trim()).toBe(heading);
    expect([...section.querySelectorAll("li")].map((li) => li.textContent!.trim())).toEqual([
      "A-0CSQW",
      "FF-0CSQW",
      "R-0CSQW",
    ]);
    expect(section.textContent!.replace(/[A-Z]+-0CSQW/g, "")).not.toContain("0CSQW");
  },
);
it.each([
  [
    "en",
    "Waitron cannot create invoice series for this date: it is outside the range the series codes cover.",
  ],
  [
    "es",
    "Waitron no puede crear series de facturas para esta fecha: está fuera del rango que cubren los códigos de serie.",
  ],
] as const)(
  "%s: a date out of range says no invoice series can be created",
  async (locale, words) => {
    const { state, prepare } = scripted();
    state.decision = { ...clock, rangeBlocked: true };
    const { el } = await mount(prepare);
    el.locale = locale;
    await el.updateComplete;
    await ready(el);
    await vi.waitFor(() => expect(text(el)).toContain(words));
  },
);
it("the Spanish series line says what Continuar does", async () => {
  const { el } = await mount();
  el.locale = "es";
  await el.updateComplete;
  expect(seriesLine(el)).toBe(
    "Cuando pulses Continuar, Waitron creará series de facturas nuevas para este servidor, para que sus números de factura nunca repitan los del servidor anterior. La serie de facturas es el código al principio de cada número de factura: por ejemplo, en A-0CSQW/1 la serie es A-0CSQW.",
  );
});
it.each([
  ["en", /in (\S+)\/(\d+) the series is (\S+)\.$/],
  ["es", /en (\S+)\/(\d+) la serie es (\S+)\.$/],
] as const)(
  "the %s restore series line's example is an invoice number in the traced format",
  async (locale, example) => {
    const { el } = await mount();
    el.locale = locale;
    await el.updateComplete;
    const [, series, number, named] = seriesLine(el)!.match(example)!;
    // An invoice number is the series code, "/", then the number (`formatInvoiceNumber`,
    // packages/core/src/record-sale.ts), and a series code is the base code, "-", then the name.
    expect(series).toBe(named);
    expect(Number(number)).toBeGreaterThan(0);
    const dash = series!.lastIndexOf("-");
    const base = series!.slice(0, dash),
      name = series!.slice(dash + 1);
    expect(isMinuteIdentity(name)).toBe(true);
    expect(
      seriesMatchBases([{ code: series!, purpose: "standard" }], name, [
        { code: base, purpose: "standard" },
      ]),
    ).toBe(true);
  },
);

const detailRows = (el: LitElement, list: string) =>
  [...el.shadowRoot!.querySelectorAll(`[data-test=${list}] > div`)].map((row) => [
    row.querySelector("dt")?.textContent?.trim(),
    row.querySelector("dd")?.textContent?.replace(/\s+/g, " ").trim(),
  ]);
it("Check this venue lists the backup's details one to a row, and no clock rows", async () => {
  const { el } = await pressed();
  expect(el.shadowRoot!.querySelector("h4")?.textContent?.trim()).toBe("Check this venue");
  expect(detailRows(el, "venue-review")).toEqual([
    ["Environment", "Production"],
    ["Country", "Spain"],
    ["Taxpayer NIF", "B12345674"],
    ["Time zone", "Europe/Madrid"],
  ]);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-clock=read]")).not.toBeNull());
  expect(el.shadowRoot!.querySelectorAll("[data-test=check-venue] dl.details")).toHaveLength(1);
  for (const gone of ["Box time", "Server time", "matches", "14:30"])
    expect(text(el)).not.toContain(gone);
  expect(text(el)).not.toContain(new Date(instant).toISOString());
});
it.each(["", "E1"])(
  "a backup whose country code %j the browser cannot name shows the code as stored",
  async (country) => {
    const host = document.createElement("main");
    applyTokens(host);
    document.body.append(host);
    hosts.push(host);
    const el = FISCAL_SETUP.createRecovery!({
      locale: "en",
      selection: { ...selection, country },
      binding: { ...binding },
      prepare: vi.fn(async () => {
        throw new Error("nothing is sent before Proceed");
      }),
    }) as Entry;
    host.append(el);
    await el.updateComplete;
    expect(detailRows(el, "venue-review")).toContainEqual(["Country", country]);
  },
);
it("clocks that differ show one time per clock and ask which is correct; neither answer sends anything", async () => {
  const decision = {
    ...clock,
    usable: [
      { source: "box", lowerMs: instant, upperMs: instant },
      { source: "internet", lowerMs: instant + 3 * 60_000, upperMs: instant + 3 * 60_000 },
    ],
    unavailable: [{ source: "browser", result: "unavailable" as const, reason: "same_machine" }],
    disagreement: true,
  };
  for (const choice of ["server-correct", "both-wrong"]) {
    const { el, prepare } = await pressed(undefined, decision);
    await vi.waitFor(() => expect(text(el)).toContain(DIFFER));
    expect(detailRows(el, "clock-times")).toEqual([
      ["Server time", "18 October 2026 at 14:30"],
      ["This device", "Unavailable"],
      ["Internet", "18 October 2026 at 14:33"],
    ]);
    expect(text(el)).not.toMatch(/ask for help/);
    const sent = prepare.mock.calls.length;
    await userEvent.click(button(el, choice));
    await el.updateComplete;
    expect(prepare.mock.calls).toHaveLength(sent);
    expect(text(el)).toContain(
      "Please correct the time on this device and then reconnect to the server.",
    );
    expect(text(el)).not.toContain(DIFFER);
    expect(action(el)).toBe("Compare the clocks again");
  }
});
it("Edit these details sends nothing and asks to go back to choosing the backup", async () => {
  const { el, prepare, host } = await mount();
  await fill(el);
  const asked: Event[] = [];
  host.addEventListener("recovery-change-details", (event) => asked.push(event));
  const change = button(el, "change-details");
  expect(change.textContent?.trim()).toBe("Edit these details");
  expect(change.getAttribute("variant")).toBe("secondary");
  await userEvent.click(change);
  expect(asked).toHaveLength(1);
  expect(asked[0]!.composed).toBe(true);
  expect(prepare).not.toHaveBeenCalled();
});
it("after Proceed the second screen says which series were created, and the restore can still read its credentials", async () => {
  const { el } = await pressed();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=selected-hour] h4")?.textContent?.trim()).toBe(
      "We've created these series",
    ),
  );
  expect(
    [...el.shadowRoot!.querySelectorAll("[data-test=selected-hour] li")].map((li) =>
      li.textContent?.trim(),
    ),
  ).toEqual(["A-0CSQW", "FF-0CSQW", "R-0CSQW"]);
  expect(el.shadowRoot!.querySelector<HTMLElement>("[data-test=check-venue]")?.hidden).toBe(true);
  expect(el.shadowRoot!.querySelector("[data-test=change-details]")).toBeNull();
  expect(el.readCredentials()).not.toBeNull();
});
it("in Spanish the restore page asks which clock is correct and offers Editar estos datos, never pide ayuda", async () => {
  const { state, prepare } = scripted();
  state.decision = { ...clock, disagreement: true };
  const host = document.createElement("main");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = FISCAL_SETUP.createRecovery!({
    locale: "es",
    selection: { ...selection },
    binding: { ...binding },
    prepare,
  }) as Entry;
  host.append(el);
  await el.updateComplete;
  await fill(el);
  expect(button(el, "change-details").textContent?.trim()).toBe("Editar estos datos");
  await proceed(el);
  await vi.waitFor(() =>
    expect(text(el)).toContain(
      "Es muy importante que la hora del servidor sea correcta. ¿Cuál es la correcta?",
    ),
  );
  expect(text(el)).toContain("Hora del servidor");
  expect(text(el)).not.toMatch(/pide ayuda/);
  await userEvent.click(button(el, "server-correct"));
  await el.updateComplete;
  expect(text(el)).toContain(
    "Corrige la hora de este dispositivo y vuelve a conectarte al servidor.",
  );
});
it("a handover start offers Edit these details, which sends nothing", async () => {
  const prepare = vi.fn(async () => {
    throw new Error("nothing is sent before Proceed");
  });
  const el = await mountPromotion(prepare);
  check(el, "recovery-details-confirmed");
  await el.updateComplete;
  const asked: Event[] = [];
  el.addEventListener("recovery-change-details", (event) => asked.push(event));
  expect(button(el, "change-details").textContent?.trim()).toBe("Edit these details");
  await userEvent.click(button(el, "change-details"));
  expect(asked).toHaveLength(1);
  expect(prepare).not.toHaveBeenCalled();
  expect(detailRows(el, "venue-review")).toEqual([["Time zone", "America/New_York"]]);
});
it("after Proceed focus moves to the second screen's heading, and the screen is announced", async () => {
  const { el } = await pressed();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
  );
  const result = el.shadowRoot!.querySelector<HTMLElement>("[data-test=selected-hour]")!;
  const heading = result.querySelector<HTMLElement>("h4")!;
  await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(heading));
  expect(heading.tabIndex).toBe(-1);
  expect(result.getAttribute("role")).toBe("status");
});
it("series that arrive while the person is in another field leave focus in that field", async () => {
  let answer: ((value: unknown) => void) | undefined;
  const { el } = await pressed([new Promise((resolve) => (answer = resolve))]);
  const elsewhere = document.createElement("input");
  document.body.append(elsewhere);
  hosts.push(elsewhere);
  await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
  elsewhere.focus();
  answer!(selected);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
  );
  await el.updateComplete;
  expect(document.activeElement).toBe(elsewhere);
});
