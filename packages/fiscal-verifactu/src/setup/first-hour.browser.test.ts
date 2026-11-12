import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import type { InitialSetupActions } from "@waitron/module/src/setup-contract.js";
import { readRecoveryPdf, openRecoveryPdf } from "../recovery-reader.js";
import { FISCAL_SETUP } from "@waitron/fiscal-verifactu/setup";
import { isMinuteIdentity } from "../hour-identity.js";
import { seriesMatchBases } from "../allocation-identity.js";
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
const context = {
  status: "claimed",
  environment: "production",
  venue: {
    legalName: "Olivo SL",
    country: "ES",
    taxId: "B12345674",
    seriesCode: "A",
    fullSeriesCode: "FF",
    rectificativeSeriesCode: "R",
    name: "Olivo",
    city: "Madrid",
    fiscalTerritory: "ES-common",
    timeZone: "Europe/Madrid",
  },
};
const selected = {
  kind: "waitron-hour-setup",
  status: "selected",
  identity: "0CSQW",
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
const hosts: HTMLElement[] = [];
it("the public setup factory refuses a host without hour preparation", () => {
  const unexpected = async () => {
    throw new Error("legacy route invoked");
  };
  expect(() =>
    FISCAL_SETUP.create({
      locale: "en",
      request: context,
      api: {
        candidates: unexpected,
        request: unexpected,
        importInput: unexpected,
        enrol: unexpected,
        confirm: unexpected,
      },
    }),
  ).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    }),
  );
});
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  vi.restoreAllMocks();
});
async function mount(
  options: {
    decision?: typeof clock | (() => typeof clock);
    select?: () => Promise<unknown>;
    preview?: unknown;
    locale?: "en" | "es";
    prepare?: (proposal: unknown) => Promise<unknown>;
    request?: typeof context;
    within?: HTMLElement;
  } = {},
) {
  const calls: { action: string; value?: unknown }[] = [];
  const preparation = async (proposal: unknown) => {
    calls.push({ action: "prepare", value: proposal });
    if (options.prepare) return options.prepare(proposal);
    const action = (proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks") {
      const count = calls.filter(
        (c) => (c.value as { action?: string })?.action === "compare-clocks",
      ).length;
      const decision =
        typeof options.decision === "function" ? options.decision() : (options.decision ?? clock);
      return { id: `comparison-${count}`, clock: decision };
    }
    if (action === "selection") return options.preview ?? { status: "preview", identity: "0CSQW" };
    throw new Error("unexpected action");
  };
  const api = {
    preparation,
    async candidates(value: unknown) {
      calls.push({ action: "candidates", value });
      return options.select ? options.select() : selected;
    },
    async request(): Promise<unknown> {
      calls.push({ action: "request" });
      return null;
    },
    async importInput(value: unknown) {
      calls.push({ action: "input", value });
    },
    async enrol() {
      throw new Error("no enrolment in hour setup");
    },
    async confirm() {
      throw new Error("no activation before PDF");
    },
  } satisfies InitialSetupActions & { preparation: typeof preparation };
  const host = document.createElement("main");
  applyTokens(host);
  (options.within ?? document.body).append(host);
  hosts.push(options.within ?? host);
  const parent = FISCAL_SETUP.create({
    locale: options.locale ?? "en",
    request: options.request ?? structuredClone(context),
    api,
  }) as LitElement;
  host.append(parent);
  await parent.updateComplete;
  const el = parent.shadowRoot!.querySelector<LitElement>("vf-first-setup-hour");
  expect(el, "the actual fiscal factory mounts hour setup").not.toBeNull();
  await el!.updateComplete;
  return {
    el: el!,
    parent,
    calls,
    host,
    api: api as InitialSetupActions & {
      stageNodeKey?: () => Promise<unknown>;
      registerRecoveryDocument?: (value: unknown) => Promise<void>;
      confirmRecoveryDocument?: (value: unknown) => Promise<void>;
    },
  };
}
const button = (el: LitElement, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(`[data-test="${name}"]`)!;
async function ready(el: LitElement) {
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-clock=read]")).not.toBeNull());
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(
    'input[name="setup-details-confirmed"]',
  )!;
  expect(input).not.toBeNull();
  await userEvent.click(input);
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
const text = (el: LitElement) => el.shadowRoot!.textContent!.replace(/\s+/g, " ");
const remaining = (el: LitElement) =>
  el.shadowRoot!.querySelector("[data-test=remaining]")?.textContent?.trim();
const actionsOf = (calls: { action: string; value?: unknown }[]) =>
  calls.map((c) => (c.action === "prepare" ? (c.value as { action: string }).action : c.action));
const WHY_WAIT = "Waiting to confirm the time, so no invoice series is ever repeated.";
const NOTHING_TO_DO = "Nothing to do; keep this page open.";
const WHY_SECOND =
  "So no invoice series is ever repeated, the box's time is compared with another device's or the internet's.";
const ON_BOX = "This screen is on the box itself, so it does not count.";
const SETUP_DO =
  "Connect the box to the internet, or open this page on a phone or till on the venue's network and enter the setup password.";
const SETUP_ENDS =
  "It carries on by itself once the box reaches the internet, or on the phone if you carry on there.";
const OLD_WHY_REFUSED = "No invoice series is created without a confirmed time";
const DIFFER = "It is very important that the server time is set correctly. Which time is correct:";
const fakeClock = () =>
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
class LeaveShell extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<slot></slot>`;
  }
}
customElements.define("first-hour-leave-shell", LeaveShell);
it("counts the reviewed tick as an unsaved change, and unticking it as none", async () => {
  const shell = document.createElement("first-hour-leave-shell") as LeaveShell;
  document.body.append(shell);
  await shell.updateComplete;
  const { el } = await mount({ within: shell, decision: noSecondClock });
  expect(shell.leave.coordinator.isDirty([el])).toBe(false);
  await ready(el);
  expect(shell.leave.coordinator.isDirty([el])).toBe(true);
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLInputElement>('input[name="setup-details-confirmed"]')!,
  );
  await el.updateComplete;
  expect(shell.leave.coordinator.isDirty([el])).toBe(false);
});
it("automatically compares clocks and shows combined country, place and zone, with no clock time, before selection", async () => {
  const { el, calls } = await mount();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-clock=read]")).not.toBeNull());
  expect(el.shadowRoot!.textContent).toContain("Spain");
  expect(el.shadowRoot!.textContent).toContain("Production");
  expect(el.shadowRoot!.textContent).toContain("Madrid");
  expect(el.shadowRoot!.textContent).toContain("Europe/Madrid");
  expect(el.shadowRoot!.textContent).not.toContain("14:30");
  expect(el.shadowRoot!.querySelector("wt-disclosure")).toBeNull();
  expect(calls[0]).toEqual({ action: "prepare", value: { action: "clock-challenge" } });
  expect(calls[1]).toMatchObject({
    action: "prepare",
    value: {
      action: "compare-clocks",
      browser: { challengeId: "challenge", instantMs: expect.any(Number) },
    },
  });
  expect(calls.some((c) => c.action === "candidates")).toBe(false);
  expect(el.shadowRoot!.querySelector('input[type="file"], wt-textarea')).toBeNull();
});
it("shows Canary local time rather than the browser or Madrid zone", async () => {
  const request = structuredClone(context);
  request.venue = {
    ...request.venue,
    city: "Las Palmas",
    fiscalTerritory: "ES-canary",
    timeZone: "Atlantic/Canary",
  };
  const { el } = await mount({ request, decision: { ...clock, disagreement: true } });
  await ready(el);
  expect(el.shadowRoot!.textContent).toContain("Las Palmas");
  expect(el.shadowRoot!.textContent).toContain("Atlantic/Canary");
  await proceed(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=clock-times]")).not.toBeNull(),
  );
  expect(el.shadowRoot!.textContent).toContain("13:30");
  expect(el.shadowRoot!.textContent).not.toContain("14:30");
});
it("requires the scope confirmation then imports only selected server input", async () => {
  const { el, calls } = await mount();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-clock=read]")).not.toBeNull());
  expect(el.shadowRoot!.querySelector('input[name="taxpayer-hour"]')).toBeNull();
  await ready(el);
  await proceed(el);
  await vi.waitFor(() =>
    expect(calls.filter((c) => c.action === "input")).toEqual([
      { action: "input", value: selected.input },
    ]),
  );
  expect(calls.filter((c) => c.action === "candidates")).toEqual([
    { action: "candidates", value: { comparisonId: "comparison-2" } },
  ]);
  for (const code of ["A-0CSQW", "FF-0CSQW", "R-0CSQW"])
    expect(el.shadowRoot!.textContent).toContain(code);
  expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull();
});
it("asks no last-hour question and offers no clock confirmation", async () => {
  const { el } = await mount();
  await ready(el);
  expect(el.shadowRoot!.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  expect(el.shadowRoot!.querySelector("fieldset")).toBeNull();
  expect(el.shadowRoot!.querySelector('[name="setup-clock-confirmed"]')).toBeNull();
  expect(text(el)).not.toContain("UTC hour");
});
it("keeps the server wait and never imports or locally completes it", async () => {
  const { el, calls } = await mount({
    select: async () => ({
      status: "waiting",
      targetMs: instant + 1800000,
      remainingMs: 1800000,
    }),
  });
  await ready(el);
  await proceed(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=hour-wait]")).not.toBeNull(),
  );
  expect(calls.some((c) => c.action === "input")).toBe(false);
  expect(text(el)).toContain("30:00");
});
it.each(["releaseBlocked", "rangeBlocked"] as const)(
  "keeps %s selection blocked",
  async (reason) => {
    const { el, calls } = await mount({ decision: { ...clock, [reason]: true } });
    await ready(el);
    expect(calls.some((c) => c.action === "candidates")).toBe(false);
  },
);
it("explains a waiting setup with a countdown that goes back to the server at zero", async () => {
  const answers: unknown[] = [
    { status: "waiting", targetMs: instant + 84_000, remainingMs: 84_000 },
    selected,
  ];
  const { el, calls } = await mount({ select: async () => answers.shift() });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
    await vi.waitFor(() => expect(remaining(el)).toBeDefined());
    vi.advanceTimersByTime(0);
    await el.updateComplete;
    expect(text(el)).toContain(WHY_WAIT);
    expect(text(el)).toContain(NOTHING_TO_DO);
    expect(text(el)).toContain("Continues in 1:24");
    const timer = el.shadowRoot!.querySelector("[data-test=remaining]")!;
    expect(timer.closest("[role=timer]")).not.toBeNull();
    vi.advanceTimersByTime(1_000);
    await el.updateComplete;
    expect(remaining(el)).toBe("1:23");
    vi.advanceTimersByTime(83_000);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(2));
    const sequence = actionsOf(calls);
    const first = sequence.indexOf("candidates"),
      second = sequence.lastIndexOf("candidates");
    expect(sequence.slice(first + 1, second)).toEqual(["clock-challenge", "compare-clocks"]);
    expect(calls.filter((c) => c.action === "candidates").map((c) => c.value)).toEqual([
      { comparisonId: "comparison-2" },
      { comparisonId: "comparison-3" },
    ]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
    );
    expect(calls.filter((c) => c.action === "input")).toEqual([
      { action: "input", value: selected.input },
    ]);
  } finally {
    vi.useRealTimers();
  }
});
it("a countdown reaching zero imports nothing the server did not select", async () => {
  const answers: unknown[] = [
    { status: "waiting", targetMs: instant + 1_000, remainingMs: 1_000 },
    { status: "waiting", targetMs: instant + 31_000, remainingMs: 30_000 },
  ];
  const { el, calls } = await mount({ select: async () => answers.shift() });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
    await vi.waitFor(() => expect(remaining(el)).toBe("0:01"));
    vi.advanceTimersByTime(1_000);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(2));
    await vi.waitFor(() => expect(remaining(el)).toBeDefined());
    vi.advanceTimersByTime(0);
    await el.updateComplete;
    expect(remaining(el)).toBe("0:30");
    expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).toBeNull();
    expect(calls.filter((c) => c.action === "input")).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
it("a reload during a wait shows the server's time left", async () => {
  fakeClock();
  try {
    const { el, calls } = await mount({
      preview: { status: "waiting", targetMs: instant + 61_000, remainingMs: 61_000 },
    });
    await vi.waitFor(() => expect(remaining(el)).toBeDefined());
    vi.advanceTimersByTime(0);
    await el.updateComplete;
    expect(remaining(el)).toBe("1:01");
    expect(text(el)).toContain(WHY_WAIT);
    expect(actionsOf(calls)).toEqual(["clock-challenge", "compare-clocks", "selection"]);
    expect(calls.some((c) => c.action === "candidates")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
const detailsTick = (el: LitElement) =>
  el.shadowRoot!.querySelector<HTMLInputElement>('input[name="setup-details-confirmed"]')!;
it("a reload during the box's wait makes the series by itself at zero, with no press or tick", async () => {
  fakeClock();
  try {
    const { el, calls } = await mount({
      preview: { status: "waiting", targetMs: instant + 61_000, remainingMs: 61_000 },
    });
    await vi.waitFor(() => expect(remaining(el)).toBeDefined());
    vi.advanceTimersByTime(0);
    await el.updateComplete;
    expect(remaining(el)).toBe("1:01");
    expect(text(el)).toContain(NOTHING_TO_DO);
    expect(detailsTick(el).checked).toBe(false);
    expect(calls.some((c) => c.action === "candidates")).toBe(false);
    vi.advanceTimersByTime(61_000);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
    );
    const sent = calls.length;
    vi.advanceTimersByTime(120_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(calls).toHaveLength(sent);
  } finally {
    vi.useRealTimers();
  }
});
function reloadedDuringWait(decision: () => typeof clock) {
  let previews = 0;
  return async (proposal: unknown) => {
    const action = (proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks") return { id: "comparison", clock: decision() };
    if (action === "selection")
      return ++previews === 1
        ? { status: "waiting", targetMs: instant + 61_000, remainingMs: 61_000 }
        : { status: "preview", identity: "0CSQW" };
    throw new Error("unexpected action");
  };
}
it("a reload's wait whose second clock is missing at zero makes the series by itself once a clock answers", async () => {
  let decision = clock;
  fakeClock();
  try {
    const { el, calls } = await mount({ prepare: reloadedDuringWait(() => decision) });
    await vi.waitFor(() => expect(remaining(el)).toBe("1:01"));
    decision = noSecondClock;
    vi.advanceTimersByTime(61_000);
    await vi.waitFor(() => expect(text(el)).toContain(SETUP_DO));
    expect(text(el)).toContain(SETUP_ENDS);
    expect(action(el)).toBeUndefined();
    expect(calls.some((c) => c.action === "candidates")).toBe(false);
    decision = clock;
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
    );
    expect(detailsTick(el)).toBeNull();
    expect(calls.filter((c) => c.action === "input")).toEqual([
      { action: "input", value: selected.input },
    ]);
  } finally {
    vi.useRealTimers();
  }
});
it("a reload's wait that stops at zero on clocks that differ needs the tick and Proceed, even after Compare the clocks again waits for a second clock", async () => {
  let decision: typeof clock = clock;
  fakeClock();
  try {
    const { el, calls } = await mount({ prepare: reloadedDuringWait(() => decision) });
    await vi.waitFor(() => expect(remaining(el)).toBe("1:01"));
    decision = { ...clock, disagreement: true };
    vi.advanceTimersByTime(61_000);
    await vi.waitFor(() => expect(text(el)).toContain(DIFFER));
    await vi.waitFor(() => expect(action(el)).toBe("Compare the clocks again"));
    decision = noSecondClock;
    await userEvent.click(button(el, "compare"));
    await vi.waitFor(() => expect(text(el)).toContain(SETUP_DO));
    await vi.waitFor(() => expect(action(el)).toBe("Proceed"));
    decision = clock;
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() =>
      expect(actionsOf(calls).filter((a) => a === "compare-clocks")).toHaveLength(4),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(calls.filter((c) => c.action === "candidates")).toEqual([]);
    expect(action(el)).toBe("Proceed");
    expect(button(el, "compare").disabled).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it("a reload's wait that the box answers at zero with a fresh wait makes the series by itself at that wait's zero", async () => {
  const answers: unknown[] = [
    { status: "waiting", targetMs: instant + 151_000, remainingMs: 90_000 },
    selected,
  ];
  fakeClock();
  try {
    const { el, calls } = await mount({
      prepare: reloadedDuringWait(() => clock),
      select: async () => answers.shift(),
    });
    await vi.waitFor(() => expect(remaining(el)).toBe("1:01"));
    vi.advanceTimersByTime(61_000);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1));
    await vi.waitFor(() => expect(remaining(el)).toBe("1:30"));
    expect(action(el)).toBeUndefined();
    vi.advanceTimersByTime(90_000);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(2));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
    );
    expect(detailsTick(el)).toBeNull();
    expect(calls.filter((c) => c.action === "input")).toEqual([
      { action: "input", value: selected.input },
    ]);
  } finally {
    vi.useRealTimers();
  }
});
it("a reload's wait ends for good once the tick changes, so nothing more is asked without Proceed", async () => {
  const compares = (calls: { action: string; value?: unknown }[]) =>
    actionsOf(calls).filter((a) => a === "compare-clocks").length;
  fakeClock();
  try {
    const { el, calls } = await mount({ prepare: reloadedDuringWait(() => clock) });
    await vi.waitFor(() => expect(remaining(el)).toBe("1:01"));
    await userEvent.click(detailsTick(el));
    await el.updateComplete;
    expect(remaining(el)).toBeUndefined();
    await userEvent.click(detailsTick(el));
    await el.updateComplete;
    expect(detailsTick(el).checked).toBe(false);
    vi.advanceTimersByTime(61_000 + 61_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(compares(calls)).toBe(1);
    expect(calls.filter((c) => c.action === "candidates")).toEqual([]);
    expect(action(el)).toBe("Proceed");
    expect(button(el, "compare").disabled).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it("a reload's wait ends when the page is taken off the screen", async () => {
  let hold: Promise<void> | undefined;
  const prepare = async (proposal: unknown) => {
    const action = (proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks") {
      if (hold) await hold;
      return { id: "comparison", clock };
    }
    if (action === "selection")
      return { status: "waiting", targetMs: instant + 61_000, remainingMs: 61_000 };
    throw new Error("unexpected action");
  };
  const compares = (calls: { action: string; value?: unknown }[]) =>
    actionsOf(calls).filter((a) => a === "compare-clocks").length;
  fakeClock();
  try {
    const { el, calls, host } = await mount({ prepare });
    await vi.waitFor(() => expect(remaining(el)).toBe("1:01"));
    let release!: () => void;
    hold = new Promise((resolve) => {
      release = resolve;
    });
    vi.advanceTimersByTime(61_000);
    await vi.waitFor(() => expect(compares(calls)).toBe(2));
    host.remove();
    hold = undefined;
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.body.append(host);
    await el.updateComplete;
    expect(remaining(el)).toBeUndefined();
    vi.advanceTimersByTime(61_000 + 61_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(compares(calls)).toBe(2);
    expect(calls.filter((c) => c.action === "candidates")).toEqual([]);
    expect(detailsTick(el).checked).toBe(false);
    expect(action(el)).toBe("Proceed");
    expect(button(el, "compare").disabled).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it("a recorded wait the load's preview shows only after the tick changed does not carry on by itself", async () => {
  let decision: typeof clock = noSecondClock;
  fakeClock();
  try {
    const { el, calls } = await mount({
      decision: () => decision,
      preview: { status: "waiting", targetMs: instant + 61_000, remainingMs: 61_000 },
    });
    await vi.waitFor(() => expect(text(el)).toContain(SETUP_DO));
    await userEvent.click(detailsTick(el));
    await el.updateComplete;
    decision = clock;
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(remaining(el)).toBe("1:01"));
    vi.advanceTimersByTime(200_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(calls.filter((c) => c.action === "candidates" || c.action === "request")).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
const SERIES_LINE =
  "When you press Proceed, Waitron creates this box's invoice series. The invoice series is the code at the start of every invoice number: for example, in A-0CSQW/1 the series is A-0CSQW.";
const seriesLine = (el: LitElement) =>
  el.shadowRoot!.querySelector("[data-test=series-line]")?.textContent?.trim();
it("with the clocks agreeing, ticking the details and pressing Proceed makes the series", async () => {
  fakeClock();
  try {
    const { el, calls } = await mount();
    await ready(el);
    await proceed(el);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
    );
    expect(calls.filter((c) => c.action === "candidates")).toEqual([
      { action: "candidates", value: { comparisonId: "comparison-2" } },
    ]);
  } finally {
    vi.useRealTimers();
  }
});
it("without the tick nothing asks for the series, and the page says Proceed starts it", async () => {
  fakeClock();
  try {
    const { el, calls } = await mount({ preview: { status: "preview", identity: "0CSQW" } });
    await vi.waitFor(() =>
      expect(actionsOf(calls)).toEqual(["clock-challenge", "compare-clocks", "selection"]),
    );
    vi.advanceTimersByTime(200_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(calls.filter((c) => c.action === "candidates" || c.action === "request")).toEqual([]);
    expect(seriesLine(el)).toBe(SERIES_LINE);
  } finally {
    vi.useRealTimers();
  }
});
it("with the tick and the clocks agreeing, nothing asks for the series until Proceed", async () => {
  fakeClock();
  try {
    const { el, calls } = await mount();
    await ready(el);
    vi.advanceTimersByTime(200_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(calls.filter((c) => c.action === "candidates" || c.action === "request")).toEqual([]);
    expect(actionsOf(calls)).toEqual(["clock-challenge", "compare-clocks", "selection"]);
    await proceed(el);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
    );
  } finally {
    vi.useRealTimers();
  }
});
it("the page says what Proceed does only while the button reads Proceed, not during the wait after it", async () => {
  const answers: unknown[] = [
    { status: "waiting", targetMs: instant + 61_000, remainingMs: 61_000 },
    selected,
  ];
  fakeClock();
  try {
    const { el } = await mount({ select: async () => answers.shift() });
    await ready(el);
    expect(seriesLine(el)).toBe(SERIES_LINE);
    await proceed(el);
    await vi.waitFor(() => expect(remaining(el)).toBe("1:01"));
    expect(el.shadowRoot!.querySelector("[data-test=series-line]")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
it("Proceed is quiet and disabled until the details are ticked", async () => {
  const { el } = await mount();
  await vi.waitFor(() => expect(action(el)).toBe("Proceed"));
  expect(quiet(el)).toEqual({ disabled: true, variant: "secondary" });
  await userEvent.click(detailsTick(el));
  await el.updateComplete;
  expect(quiet(el)).toEqual({ disabled: false, variant: "primary" });
});
it("taking the tick away during the box's wait stops the page, and ticking again asks nothing until Proceed", async () => {
  const answers: unknown[] = [
    { status: "waiting", targetMs: instant + 61_000, remainingMs: 61_000 },
    selected,
  ];
  fakeClock();
  try {
    const { el, calls } = await mount({ select: async () => answers.shift() });
    await ready(el);
    await proceed(el);
    await vi.waitFor(() => expect(remaining(el)).toBe("1:01"));
    await userEvent.click(detailsTick(el));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
    vi.advanceTimersByTime(120_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1);
    await userEvent.click(detailsTick(el));
    await el.updateComplete;
    vi.advanceTimersByTime(120_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1);
    await proceed(el);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(2));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
    );
  } finally {
    vi.useRealTimers();
  }
});
it("with no second clock on load it explains itself before the tick, and makes the series once Proceed is pressed and a clock answers", async () => {
  let decision = {
    ...clock,
    usable: clock.usable.filter((r) => r.source === "box"),
    unavailable: [
      { source: "browser", result: "unavailable" as const, reason: "same_machine" },
      { source: "internet", result: "unavailable" as const, reason: "offline" },
    ],
    secondClock: false,
  };
  fakeClock();
  try {
    const { el, calls } = await mount({ decision: () => decision });
    await vi.waitFor(() => expect(text(el)).toContain(SETUP_DO));
    expect(text(el)).toContain(WHY_SECOND);
    expect(seriesLine(el)).toBe(SERIES_LINE);
    expect(text(el)).not.toContain(SETUP_ENDS);
    expect(detailsTick(el).checked).toBe(false);
    await ready(el);
    expect(text(el)).toContain(SETUP_DO);
    expect(text(el)).not.toContain(SETUP_ENDS);
    await proceed(el);
    await vi.waitFor(() => expect(text(el)).toContain(SETUP_ENDS));
    expect(text(el)).toContain(SETUP_DO);
    expect(action(el)).toBeUndefined();
    expect(calls.some((c) => c.action === "candidates")).toBe(false);
    decision = { ...clock };
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
    );
  } finally {
    vi.useRealTimers();
  }
});
it("shows no countdown before the tick when no wait is recorded", async () => {
  const { el, calls } = await mount();
  await vi.waitFor(() =>
    expect(actionsOf(calls)).toEqual(["clock-challenge", "compare-clocks", "selection"]),
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=hour-wait]")).toBeNull();
});
it("with no second clock it explains itself and carries on when the internet arrives", async () => {
  let decision = {
    ...clock,
    usable: clock.usable.filter((r) => r.source === "box"),
    unavailable: [
      { source: "browser", result: "unavailable" as const, reason: "same_machine" },
      { source: "internet", result: "unavailable" as const, reason: "offline" },
    ],
    secondClock: false,
  };
  const { el, calls } = await mount({ decision: () => decision });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
    await vi.waitFor(() => expect(text(el)).toContain(SETUP_DO));
    expect(text(el)).toContain(WHY_SECOND);
    expect(text(el)).toContain(ON_BOX);
    expect(text(el)).toContain(SETUP_ENDS);
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
    expect(calls.some((c) => c.action === "candidates")).toBe(false);
    decision = { ...clock };
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
    );
  } finally {
    vi.useRealTimers();
  }
});
it("a phone with no second clock does not say it is the box", async () => {
  const decision = {
    ...clock,
    usable: clock.usable.filter((r) => r.source === "box"),
    unavailable: [
      { source: "browser", result: "unavailable" as const, reason: "challenge" },
      { source: "internet", result: "unavailable" as const, reason: "offline" },
    ],
    secondClock: false,
  };
  const { el } = await mount({ decision });
  await ready(el);
  await vi.waitFor(() => expect(text(el)).toContain(SETUP_DO));
  expect(text(el)).toContain(WHY_SECOND);
  expect(text(el)).not.toContain(ON_BOX);
});
it("a clock refusal shows each clock's reading and no countdown, and waits for Compare the clocks again", async () => {
  const decision = {
    ...clock,
    usable: [
      { source: "box", lowerMs: instant, upperMs: instant },
      { source: "browser", lowerMs: instant + 45_000, upperMs: instant + 45_000 },
    ],
    unavailable: [{ source: "internet", result: "unavailable" as const, reason: "offline" }],
    disagreement: true,
  };
  const { el, calls } = await mount({ decision });
  fakeClock();
  try {
    await ready(el);
    expect(text(el)).not.toContain(DIFFER);
    await proceed(el);
    await vi.waitFor(() => expect(text(el)).toContain(DIFFER));
    expect(text(el)).not.toContain(OLD_WHY_REFUSED);
    expect(text(el)).not.toMatch(/ask for help/);
    expect(detailRows(el, "clock-times")).toEqual([
      ["Server time", "18 October 2026 at 14:30:00"],
      ["This device", "18 October 2026 at 14:30:45"],
    ]);
    expect(text(el)).not.toContain(new Date(instant).toISOString());
    expect(text(el)).not.toContain(new Date(instant + 45_000).toISOString());
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
    expect(calls.some((c) => c.action === "candidates")).toBe(false);
    const before = calls.length;
    vi.advanceTimersByTime(60_000);
    await el.updateComplete;
    expect(calls).toHaveLength(before);
    expect(button(el, "compare").textContent?.trim()).toBe("Compare the clocks again");
    await userEvent.click(button(el, "compare"));
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(before));
    expect(actionsOf(calls.slice(before))).toEqual(
      expect.arrayContaining(["clock-challenge", "compare-clocks"]),
    );
  } finally {
    vi.useRealTimers();
  }
});
it("a later minute allowed from beyond the date range is explained without a time", async () => {
  const { el } = await mount({
    select: async () => {
      throw {
        code: "sif.allocation_invalid",
        params: { reason: "minute_not_later", allowedFromMs: 8_640_000_000_060_000 },
      };
    },
  });
  await ready(el);
  await proceed(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=minute-not-later]")?.textContent?.trim()).toBe(
      "The invoice series cannot be created yet: this box's clock is earlier than a time it has already used for invoice series.",
    ),
  );
});
it("a later minute in use is explained and does not count down", async () => {
  const allowedFromMs = Date.parse("2026-10-18T20:04:00Z");
  const { el, calls } = await mount({
    select: async () => {
      throw {
        code: "sif.allocation_invalid",
        params: { reason: "minute_not_later", allowedFromMs },
      };
    },
  });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
    await vi.waitFor(() =>
      expect(text(el)).toContain(
        "The invoice series cannot be created yet: this box's clock is earlier than a time it has already used for invoice series.",
      ),
    );
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
    vi.advanceTimersByTime(60_000);
    await el.updateComplete;
    expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
it("a minute in use shows one countdown, checks again quietly and keeps saying why", async () => {
  const answers: (() => unknown)[] = [
    () => {
      throw {
        code: "sif.allocation_invalid",
        params: {
          reason: "minute_in_use",
          allowedFromMs: instant + 180_000,
          remainingMs: 180_000,
          recheckInMs: 30_000,
        },
      };
    },
    () => ({ status: "waiting", targetMs: instant + 180_000, remainingMs: 150_000 }),
  ];
  const { el, calls } = await mount({ select: async () => answers.shift()!() });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
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
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(2));
    await el.updateComplete;
    expect(taken()).toBe(
      "This invoice series code has already been used. Waitron creates a new one by itself when the countdown ends.",
    );
    expect(remaining(el)).toBe("02:30");
    expect(el.shadowRoot!.querySelector("[data-test=minute-in-use]")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
it("a lost re-check during a taken minute keeps counting and checks again", async () => {
  const answers: (() => unknown)[] = [
    () => {
      throw {
        code: "sif.allocation_invalid",
        params: {
          reason: "minute_in_use",
          allowedFromMs: instant + 180_000,
          remainingMs: 180_000,
          recheckInMs: 30_000,
        },
      };
    },
    () => {
      throw new TypeError("Failed to fetch");
    },
    () => ({ status: "waiting", targetMs: instant + 180_000, remainingMs: 135_000 }),
  ];
  const { el, calls } = await mount({ select: async () => answers.shift()!() });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
    await vi.waitFor(() => expect(remaining(el)).toBe("03:00"));
    vi.advanceTimersByTime(30_000);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(2));
    vi.advanceTimersByTime(1_000);
    await el.updateComplete;
    expect(remaining(el)).toBe("02:29");
    expect(text(el)).toContain(
      "This invoice series code has already been used. Waitron creates a new one by itself when the countdown ends.",
    );
    expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
      "false",
    );
    vi.advanceTimersByTime(14_000);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(3));
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
  const answers: (() => unknown)[] = [
    () => {
      throw {
        code: "sif.allocation_invalid",
        params: {
          reason: "minute_in_use",
          allowedFromMs: instant + 180_000,
          remainingMs: 180_000,
          recheckInMs: 30_000,
        },
      };
    },
    () => ({ status: "waiting", targetMs: "soon", remainingMs: 150_000 }),
  ];
  const { el, calls } = await mount({ select: async () => answers.shift()!() });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
    await vi.waitFor(() => expect(remaining(el)).toBe("03:00"));
    vi.advanceTimersByTime(30_000);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
        "true",
      ),
    );
    expect(remaining(el)).toBeUndefined();
    vi.advanceTimersByTime(60_000);
    expect(calls.filter((c) => c.action === "candidates")).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});
it("ignores a late selection after the public context is replaced", async () => {
  let release!: (value: unknown) => void;
  const { el, calls, parent } = await mount({
    select: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  await ready(el);
  await proceed(el);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  (parent as LitElement & { context: unknown }).context = {
    ...context,
    venue: { ...context.venue, taxId: "B87654321" },
  };
  await parent.updateComplete;
  release(selected);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls.some((c) => c.action === "input")).toBe(false);
});
it("allows retry after a request refusal", async () => {
  let attempts = 0;
  const { el, calls } = await mount({
    select: async () => {
      if (++attempts === 1) throw { code: "setup.attempt_conflict" };
      return selected;
    },
  });
  await ready(el);
  await proceed(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
      "true",
    ),
  );
  expect(button(el, "compare").disabled).toBe(false);
  await userEvent.click(button(el, "compare"));
  await vi.waitFor(() => expect(calls.some((c) => c.action === "input")).toBe(true));
});
it("keeps one real key-only PDF for download and print, then grants Review only after explicit kept", async () => {
  const { el, calls, api } = await mount();
  const deliveries: unknown[] = [],
    kept: unknown[] = [];
  api.stageNodeKey = async () => ({
    stage: { stageId: "stage", nodeId: "node", name: "Olivo key" },
    key: { nodeId: "node", name: "Olivo key", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
  });
  api.registerRecoveryDocument = async (value) => {
    deliveries.push(value);
  };
  api.confirmRecoveryDocument = async (value) => {
    kept.push(value);
  };
  await ready(el);
  await proceed(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
  );
  await userEvent.click(button(el, "prepare-pdf"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("a[data-test=download-pdf]")).not.toBeNull(),
  );
  const download = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=download-pdf]")!;
  const print = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=print-pdf]")!;
  expect(download.href).toBe(print.href);
  const bytes = new Uint8Array(await (await fetch(download.href)).arrayBuffer());
  expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
  const decoded = await readRecoveryPdf(bytes);
  expect(decoded.document?.nodeKey).toEqual({
    nodeId: "node",
    name: "Olivo key",
    secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
  });
  expect(decoded.document?.scope).toEqual({
    taxpayerNif: "B12345674",
    environment: "production",
    softwareId: "W1",
  });
  expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain(
    "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
  );
  expect(JSON.stringify(Object.entries(localStorage))).not.toContain(
    "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
  );
  expect(JSON.stringify(deliveries)).not.toContain("AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  expect(deliveries).toEqual([
    {
      stageId: "stage",
      inputDigest: "e799c91f661c00f8cf2ba285b34aaa1be7c6d4c5c8a9307e9614d920621d9253",
      bindingDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      documentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      statement: {
        kind: "waitron-recovery-document",
        version: 1,
        scope: { taxpayerNif: "B12345674", environment: "production", softwareId: "W1" },
        taxpayerName: "Olivo SL",
        venueName: "Olivo",
        createdAt: expect.any(String),
        nodeKey: { nodeId: "node", name: "Olivo key" },
      },
    },
  ]);
  expect(kept).toEqual([]);
  expect(button(el, "kept").disabled).toBe(true);
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLInputElement>('input[name="setup-pdf-kept"]')!,
  );
  await userEvent.click(button(el, "kept"));
  await vi.waitFor(() => expect(kept).toHaveLength(1));
  expect(kept[0]).toEqual({ ...(deliveries[0] as object), statement: undefined });
  expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1);
  expect(el.shadowRoot!.textContent).not.toContain("AbCdEfGhIjKlMnOpQrStUvWxYz012345");
});
it("the wizard PDF uses the reviewed Canary venue zone", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instant);
  try {
    const request = structuredClone(context);
    request.venue.timeZone = "Atlantic/Canary";
    const { el, api } = await mount({ request });
    api.stageNodeKey = async () => ({
      stage: { stageId: "stage", nodeId: "node", name: "Olivo key" },
      key: { nodeId: "node", name: "Olivo key", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
    });
    api.registerRecoveryDocument = async () => {};
    api.confirmRecoveryDocument = async () => {};
    await ready(el);
    await proceed(el);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
    );
    await userEvent.click(button(el, "prepare-pdf"));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=download-pdf]")).not.toBeNull(),
    );
    const download = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=download-pdf]")!;
    const task = openRecoveryPdf(new Uint8Array(await (await fetch(download.href)).arrayBuffer()));
    try {
      const pdf = await task.promise;
      let text = "";
      for (let n = 1; n <= pdf.numPages; n++)
        text += (await (await pdf.getPage(n)).getTextContent()).items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
      expect(text).toContain("18 October 2026, 13:30");
      expect(text).toContain("WEST");
    } finally {
      await task.destroy();
    }
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  [
    "en",
    "Keep your recovery pack.",
    "Download recovery pack",
    "I kept the recovery pack.",
    "Make the pack again with a new server key",
    "Recovery pack confirmed.",
  ],
  [
    "es",
    "Guarda el paquete de recuperación.",
    "Descargar el paquete de recuperación",
    "He guardado el paquete de recuperación.",
    "Hacer el paquete otra vez con una nueva clave del servidor",
    "Paquete de recuperación confirmado.",
  ],
] as const)(
  "names the %s step's download a recovery pack and never the server key a recovery key",
  async (locale, next, make, keptLabel, replace, complete) => {
    const { el, api } = await mount({ locale });
    api.stageNodeKey = async () => ({
      stage: { stageId: "stage", nodeId: "node", name: "Olivo key" },
      key: { nodeId: "node", name: "Olivo key", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
    });
    api.reissueNodeKey = api.stageNodeKey;
    api.registerRecoveryDocument = async () => {};
    api.confirmRecoveryDocument = async () => {};
    await ready(el);
    await proceed(el);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
    );
    expect(el.shadowRoot!.textContent).toContain(next);
    expect(button(el, "prepare-pdf").textContent!.trim()).toBe(make);
    await userEvent.click(button(el, "prepare-pdf"));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=download-pdf]")).not.toBeNull(),
    );
    expect(
      el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=download-pdf]")!.download,
    ).toBe("waitron-recovery-pack-1.pdf");
    expect(el.shadowRoot!.textContent).toContain(keptLabel);
    expect(button(el, "replace-key").textContent!.trim()).toBe(replace);
    await userEvent.click(
      el.shadowRoot!.querySelector<HTMLInputElement>('input[name="setup-pdf-kept"]')!,
    );
    await userEvent.click(button(el, "kept"));
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(complete));
    expect(el.shadowRoot!.textContent).not.toMatch(/recovery key|clave de recuperación/i);
  },
);

it("continues a frozen hour through its public request without selecting another", async () => {
  const { el, calls, api } = await mount({ request: { ...context, status: "consumption-intent" } });
  api.request = async () => {
    calls.push({ action: "request" });
    return selected;
  };
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-clock=read]")).not.toBeNull());
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLInputElement>('input[name="setup-details-confirmed"]')!,
  );
  await proceed(el);
  await vi.waitFor(() => expect(calls.some((c) => c.action === "input")).toBe(true));
  expect(calls.filter((c) => c.action === "request")).toHaveLength(1);
  expect(calls.filter((c) => c.action === "candidates")).toEqual([]);
});
it.each([null, [], { id: 1 }])(
  "refuses malformed challenge %j before comparison or hour selection",
  async (challenge) => {
    const { el, calls } = await mount({ prepare: async () => challenge });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
        "true",
      ),
    );
    expect(el.shadowRoot!.querySelector("[data-clock=read]")).toBeNull();
    expect(calls.map((call) => call.value)).toEqual([{ action: "clock-challenge" }]);
  },
);

it.each([
  null,
  { id: 1, clock },
  { id: "comparison", clock: null },
  { id: "comparison", clock: { ...clock, usable: {} } },
  { id: "comparison", clock: { ...clock, unavailable: {} } },
])("refuses malformed comparison %j before hour selection", async (compared) => {
  const { el, calls } = await mount({
    prepare: async (proposal) =>
      (proposal as { action: string }).action === "clock-challenge"
        ? { id: "challenge" }
        : compared,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
      "true",
    ),
  );
  expect(el.shadowRoot!.querySelector("[data-clock=read]")).toBeNull();
  expect(calls.some((call) => call.action === "candidates" || call.action === "input")).toBe(false);
});

it.each([
  null,
  { status: "other" },
  { ...selected, kind: "legacy" },
  { ...selected, identity: "S000001" },
  { ...selected, input: null },
  { ...selected, input: { allocation: [] } },
  { ...selected, input: { allocation: { installationIdentity: "0CSSR", series: [] } } },
  { ...selected, input: { allocation: { installationIdentity: "0CSQW", series: {} } } },
  { ...selected, input: { allocation: { installationIdentity: "0CSQW", series: [null] } } },
  {
    ...selected,
    input: {
      allocation: { installationIdentity: "0CSQW", series: [{ code: "", purpose: "full" }] },
    },
  },
  {
    ...selected,
    input: { allocation: { installationIdentity: "0CSQW", series: [{ purpose: "full" }] } },
  },
  { status: "waiting", targetMs: instant + 0.5, remainingMs: 1000 },
  { status: "waiting", targetMs: instant, remainingMs: -1 },
  { status: "waiting", targetMs: instant, remainingMs: Infinity },
  { status: "waiting", targetMs: instant, remainingMs: "1000" },
  { status: "waiting", targetMs: instant + 1800000, remainingMs: null },
  { status: "waiting", targetMs: 8_640_000_000_060_000, remainingMs: 1000 },
])("refuses malformed hour result %j without importing it and permits retry", async (result) => {
  const { el, calls } = await mount({ select: async () => result });
  await ready(el);
  await proceed(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
      "true",
    ),
  );
  expect(calls.filter((call) => call.action === "input")).toEqual([]);
  expect(
    el.shadowRoot!.querySelector("[data-test=selected-hour], [data-test=hour-wait]"),
  ).toBeNull();
  expect(action(el)).toBe("Try again");
  expect(button(el, "compare").disabled).toBe(false);
});

it.each(["clock-challenge", "compare-clocks"])(
  "ignores a late rejected %s after the screen disconnects",
  async (action) => {
    let reject!: (reason: Error) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { el, host, calls } = await mount({
      prepare: async (proposal) => {
        if ((proposal as { action: string }).action !== action) return { id: "challenge" };
        entered();
        return new Promise((_resolve, fail) => {
          reject = fail;
        });
      },
    });
    await started;
    host.remove();
    reject(new Error("late network refusal"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).not.toBe(
      "true",
    );
    expect(el.shadowRoot!.querySelector("[data-clock=read]")).toBeNull();
    expect(calls.filter((call) => call.action === "candidates" || call.action === "input")).toEqual(
      [],
    );
  },
);

it.each(["clock-challenge", "compare-clocks"])(
  "does not publish a late successful %s after disconnection",
  async (action) => {
    let release!: (value: unknown) => void, entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const { el, host, calls } = await mount({
      prepare: async (proposal) => {
        if ((proposal as { action: string }).action !== action) return { id: "challenge" };
        entered();
        return pending;
      },
    });
    await started;
    host.remove();
    release(action === "clock-challenge" ? { id: "challenge" } : { id: "comparison", clock });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-clock=read]")).toBeNull();
    expect(calls.some((call) => call.action === "candidates" || call.action === "input")).toBe(
      false,
    );
    expect(
      calls.filter((call) => (call.value as { action?: string })?.action === "compare-clocks"),
    ).toHaveLength(action === "clock-challenge" ? 0 : 1);
  },
);

it("does not ask for the name after Proceed's comparison resolves on a disconnected screen", async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let compared = 0;
  const { el, host, calls } = await mount({
    prepare: async (proposal) => {
      const action = (proposal as { action: string }).action;
      if (action === "clock-challenge") return { id: "challenge" };
      if (action === "selection") return { status: "preview" };
      if (++compared === 2) {
        entered();
        await pending;
      }
      return { id: "comparison", clock };
    },
  });
  await ready(el);
  await proceed(el);
  await started;
  host.remove();
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(calls.filter((call) => call.action === "candidates" || call.action === "input")).toEqual(
    [],
  );
  expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).toBeNull();
});

it("does not publish selected state after its input import finishes on a disconnected screen", async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { el, api, host } = await mount();
  api.importInput = async () => {
    entered();
    await pending;
  };
  await ready(el);
  await proceed(el);
  await started;
  host.remove();
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=prepare-pdf]")).toBeNull();
});

it.each(["stage", "register", "input digest", "PDF ready"])(
  "discards a recovery delivery when the screen disconnects during %s",
  async (phase) => {
    const { el, host, api } = await mount();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registrations: unknown[] = [];
    const staged = {
      stage: { stageId: "stage", nodeId: "node", name: "Olivo key" },
      key: { nodeId: "node", name: "Olivo key", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
    };
    api.stageNodeKey = async () => {
      if (phase === "stage") {
        entered();
        await gate;
      }
      return staged;
    };
    api.registerRecoveryDocument = async (value) => {
      registrations.push(value);
      if (phase === "register") {
        entered();
        await gate;
      }
    };
    api.confirmRecoveryDocument = async () => {
      throw new Error("kept without a document");
    };
    const realCreate = URL.createObjectURL.bind(URL);
    const urls: string[] = [];
    const revoked = vi.spyOn(URL, "revokeObjectURL");
    vi.spyOn(URL, "createObjectURL").mockImplementation((object) => {
      const url = realCreate(object);
      urls.push(url);
      if (phase === "PDF ready") {
        host.remove();
        entered();
      }
      return url;
    });
    if (phase === "input digest") {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
        const data = args[1];
        const text = new TextDecoder().decode(data as BufferSource);
        if (text.startsWith('{"allocation":')) {
          entered();
          await gate;
        }
        return digest(...args);
      });
    }
    await ready(el);
    await proceed(el);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
    );
    await userEvent.click(button(el, "prepare-pdf"));
    await started;
    host.remove();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=download-pdf]")).toBeNull();
    expect(registrations).toHaveLength(phase === "register" ? 1 : 0);
    for (const url of urls) expect(revoked).toHaveBeenCalledWith(url);
  },
);

it("keeps a failed kept confirmation retryable without granting completion", async () => {
  const { el, api } = await mount();
  api.stageNodeKey = async () => ({
    stage: { stageId: "stage", nodeId: "node", name: "Olivo key" },
    key: { nodeId: "node", name: "Olivo key", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
  });
  api.registerRecoveryDocument = async () => {};
  let refuse = true;
  api.confirmRecoveryDocument = async () => {
    if (refuse) throw new Error("temporary refusal");
  };
  await ready(el);
  await proceed(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
  );
  await userEvent.click(button(el, "prepare-pdf"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=download-pdf]")).not.toBeNull(),
  );
  await userEvent.click(el.shadowRoot!.querySelector<HTMLInputElement>('[name="setup-pdf-kept"]')!);
  await userEvent.click(button(el, "kept"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions[data-failed=true]")).not.toBeNull(),
  );
  expect(button(el, "kept").disabled).toBe(false);
  expect(el.shadowRoot!.textContent).not.toContain("Recovery pack confirmed.");
  refuse = false;
  await userEvent.click(button(el, "kept"));
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Recovery pack confirmed."));
});

const quiet = (el: LitElement) => {
  const compare = button(el, "compare");
  return { disabled: compare.disabled, variant: compare.getAttribute("variant") };
};
const noSecondClock = {
  ...clock,
  usable: clock.usable.filter((r) => r.source === "box"),
  unavailable: [{ source: "internet", result: "unavailable" as const, reason: "offline" }],
  secondClock: false,
};
function gatedClocks() {
  const state = {
    decision: noSecondClock as typeof clock,
    hold: undefined as Promise<void> | undefined,
    fail: false,
    refusal: undefined as unknown,
  };
  let compared = 0;
  const prepare = async (proposal: unknown) => {
    const action = (proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "selection") return { status: "preview" };
    if (state.hold) await state.hold;
    if (state.refusal !== undefined) throw state.refusal;
    if (state.fail) {
      state.fail = false;
      throw new TypeError("Failed to fetch");
    }
    return { id: `comparison-${++compared}`, clock: state.decision };
  };
  return { state, prepare };
}
it("keeps the explanation on screen while an automatic re-check is in flight", async () => {
  const { state, prepare } = gatedClocks();
  const { el, calls } = await mount({ prepare });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
    await vi.waitFor(() => expect(text(el)).toContain(SETUP_DO));
    let release!: () => void;
    state.hold = new Promise((resolve) => {
      release = resolve;
    });
    const before = calls.length;
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(before));
    await el.updateComplete;
    expect(text(el)).toContain(WHY_SECOND);
    expect(text(el)).toContain(SETUP_DO);
    release();
  } finally {
    vi.useRealTimers();
  }
});
it("keeps the countdown's explanation on screen while its re-check is in flight", async () => {
  const { state, prepare } = gatedClocks();
  state.decision = clock;
  const { el } = await mount({
    prepare,
    select: async () => ({ status: "waiting", targetMs: instant + 1_000, remainingMs: 1_000 }),
  });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
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
it("keeps checking for a second clock after one automatic re-check fails", async () => {
  const { state, prepare } = gatedClocks();
  const { el, calls } = await mount({ prepare });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
    await vi.waitFor(() => expect(text(el)).toContain(SETUP_DO));
    state.fail = true;
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(state.fail).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(text(el)).toContain(SETUP_DO);
    state.decision = clock;
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1));
  } finally {
    vi.useRealTimers();
  }
});
it("stops checking for a second clock when a re-check is refused, and shows the failure", async () => {
  const { state, prepare } = gatedClocks();
  const { el, calls } = await mount({ prepare });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
    await vi.waitFor(() => expect(text(el)).toContain(SETUP_DO));
    state.refusal = { code: "setup.owner_required" };
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
        "true",
      ),
    );
    await el.updateComplete;
    expect(text(el)).not.toContain(SETUP_ENDS);
    expect(quiet(el)).toEqual({ disabled: false, variant: "primary" });
    const after = calls.length;
    vi.advanceTimersByTime(45_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toHaveLength(after);
  } finally {
    vi.useRealTimers();
  }
});
it("an answer it cannot read while waiting for a second clock shows the failure", async () => {
  const { state, prepare } = gatedClocks();
  const { el, calls } = await mount({ prepare });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
    await vi.waitFor(() => expect(text(el)).toContain(SETUP_DO));
    // A comparison with no readings lists, which `readClocks` refuses as "invalid comparison".
    state.decision = {} as typeof clock;
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
        "true",
      ),
    );
    await el.updateComplete;
    expect(text(el)).not.toContain(SETUP_ENDS);
    expect(quiet(el)).toEqual({ disabled: false, variant: "primary" });
    const after = calls.length;
    vi.advanceTimersByTime(45_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toHaveLength(after);
  } finally {
    vi.useRealTimers();
  }
});
it.each([
  [
    "en",
    "We've created these series",
    "Waitron cannot create invoice series for this date: it is outside the range the series codes cover.",
  ],
  [
    "es",
    "Hemos creado estas series",
    "Waitron no puede crear series de facturas para esta fecha: está fuera del rango que cubren los códigos de serie.",
  ],
] as const)(
  "%s labels say invoice series, list the codes and never the bare name",
  async (locale, chosen, range) => {
    const { el } = await mount({ locale });
    await ready(el);
    await proceed(el);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
    );
    const result = el.shadowRoot!.querySelector("[data-test=selected-hour]")!;
    expect(result.querySelector("h2")?.textContent?.trim()).toBe(chosen);
    expect([...result.querySelectorAll("li")].map((li) => li.textContent?.trim())).toEqual([
      "A-0CSQW",
      "FF-0CSQW",
      "R-0CSQW",
    ]);
    expect(text(el).replaceAll(/[A-Z]+-0CSQW/g, "")).not.toContain("0CSQW");
    const blocked = await mount({ locale, decision: { ...clock, rangeBlocked: true } });
    await vi.waitFor(() => expect(text(blocked.el)).toContain(range));
  },
);
it("says in Spanish that the series code already exists, with the countdown", async () => {
  const { el } = await mount({
    locale: "es",
    select: async () => {
      throw {
        code: "sif.allocation_invalid",
        params: {
          reason: "minute_in_use",
          allowedFromMs: instant + 180_000,
          remainingMs: 180_000,
          recheckInMs: 30_000,
        },
      };
    },
  });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
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
it("says in Spanish that the series cannot be made yet, with the plural verb", async () => {
  const { el } = await mount({
    locale: "es",
    select: async () => {
      throw {
        code: "sif.allocation_invalid",
        params: { reason: "minute_not_later", allowedFromMs: Date.parse("2026-10-18T20:04:00Z") },
      };
    },
  });
  await ready(el);
  await proceed(el);
  await vi.waitFor(() =>
    expect(text(el)).toContain(
      "Todavía no se pueden crear las series de facturas: la hora de este servidor es anterior a una hora que ya usó para series de facturas.",
    ),
  );
});
it.each([["second_clock_missing", { ...noSecondClock }]] as const)(
  "%s found on load is explained, with no failure",
  async (reason, decision) => {
    const prepare = async (proposal: unknown) => {
      const action = (proposal as { action: string }).action;
      if (action === "clock-challenge") return { id: "challenge" };
      if (action === "compare-clocks") return { id: "comparison", clock: decision };
      throw { code: "sif.allocation_invalid", params: { reason } };
    };
    const missing = reason === "second_clock_missing";
    fakeClock();
    try {
      const { el, calls } = await mount({ prepare });
      await vi.waitFor(() => expect(text(el)).toContain(missing ? WHY_SECOND : DIFFER));
      expect(actionsOf(calls)).toEqual(["clock-challenge", "compare-clocks"]);
      expect(el.shadowRoot!.querySelector("[data-clock=read]")).not.toBeNull();
      expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
        "false",
      );
      for (const checks of [1, 2, 3]) {
        vi.advanceTimersByTime(15_000);
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (missing) await vi.waitFor(() => expect(calls).toHaveLength(2 + 2 * checks));
        else expect(calls).toHaveLength(2);
      }
      expect(text(el)).toContain(missing ? WHY_SECOND : DIFFER);
    } finally {
      vi.useRealTimers();
    }
  },
);
it.each([
  ["clocks that disagree", undefined],
  ["a preview the box refuses as disagreeing", { reason: "clock_disagreement" }],
] as const)(
  "%s found on load show no clock step until Proceed, then explain it with no failure",
  async (_case, previewRefusal) => {
    const decision = {
      ...clock,
      usable: [
        { source: "box", lowerMs: instant, upperMs: instant },
        { source: "browser", lowerMs: instant + 45_000, upperMs: instant + 45_000 },
      ],
      disagreement: previewRefusal === undefined,
    };
    const prepare = async (proposal: unknown) => {
      const action = (proposal as { action: string }).action;
      if (action === "clock-challenge") return { id: "challenge" };
      if (action === "compare-clocks") return { id: "comparison", clock: decision };
      throw { code: "sif.allocation_invalid", params: previewRefusal ?? { reason: "unexpected" } };
    };
    fakeClock();
    try {
      const { el, calls } = await mount({
        prepare,
        select: async () => {
          throw { code: "sif.allocation_invalid", params: { reason: "clock_disagreement" } };
        },
      });
      await ready(el);
      await vi.waitFor(() => expect(action(el)).toBe("Proceed"));
      expect(text(el)).not.toContain(DIFFER);
      expect(el.shadowRoot!.querySelector("[data-test=clock-refused]")).toBeNull();
      expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
        "false",
      );
      expect(actionsOf(calls)).toEqual(
        previewRefusal
          ? ["clock-challenge", "compare-clocks", "selection"]
          : ["clock-challenge", "compare-clocks"],
      );
      await proceed(el);
      await vi.waitFor(() => expect(text(el)).toContain(DIFFER));
      expect(detailRows(el, "clock-times")).toEqual([
        ["Server time", "18 October 2026 at 14:30:00"],
        ["This device", "18 October 2026 at 14:30:45"],
      ]);
      expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
        "false",
      );
      const before = calls.length;
      vi.advanceTimersByTime(45_000);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(calls).toHaveLength(before);
      expect(action(el)).toBe("Compare the clocks again");
    } finally {
      vi.useRealTimers();
    }
  },
);

it("a box clock before this release shows only the release line", async () => {
  const { el } = await mount({
    prepare: async (proposal: unknown) => {
      const action = (proposal as { action: string }).action;
      if (action === "clock-challenge") return { id: "challenge" };
      if (action === "compare-clocks")
        return { id: "comparison", clock: { ...clock, releaseBlocked: true } };
      throw { code: "sif.allocation_invalid", params: { reason: "clock_unconfirmed" } };
    },
  });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-clock=read]")).not.toBeNull());
  await vi.waitFor(() => expect(button(el, "compare").disabled).toBe(false));
  expect(text(el)).toContain("Box time precedes this Waitron release.");
  expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
    "false",
  );
});

it("a missing second clock reported by the server starts the 15-second check", async () => {
  let refused = false;
  const { el, calls } = await mount({
    select: async () => {
      if (refused) return selected;
      refused = true;
      throw { code: "sif.allocation_invalid", params: { reason: "second_clock_missing" } };
    },
  });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
    await vi.waitFor(() => expect(text(el)).toContain(SETUP_DO));
    expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1);
    vi.advanceTimersByTime(15_000);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(2));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
    );
  } finally {
    vi.useRealTimers();
  }
});
it("names the box's own clock reading «Servidor» in Spanish, apart from a till", async () => {
  const { el } = await mount({ locale: "es", decision: { ...clock, disagreement: true } });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-clock=read]")).not.toBeNull());
  const series = seriesLine(el);
  await ready(el);
  await proceed(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=clock-times]")).not.toBeNull(),
  );
  const labels = [...el.shadowRoot!.querySelectorAll("[data-test=clock-times] dt")].map((dt) =>
    dt.textContent!.trim(),
  );
  expect(labels).toEqual(["Hora del servidor", "Este dispositivo", "Internet"]);
  expect(series).toBe(
    "Cuando pulses Continuar, Waitron creará las series de facturas de este servidor. La serie de facturas es el código al principio de cada número de factura: por ejemplo, en A-0CSQW/1 la serie es A-0CSQW.",
  );
});
const differ = (el: LitElement) => vi.waitFor(() => expect(text(el)).toContain(DIFFER));
const failed = (el: LitElement) =>
  vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
      "true",
    ),
  );
const shows = (el: LitElement, name: string) =>
  vi.waitFor(() => expect(el.shadowRoot!.querySelector(`[data-test=${name}]`)).not.toBeNull());
const pressed = async (options: Parameters<typeof mount>[0]) => {
  const { el } = await mount(options);
  await ready(el);
  await proceed(el);
  return el;
};
const refusing = (params: Record<string, unknown>) => async () => {
  throw { code: "sif.allocation_invalid", params };
};
it.each<[string, string | undefined, boolean, () => Promise<LitElement>]>([
  [
    "the clocks differ after a press",
    "Compare the clocks again",
    false,
    async () => {
      const el = await pressed({ decision: { ...clock, disagreement: true } });
      await differ(el);
      return el;
    },
  ],
  [
    "the box time is before this release",
    "Compare the clocks again",
    false,
    async () => {
      const { el } = await mount({ decision: { ...clock, releaseBlocked: true } });
      await vi.waitFor(() => expect(text(el)).toContain("Box time precedes this Waitron release."));
      return el;
    },
  ],
  [
    "the date is out of range",
    "Compare the clocks again",
    false,
    async () => {
      const { el } = await mount({ decision: { ...clock, rangeBlocked: true } });
      await vi.waitFor(() => expect(text(el)).toContain("Waitron cannot create invoice series"));
      return el;
    },
  ],
  [
    "a later minute is already in use",
    "Compare the clocks again",
    false,
    async () => {
      const el = await pressed({
        select: refusing({ reason: "minute_not_later", allowedFromMs: instant + 60_000 }),
      });
      await shows(el, "minute-not-later");
      return el;
    },
  ],
  [
    "the clock read on load failed",
    "Try again",
    false,
    async () => {
      const { el } = await mount({ prepare: async () => null });
      await failed(el);
      return el;
    },
  ],
  [
    "a run after a press failed",
    "Try again",
    false,
    async () => {
      const el = await pressed({
        select: async () => {
          throw { code: "setup.attempt_conflict" };
        },
      });
      await failed(el);
      return el;
    },
  ],
  [
    "this attempt's own name is found taken",
    undefined,
    false,
    async () => {
      const el = await pressed({ select: refusing({ reason: "minute_in_use" }) });
      await shows(el, "minute-in-use");
      return el;
    },
  ],
  [
    "the page is sending Proceed's request",
    "Proceed",
    true,
    async () => {
      const el = await pressed({ select: () => new Promise(() => {}) });
      await el.updateComplete;
      return el;
    },
  ],
  [
    "a countdown after a press",
    undefined,
    false,
    async () => {
      const el = await pressed({
        select: async () => ({
          status: "waiting",
          targetMs: instant + 61_000,
          remainingMs: 61_000,
        }),
      });
      await shows(el, "remaining");
      return el;
    },
  ],
  [
    "a wait for a second clock after a press",
    undefined,
    false,
    async () => {
      const el = await pressed({ decision: noSecondClock });
      await vi.waitFor(() => expect(text(el)).toContain(SETUP_ENDS));
      return el;
    },
  ],
  [
    "a reload's recorded wait",
    undefined,
    false,
    async () => {
      const { el } = await mount({
        preview: { status: "waiting", targetMs: instant + 61_000, remainingMs: 61_000 },
      });
      await shows(el, "remaining");
      return el;
    },
  ],
  [
    "the series are made",
    undefined,
    false,
    async () => {
      const el = await pressed({});
      await shows(el, "selected-hour");
      return el;
    },
  ],
  [
    "nothing is pressed yet",
    "Proceed",
    true,
    async () => {
      const { el } = await mount();
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-clock=read]")).not.toBeNull(),
      );
      return el;
    },
  ],
  [
    "a wait for a second clock before a press",
    "Proceed",
    true,
    async () => {
      const { el } = await mount({ decision: noSecondClock });
      await vi.waitFor(() => expect(text(el)).toContain(SETUP_DO));
      return el;
    },
  ],
  [
    "the tick changed since a press",
    "Proceed",
    true,
    async () => {
      const el = await pressed({
        select: async () => ({
          status: "waiting",
          targetMs: instant + 61_000,
          remainingMs: 61_000,
        }),
      });
      await shows(el, "remaining");
      await userEvent.click(detailsTick(el));
      await el.updateComplete;
      return el;
    },
  ],
  [
    "the tick is given before a press",
    "Proceed",
    false,
    async () => {
      const { el } = await mount();
      await ready(el);
      return el;
    },
  ],
])("while %s the page's one button reads %s", async (_state, label, disabled, reach) => {
  const el = await reach();
  await el.updateComplete;
  expect(action(el)).toBe(label);
  if (label) expect(button(el, "compare").disabled).toBe(disabled);
});
it.each([
  ["en", "These details are correct."],
  ["es", "Estos datos son correctos."],
] as const)("%s: the details tick reads that the details are correct", async (locale, words) => {
  const { el } = await mount({ locale });
  expect(detailsTick(el).closest("label")!.textContent!.replace(/\s+/g, " ").trim()).toBe(
    `${words} *`,
  );
});
it("while Proceed's request is sent, Proceed stays on screen in its own colour, busy, and a second press sends nothing", async () => {
  let release!: (value: unknown) => void;
  const { el, calls } = await mount({
    select: () => new Promise((resolve) => (release = resolve)),
  });
  await ready(el);
  await proceed(el);
  await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1));
  await el.updateComplete;
  const compare = button(el, "compare") as HTMLElement & {
    disabled: boolean;
    loading: boolean;
    variant: string;
  };
  expect(action(el)).toBe("Proceed");
  expect(compare.loading).toBe(true);
  expect(compare.variant).toBe("primary");
  await (compare as unknown as LitElement).updateComplete;
  expect(compare.shadowRoot!.querySelector("button")!.disabled).toBe(true);
  expect(compare.shadowRoot!.querySelector("button")!.getAttribute("aria-busy")).toBe("true");
  compare.click();
  await el.updateComplete;
  expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1);
  release(selected);
  await shows(el, "selected-hour");
  expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1);
  expect(el.shadowRoot!.querySelector("[data-test=compare]")).toBeNull();
});
it("the clock read on load shows no button while it is sent, since nobody pressed one", async () => {
  let release!: (value: unknown) => void;
  const { el } = await mount({
    prepare: (proposal) => {
      const action = (proposal as { action: string }).action;
      if (action === "clock-challenge") return Promise.resolve({ id: "challenge" });
      if (action === "compare-clocks") return new Promise((resolve) => (release = resolve));
      return Promise.resolve({ status: "preview", identity: "0CSQW" });
    },
  });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await el.updateComplete;
  expect(action(el)).toBeUndefined();
  release({ id: "comparison-1", clock });
  await vi.waitFor(() => expect(action(el)).toBe("Proceed"));
});
it("names the page's buttons in Spanish", async () => {
  const first = await mount({ locale: "es" });
  await vi.waitFor(() => expect(action(first.el)).toBe("Continuar"));
  const differing = await mount({ locale: "es", decision: { ...clock, disagreement: true } });
  await ready(differing.el);
  await proceed(differing.el);
  await vi.waitFor(() => expect(action(differing.el)).toBe("Volver a comparar los relojes"));
  const failing = await mount({ locale: "es", prepare: async () => null });
  await vi.waitFor(() => expect(action(failing.el)).toBe("Volver a intentarlo"));
  expect(
    failing.el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error,
  ).toBe("No se pudo completar este paso.");
});
it("says only that the step could not be completed when it fails", async () => {
  const { el } = await mount({ prepare: async () => null });
  await failed(el);
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error,
  ).toBe("Could not complete this step.");
});
it("clocks that disagree before Proceed offer Proceed, not Compare the clocks again, and never ask for the series", async () => {
  const decision: typeof clock = { ...clock, disagreement: true };
  fakeClock();
  try {
    const { el, calls } = await mount({ decision: () => decision });
    await vi.waitFor(() => expect(action(el)).toBe("Proceed"));
    expect(text(el)).not.toContain(DIFFER);
    await userEvent.click(detailsTick(el));
    expect(actionsOf(calls).filter((a) => a === "compare-clocks")).toHaveLength(1);
    vi.advanceTimersByTime(200_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(calls.filter((c) => c.action === "candidates")).toEqual([]);
    expect(button(el, "compare").disabled).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
it("Compare the clocks again after Proceed carries on to the series once the clocks agree", async () => {
  let decision: typeof clock = clock;
  const { el, calls } = await mount({ decision: () => decision });
  await ready(el);
  decision = { ...clock, disagreement: true };
  await proceed(el);
  await differ(el);
  await vi.waitFor(() => expect(action(el)).toBe("Compare the clocks again"));
  expect(calls.filter((c) => c.action === "candidates")).toEqual([]);
  decision = clock;
  await userEvent.click(button(el, "compare"));
  await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1));
  await shows(el, "selected-hour");
});
it("a taken minute's countdown says the code was used and makes the series at zero with no press", async () => {
  const answers: (() => unknown)[] = [
    () => {
      throw {
        code: "sif.allocation_invalid",
        params: {
          reason: "minute_in_use",
          allowedFromMs: instant + 60_000,
          remainingMs: 60_000,
          recheckInMs: 60_000,
        },
      };
    },
    () => selected,
  ];
  const { el, calls } = await mount({ select: async () => answers.shift()!() });
  fakeClock();
  try {
    await ready(el);
    await proceed(el);
    await shows(el, "minute-taken");
    expect(el.shadowRoot!.querySelector("[data-test=minute-taken]")?.textContent?.trim()).toBe(
      "This invoice series code has already been used. Waitron creates a new one by itself when the countdown ends.",
    );
    expect(text(el)).toContain("New invoice series in 01:00");
    expect(action(el)).toBeUndefined();
    vi.advanceTimersByTime(60_000);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(2));
    await shows(el, "selected-hour");
  } finally {
    vi.useRealTimers();
  }
});
it.each([
  ["en", /in (\S+)\/(\d+) the series is (\S+)\.$/],
  ["es", /en (\S+)\/(\d+) la serie es (\S+)\.$/],
] as const)(
  "the %s series line's example is an invoice number in the traced format",
  async (locale, example) => {
    const { el } = await mount({ locale });
    await shows(el, "series-line");
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
      seriesMatchBases([{ code: series, purpose: "standard" }], name, [
        { code: base, purpose: "standard" },
      ]),
    ).toBe(true);
  },
);
it.each([
  [
    "en",
    "Keep your recovery pack.",
    "The recovery pack is a PDF holding this box's server key. If this box ever fails, restoring this venue's backups onto a new box asks for that key, so keep the pack somewhere safe, away from the box.",
  ],
  [
    "es",
    "Guarda el paquete de recuperación.",
    "El paquete de recuperación es un PDF con la clave de este servidor. Si este servidor falla, restaurar las copias de este local en un servidor nuevo pide esa clave, así que guarda el paquete en un lugar seguro, lejos del servidor.",
  ],
] as const)(
  "%s says under the recovery pack heading what the pack is and why to keep it",
  async (locale, heading, why) => {
    const el = await pressed({ locale });
    await shows(el, "selected-hour");
    const section = el.shadowRoot!.querySelector(`section[aria-label="${heading}"]`)!;
    expect(section.querySelector("h3")?.textContent?.trim()).toBe(heading);
    expect(section.querySelector("[data-test=pack-why]")?.textContent?.trim()).toBe(why);
  },
);

const detailRows = (el: LitElement, list: string) =>
  [...el.shadowRoot!.querySelectorAll(`[data-test=${list}] > div`)].map((row) => [
    row.querySelector("dt")?.textContent?.trim(),
    row.querySelector("dd")?.textContent?.replace(/\s+/g, " ").trim(),
  ]);
it("Check this venue puts each detail on a row of its own, label then value", async () => {
  const { el } = await mount();
  await ready(el);
  expect(el.shadowRoot!.querySelector("h2")?.textContent?.trim()).toBe("Check this venue");
  expect(detailRows(el, "venue-review")).toEqual([
    ["Environment", "Production"],
    ["Country", "Spain"],
    ["Place", "Olivo · Madrid"],
    ["Taxpayer NIF", "B12345674"],
    ["Time zone", "Europe/Madrid"],
  ]);
  const list = el.shadowRoot!.querySelector("[data-test=venue-review]")!;
  expect(getComputedStyle(list).display).toBe("grid");
  const rows = [...list.querySelectorAll(":scope > div")];
  const starts = new Set<number>();
  for (const row of rows) {
    expect(getComputedStyle(row).display).toBe("contents");
    const dt = row.querySelector("dt")!.getBoundingClientRect();
    const dd = row.querySelector("dd")!;
    expect(getComputedStyle(dd).textAlign).toBe("start");
    const value = dd.getBoundingClientRect();
    expect(value.top).toBe(dt.top);
    starts.add(value.left);
  }
  expect(starts.size).toBe(1);
  const widestLabel = Math.max(
    ...rows.map((row) => row.querySelector("dt")!.getBoundingClientRect().right),
  );
  const gap = [...starts][0]! - widestLabel;
  expect(gap).toBeGreaterThan(0);
  expect(gap).toBeLessThanOrEqual(32);
});
it("a long value wraps beside its label at phone width rather than overflowing", async () => {
  const request = structuredClone(context);
  request.venue = { ...request.venue, name: "Restaurante".repeat(12) };
  const { el } = await mount({ request });
  el.style.display = "block";
  el.style.width = "320px";
  await ready(el);
  const list = el.shadowRoot!.querySelector<HTMLElement>("[data-test=venue-review]")!;
  expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
  const place = [...list.querySelectorAll("dd")].find((dd) =>
    dd.textContent!.includes("Restaurante"),
  )!;
  expect(place.getBoundingClientRect().height).toBeGreaterThan(
    list.querySelector("dt")!.getBoundingClientRect().height * 1.5,
  );
});
it.each([
  ["browser", "matches this device"],
  ["internet", "matches the internet time"],
] as const)(
  "when only the %s agrees, Check this venue shows no clock rows",
  async (source, words) => {
    const decision = {
      ...clock,
      usable: clock.usable.filter((r) => r.source === "box" || r.source === source),
      unavailable: [
        {
          source: source === "browser" ? "internet" : "browser",
          result: "unavailable" as const,
          reason: "offline",
        },
      ],
    };
    const { el } = await mount({ decision });
    await ready(el);
    expect(el.shadowRoot!.querySelectorAll("dl")).toHaveLength(1);
    for (const gone of [words, "Box time", "Server time", "This device", "14:30"])
      expect(text(el)).not.toContain(gone);
    expect(text(el)).not.toContain("Clocks agree");
    expect(el.shadowRoot!.querySelector("wt-disclosure")).toBeNull();
  },
);
it.each(["en", "es"] as const)(
  "%s: clocks that differ show one time per clock, ask which is correct, and neither answer sends anything",
  async (locale) => {
    const decision = {
      ...clock,
      usable: [
        { source: "box", lowerMs: instant + 10_000, upperMs: instant + 10_000 },
        { source: "browser", lowerMs: instant + 5 * 60_000, upperMs: instant + 5 * 60_000 },
      ],
      unavailable: [{ source: "internet", result: "unavailable" as const, reason: "offline" }],
      disagreement: true,
    };
    for (const choice of ["server-correct", "both-wrong"]) {
      const { el, calls } = await mount({ decision, locale });
      await ready(el);
      expect(button(el, choice)).toBeNull();
      await proceed(el);
      await vi.waitFor(() => expect(button(el, choice)).not.toBeNull());
      expect(detailRows(el, "clock-times")).toEqual(
        locale === "en"
          ? [
              ["Server time", "18 October 2026 at 14:30"],
              ["This device", "18 October 2026 at 14:35"],
            ]
          : [
              ["Hora del servidor", "18 de octubre de 2026 a las 14:30"],
              ["Este dispositivo", "18 de octubre de 2026 a las 14:35"],
            ],
      );
      expect(text(el)).toContain(
        locale === "en"
          ? DIFFER
          : "Es muy importante que la hora del servidor sea correcta. ¿Cuál es la correcta?",
      );
      expect(text(el)).not.toMatch(/ask for help|pide ayuda/i);
      const before = calls.length;
      await userEvent.click(button(el, choice));
      await el.updateComplete;
      expect(calls).toHaveLength(before);
      expect(button(el, "server-correct")).toBeNull();
      expect(text(el)).toContain(
        locale === "en"
          ? "Please correct the time on this device and then reconnect to the server."
          : "Corrige la hora de este dispositivo y vuelve a conectarte al servidor.",
      );
      expect(action(el)).toBe(
        locale === "en" ? "Compare the clocks again" : "Volver a comparar los relojes",
      );
    }
  },
);
it.each(["en", "es"] as const)(
  "%s: Edit these details sends nothing and asks the setup to go back to where they were entered",
  async (locale) => {
    const { el, calls, host } = await mount({ locale });
    await ready(el);
    const asked: Event[] = [];
    host.addEventListener("initial-change-details", (event) => asked.push(event));
    const before = calls.length;
    const change = button(el, "change-details");
    expect(change.textContent?.trim()).toBe(
      locale === "en" ? "Edit these details" : "Editar estos datos",
    );
    expect(change.getAttribute("variant")).toBe("secondary");
    await userEvent.click(change);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.composed).toBe(true);
    expect(calls).toHaveLength(before);
  },
);
it.each([
  ["en", "We've created these series", "Download recovery pack"],
  ["es", "Hemos creado estas series", "Descargar el paquete de recuperación"],
] as const)(
  "%s: after Proceed the second screen lists the series, explains the pack and offers to download it",
  async (locale, heading, download) => {
    const el = await pressed({ locale });
    await shows(el, "selected-hour");
    expect(el.shadowRoot!.querySelector("[data-test=selected-hour] h2")?.textContent?.trim()).toBe(
      heading,
    );
    expect(el.shadowRoot!.querySelector("[data-test=venue-review]")).toBeNull();
    expect(el.shadowRoot!.querySelector('input[name="setup-details-confirmed"]')).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=change-details]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=pack-why]")).not.toBeNull();
    expect(button(el, "prepare-pdf").textContent?.trim()).toBe(download);
  },
);
it("after Proceed focus moves to the second screen's heading, and the screen is announced", async () => {
  const el = await pressed({});
  await shows(el, "selected-hour");
  const result = el.shadowRoot!.querySelector<HTMLElement>("[data-test=selected-hour]")!;
  const heading = result.querySelector<HTMLElement>("h2")!;
  await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(heading));
  expect(heading.tabIndex).toBe(-1);
  expect(result.getAttribute("role")).toBe("status");
});
it("series that arrive while the person is in another field leave focus in that field", async () => {
  let answer: ((value: unknown) => void) | undefined;
  const { el } = await mount({ select: () => new Promise((resolve) => (answer = resolve)) });
  const elsewhere = document.createElement("input");
  document.body.append(elsewhere);
  hosts.push(elsewhere);
  await ready(el);
  await proceed(el);
  await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
  elsewhere.focus();
  answer!(selected);
  await shows(el, "selected-hour");
  await el.updateComplete;
  expect(document.activeElement).toBe(elsewhere);
});
