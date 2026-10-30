import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import type { InitialSetupActions } from "@waitron/module/src/setup-contract.js";
import { readRecoveryPdf, openRecoveryPdf } from "../recovery-reader.js";
import { FISCAL_SETUP } from "@waitron/fiscal-verifactu/setup";
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
    location: {
      name: "Olivo",
      city: "Madrid",
      fiscalTerritory: "ES-common",
      timeZone: "Europe/Madrid",
    },
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
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).not.toBeNull(),
  );
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(
    'input[name="setup-details-confirmed"]',
  )!;
  expect(input).not.toBeNull();
  await userEvent.click(input);
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
const WHY_REFUSED = "No series is made without a confirmed time, so none is ever repeated.";
const DIFFER = "This box's time and this device's differ by more than 30 seconds.";
const DIFFER_DO =
  "Try from another phone or till. If they still differ, the box's time may be wrong: ask for help.";
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
  const { el } = await mount({ within: shell });
  expect(shell.leave.coordinator.isDirty([el])).toBe(false);
  await ready(el);
  expect(shell.leave.coordinator.isDirty([el])).toBe(true);
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLInputElement>('input[name="setup-details-confirmed"]')!,
  );
  await el.updateComplete;
  expect(shell.leave.coordinator.isDirty([el])).toBe(false);
});
it("automatically compares clocks and shows combined country, place, zone and local time before selection", async () => {
  const { el, calls } = await mount();
  await ready(el);
  expect(el.shadowRoot!.textContent).toContain("Spain");
  expect(el.shadowRoot!.textContent).toContain("Production");
  expect(el.shadowRoot!.textContent).toContain("Madrid");
  expect(el.shadowRoot!.textContent).toContain("Europe/Madrid");
  expect(el.shadowRoot!.textContent).toContain("14:30");
  expect(el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("wt-disclosure")?.open).toBe(
    false,
  );
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
  expect(button(el, "select").disabled).toBe(false);
});
it("shows Canary local time rather than the browser or Madrid zone", async () => {
  const request = structuredClone(context);
  request.venue.location = {
    ...request.venue.location,
    city: "Las Palmas",
    fiscalTerritory: "ES-canary",
    timeZone: "Atlantic/Canary",
  };
  const { el } = await mount({ request });
  await ready(el);
  expect(el.shadowRoot!.textContent).toContain("Las Palmas");
  expect(el.shadowRoot!.textContent).toContain("Atlantic/Canary");
  expect(el.shadowRoot!.textContent).toContain("13:30");
  expect(el.shadowRoot!.textContent).not.toContain("14:30");
});
it("requires the scope confirmation then imports only selected server input", async () => {
  const { el, calls } = await mount();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).not.toBeNull(),
  );
  expect(button(el, "select").disabled).toBe(true);
  expect(el.shadowRoot!.querySelector('input[name="taxpayer-hour"]')).toBeNull();
  await ready(el);
  await userEvent.click(button(el, "select"));
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
  await userEvent.click(button(el, "select"));
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
    expect(button(el, "select").disabled).toBe(true);
    expect(calls.some((c) => c.action === "candidates")).toBe(false);
  },
);
it("explains a waiting setup with a countdown that goes back to the server at zero", async () => {
  const answers: unknown[] = [
    { status: "waiting", targetMs: instant + 84_000, remainingMs: 84_000 },
    selected,
  ];
  const { el, calls } = await mount({ select: async () => answers.shift() });
  await ready(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
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
  await ready(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
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
it("shows no countdown before a press when no wait is recorded", async () => {
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
  await ready(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
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
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() => expect(text(el)).toContain(SETUP_DO));
  expect(text(el)).toContain(WHY_SECOND);
  expect(text(el)).not.toContain(ON_BOX);
});
it("a clock refusal shows both readings and no countdown, and waits for Check again", async () => {
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
  await ready(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
    await vi.waitFor(() => expect(text(el)).toContain(DIFFER));
    expect(text(el)).toContain(WHY_REFUSED);
    expect(text(el)).toContain(DIFFER_DO);
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("wt-disclosure")?.open,
    ).toBe(true);
    expect(text(el)).toContain(new Date(instant).toISOString());
    expect(text(el)).toContain(new Date(instant + 45_000).toISOString());
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
    expect(calls.some((c) => c.action === "candidates")).toBe(false);
    const before = calls.length;
    vi.advanceTimersByTime(60_000);
    await el.updateComplete;
    expect(calls).toHaveLength(before);
    expect(button(el, "compare").textContent?.trim()).toBe("Check again");
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
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=minute-not-later]")?.textContent?.trim()).toBe(
      "The series cannot be made yet: a later minute is already in use.",
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
  await ready(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
    await vi.waitFor(() =>
      expect(text(el)).toContain(
        "The series cannot be made yet: a later minute is already in use.",
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
  await ready(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
    const taken = () =>
      el
        .shadowRoot!.querySelector("[data-test=minute-taken]")
        ?.textContent?.replace(/\s+/g, " ")
        .trim();
    await vi.waitFor(() =>
      expect(taken()).toBe(
        "The minute this box would use already has a series here, so it will use the next free minute.",
      ),
    );
    expect(remaining(el)).toBe("3:00");
    expect(quiet(el)).toEqual({ disabled: true, variant: "secondary" });
    vi.advanceTimersByTime(30_000);
    await vi.waitFor(() => expect(calls.filter((c) => c.action === "candidates")).toHaveLength(2));
    await el.updateComplete;
    expect(taken()).toBe(
      "The minute this box would use already has a series here, so it will use the next free minute.",
    );
    expect(remaining(el)).toBe("2:30");
    expect(el.shadowRoot!.querySelector("[data-test=minute-in-use]")).toBeNull();
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
  await userEvent.click(button(el, "select"));
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
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
      "true",
    ),
  );
  expect(button(el, "select").disabled).toBe(false);
  await userEvent.click(button(el, "select"));
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
  await userEvent.click(button(el, "select"));
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
    request.venue.location.timeZone = "Atlantic/Canary";
    const { el, api } = await mount({ request });
    api.stageNodeKey = async () => ({
      stage: { stageId: "stage", nodeId: "node", name: "Olivo key" },
      key: { nodeId: "node", name: "Olivo key", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
    });
    api.registerRecoveryDocument = async () => {};
    api.confirmRecoveryDocument = async () => {};
    await ready(el);
    await userEvent.click(button(el, "select"));
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
      const text = (await (await pdf.getPage(1)).getTextContent()).items
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

it("continues a frozen hour through its public request without selecting another", async () => {
  const { el, calls, api } = await mount({ request: { ...context, status: "consumption-intent" } });
  api.request = async () => {
    calls.push({ action: "request" });
    return selected;
  };
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).not.toBeNull(),
  );
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLInputElement>('input[name="setup-details-confirmed"]')!,
  );
  await userEvent.click(button(el, "select"));
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
    expect(button(el, "select").disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).toBeNull();
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
  expect(button(el, "select").disabled).toBe(true);
  expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).toBeNull();
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
  { status: "waiting", targetMs: instant + 0.5, remainingMs: 1000 },
  { status: "waiting", targetMs: instant, remainingMs: -1 },
  { status: "waiting", targetMs: instant, remainingMs: Infinity },
  { status: "waiting", targetMs: instant, remainingMs: "1000" },
  { status: "waiting", targetMs: instant + 1800000, remainingMs: null },
  { status: "waiting", targetMs: 8_640_000_000_060_000, remainingMs: 1000 },
])("refuses malformed hour result %j without importing it and permits retry", async (result) => {
  const { el, calls } = await mount({ select: async () => result });
  await ready(el);
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
      "true",
    ),
  );
  expect(calls.filter((call) => call.action === "input")).toEqual([]);
  expect(
    el.shadowRoot!.querySelector("[data-test=selected-hour], [data-test=hour-wait]"),
  ).toBeNull();
  expect(button(el, "select").disabled).toBe(false);
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
    expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).toBeNull();
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
    expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).toBeNull();
    expect(calls.some((call) => call.action === "candidates" || call.action === "input")).toBe(
      false,
    );
    expect(
      calls.filter((call) => (call.value as { action?: string })?.action === "compare-clocks"),
    ).toHaveLength(action === "clock-challenge" ? 0 : 1);
  },
);

it("does not ask for the name after a press's comparison resolves on a disconnected screen", async () => {
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
  await userEvent.click(button(el, "select"));
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
  await userEvent.click(button(el, "select"));
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
    await userEvent.click(button(el, "select"));
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
  await userEvent.click(button(el, "select"));
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
  expect(el.shadowRoot!.textContent).not.toContain("Recovery PDF confirmed.");
  refuse = false;
  await userEvent.click(button(el, "kept"));
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Recovery PDF confirmed."));
});

const quiet = (el: LitElement) => {
  const select = button(el, "select");
  return { disabled: select.disabled, variant: select.getAttribute("variant") };
};
it("draws Make the series quiet and disabled while a countdown runs", async () => {
  const { el } = await mount({
    select: async () => ({ status: "waiting", targetMs: instant + 84_000, remainingMs: 84_000 }),
  });
  await ready(el);
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() => expect(remaining(el)).toBeDefined());
  await el.updateComplete;
  expect(quiet(el)).toEqual({ disabled: true, variant: "secondary" });
});
const noSecondClock = {
  ...clock,
  usable: clock.usable.filter((r) => r.source === "box"),
  unavailable: [{ source: "internet", result: "unavailable" as const, reason: "offline" }],
  secondClock: false,
};
it("draws Make the series quiet and disabled while it waits for a second clock", async () => {
  const { el } = await mount({ decision: noSecondClock });
  await ready(el);
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() => expect(text(el)).toContain(SETUP_DO));
  await el.updateComplete;
  expect(quiet(el)).toEqual({ disabled: true, variant: "secondary" });
});
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
  await ready(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
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
  await ready(el);
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
it("keeps checking for a second clock after one automatic re-check fails", async () => {
  const { state, prepare } = gatedClocks();
  const { el, calls } = await mount({ prepare });
  await ready(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
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
  await ready(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
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
it.each([
  ["en", "Series name: 0CSQW", "This date is outside the range of series names."],
  ["es", "Nombre de las series: 0CSQW", "Esta fecha está fuera del rango de nombres de serie."],
] as const)("%s labels say series name, not hour", async (locale, chosen, range) => {
  const { el } = await mount({ locale });
  await ready(el);
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull(),
  );
  expect(text(el)).toContain(chosen);
  const blocked = await mount({ locale, decision: { ...clock, rangeBlocked: true } });
  await vi.waitFor(() => expect(text(blocked.el)).toContain(range));
});
it("says in Spanish that the minute already has a series, with the countdown", async () => {
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
  await ready(el);
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() =>
    expect(text(el)).toContain(
      "El minuto que usaría este equipo ya tiene una serie aquí, así que usará el siguiente minuto libre.",
    ),
  );
  expect(text(el)).toContain("Sigue en");
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
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() =>
    expect(text(el)).toContain(
      "Todavía no se pueden crear las series: ya se usó un minuto posterior a la hora de este equipo.",
    ),
  );
});
it.each([
  ["second_clock_missing", { ...noSecondClock }],
  [
    "clock_disagreement",
    {
      ...clock,
      usable: [
        { source: "box", lowerMs: instant, upperMs: instant },
        { source: "browser", lowerMs: instant + 45_000, upperMs: instant + 45_000 },
      ],
      disagreement: true,
    },
  ],
] as const)(
  "a preview refused for %s on load shows the readings with no failure and no explanation",
  async (reason, decision) => {
    const prepare = async (proposal: unknown) => {
      const action = (proposal as { action: string }).action;
      if (action === "clock-challenge") return { id: "challenge" };
      if (action === "compare-clocks") return { id: "comparison", clock: decision };
      // What the real server's preview throws for a comparison that cannot admit a name.
      throw { code: "sif.allocation_invalid", params: { reason } };
    };
    fakeClock();
    try {
      const { el, calls } = await mount({ prepare });
      await vi.waitFor(() =>
        expect(actionsOf(calls)).toEqual(["clock-challenge", "compare-clocks", "selection"]),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).not.toBeNull();
      expect(el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-failed")).toBe(
        "false",
      );
      expect(text(el)).not.toContain(WHY_SECOND);
      expect(text(el)).not.toContain(WHY_REFUSED);
      vi.advanceTimersByTime(45_000);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(calls).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  },
);

it("a box clock before this release shows only the release line when the preview is refused", async () => {
  const { el } = await mount({
    prepare: async (proposal: unknown) => {
      const action = (proposal as { action: string }).action;
      if (action === "clock-challenge") return { id: "challenge" };
      if (action === "compare-clocks")
        return { id: "comparison", clock: { ...clock, releaseBlocked: true } };
      // What the real server's preview throws for a box clock before the release.
      throw { code: "sif.allocation_invalid", params: { reason: "clock_unconfirmed" } };
    },
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).not.toBeNull(),
  );
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
  await ready(el);
  fakeClock();
  try {
    await userEvent.click(button(el, "select"));
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
  const { el } = await mount({ locale: "es" });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).not.toBeNull(),
  );
  const labels = [...el.shadowRoot!.querySelectorAll("[data-test=clock-readings] dt")].map((dt) =>
    dt.textContent!.trim(),
  );
  expect(labels).toEqual(["Servidor", "Navegador", "Internet"]);
});
