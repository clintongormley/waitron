import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import (not `import type`): pulls in the module for its `@customElement` side effect, which
// registers `dashboard-person-edit` so `mountWidget` can create it.
import { PersonEdit } from "./person-edit.js";
import type { PersonSummary } from "../api/client.js";

afterEach(cleanupWidgets);

const active: PersonSummary = {
  personId: "p1",
  displayName: "Ada",
  role: "manager",
  status: "active",
  hasPassword: true,
  hasTotp: false,
};

const suspended: PersonSummary = {
  ...active,
  personId: "p2",
  displayName: "Bea",
  status: "suspended",
};

/** The wt-dialog inside the widget, once its own first render (which calls showModal) has settled. */
async function openedDialog(el: PersonEdit): Promise<HTMLDialogElement> {
  const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return wtDialog.shadowRoot!.querySelector("dialog")!;
}

describe("person-edit", () => {
  // open defaults to false, so the wt-dialog it drives never calls showModal — the native dialog
  // stays closed and renders nothing to the a11y tree. Pins the default-closed contract.
  it("stays closed by default", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {});
    expect((await openedDialog(el)).open).toBe(false);
  });

  it("opens the dialog when open is set", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: active,
      open: true,
    });
    expect((await openedDialog(el)).open).toBe(true);
  });

  // The role picker must show the person's CURRENT (non-default) role. `manager` is the third of the
  // four options, so this fails if the select is driven by a `.value` property bound before its
  // <option> children render — the latent bug the backlog names for the login/create pickers, which
  // "renders right today only because the default equals the first option". Driving via `?selected`
  // on the options is what makes a non-default preset stick.
  it("presets the role picker to the person's current role", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: active,
      open: true,
    });
    expect(el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=edit-role]")!.value).toBe(
      "manager",
    );
  });

  it("emits update-role with the newly selected role on save", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: active,
      open: true,
    });
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=edit-role]")!;
    select.value = "admin";
    select.dispatchEvent(new Event("change"));
    await el.updateComplete;

    const seen = new Promise<CustomEvent<{ role: string }>>((resolve) =>
      el.addEventListener("update-role", (e) => resolve(e as CustomEvent)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-role]")!.click();
    expect((await seen).detail).toEqual({ role: "admin" });
  });

  // Status is derived straight from the person: an ACTIVE person's control offers to suspend them.
  it("labels the status control Suspender and emits suspended for an active person", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: active,
      open: true,
    });
    const button = el.shadowRoot!.querySelector<HTMLElement>("[data-test=toggle-status]")!;
    expect(button.textContent).toContain("Suspender");

    const seen = new Promise<CustomEvent<{ status: string }>>((resolve) =>
      el.addEventListener("set-status", (e) => resolve(e as CustomEvent)),
    );
    button.click();
    expect((await seen).detail).toEqual({ status: "suspended" });
  });

  it("labels the status control Reactivar and emits active for a suspended person", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: suspended,
      open: true,
    });
    const button = el.shadowRoot!.querySelector<HTMLElement>("[data-test=toggle-status]")!;
    expect(button.textContent).toContain("Reactivar");

    const seen = new Promise<CustomEvent<{ status: string }>>((resolve) =>
      el.addEventListener("set-status", (e) => resolve(e as CustomEvent)),
    );
    button.click();
    expect((await seen).detail).toEqual({ status: "active" });
  });

  it("emits reset-pin with the entered pin on save", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: active,
      open: true,
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-pin]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "4321" } }),
    );
    await el.updateComplete;

    const seen = new Promise<CustomEvent<{ pin: string }>>((resolve) =>
      el.addEventListener("reset-pin", (e) => resolve(e as CustomEvent)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-pin]")!.click();
    expect((await seen).detail).toEqual({ pin: "4321" });
  });

  it("emits set-password with the entered password on save", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: active,
      open: true,
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-password]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "hunter2 correct horse" } }),
    );
    await el.updateComplete;

    const seen = new Promise<CustomEvent<{ password: string }>>((resolve) =>
      el.addEventListener("set-password", (e) => resolve(e as CustomEvent)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-password]")!.click();
    expect((await seen).detail).toEqual({ password: "hunter2 correct horse" });
  });

  // Every action event must escape this widget's shadow boundary to reach the staff screen, so each
  // is dispatched bubbles+composed. Asserted on update-role as the representative (all four use the
  // same dispatch helper) so a future edit does not quietly drop either flag.
  it("emits its action events as bubbling, composed events", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: active,
      open: true,
    });
    const seen = new Promise<Event>((resolve) => el.addEventListener("update-role", resolve));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-role]")!.click();
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  // Leak guard: a typed PIN and password are SECRETS and must not linger into the next person's edit.
  // When the dialog closes (Escape/backdrop, or the screen setting `.open=false`), both fields reset.
  // Prove by deletion: drop the resets in `#onClose` and this reopens with "4321"/"secret" still set.
  // `dialog.close()` fires the native `close` event as a QUEUED TASK, so the wt-close must be awaited.
  it("resets the pin and password fields when the dialog closes", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: active,
      open: true,
    });
    const pin = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=edit-pin]",
    )!;
    const password = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=edit-password]",
    )!;
    pin.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "4321" } }));
    password.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "secret" } }));
    await el.updateComplete;
    expect(pin.value).toBe("4321");
    expect(password.value).toBe("secret");

    const nativeDialog = await openedDialog(el);
    const closed = new Promise<void>((resolve) =>
      el.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    nativeDialog.close();
    await closed;
    await el.updateComplete;

    expect(
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-test=edit-pin]")!.value,
    ).toBe("");
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-test=edit-password]")!
        .value,
    ).toBe("");
  });
});
