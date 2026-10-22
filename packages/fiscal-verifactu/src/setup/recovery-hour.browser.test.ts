import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens, LeaveController } from "@waitron/ui";
import { LitElement, html } from "lit";
import type { Mock } from "vitest";
import type { ModuleRecoveryEntry } from "@waitron/module/src/setup-contract.js";
import { FISCAL_SETUP } from "./first-fiscal-screen.js";

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
  input: { selected: "server-input" },
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
      if (action === "preview") return { status: "preview" };
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
function check(el: Entry, name: string, value = true) {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  expect(input, `visible ${name} declaration`).not.toBeNull();
  input!.checked = value;
  input!.dispatchEvent(new Event("change", { bubbles: true }));
}
async function ready(el: Entry) {
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
  check(el, "recovery-old-box-stopped");
  check(el, "recovery-sole-operation");
  await vi.waitFor(() => expect(button(el, "compare").disabled).toBe(false));
}
function button(el: Entry, name: string) {
  const value = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    `[data-test="${name}"]`,
  );
  expect(value, `${name} action`).not.toBeNull();
  return value!;
}
const text = (el: Entry) => el.shadowRoot!.textContent!.replace(/\s+/g, " ");
const remaining = (el: Entry) =>
  el.shadowRoot!.querySelector("[data-test=remaining]")?.textContent?.trim();
const actionsOf = (prepare: Mock<(request: { proposal: unknown }) => Promise<unknown>>) =>
  prepare.mock.calls.map(([r]) => (r.proposal as { action: string }).action);
const quiet = (el: Entry) => {
  const action = button(el, "select") as HTMLElement & { disabled: boolean; variant: string };
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
const WHY_REFUSED = "No series is made without a confirmed time, so none is ever repeated.";
const DIFFER = "This box's time and this device's differ by more than 30 seconds.";
const DIFFER_DO =
  "Try from another phone or laptop that has the backup. If they still differ, the box's time may be wrong: ask for help.";
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
    preview: undefined as unknown,
    hold: undefined as Promise<void> | undefined,
    fail: false,
    refusal: undefined as unknown,
  };
  let compared = 0;
  const prepare = vi.fn(async (request: { proposal: unknown }) => {
    const action = (request.proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "preview") {
      if (state.preview !== undefined) return state.preview;
      // What the real server's preview throws for a comparison that cannot admit a name.
      if (!state.decision.secondClock)
        throw { code: "sif.allocation_invalid", params: { reason: "second_clock_missing" } };
      if (state.decision.disagreement)
        throw { code: "sif.allocation_invalid", params: { reason: "clock_disagreement" } };
      return { status: "preview" };
    }
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
async function compare(el: Entry) {
  button(el, "compare").click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).not.toBeNull(),
  );
}
it("decodes the printed key and sends independent recovery declarations before selecting", async () => {
  const { el, prepare } = await mount();
  expect(el.shadowRoot!.querySelector("wt-textarea")).toBeNull();
  expect(el.readCredentials()).toBeNull();
  await ready(el);
  await compare(el);
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
  button(el, "select").click();
  await vi.waitFor(() =>
    expect(el.readCredentials()).toEqual({
      recoveryOperation: { binding, input: { selected: "server-input" } },
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
it("requires both explicit isolation declarations", async () => {
  const { el, prepare } = await mount();
  await ready(el);
  check(el, "recovery-old-box-stopped", false);
  await el.updateComplete;
  expect(button(el, "compare").disabled).toBe(true);
  check(el, "recovery-old-box-stopped");
  check(el, "recovery-sole-operation", false);
  await el.updateComplete;
  expect(button(el, "compare").disabled).toBe(true);
  expect(prepare).not.toHaveBeenCalled();
});
it("asks no last-hour question and offers no clock confirmation", async () => {
  const { el } = await mount();
  await ready(el);
  await compare(el);
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
    if (action === "preview") return { status: "preview" };
    return {
      status: "waiting",
      targetMs: Date.parse("2026-10-18T13:00:00Z"),
      remainingMs: 1_800_000,
    };
  });
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  button(el, "select").click();
  await vi.waitFor(() => expect(remaining(el)).toBe("30:00"));
  expect(prepare.mock.calls.at(-1)?.[0].proposal).toEqual({
    action: "select",
    comparisonId: "comparison",
  });
  expect(el.readCredentials()).toBeNull();
  expect(button(el, "compare").disabled).toBe(false);
});
it.each(["key", "isolation", "clear", "disconnect"])(
  "invalidates the selected input after %s changes",
  async (fault) => {
    const { el } = await mount();
    await ready(el);
    await compare(el);
    button(el, "select").click();
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
    expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).toBeNull();
  },
);
it("keeps a refused named key beside its native field and leaves retry available", async () => {
  const prepare = vi.fn(async () => {
    throw { code: "setup.request_invalid", params: { field: "nodeRecoverySecret" }, status: 400 };
  });
  const { el } = await mount(prepare);
  await ready(el);
  button(el, "compare").click();
  await vi.waitFor(() =>
    expect(
      (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
    ).toContain("Check the fields"),
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
  await compare(el);
  button(el, "select").click();
  await vi.waitFor(() =>
    expect(
      (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
    ).toContain("Check the fields"),
  );
  expect(el.readCredentials()).toBeNull();
});
it("ignores a selected response after the sole-recovery declaration changes", async () => {
  let release!: (value: unknown) => void;
  const held = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const prepare = vi.fn(async (request: { proposal: unknown }) => {
    const action = (request.proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks") return { id: "comparison", clock };
    if (action === "preview") return { status: "preview" };
    return held;
  });
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  button(el, "select").click();
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
  expect(el.shadowRoot!.textContent).not.toContain("0CSQW");
});
it("marks each missing declaration after an attempted recovery", async () => {
  const { el } = await mount();
  expect(el.readCredentials()).toBeNull();
  await el.updateComplete;
  for (const name of ["recovery-old-box-stopped", "recovery-sole-operation"]) {
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
    if (action === "preview") return { status: "preview" };
    return held;
  });
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  button(el, "select").click();
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
  expect(el.shadowRoot!.textContent).not.toContain("0CSQW");
});
it("all three actions expose a visible native button", async () => {
  const { el } = await mount();
  for (const name of ["compare", "select", "clear"]) {
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
  await compare(el);
  button(el, "select").click();
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
it("places the recovery authenticator's real refusal beside the key without disabling retry", async () => {
  const { el } = await mount(
    vi.fn(async () => {
      throw { code: "promotion.break_glass_invalid", params: {}, status: 403 };
    }),
  );
  await ready(el);
  button(el, "compare").click();
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
])("keeps Select quiet while the clock has a blocking condition %j", async (blocking) => {
  const prepare = vi.fn(async (request: { proposal: unknown }) =>
    (request.proposal as { action: string }).action === "clock-challenge"
      ? { id: "challenge" }
      : { id: "comparison", clock: { ...clock, ...blocking } },
  );
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  expect(button(el, "select").disabled).toBe(true);
});
it("sends no installation code", async () => {
  const { el, prepare } = await mount();
  await ready(el);
  await compare(el);
  button(el, "select").click();
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
  await ready(el);
  await compare(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
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
      { action: "select", comparisonId: "comparison-2" },
      { action: "select", comparisonId: "comparison-3" },
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
  await ready(el);
  await compare(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
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
it("Check again during a wait shows the server's time left", async () => {
  const { state, prepare } = scripted();
  state.preview = { status: "waiting", targetMs: instant + 61_000, remainingMs: 61_000 };
  const { el } = await mount(prepare);
  await ready(el);
  fakeClock();
  try {
    await compare(el);
    await vi.waitFor(() => expect(remaining(el)).toBeDefined());
    vi.advanceTimersByTime(0);
    await el.updateComplete;
    expect(remaining(el)).toBe("1:01");
    expect(text(el)).toContain(WHY_WAIT);
    expect(actionsOf(prepare)).toEqual(["clock-challenge", "compare-clocks", "preview"]);
    expect(quiet(el)).toEqual({ disabled: true, variant: "secondary" });
  } finally {
    vi.useRealTimers();
  }
});
it("Compare clocks with no second clock explains the wait and checks again by itself", async () => {
  const { state, prepare } = scripted();
  state.decision = noSecondClock;
  const { el } = await mount(prepare);
  await ready(el);
  fakeClock();
  try {
    await compare(el);
    await vi.waitFor(() => expect(text(el)).toContain(RESTORE_DO));
    expect(text(el)).toContain(WHY_SECOND);
    expect(text(el)).toContain(ON_BOX);
    expect(text(el)).toContain(RESTORE_ENDS);
    expect(
      (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
    ).toBe("");
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
    expect(quiet(el)).toEqual({ disabled: true, variant: "secondary" });
    state.decision = clock;
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(selects(prepare)).toHaveLength(1));
    await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
  } finally {
    vi.useRealTimers();
  }
});
it("Compare clocks with clocks that differ explains the refusal, not a failure", async () => {
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
  await ready(el);
  fakeClock();
  try {
    await compare(el);
    await vi.waitFor(() => expect(text(el)).toContain(DIFFER_DO));
    expect(text(el)).toContain(WHY_REFUSED);
    expect(text(el)).toContain(DIFFER);
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
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  state.decision = noSecondClock;
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
    await vi.waitFor(() => expect(text(el)).toContain(RESTORE_DO));
    expect(text(el)).toContain(WHY_SECOND);
    expect(text(el)).toContain(ON_BOX);
    expect(text(el)).toContain(RESTORE_ENDS);
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
    expect(selects(prepare)).toHaveLength(0);
    expect(quiet(el)).toEqual({ disabled: true, variant: "secondary" });
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
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  state.decision = {
    ...noSecondClock,
    unavailable: [
      { source: "browser", result: "unavailable" as const, reason: "challenge" },
      { source: "internet", result: "unavailable" as const, reason: "offline" },
    ],
  };
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() => expect(text(el)).toContain(RESTORE_DO));
  expect(text(el)).toContain(WHY_SECOND);
  expect(text(el)).not.toContain(ON_BOX);
});
it("a clock refusal shows both readings and no countdown, and waits for Check again", async () => {
  const { state, prepare } = scripted();
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  state.decision = {
    ...clock,
    usable: [
      { source: "box", lowerMs: instant, upperMs: instant },
      { source: "browser", lowerMs: instant + 45_000, upperMs: instant + 45_000 },
    ],
    unavailable: [{ source: "internet", result: "unavailable" as const, reason: "offline" }],
    disagreement: true,
  };
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
    await vi.waitFor(() => expect(text(el)).toContain(DIFFER));
    expect(text(el)).toContain(WHY_REFUSED);
    expect(text(el)).toContain(DIFFER_DO);
    expect(text(el)).toContain(new Date(instant).toISOString());
    expect(text(el)).toContain(new Date(instant + 45_000).toISOString());
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
    expect(selects(prepare)).toHaveLength(0);
    const before = prepare.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    await el.updateComplete;
    expect(prepare.mock.calls).toHaveLength(before);
    expect(button(el, "compare").textContent?.trim()).toBe("Check again");
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
  await compare(el);
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() => expect(text(el)).toContain(DIFFER));
  expect(text(el)).toContain(DIFFER_DO);
});
it("a missing second clock reported by the server starts the 15-second check", async () => {
  const { prepare } = scripted([
    { code: "sif.allocation_invalid", params: { reason: "second_clock_missing" } },
    selected,
  ]);
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
    await vi.waitFor(() => expect(text(el)).toContain(RESTORE_DO));
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(selects(prepare)).toHaveLength(2));
    await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
  } finally {
    vi.useRealTimers();
  }
});
it("a later minute in use names its time and does not count down", async () => {
  const { prepare } = scripted([
    {
      code: "sif.allocation_invalid",
      params: { reason: "minute_not_later", allowedFromMs: Date.parse("2026-10-18T20:04:00Z") },
    },
  ]);
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
    await vi.waitFor(() =>
      expect(text(el)).toContain(
        "The series cannot be made yet: a later minute is already in use. You can carry on from 22:04.",
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
it("draws Make the series quiet and disabled while a countdown runs", async () => {
  const { prepare } = scripted([
    { status: "waiting", targetMs: instant + 84_000, remainingMs: 84_000 },
  ]);
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  expect(quiet(el)).toEqual({ disabled: false, variant: "primary" });
  expect(button(el, "select").textContent?.trim()).toBe("Make the series");
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() => expect(remaining(el)).toBeDefined());
  await el.updateComplete;
  expect(quiet(el)).toEqual({ disabled: true, variant: "secondary" });
});
it("keeps the countdown's explanation on screen while its re-check is in flight", async () => {
  const { state, prepare } = scripted([
    { status: "waiting", targetMs: instant + 1_000, remainingMs: 1_000 },
  ]);
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
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
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  state.decision = noSecondClock;
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
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
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  state.decision = noSecondClock;
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
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
it("an edit to a declaration stops the wait", async () => {
  const { prepare } = scripted([
    { status: "waiting", targetMs: instant + 1_000, remainingMs: 1_000 },
    selected,
  ]);
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
    await vi.waitFor(() => expect(remaining(el)).toBe("0:01"));
    check(el, "recovery-old-box-stopped", false);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
    check(el, "recovery-old-box-stopped");
    await el.updateComplete;
    vi.advanceTimersByTime(5_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(selects(prepare)).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
it("explains each wait in Spanish with the restore page's words", async () => {
  const { state, prepare } = scripted([
    { status: "waiting", targetMs: instant + 84_000, remainingMs: 84_000 },
  ]);
  const { el } = await mount(prepare);
  el.locale = "es";
  await el.updateComplete;
  await ready(el);
  await compare(el);
  state.decision = noSecondClock;
  expect(button(el, "select").textContent?.trim()).toBe("Crear las series");
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() =>
    expect(text(el)).toContain(
      "Conecta el equipo a internet, o abre esta página desde un móvil o un portátil del local que tenga la copia.",
    ),
  );
  expect(text(el)).toContain(
    "Para que ninguna serie de facturas se repita, la hora del equipo se compara con la de otro aparato o con internet.",
  );
  expect(text(el)).toContain("Esta pantalla está en el propio equipo y no cuenta.");
  expect(text(el)).toContain(
    "Sigue sola cuando el equipo tenga internet, o en el otro aparato si sigues allí.",
  );
  state.decision = {
    ...clock,
    usable: [
      { source: "box", lowerMs: instant, upperMs: instant },
      { source: "browser", lowerMs: instant + 45_000, upperMs: instant + 45_000 },
    ],
    disagreement: true,
  };
  await userEvent.click(button(el, "compare"));
  await vi.waitFor(() => expect(button(el, "select").disabled).toBe(false));
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() =>
    expect(text(el)).toContain(
      "Prueba desde otro móvil o portátil que tenga la copia. Si siguen sin coincidir, puede que la hora del equipo esté mal: pide ayuda.",
    ),
  );
  expect(text(el)).toContain(
    "La hora de este equipo y la de este dispositivo no coinciden (más de 30 segundos).",
  );
  expect(text(el)).toContain(
    "Sin una hora confirmada no se crean series, para que ninguna se repita.",
  );
  expect(button(el, "compare").textContent?.trim()).toBe("Comprobar otra vez");
  state.decision = clock;
  await userEvent.click(button(el, "compare"));
  await vi.waitFor(() => expect(button(el, "select").disabled).toBe(false));
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() => expect(remaining(el)).toBeDefined());
  expect(text(el)).toContain(
    "Esperamos a confirmar la hora para que ninguna serie de facturas se repita.",
  );
  expect(text(el)).toContain("No hace falta hacer nada; deja esta página abierta.");
  expect(text(el)).toContain("Sigue en");
});
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
  await compare(el);
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() =>
    expect(text(el)).toContain(
      "Todavía no se pueden crear las series: ya se usó un minuto posterior a la hora de este equipo. Podrás seguir a partir de las 22:04.",
    ),
  );
});
it("keeps the 15-second rhythm when a re-check again finds no second clock", async () => {
  const { state, prepare } = scripted();
  state.decision = noSecondClock;
  const { el } = await mount(prepare);
  await ready(el);
  fakeClock();
  try {
    await compare(el);
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
