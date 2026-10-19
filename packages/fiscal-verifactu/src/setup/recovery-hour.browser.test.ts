import { afterEach, expect, it, vi } from "vitest";
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
  unavailable: [],
  disagreement: false,
  requiresConfirmation: false,
  boundaryWait: false,
  releaseBlocked: false,
  rangeBlocked: false,
};
const selected = {
  status: "selected",
  identity: "06TH",
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
      if (action === "confirm-clock") return clock;
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
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(
    name.startsWith("taxpayer-hour-")
      ? `input[name="taxpayer-hour"][value="${name.slice(14)}"]`
      : `input[name="${name}"]`,
  );
  expect(input, `visible ${name} declaration`).not.toBeNull();
  input!.checked = value;
  input!.dispatchEvent(new Event("change", { bubbles: true }));
}
async function ready(el: Entry, answer = "no") {
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
  const codes = el.shadowRoot!.querySelector<LitElement>('[name="recovery-installation-codes"]')!;
  await codes.updateComplete;
  const codeInput = codes.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  codeInput.value = "06RB";
  codeInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  check(el, "recovery-old-box-stopped");
  check(el, "recovery-sole-operation");
  check(el, `taxpayer-hour-${answer}`);
  await vi.waitFor(() => expect(button(el, "compare").disabled).toBe(false));
}
function button(el: Entry, name: string) {
  const value = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    `[data-test="${name}"]`,
  );
  expect(value, `${name} action`).not.toBeNull();
  return value!;
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
    answer: "no",
    installationCodes: ["06RB"],
  });
  expect(el.shadowRoot!.textContent).toContain("06TH");
  expect(el.shadowRoot!.textContent).not.toContain("AbCdEfGhIjKlMnOpQrStUvWxYz012345");
});
it("requires both explicit isolation declarations and the taxpayer-wide answer", async () => {
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
it("groups the three native answers as one required choice", async () => {
  const { el } = await mount();
  const radios = Array.from(
    el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  );
  expect(radios).toHaveLength(3);
  expect(new Set(radios.map((r) => r.name)).size).toBe(1);
  expect(radios.map((r) => r.value)).toEqual(["no", "yes", "unknown"]);
  expect(radios.every((r) => r.required)).toBe(true);
});
it("requires a fresh explicit confirmation for disagreeing readings", async () => {
  const prepare = vi.fn(async (request: { proposal: unknown }) => {
    const action = (request.proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks")
      return {
        id: "different-reading",
        clock: { ...clock, requiresConfirmation: true, disagreement: true },
      };
    if (action === "confirm-clock") return clock;
    return selected;
  });
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  expect(button(el, "select").disabled).toBe(true);
  check(el, "recovery-clock-confirmed");
  await el.updateComplete;
  expect(button(el, "select").disabled).toBe(false);
  button(el, "select").click();
  await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
  expect(prepare.mock.calls.slice(-2).map(([r]) => r.proposal)).toEqual([
    { action: "confirm-clock", comparisonId: "different-reading" },
    { action: "select", answer: "no", installationCodes: ["06RB"] },
  ]);
  button(el, "compare").click();
  await vi.waitFor(() =>
    expect(
      prepare.mock.calls.filter(
        ([r]) => (r.proposal as { action: string }).action === "compare-clocks",
      ),
    ).toHaveLength(2),
  );
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLInputElement>('[name="recovery-clock-confirmed"]')!.checked,
  ).toBe(false);
  expect(el.readCredentials()).toBeNull();
});
it.each(["yes", "unknown"])(
  "keeps the server's %s wait and only sends the selected answer",
  async (answer) => {
    const prepare = vi.fn(async (request: { proposal: unknown }) => {
      const action = (request.proposal as { action: string }).action;
      if (action === "clock-challenge") return { id: "challenge" };
      if (action === "compare-clocks") return { id: "comparison", clock };
      return {
        status: "waiting",
        targetMs: Date.parse("2026-10-18T13:00:00Z"),
        remainingMs: 1_800_000,
        requiresClockConfirmation: false,
      };
    });
    const { el } = await mount(prepare);
    await ready(el, answer);
    await compare(el);
    button(el, "select").click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain("2026-10-18T13:00:00.000Z"),
    );
    expect(prepare.mock.calls.at(-1)?.[0].proposal).toEqual({
      action: "select",
      answer,
      installationCodes: ["06RB"],
    });
    expect(el.readCredentials()).toBeNull();
    expect(button(el, "compare").disabled).toBe(false);
  },
);
it.each(["key", "answer", "isolation", "clear", "disconnect"])(
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
    if (fault === "answer") check(el, "taxpayer-hour-yes");
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
    return held;
  });
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  button(el, "select").click();
  await vi.waitFor(() =>
    expect(prepare.mock.calls.at(-1)?.[0].proposal).toEqual({
      action: "select",
      answer: "no",
      installationCodes: ["06RB"],
    }),
  );
  check(el, "recovery-sole-operation", false);
  release(selected);
  await held;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await el.updateComplete;
  expect(el.readCredentials()).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain("06TH");
});
it("marks each missing declaration and the unanswered group after an attempted recovery", async () => {
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
  const fieldset = el.shadowRoot!.querySelector("fieldset")!;
  expect(fieldset.getAttribute("aria-invalid")).toBe("true");
  expect(
    el
      .shadowRoot!.querySelector(`#${fieldset.getAttribute("aria-describedby")}`)!
      .textContent!.trim(),
  ).not.toBe("");
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
  await ready(el);
  await compare(el);
  button(el, "select").click();
  await vi.waitFor(() =>
    expect(prepare.mock.calls.at(-1)?.[0].proposal).toEqual({
      action: "select",
      answer: "no",
      installationCodes: ["06RB"],
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
  expect(el.shadowRoot!.textContent).not.toContain("06TH");
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
  { releaseBlocked: true, rangeBlocked: false, boundaryWait: false },
  { releaseBlocked: false, rangeBlocked: true, boundaryWait: false },
  { releaseBlocked: false, rangeBlocked: false, boundaryWait: true },
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
it("allows manual acceptance of a disagreement only when the box interval is within one hour", async () => {
  const prepare = vi.fn(async (request: { proposal: unknown }) =>
    (request.proposal as { action: string }).action === "clock-challenge"
      ? { id: "challenge" }
      : {
          id: "comparison",
          clock: {
            ...clock,
            usable: clock.usable.map((reading) =>
              reading.source === "browser"
                ? { ...reading, lowerMs: instant + 3_600_000, upperMs: instant + 3_600_000 }
                : reading,
            ),
            boundaryWait: true,
            disagreement: true,
            requiresConfirmation: true,
          },
        },
  );
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  check(el, "recovery-clock-confirmed");
  await el.updateComplete;
  expect(button(el, "select").disabled).toBe(false);
});
it("manual confirmation never enables an ambiguous box-hour interval", async () => {
  const prepare = vi.fn(async (request: { proposal: unknown }) =>
    (request.proposal as { action: string }).action === "clock-challenge"
      ? { id: "challenge" }
      : {
          id: "comparison",
          clock: {
            ...clock,
            usable: clock.usable.map((reading) =>
              reading.source === "box"
                ? {
                    ...reading,
                    lowerMs: Date.parse("2026-10-18T12:59:59Z"),
                    upperMs: Date.parse("2026-10-18T13:00:01Z"),
                  }
                : reading,
            ),
            boundaryWait: true,
            disagreement: true,
            requiresConfirmation: true,
          },
        },
  );
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  check(el, "recovery-clock-confirmed");
  await el.updateComplete;
  expect(button(el, "select").disabled).toBe(true);
});

it("requires the one code from the sheet and sends its normalised value to the hour selector", async () => {
  const { el, prepare } = await mount();
  await ready(el);
  const field = el.shadowRoot!.querySelector<LitElement>('[name="recovery-installation-codes"]');
  expect(field, "public code field from the recovery sheet").not.toBeNull();
  await field!.updateComplete;
  const input = field!.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.value = "06rb";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  await compare(el);
  button(el, "select").click();
  await vi.waitFor(() =>
    expect(prepare.mock.calls.at(-1)?.[0].proposal).toEqual({
      action: "select",
      answer: "no",
      installationCodes: ["06RB"],
    }),
  );
  expect(input.isConnected, "the edited control stays mounted").toBe(true);
  expect(
    field!.shadowRoot!.querySelector("input"),
    "the native control survives the selection render",
  ).toBe(input);
  await vi.waitFor(() => expect(el.readCredentials()).not.toBeNull());
  input.value = "06RD";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(el.readCredentials()).toBeNull();
  expect(button(el, "select").disabled).toBe(true);
});

it("does not expose a selected result after its reported code was edited during the request", async () => {
  let release!: (value: unknown) => void;
  const prepare = vi.fn(async (request: { proposal: unknown }) => {
    const action = (request.proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks") return { id: "comparison", clock };
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  button(el, "select").click();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const field = el.shadowRoot!.querySelector<LitElement>('[name="recovery-installation-codes"]')!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.value = "06RC";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  release(selected);
  await el.updateComplete;
  await Promise.resolve();
  expect(el.readCredentials()).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain("06TH");
});
it("marks a missing code beside its native field and keeps selection disabled", async () => {
  const { el } = await mount();
  await ready(el);
  const field = el.shadowRoot!.querySelector<LitElement>('[name="recovery-installation-codes"]')!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  expect(el.readCredentials()).toBeNull();
  await el.updateComplete;
  await field.updateComplete;
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(field.shadowRoot!.textContent).toContain("four-character code");
  expect(button(el, "select").disabled).toBe(true);
});

it("explains a reported-hour clash and allows another comparison", async () => {
  const prepare = vi.fn(async (request: { proposal: unknown }) => {
    const action = (request.proposal as { action: string }).action;
    if (action === "clock-challenge") return { id: "challenge" };
    if (action === "compare-clocks") return { id: "comparison", clock };
    throw { code: "sif.allocation_invalid", params: { reason: "hour_not_later" } };
  });
  const { el } = await mount(prepare);
  await ready(el);
  await compare(el);
  button(el, "select").click();
  await vi.waitFor(() =>
    expect(
      (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
    ).toContain("later than the known installation codes"),
  );
  expect(el.readCredentials()).toBeNull();
  expect(button(el, "compare").disabled).toBe(false);
});

it("opens the installation code field without a validation refusal", async () => {
  const { el } = await mount();
  const field = el.shadowRoot!.querySelector<LitElement>('[name="recovery-installation-codes"]')!;
  await field.updateComplete;
  expect(field.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("false");
  expect(field.shadowRoot!.querySelector("[data-error]")).toBeNull();
});

it("refuses a list of installation codes in the single-code field", async () => {
  const { el, prepare } = await mount();
  await ready(el);
  await compare(el);
  const field = el.shadowRoot!.querySelector<LitElement>('[name="recovery-installation-codes"]')!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  expect(button(el, "compare").disabled).toBe(false);
  input.value = "06RB, 06RC";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(button(el, "compare").disabled).toBe(true);
  expect(button(el, "select").disabled).toBe(true);
  expect(el.readCredentials()).toBeNull();
  expect(
    prepare.mock.calls.every(
      ([request]) => (request.proposal as { action: string }).action !== "select",
    ),
  ).toBe(true);
});
