import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import {
  TillSupervisorOverrideDialog,
  type OverrideConfirmDetail,
} from "./supervisor-override-dialog.js";
import type { StaffMember } from "../api/client.js";

afterEach(cleanupWidgets);

const authorizers: StaffMember[] = [
  { personId: "sup-1", displayName: "Responsable" },
  { personId: "adm-1", displayName: "Administradora" },
];

/** Mount the dialog with a set of authorizers, in es-ES (the shipped default). */
async function mount(props: Partial<TillSupervisorOverrideDialog> = {}) {
  setLocale("es-ES");
  return mountWidget<TillSupervisorOverrideDialog>("till-supervisor-override-dialog", {
    authorizers,
    ...props,
  });
}

/** The dialog's own shadow root — where the picker buttons, pad and action buttons live. */
const root = (el: TillSupervisorOverrideDialog) => el.shadowRoot!;
const pad = (el: TillSupervisorOverrideDialog) =>
  root(el).querySelector<HTMLElement & { value: string }>("till-numeric-pad");

/** Pick a supervisor by id, entering PIN mode. */
async function pick(el: TillSupervisorOverrideDialog, personId: string): Promise<void> {
  root(el).querySelector<HTMLElement>(`[data-person="${personId}"]`)!.click();
  await el.updateComplete;
}

/** Type a PIN by clicking the pad's digit keys, exactly as the operator does. */
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
    expect(pad(el)).toBeNull(); // picker mode: no pad yet
  });

  it("shows the no-supervisors state for an empty authorizer list", async () => {
    const { el } = await mount({ authorizers: [] });
    expect(root(el).textContent).toContain(t("override.no_supervisors"));
    expect(root(el).querySelector("[data-person]")).toBeNull();
  });

  it("choosing a supervisor enters PIN mode for that person", async () => {
    const { el } = await mount();
    await pick(el, "sup-1");
    expect(root(el).textContent).toContain("Responsable"); // the chosen operator's name
    expect(pad(el)).not.toBeNull();
    // The pad is in pin mode (no decimal key).
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

    // The PIN reaches the parent ONLY through the event detail — the authorizing supervisor's id + PIN.
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(confirmed).toHaveBeenCalledWith({ personId: "sup-1", pin: "4321" });
    // And it is wiped from the component the instant it is dispatched: the pad's value is empty again.
    expect(pad(el)!.value).toBe("");
  });

  it("does not confirm on an empty PIN (the Authorize control is guarded)", async () => {
    const { el } = await mount();
    const confirmed = vi.fn();
    el.addEventListener("override-confirm", confirmed);

    await pick(el, "sup-1");
    // Force-click Authorize with no PIN entered — the guard refuses it.
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
    // Back at the picker with both authorizers, no pad, PIN discarded.
    expect(pad(el)).toBeNull();
    expect(root(el).querySelector('[data-person="sup-1"]')).not.toBeNull();

    // Re-selecting starts from a blank PIN (the discarded "12" did not carry over).
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
    // wt-dialog re-emits the native dialog's close (Escape / backdrop) as a composed wt-close.
    root(el)
      .querySelector("wt-dialog")!
      .dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("shows the pin.invalid retry copy when the parent passes that error after a failed attempt", async () => {
    // The real retry sequence: the operator is already in PIN mode when the parent's failed authorize
    // sets the error and keeps the dialog open.
    const { el } = await mount();
    await pick(el, "sup-1");
    el.error = "pin.invalid";
    await el.updateComplete;
    const alert = root(el).querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain(t("pin.invalid"));
  });

  it("dismisses a shown error as soon as the operator starts retyping", async () => {
    // Start in PIN mode with the error already set (a re-render after a failed attempt).
    const { el } = await mount({ error: "pin.invalid" });
    await pick(el, "sup-1");
    // The dialog dismisses on select; a fresh error re-arms it via willUpdate.
    el.error = null;
    await el.updateComplete;
    el.error = "pin.invalid";
    await el.updateComplete;
    expect(root(el).querySelector('[role="alert"]')).not.toBeNull();

    // Typing a digit dismisses the stale message.
    await typePin(el, "1");
    expect(root(el).querySelector('[role="alert"]')).toBeNull();
  });

  it("maps any non-pin error code to the generic override.error copy, never the raw code", async () => {
    const { el } = await mount();
    await pick(el, "sup-1");
    el.error = "server.internal";
    await el.updateComplete;
    const alert = root(el).querySelector('[role="alert"]');
    expect(alert!.textContent).toContain(t("override.error"));
    expect(alert!.textContent).not.toContain("server.internal");
  });
});
