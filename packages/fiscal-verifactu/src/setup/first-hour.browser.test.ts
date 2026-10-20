import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement } from "lit";
import { applyTokens } from "@waitron/ui";
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
  unavailable: [],
  disagreement: false,
  requiresConfirmation: false,
  boundaryWait: false,
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
  identity: "06TH",
  input: {
    allocation: {
      installationIdentity: "06TH",
      series: [
        { code: "A-06TH", purpose: "standard" },
        { code: "FF-06TH", purpose: "full" },
        { code: "R-06TH", purpose: "rectificative" },
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
    decision?: typeof clock;
    select?: () => Promise<unknown>;
    prepare?: (proposal: unknown) => Promise<unknown>;
    request?: typeof context;
  } = {},
) {
  const calls: { action: string; value?: unknown }[] = [];
  const preparation = async (proposal: unknown) => {
    calls.push({ action: "prepare", value: proposal });
    if (options.prepare) return options.prepare(proposal);
    const action = (proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks") return { id: "comparison", clock: options.decision ?? clock };
    if (action === "confirm-clock") return clock;
    if (action === "selection") return { status: "preview", identity: "06TH", answer: "no" };
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
  document.body.append(host);
  hosts.push(host);
  const parent = FISCAL_SETUP.create({
    locale: "en",
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
async function ready(el: LitElement, answer = "no") {
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).not.toBeNull(),
  );
  for (const query of [
    'input[name="setup-details-confirmed"]',
    `input[name="taxpayer-hour"][value="${answer}"]`,
  ]) {
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(query)!;
    expect(input).not.toBeNull();
    await userEvent.click(input);
  }
  await el.updateComplete;
}
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
it("requires the scope confirmation and taxpayer-wide answer then imports only selected server input", async () => {
  const { el, calls } = await mount();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).not.toBeNull(),
  );
  expect(button(el, "select").disabled).toBe(true);
  await ready(el);
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() =>
    expect(calls.filter((c) => c.action === "input")).toEqual([
      { action: "input", value: selected.input },
    ]),
  );
  expect(calls.filter((c) => c.action === "candidates")).toEqual([
    { action: "candidates", value: { answer: "no" } },
  ]);
  for (const code of ["A-06TH", "FF-06TH", "R-06TH"])
    expect(el.shadowRoot!.textContent).toContain(code);
  expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull();
});
it.each(["yes", "unknown"])(
  "keeps the server wait for %s and never imports or locally completes it",
  async (answer) => {
    const { el, calls } = await mount({
      select: async () => ({
        status: "waiting",
        targetMs: instant + 1800000,
        remainingMs: 1800000,
      }),
    });
    await ready(el, answer);
    await userEvent.click(button(el, "select"));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=hour-wait]")).not.toBeNull(),
    );
    expect(calls.some((c) => c.action === "input")).toBe(false);
    expect(el.shadowRoot!.textContent).toContain("15:00");
    expect(el.shadowRoot!.textContent).toContain("30:00");
    expect(el.shadowRoot!.textContent).toContain("one at a time");
  },
);
it("requires fresh displayed-clock acceptance on disagreement", async () => {
  const { el, calls } = await mount({
    decision: { ...clock, disagreement: true, requiresConfirmation: true },
  });
  await ready(el);
  expect(button(el, "select").disabled).toBe(true);
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLInputElement>('input[name="setup-clock-confirmed"]')!,
  );
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() => expect(calls.some((c) => c.action === "input")).toBe(true));
  const confirmation = calls.findIndex(
    (c) => (c.value as { action?: string })?.action === "confirm-clock",
  );
  expect(calls[confirmation]).toEqual({
    action: "prepare",
    value: { action: "confirm-clock", comparisonId: "comparison" },
  });
  expect(confirmation).toBeLessThan(calls.findIndex((c) => c.action === "candidates"));
});
it.each(["releaseBlocked", "rangeBlocked", "boundaryWait"] as const)(
  "keeps %s selection blocked",
  async (reason) => {
    const { el, calls } = await mount({ decision: { ...clock, [reason]: true } });
    await ready(el);
    expect(button(el, "select").disabled).toBe(true);
    expect(calls.some((c) => c.action === "candidates")).toBe(false);
  },
);
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
      inputDigest: "67d6e732f26da2ae88dba5049f498bd39a4d0cdc3f35f4bd5b3b8d7aaab6c505",
      bindingDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      documentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      statement: {
        kind: "waitron-recovery-document",
        installationCodes: ["06TH"],
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
it("a displayed countdown reaching zero never imports an hour without the server", async () => {
  const { el, calls } = await mount({
    select: async () => ({ status: "waiting", targetMs: instant + 1800000, remainingMs: 1000 }),
  });
  await ready(el, "unknown");
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=remaining]")?.textContent).toContain("0:01"),
  );
  await vi.waitFor(
    () =>
      expect(el.shadowRoot!.querySelector("[data-test=remaining]")?.textContent).toContain("0:00"),
    { timeout: 3000 },
  );
  expect(el.shadowRoot!.querySelector("[data-test=selected-hour]")).toBeNull();
  expect(calls.filter((c) => c.action === "candidates")).toHaveLength(1);
  expect(calls.filter((c) => c.action === "input")).toEqual([]);
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
  { ...selected, input: { allocation: { installationIdentity: "06TJ", series: [] } } },
  { ...selected, input: { allocation: { installationIdentity: "06TH", series: {} } } },
  { status: "waiting", targetMs: instant + 0.5, remainingMs: 1000 },
  { status: "waiting", targetMs: instant, remainingMs: -1 },
  { status: "waiting", targetMs: instant, remainingMs: Infinity },
  { status: "waiting", targetMs: instant, remainingMs: "1000" },
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

it("shows a server wait requiring fresh clocks without inventing a numeric countdown", async () => {
  const { el, calls } = await mount({
    select: async () => ({ status: "waiting", targetMs: instant + 1800000, remainingMs: null }),
  });
  await ready(el, "unknown");
  await userEvent.click(button(el, "select"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=hour-wait]")).not.toBeNull(),
  );
  expect(el.shadowRoot!.querySelector("[data-test=remaining]")).toBeNull();
  expect(calls.filter((call) => call.action === "input")).toEqual([]);
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

it("does not select after a clock confirmation resolves on a disconnected screen", async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const decision = { ...clock, disagreement: true, requiresConfirmation: true };
  const { el, host, calls } = await mount({
    prepare: async (proposal) => {
      const action = (proposal as { action: string }).action;
      if (action === "clock-challenge") return { id: "challenge" };
      if (action === "compare-clocks") return { id: "comparison", clock: decision };
      entered();
      await pending;
      return decision;
    },
  });
  await ready(el);
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLInputElement>('[name="setup-clock-confirmed"]')!,
  );
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
