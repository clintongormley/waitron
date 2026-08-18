import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { roleName } from "../i18n/domain.js";
// Value import (not `import type`): pulls in the module for its `@customElement` side effect, which
// registers `dashboard-person-form` so `mountWidget` can create it.
import { PersonForm } from "./person-form.js";

afterEach(cleanupWidgets);

/** The wt-dialog inside the form, once its own first render (which calls showModal) has settled. */
async function openedDialog(el: PersonForm): Promise<HTMLDialogElement> {
  const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return wtDialog.shadowRoot!.querySelector("dialog")!;
}

describe("person-form", () => {
  // open defaults to false, so the wt-dialog it drives never calls showModal — the native dialog
  // stays closed and renders nothing to the a11y tree. This pins the default-closed contract.
  it("stays closed by default", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", {});
    expect((await openedDialog(el)).open).toBe(false);
  });

  it("opens the dialog when open is set", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    expect((await openedDialog(el)).open).toBe(true);
  });

  it("offers the four person roles", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    const options = [...el.shadowRoot!.querySelectorAll("option")];
    // The option's wire VALUE stays the raw role token (the emitted detail.role reads it back)...
    expect(options.map((o) => o.value)).toEqual(["staff", "supervisor", "manager", "admin"]);
    // ...while the visible option TEXT is the localised role name, never the raw token.
    expect(options.map((o) => o.textContent?.trim())).toEqual(
      ["staff", "supervisor", "manager", "admin"].map((r) => roleName(r, "es-ES")),
    );
    expect(options.find((o) => o.value === "manager")?.textContent).not.toContain("manager");
  });

  // Drives all three field handlers through the DOM (the wt-inputs' composed `wt-change`, the native
  // `<select>`'s `change`) and asserts the confirm control emits their captured values.
  it("emits create-person with the entered values on confirm", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    const displayName = el.shadowRoot!.querySelector<HTMLElement>("[data-test=display-name]")!;
    const pin = el.shadowRoot!.querySelector<HTMLElement>("[data-test=pin]")!;
    const select = el.shadowRoot!.querySelector("select")!;

    displayName.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Ada" } }));
    pin.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "1234" } }));
    select.value = "manager";
    select.dispatchEvent(new Event("change"));
    await el.updateComplete;

    const created = new Promise<CustomEvent<{ displayName: string; role: string; pin: string }>>(
      (resolve) => el.addEventListener("create-person", (e) => resolve(e as CustomEvent)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    const event = await created;
    expect(event.detail).toEqual({ displayName: "Ada", role: "manager", pin: "1234" });
  });

  // create-person must escape this widget's shadow boundary to reach the app shell (a later task),
  // so it is dispatched bubbles+composed — asserted so a future edit does not quietly drop either.
  it("emits create-person as a bubbling, composed event", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    const seen = new Promise<Event>((resolve) => el.addEventListener("create-person", resolve));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  // The default `role` ("staff") flows through when the operator never touches the select — the
  // one field with no explicit starting value in the confirm test above.
  it("defaults the role to staff when the select is untouched", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    const created = new Promise<CustomEvent<{ role: string }>>((resolve) =>
      el.addEventListener("create-person", (e) => resolve(e as CustomEvent)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    expect((await created).detail.role).toBe("staff");
  });

  // The real backdrop/escape path: the native <dialog> closing makes wt-dialog dispatch `wt-close`,
  // which the form listens for to reset its own `open` — so a dismissed dialog does not leave the
  // form believing it is still showing. `dialog.close()` fires the native `close` event as a QUEUED
  // TASK (not synchronously), so the wt-close must be awaited — a bare `await updateComplete`
  // (a microtask) resolves before the close task ever runs; the form's `#onClose` handler has fired
  // by the time this bubbling, composed wt-close reaches the host.
  it("resets open to false when the dialog is closed (wt-close)", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    const nativeDialog = await openedDialog(el);
    expect(nativeDialog.open).toBe(true);
    const closed = new Promise<void>((resolve) =>
      el.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    nativeDialog.close();
    await closed;
    await el.updateComplete;
    expect(el.open).toBe(false);
  });

  // When the dialog CLOSES — a successful create (the staff screen sets `.open=false`, and wt-dialog
  // fires `wt-close` on that programmatic close as much as on a dismiss) or an Escape/backdrop
  // dismiss — the fields reset, so the previous person's name/role/PIN can't linger into the next
  // create (a duplicate / reused-PIN hazard). A FAILED create keeps the dialog OPEN, so `#onClose`
  // never runs and the values survive for a retry — covered by staff-screen.test.ts. Proven by
  // deletion: remove the resets in `#onClose` and this reopens with "Ada"/"manager"/"1234" still set.
  it("resets the fields when the dialog closes, so the next open starts blank", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    const nativeDialog = await openedDialog(el);
    const displayName = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=display-name]",
    )!;
    const pin = el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-test=pin]")!;
    const select = el.shadowRoot!.querySelector("select")!;

    displayName.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Ada" } }));
    pin.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "1234" } }));
    select.value = "manager";
    select.dispatchEvent(new Event("change"));
    await el.updateComplete;
    // Sanity: the fields hold the entered values before the close.
    expect(displayName.value).toBe("Ada");
    expect(pin.value).toBe("1234");
    expect(select.value).toBe("manager");

    const closed = new Promise<void>((resolve) =>
      el.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    nativeDialog.close();
    await closed;
    await el.updateComplete;

    expect(displayName.value).toBe("");
    expect(pin.value).toBe("");
    expect(el.shadowRoot!.querySelector("select")!.value).toBe("staff");
  });

  // The screen passes a rejected create's failure down as `error`; it renders in the dialog's own top
  // layer (role="alert"), where the page-level banner behind the backdrop could not be seen.
  it("renders the error inside the dialog when one is set", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", {
      open: true,
      error: "pin.too_short",
    });
    const alert = el.shadowRoot!.querySelector("[role=alert]");
    // The banner shows LOCALISED copy for the code, never the raw wire code (the code stays in `error`).
    expect(alert?.textContent).toContain(codeMessage("pin.too_short", "es-ES"));
    expect(alert?.textContent).not.toContain("pin.too_short");
  });
});
