import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import {
  TillSupervisorOverrideDialog,
  type OverrideConfirmDetail,
} from "./supervisor-override-dialog.js";
import type { StaffMember } from "../api/client.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

const authorizers: StaffMember[] = [
  { personId: "sup-1", displayName: "Responsable" },
  { personId: "adm-1", displayName: "Administradora" },
];

async function mount(props: Partial<TillSupervisorOverrideDialog> = {}) {
  setLocale("en-GB");
  return mountWidget<TillSupervisorOverrideDialog>("till-supervisor-override-dialog", {
    authorizers,
    ...props,
  });
}

const root = (el: TillSupervisorOverrideDialog) => el.shadowRoot!;
async function shownError(el: TillSupervisorOverrideDialog) {
  await root(el).querySelector("wt-form-actions")?.updateComplete;
  const dialog = root(el).querySelector("wt-dialog")!;
  await dialog.updateComplete;
  return dialog.shadowRoot!.querySelector('[role="alert"]');
}
const pad = (el: TillSupervisorOverrideDialog) =>
  root(el).querySelector<HTMLElement & { value: string }>("till-numeric-pad");

async function pick(el: TillSupervisorOverrideDialog, personId: string): Promise<void> {
  root(el).querySelector<HTMLElement>(`[data-person="${personId}"]`)!.click();
  await el.updateComplete;
}

async function typePin(el: TillSupervisorOverrideDialog, digits: string): Promise<void> {
  for (const digit of digits) {
    pad(el)!.shadowRoot!.querySelector<HTMLElement>(`[data-key="${digit}"]`)!.click();
    await el.updateComplete;
  }
}

describe("till-supervisor-override-dialog", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-supervisor-override-dialog")).toBe(
      TillSupervisorOverrideDialog,
    );
  });

  it("renders one picker button per authorizer, no PIN pad until one is chosen", async () => {
    const { el } = await mount();
    expect(root(el).querySelector('[data-person="sup-1"]')).not.toBeNull();
    expect(root(el).querySelector('[data-person="adm-1"]')).not.toBeNull();
    expect(pad(el)).toBeNull();
  });

  it("shows the no-supervisors state for an empty authorizer list", async () => {
    const { el } = await mount({ authorizers: [] });
    expect(root(el).textContent).toContain(t("override.no_supervisors"));
    expect(root(el).querySelector("[data-person]")).toBeNull();
  });

  it("choosing a supervisor enters PIN mode for that person", async () => {
    const { el } = await mount();
    await pick(el, "sup-1");
    expect(root(el).textContent).toContain("Responsable");
    expect(pad(el)).not.toBeNull();
    expect(pad(el)!.shadowRoot!.querySelector('[data-key="."]')).toBeNull();
  });

  it("emits override-confirm carrying the picked personId + entered PIN, then wipes the PIN", async () => {
    const { el } = await mount();
    const confirmed = vi.fn();
    el.addEventListener("override-confirm", (e) =>
      confirmed((e as CustomEvent<OverrideConfirmDetail>).detail),
    );

    await pick(el, "sup-1");
    await typePin(el, "4321");
    root(el).querySelector<HTMLElement>(".authorize")!.click();
    await el.updateComplete;

    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(confirmed).toHaveBeenCalledWith({ personId: "sup-1", pin: "4321" });
    expect(pad(el)!.value).toBe("");
  });

  it("does not confirm on an empty PIN (the Authorize control is guarded)", async () => {
    const { el } = await mount();
    const confirmed = vi.fn();
    el.addEventListener("override-confirm", confirmed);

    await pick(el, "sup-1");
    root(el).querySelector<HTMLElement>(".authorize")!.click();
    await el.updateComplete;
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("Back returns from PIN mode to the picker, discarding the half-entered PIN", async () => {
    const { el } = await mount();
    await pick(el, "sup-1");
    await typePin(el, "12");
    expect(pad(el)).not.toBeNull();

    root(el).querySelector<HTMLElement>(".back")!.click();
    await el.updateComplete;
    expect(pad(el)).toBeNull();
    expect(root(el).querySelector('[data-person="sup-1"]')).not.toBeNull();

    await pick(el, "sup-1");
    expect(pad(el)!.value).toBe("");
  });

  it("emits override-cancel from the Cancel control", async () => {
    const { el } = await mount();
    const cancelled = vi.fn();
    el.addEventListener("override-cancel", cancelled);
    root(el).querySelector<HTMLElement>(".cancel")!.click();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("emits override-cancel when the modal is dismissed (wt-close)", async () => {
    const { el } = await mount();
    const cancelled = vi.fn();
    el.addEventListener("override-cancel", cancelled);
    root(el)
      .querySelector("wt-dialog")!
      .dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("shows the pin.invalid retry copy when the parent passes that error after a failed attempt", async () => {
    const { el } = await mount();
    await pick(el, "sup-1");
    el.error = "pin.invalid";
    await el.updateComplete;
    const alert = await shownError(el);
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain(t("pin.invalid"));
  });

  it("shows the wait-then-retry copy when the parent passes pin.throttled", async () => {
    const { el } = await mount();
    await pick(el, "sup-1");
    el.error = "pin.throttled";
    await el.updateComplete;
    const alert = await shownError(el);
    expect(alert!.textContent).toContain(t("pin.throttled"));
    expect(alert!.textContent).not.toContain(t("override.error"));
  });

  it("dismisses a shown error as soon as the operator starts retyping", async () => {
    const { el } = await mount({ error: "pin.invalid" });
    await pick(el, "sup-1");
    // Selecting dismissed the error; a fresh one re-arms it.
    el.error = null;
    await el.updateComplete;
    el.error = "pin.invalid";
    await el.updateComplete;
    expect(await shownError(el)).not.toBeNull();

    await typePin(el, "1");
    expect(await shownError(el)).toBeNull();
  });

  it("maps any other code to the generic override.error copy, never the raw code", async () => {
    const { el } = await mount();
    await pick(el, "sup-1");
    el.error = "server.internal";
    await el.updateComplete;
    const alert = await shownError(el);
    expect(alert!.textContent).toContain(t("override.error"));
    expect(alert!.textContent).not.toContain("server.internal");
  });

  it("says the approver may not do it when the parent passes authorization.not_permitted", async () => {
    const { el } = await mount();
    await pick(el, "sup-1");
    el.error = "authorization.not_permitted";
    await el.updateComplete;
    const alert = await shownError(el);
    expect(alert!.textContent!.trim()).toBe(codeMessage("authorization.not_permitted"));
  });
});

describe("till-supervisor-override-dialog: approval prompts", () => {
  it.each(["en", "es-ES"])("asks for approval without a role throughout (%s)", async (locale) => {
    setLocale(locale);
    const { el } = await mountWidget<TillSupervisorOverrideDialog>(
      "till-supervisor-override-dialog",
      { authorizers },
    );
    const dialog = root(el).querySelector<HTMLElement & { heading: string }>("wt-dialog")!;
    expect(dialog.heading).toBe(t("override.title"));
    expect(root(el).querySelector(".prompt")!.textContent!.trim()).toBe(
      t("override.pick_supervisor"),
    );
    await pick(el, "sup-1");
    expect(root(el).querySelector(".prompt")!.textContent!.trim()).toBe(t("override.enter_pin"));

    el.authorizers = [];
    await pick(el, "sup-1").catch(() => undefined);
    root(el).querySelector<HTMLElement>(".back")?.click();
    await el.updateComplete;
    expect(root(el).querySelector(".prompt")!.textContent!.trim()).toBe(
      t("override.no_supervisors"),
    );
  });

  it("uses the same permission-based wording by default", async () => {
    const { el } = await mount();
    const dialog = root(el).querySelector<HTMLElement & { heading: string }>("wt-dialog")!;
    expect(dialog.heading).toBe(t("override.title"));
    expect(root(el).querySelector(".prompt")!.textContent!.trim()).toBe(
      t("override.pick_supervisor"),
    );
  });
});

it("hands a refusal to the footer row while Authorize remains usable for retry", async () => {
  const { el } = await mount();
  await pick(el, "sup-1");
  await typePin(el, "1234");
  el.error = "pin.invalid";
  await el.updateComplete;
  const actions = root(el).querySelector<
    HTMLElement & { error: string; updateComplete: Promise<unknown> }
  >('wt-form-actions[slot="footer"]');
  expect(actions).not.toBeNull();
  await actions!.updateComplete;
  expect(actions!.error).toBe(t("pin.invalid"));
  expect(root(el).querySelector(".error")).toBeNull();
  expect(root(el).querySelector<HTMLElement & { disabled: boolean }>(".authorize")!.disabled).toBe(
    false,
  );
});

it.each([
  ["en", "Approval needed", "Choose who approves", "Enter their PIN"],
  ["es", "Hace falta aprobación", "Elige quién aprueba", "Introduce su PIN"],
])(
  "asks for an approver without naming a role in %s",
  async (locale, heading, pickText, pinText) => {
    const { el } = await mount();
    setLocale(locale);
    el.requestUpdate();
    await el.updateComplete;
    const dialog = root(el).querySelector("wt-dialog")!;
    await dialog.updateComplete;
    expect(dialog.heading).toBe(heading);
    expect(root(el).textContent).toContain(pickText);
    await pick(el, "sup-1");
    expect(root(el).textContent).toContain(pinText);
    setLocale("en");
  },
);
