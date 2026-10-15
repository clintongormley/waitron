import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import type { InitialSetupActions } from "@waitron/module/src/setup-contract.js";
import "./first-fiscal-screen.js";
import type { FirstFiscalScreen } from "./first-fiscal-screen.js";

const publicRequest = {
  version: 1,
  kind: "first-fiscal-setup",
  attemptId: "attempt",
  binding: {
    module: "fiscal-verifactu",
    action: "setup",
    eventId: "event",
    sourceId: "first-setup:attempt",
    targetNodeId: "node",
  },
  operatorId: "admin",
  recipientVenueId: "first-setup:attempt",
  taxpayerNif: "B12345674",
  softwareId: "W1",
  environment: "production",
  requiredBases: [
    { code: "A", purpose: "standard" },
    { code: "FF", purpose: "full" },
    { code: "R", purpose: "rectificative" },
  ],
  candidates: [{ installationIdentity: "S000001" }],
  candidateDigest: "public-digest",
};
const input = {
  allocation: {
    allocationId: "allocation",
    installationIdentity: "S000001",
    series: [{ code: "A-S000001", purpose: "standard" }],
    reservationEvidence: {
      block: { payload: { custodianId: "Elena", generationId: "generation", blockId: "block" } },
      consumption: { payload: {} },
    },
  },
  approval: { incidentEvidence: "ORIGINAL / 1" },
};
const publicKey = {
  custodianId: "Elena",
  publicKey: "PUBLIC KEY ONLY",
  fingerprint: "a".repeat(64),
};
const mounted: HTMLElement[] = [];
afterEach(() => mounted.splice(0).forEach((el) => el.remove()));
async function mount(overrides: Partial<InitialSetupActions> = {}) {
  const calls: { action: string; values: unknown[] }[] = [];
  const action = (name: string, ...values: unknown[]) => {
    calls.push({ action: name, values });
  };
  const api: InitialSetupActions = {
    async candidates(proposal) {
      action("candidates", proposal);
      return publicRequest;
    },
    async request() {
      action("request");
      return publicRequest;
    },
    async importInput(value) {
      action("input", value);
    },
    async enrol(key, comparison) {
      action("enrol", key, comparison);
    },
    async confirm(statement) {
      action("confirm", statement);
    },
    ...overrides,
  };
  const host = document.createElement("div");
  document.body.append(host);
  applyTokens(host);
  mounted.push(host);
  const el = document.createElement("vf-first-fiscal-screen");
  el.context = {
    status: "claimed",
    environment: "production",
    venue: {
      taxId: "B12345674",
      seriesCode: "A",
      fullSeriesCode: "FF",
      rectificativeSeriesCode: "R",
    },
  };
  el.api = api;
  host.append(el);
  await el.updateComplete;
  return { el, calls, host };
}
async function click(el: FirstFiscalScreen, test: string) {
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!);
  await el.updateComplete;
}
async function field(el: FirstFiscalScreen, test: string, value: string) {
  el.shadowRoot!.querySelector(`[data-test=${test}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}
async function file(el: FirstFiscalScreen, test: string, value: unknown) {
  const control = el.shadowRoot!.querySelector<HTMLInputElement>(`[data-test=${test}]`)!;
  const files = new DataTransfer();
  files.items.add(new File([JSON.stringify(value)], "public.json", { type: "application/json" }));
  control.files = files.files;
  control.dispatchEvent(new Event("change"));
  await el.updateComplete;
}
async function candidates(el: FirstFiscalScreen) {
  await click(el, "existing");
  await field(el, "serials", "1, 2");
  await click(el, "candidates");
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=allocation-file]"))
    .not.toBeNull();
}
async function importAllocation(el: FirstFiscalScreen) {
  await candidates(el);
  await file(el, "allocation-file", input);
  await click(el, "import");
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=key-file]")).not.toBeNull();
}

it("keeps both outside custody routes explicit and contains no secret or key-generation control", async () => {
  const { el, calls } = await mount();
  expect(el.shadowRoot!.textContent).toContain("Production");
  expect(el.shadowRoot!.querySelector("[data-test=new]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=existing]")).not.toBeNull();
  expect(
    el.shadowRoot!.querySelector(
      "input[type=password], [name*=passphrase], [name*=private], [name*=secret]",
    ),
  ).toBeNull();
  await click(el, "new");
  expect(el.shadowRoot!.textContent).toContain("separate computer");
  expect(calls).toEqual([]);
});
it("checks proposed serials locally and sends exact values only on an explicit action", async () => {
  const { el, calls } = await mount();
  await click(el, "existing");
  await field(el, "serials", "1, 1");
  await click(el, "candidates");
  expect(calls).toEqual([]);
  expect(el.shadowRoot!.querySelector("[data-test=serials]")!.hasAttribute("invalid")).toBe(true);
  await field(el, "serials", "1, 2");
  await click(el, "candidates");
  await expect.poll(() => calls).toEqual([{ action: "candidates", values: [{ serials: [1, 2] }] }]);
});
it("imports the public assignment without enrolling trust and requires independent fingerprint and fresh original consultation", async () => {
  const { el, calls } = await mount();
  await importAllocation(el);
  expect(calls.map((call) => call.action)).toEqual(["candidates", "input"]);
  await file(el, "key-file", publicKey);
  await field(el, "fingerprint", publicKey.fingerprint);
  await click(el, "enrol");
  await expect.poll(() => calls.at(-1)?.action).toBe("enrol");
  expect(calls.at(-1)?.values).toEqual([publicKey, publicKey.fingerprint]);
  expect(el.shadowRoot!.querySelector("[data-test=confirm]")!.hasAttribute("disabled")).toBe(true);
  for (const name of ["consulted", "consumed"]) {
    el.shadowRoot!.querySelector(`[data-test=${name}]`)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: true } }),
    );
  }
  await field(el, "incident", "ORIGINAL / 1");
  await click(el, "confirm");
  await expect.poll(() => calls.at(-1)?.action).toBe("confirm");
  expect(calls.at(-1)?.values).toEqual([
    {
      version: 1,
      allocationId: "allocation",
      binding: publicRequest.binding,
      operatorId: "admin",
      priorActivation: "none",
      incidentEvidence: "ORIGINAL / 1",
      requiredBases: publicRequest.requiredBases,
      recipientVenueId: "first-setup:attempt",
      generationId: "generation",
      blockId: "block",
      currentRegisterConfirmed: true,
      consumptionConfirmed: true,
      currentEntryState: "consumed-for-event",
    },
  ]);
});
it("keeps a server refusal beside the public input and does not enrol or confirm anything", async () => {
  const { el, calls } = await mount({
    async importInput() {
      throw { code: "sif.allocation_invalid" };
    },
  });
  await candidates(el);
  await file(el, "allocation-file", input);
  await click(el, "import");
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=allocation-error]")?.textContent)
    .toContain("Check");
  expect(calls.map((call) => call.action)).toEqual(["candidates"]);
  expect(el.shadowRoot!.querySelector("[data-test=key-file]")).toBeNull();
});
it("refuses secret-bearing or oversized input before sending it to the box API", async () => {
  const { el, calls } = await mount();
  await candidates(el);
  await file(el, "allocation-file", { ...input, privateKey: "PRIVATE SENTINEL" });
  await click(el, "import");
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=allocation-error]")?.textContent)
    .toContain("Check");
  expect(calls.map((call) => call.action)).toEqual(["candidates"]);
  expect(el.shadowRoot!.textContent).not.toContain("PRIVATE SENTINEL");
});

it("retires late candidate answers and lets a reconnected screen make a fresh request", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise<unknown>((release) => {
    resolve = release;
  });
  let requests = 0;
  const { el, host } = await mount({
    async candidates() {
      return ++requests === 1 ? pending : publicRequest;
    },
  });
  await click(el, "existing");
  await field(el, "serials", "1");
  await click(el, "candidates");
  el.remove();
  await el.updateComplete;
  host.append(el);
  await el.updateComplete;
  await click(el, "candidates");
  resolve({ ...publicRequest, candidateDigest: "STALE" });
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=allocation-file]"))
    .not.toBeNull();
  expect(requests).toBe(2);
  const { vi } = await import("vitest");
  const created = vi.spyOn(URL, "createObjectURL");
  try {
    await click(el, "download-request");
    expect(JSON.parse(await (created.mock.calls[0]![0] as Blob).text())).toEqual(publicRequest);
  } finally {
    created.mockRestore();
  }
});
it("retains unsaved inputs across removal and reconnect", async () => {
  const { el, host } = await mount();
  await click(el, "new");
  await field(el, "serials", "7, 8");
  expect((el as unknown as { draft: { serials: string } }).draft.serials).toBe("7, 8");
  el.remove();
  await el.updateComplete;
  host.append(el);
  await el.updateComplete;
  expect(
    (el.shadowRoot!.querySelector("[data-test=serials]") as HTMLElement & { value: string }).value,
  ).toBe("7, 8");
});
it("exports exactly the validated public setup request", async () => {
  const { vi } = await import("vitest");
  const create = vi.spyOn(URL, "createObjectURL"),
    revoke = vi.spyOn(URL, "revokeObjectURL");
  try {
    const { el } = await mount();
    await candidates(el);
    await click(el, "download-request");
    const blob = create.mock.calls[0]![0] as Blob;
    expect(JSON.parse(await blob.text())).toEqual(publicRequest);
    await expect.poll(() => revoke.mock.calls.length).toBe(1);
  } finally {
    create.mockRestore();
    revoke.mockRestore();
  }
});
it("loads the exact saved public request for an interrupted event without proposing another block", async () => {
  const { el, calls } = await mount();
  el.context = { ...el.context, status: "publication" };
  await el.updateComplete;
  await click(el, "resume");
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=allocation-file]"))
    .not.toBeNull();
  expect(calls).toEqual([{ action: "request", values: [] }]);
});
it("keeps a refused candidate proposal editable without accepting a public request", async () => {
  const { el } = await mount({
    async candidates() {
      throw { code: "sif.allocation_invalid" };
    },
  });
  await click(el, "new");
  await field(el, "serials", "4");
  await click(el, "candidates");
  await expect
    .poll(
      () =>
        (
          el.shadowRoot!.querySelector("wt-form-actions") as
            (HTMLElement & { error: string }) | null
        )?.error,
    )
    .toContain("Check");
  expect(el.shadowRoot!.querySelector("[data-test=candidates]")!.hasAttribute("disabled")).toBe(
    false,
  );
  expect(el.shadowRoot!.querySelector("[data-test=allocation-file]")).toBeNull();
});
it("refuses a missing or oversized public file before reading or uploading it", async () => {
  const { el, calls } = await mount();
  await candidates(el);
  const control = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=allocation-file]")!;
  const data = new DataTransfer();
  data.items.add(new File(["X".repeat(65537)], "large.json"));
  control.files = data.files;
  control.dispatchEvent(new Event("change"));
  await el.updateComplete;
  await click(el, "import");
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=allocation-error]")?.textContent)
    .toContain("Check");
  expect(calls.map((call) => call.action)).toEqual(["candidates"]);
});
it("does not enrol a key when the independent fingerprint is missing or mismatches", async () => {
  const { el, calls } = await mount();
  await importAllocation(el);
  await file(el, "key-file", publicKey);
  await field(el, "fingerprint", "a".repeat(63));
  await click(el, "enrol");
  expect(el.shadowRoot!.querySelector("[data-test=fingerprint]")!.hasAttribute("invalid")).toBe(
    true,
  );
  await field(el, "fingerprint", "b".repeat(64));
  await click(el, "enrol");
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=fingerprint]")!.getAttribute("error"))
    .toContain("Check");
  expect(calls.map((call) => call.action)).toEqual(["candidates", "input"]);
  expect(el.shadowRoot!.querySelector("[data-test=confirm]")!.hasAttribute("disabled")).toBe(true);
});
it("keeps a refused public request load available and reports the refusal", async () => {
  const { el } = await mount({
    async request() {
      throw { code: "setup.attempt_conflict" };
    },
  });
  el.context = { ...el.context, status: "consumption-intent" };
  await el.updateComplete;
  await click(el, "resume");
  await expect
    .poll(() => el.shadowRoot!.querySelector("[role=alert]")?.textContent)
    .toContain("Check");
  expect(el.shadowRoot!.querySelector("[data-test=resume]")!.hasAttribute("disabled")).toBe(false);
});

it("creates the localized module screen through its contribution and discards its draft through the shared coordinator", async () => {
  const { LitElement, html } = await import("lit");
  const { LeaveController } = await import("@waitron/ui");
  const { FISCAL_SETUP } = await import("./first-fiscal-screen.js");
  class Harness extends LitElement {
    readonly leave = new LeaveController(this);
    override render() {
      return html`<slot></slot
        >${this.leave.render({ heading: "Unsaved", message: "Discard this draft?", keepLabel: "Keep", discardLabel: "Discard" })}`;
    }
  }
  customElements.define("test-first-fiscal-leave", Harness);
  const host = document.createElement("test-first-fiscal-leave") as Harness;
  document.body.append(host);
  mounted.push(host);
  applyTokens(host);
  await host.updateComplete;
  let proposed: unknown;
  const el = FISCAL_SETUP.create({
    locale: "es",
    request: {
      status: "claimed",
      environment: "production",
      venue: {
        taxId: "B12345674",
        seriesCode: "A",
        fullSeriesCode: "FF",
        rectificativeSeriesCode: "R",
      },
    },
    api: {
      async candidates(value) {
        proposed = value;
        return publicRequest;
      },
      async request() {
        return publicRequest;
      },
      async importInput() {},
      async enrol() {},
      async confirm() {},
    },
  }) as FirstFiscalScreen;
  host.append(el);
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain("Producción");
  expect(el.shadowRoot!.textContent).toContain("B12345674");
  await click(el, "existing");
  await field(el, "serials", "7, 8");
  const leave = host.leave.coordinator.request({
    scopes: [el],
    reason: "navigation",
    proceed: () => {},
  });
  const warning = host.shadowRoot!.querySelector<
    HTMLElement & { open: boolean; updateComplete: Promise<unknown> }
  >("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  await userEvent.click(warning.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!);
  await leave;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=serials]")).toBeNull();
  expect(proposed).toBeUndefined();
  await click(el, "existing");
  await field(el, "serials", "3");
  await click(el, "candidates");
  await expect.poll(() => proposed).toEqual({ serials: [3] });
});

it.each([
  {
    kind: "waitron-custodian-key",
    version: 1,
    kdf: { name: "PBKDF2" },
    cipher: { name: "AES-GCM" },
    scope: { custodianId: "Elena" },
    fingerprint: "a".repeat(64),
    ciphertext: "DISPOSABLE-ENCRYPTED-SENTINEL",
  },
  {
    version: 1,
    kind: "recovery-pack",
    public: {},
    nodeRecoverySecret: "DISPOSABLE-SECRET-SENTINEL",
  },
])(
  "never uploads a protected key file or recovery pack as public allocation input",
  async (value) => {
    const uploaded: unknown[] = [];
    const { el } = await mount({
      async importInput(input) {
        uploaded.push(input);
        throw { code: "sif.allocation_invalid" };
      },
    });
    await candidates(el);
    await file(el, "allocation-file", value);
    await click(el, "import");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=allocation-error]")?.textContent)
      .toContain("Check");
    expect(uploaded).toEqual([]);
  },
);

it("refuses secret-bearing fields nested in an otherwise public allocation before upload", async () => {
  const uploaded: unknown[] = [];
  const { el } = await mount({
    async importInput(value) {
      uploaded.push(value);
      throw { code: "sif.allocation_invalid" };
    },
  });
  await candidates(el);
  await file(el, "allocation-file", {
    allocation: { ...input.allocation, privateKey: "DISPOSABLE-PRIVATE-SENTINEL" },
    approval: input.approval,
  });
  await click(el, "import");
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=allocation-error]")?.textContent)
    .toContain("Check");
  expect(uploaded).toEqual([]);
});

it("shows the exact signed series and frozen event identities before current-original confirmation", async () => {
  const { el } = await mount();
  await importAllocation(el);
  const value = (test: string) =>
    el.shadowRoot!.querySelector(`[data-test=${test}]`)?.textContent?.trim();
  expect(value("review-series")).toContain("A-S000001");
  expect(value("review-box")).toBe("node");
  expect(value("review-event")).toBe("event");
  expect(value("review-operator")).toBe("admin");
  expect(value("review-custodian")).toBe("Elena");
  expect(value("review-generation")).toBe("generation");
  expect(value("review-block")).toBe("block");
});

it("shows the complete independent fingerprint without horizontal clipping at phone form width", async () => {
  const { el, host } = await mount();
  host.style.width = "260px";
  await importAllocation(el);
  await field(el, "fingerprint", "abcdef0123456789".repeat(4));
  const component = el.shadowRoot!.querySelector<
    HTMLElement & { updateComplete: Promise<unknown> }
  >("[data-test=fingerprint]")!;
  await component.updateComplete;
  const native = component.shadowRoot!.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "input,textarea",
  )!;
  native.focus();
  native.setSelectionRange(64, 64);
  expect(native.clientWidth).toBeGreaterThan(0);
  expect(native.scrollWidth).toBeLessThanOrEqual(native.clientWidth);
  expect(native.value).toBe("abcdef0123456789".repeat(4));
});
