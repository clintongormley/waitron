import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { roleName, statusName } from "../i18n/domain.js";
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
  email: "ada@x.com",
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
  // "renders right today only because the default equals the first option". Reconciling the native
  // <select>'s `.value` to `selectedRole` in `updated()` (after the options render) is what makes a
  // non-default preset stick.
  it("presets the role picker to the person's current role", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: active,
      open: true,
    });
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=edit-role]")!;
    expect(select.value).toBe("manager");
    // The option's wire VALUE stays the raw role token (updated() reconciles the live value to it)...
    const options = [...select.querySelectorAll("option")];
    expect(options.map((o) => o.value)).toEqual(["staff", "supervisor", "manager", "admin"]);
    // ...while the visible option TEXT is the localised role name, never the raw token.
    expect(options.map((o) => o.textContent?.trim())).toEqual(
      ["staff", "supervisor", "manager", "admin"].map((r) => roleName(r, "es-ES")),
    );
    expect(options.find((o) => o.value === "manager")?.textContent).not.toContain("manager");
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
    expect(button.textContent).toContain(t("person.suspend", "es-ES"));
    // The status label shows the localised status name, never the raw token.
    const label = el.shadowRoot!.querySelector(".status-label")!;
    expect(label.textContent).toContain(
      `${t("person.status_label", "es-ES")}: ${statusName("active", "es-ES")}`,
    );
    expect(label.textContent).not.toContain("active");

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
    expect(button.textContent).toContain(t("person.reactivate", "es-ES"));

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

  // Unlike the write-only PIN/password, the email is EXISTING data, so the field is preset to the
  // person's current email (parallel to the role picker's preset) — the operator edits what is there.
  it("presets the email field to the person's current email", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: active,
      open: true,
    });
    const email = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=edit-email]",
    )!;
    expect(email.value).toBe("ada@x.com");
  });

  // A person with no email yet presets the field to an empty string, not "null" — `email` is nullable.
  it("presets the email field to empty when the person has none", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: { ...active, email: null },
      open: true,
    });
    const email = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=edit-email]",
    )!;
    expect(email.value).toBe("");
  });

  it("emits set-email with the entered email on save", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: active,
      open: true,
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-email]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "owner@x.com" } }),
    );
    await el.updateComplete;

    const seen = new Promise<CustomEvent<{ email: string }>>((resolve) =>
      el.addEventListener("set-email", (e) => resolve(e as CustomEvent)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-email]")!.click();
    expect((await seen).detail).toEqual({ email: "owner@x.com" });
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
  // When the dialog closes (Escape, or the screen setting `.open=false` — wt-dialog has no backdrop
  // light-dismiss), both fields reset.
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

  // A native <select> keeps a user's dirty pick even after `selectedRole` reverts, because a
  // `?selected` attribute only seeds `defaultSelected`. So: pick a non-saved role, close (which
  // reverts `selectedRole` to the person's role), reopen the SAME person — the picker must show the
  // person's role again, not the abandoned pick. `updated()` reconciling `.value` is what fixes this;
  // prove by deletion: remove the `updated()` reconcile and this reopens showing "admin".
  it("shows the person's role again after an unsaved pick is reverted on close and reopened", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: active, // role: manager
      open: true,
    });
    const select = () => el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=edit-role]")!;
    select().value = "admin";
    select().dispatchEvent(new Event("change"));
    await el.updateComplete;
    expect(select().value).toBe("admin");

    // Close via the real Escape/programmatic path — the native <dialog> closing fires wt-close.
    const nativeDialog = await openedDialog(el);
    const closed = new Promise<void>((resolve) =>
      el.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    nativeDialog.close();
    await closed;
    await el.updateComplete;

    // Reopen the same person (same personId, so willUpdate's identity guard does NOT re-preset).
    el.open = true;
    await el.updateComplete;
    expect(select().value).toBe("manager");
  });

  // A PIN and a password are secrets; the fields must be masked (type=password), not plaintext — the
  // wt-input default. `wt-input` forwards `type` to its inner <input> (packages/ui wt-input.ts).
  it("masks the pin and password fields", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: active,
      open: true,
    });
    const inner = (test: string) =>
      el
        .shadowRoot!.querySelector(`[data-test=${test}]`)!
        .shadowRoot!.querySelector<HTMLInputElement>("input")!;
    expect(inner("edit-pin").type).toBe("password");
    expect(inner("edit-password").type).toBe("password");
  });

  // The screen passes an edit action's failure down as `error`; it renders in the dialog's own top
  // layer (role="alert"), where the page-level banner behind the backdrop could not be seen.
  it("renders the error inside the dialog when one is set", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: active,
      open: true,
      error: "authorization.not_permitted",
    });
    const alert = el.shadowRoot!.querySelector("[role=alert]");
    // The banner shows LOCALISED copy for the code, never the raw wire code (the code stays in `error`).
    expect(alert?.textContent).toContain(codeMessage("authorization.not_permitted", "es-ES"));
    expect(alert?.textContent).not.toContain("authorization.not_permitted");
  });
});
