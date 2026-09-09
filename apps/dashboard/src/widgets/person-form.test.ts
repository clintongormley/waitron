import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { roleName } from "../i18n/domain.js";
import { t } from "../i18n/t.js";
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

async function fillRequired(el: PersonForm): Promise<void> {
  for (const [testId, value] of [
    ["display-name", "Ada"],
    ["pin", "1234"],
    ["email", "ada@x.com"],
  ] as const) {
    el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value } }),
    );
  }
  await el.updateComplete;
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

  // The role picker must DISPLAY `selectedRole` even when it is not the first option. Today the create
  // form only ever presets "staff" (the first option), so a `.value` bound in the template renders
  // right by luck; this seeds a non-first role BEFORE the first render (as a future "duplicate person"
  // flow would) to prove the live <select> value tracks state regardless of option order. `manager` is
  // the third of the four options, so this fails if the picker is driven by a `.value` property bound
  // before its <option> children exist. Reconciling `.value` in `updated()` (after the options render)
  // is the fix, mirroring the edit dialog. Prove-by-deletion: remove the `updated()` reconcile and the
  // picker shows "staff".
  it("presets the role picker to a non-first role, not the first option", async () => {
    // mountWidget assigns props before the first render; `selectedRole` is private @state, so cast to
    // reach it — the same escape hatch the login-screen suite uses for `selected`/`roster`.
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", {
      open: true,
      selectedRole: "manager",
    } as unknown as Partial<PersonForm>);
    expect(el.shadowRoot!.querySelector("select")!.value).toBe("manager");
  });

  // Drives all three field handlers through the DOM (the wt-inputs' composed `wt-change`, the native
  // `<select>`'s `change`) and asserts the confirm control emits their captured values.
  it("emits create-person with the entered values on confirm", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    const displayName = el.shadowRoot!.querySelector<HTMLElement>("[data-test=display-name]")!;
    const pin = el.shadowRoot!.querySelector<HTMLElement>("[data-test=pin]")!;
    const email = el.shadowRoot!.querySelector<HTMLElement>("[data-test=email]")!;
    const select = el.shadowRoot!.querySelector("select")!;

    displayName.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Ada" } }));
    pin.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "1234" } }));
    email.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "ada@x.com" } }));
    select.value = "manager";
    select.dispatchEvent(new Event("change"));
    await el.updateComplete;

    const created = new Promise<CustomEvent<{ displayName: string; role: string; pin: string }>>(
      (resolve) => el.addEventListener("create-person", (e) => resolve(e as CustomEvent)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    const event = await created;
    expect(event.detail).toEqual({
      displayName: "Ada",
      role: "manager",
      pin: "1234",
      email: "ada@x.com",
    });
  });

  // The dashboard sign-in email is carried on create-person alongside the other fields. Typed into
  // the `wt-input[type=email]` (its composed `wt-change`), it must reach the emitted detail so the
  // staff screen can forward it to `createPerson`.
  it("carries the typed email on create-person", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=display-name]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Owner" } }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=pin]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "1234" } }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=email]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "owner@x.com" } }),
    );
    await el.updateComplete;

    const created = new Promise<CustomEvent<{ email?: string }>>((resolve) =>
      el.addEventListener("create-person", (e) => resolve(e as CustomEvent)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    expect((await created).detail).toMatchObject({
      displayName: "Owner",
      pin: "1234",
      email: "owner@x.com",
    });
  });

  it("keeps create available so an empty submission can explain every missing field", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    const confirm = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=confirm]",
    )!;
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await el.updateComplete;
    const summary = el.shadowRoot!.querySelector("wt-form-error-summary")!;
    expect(summary.shadowRoot!.querySelector("[data-heading]")?.textContent).toBe(
      t("form.error_heading"),
    );
    expect(summary.shadowRoot!.querySelectorAll("li")).toHaveLength(3);
    expect(
      [...el.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-input")].map(
        (field) => field.error,
      ),
    ).toEqual([t("form.name_required"), t("form.pin_required"), t("form.email_required")]);
  });

  it("gives fields semantic names and marks every required value", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    const fields = [...el.shadowRoot!.querySelectorAll("wt-input")].map((field) => {
      const input = field.shadowRoot!.querySelector("input")!;
      return { name: input.name, required: input.required };
    });
    expect(fields).toEqual([
      { name: "name", required: true },
      { name: "pin", required: true },
      { name: "email", required: true },
    ]);
    expect(el.shadowRoot!.querySelector("select")!.name).toBe("role");
  });

  it("shows explanatory errors for a short PIN and malformed email", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    for (const [testId, value] of [
      ["display-name", "Ada"],
      ["pin", "12"],
      ["email", "not-an-email"],
    ] as const) {
      el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value } }),
      );
    }
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await el.updateComplete;
    expect(
      (el.shadowRoot!.querySelector("[data-test=pin]") as HTMLElement & { error: string }).error,
    ).toBe(codeMessage("pin.too_short"));
    expect(
      (el.shadowRoot!.querySelector("[data-test=email]") as HTMLElement & { error: string }).error,
    ).toBe(codeMessage("person.email_invalid"));
  });

  it("puts Cancel on the left, Create on the right, and offers contextual email help", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
    expect(actions.querySelector('[slot="cancel"]')?.getAttribute("data-test")).toBe("cancel");
    expect(actions.querySelector("wt-button:not([slot])")?.getAttribute("data-test")).toBe(
      "confirm",
    );
    expect(
      el.shadowRoot!.querySelector("[data-test=email] wt-help-tooltip")?.textContent?.trim(),
    ).toBe(t("person.email_help"));
  });

  // A padded real address is emitted TRIMMED, so surrounding spaces never reach the server's own
  // trim+validate as a distinct (still valid, but noisy) value. (Copilot, PR #172.)
  it("emits a padded email trimmed on create-person", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await fillRequired(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=email]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "  owner@x.com  " } }),
    );
    await el.updateComplete;
    const created = new Promise<CustomEvent<{ email?: string }>>((resolve) =>
      el.addEventListener("create-person", (e) => resolve(e as CustomEvent)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    expect((await created).detail.email).toBe("owner@x.com");
  });

  // The email field is a `type=email` input so mobile keyboards and browser validation treat it as an
  // address. `wt-input` forwards `type` to its inner <input> (packages/ui wt-input.ts).
  it("renders the email field as a type=email input", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    const inner = el
      .shadowRoot!.querySelector("[data-test=email]")!
      .shadowRoot!.querySelector<HTMLInputElement>("input")!;
    expect(inner.type).toBe("email");
  });

  // create-person must escape this widget's shadow boundary to reach the app shell (a later task),
  // so it is dispatched bubbles+composed — asserted so a future edit does not quietly drop either.
  it("emits create-person as a bubbling, composed event", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await fillRequired(el);
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
    await fillRequired(el);
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

  it("keeps the person dialog open when Escape only dismisses its help tooltip", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    const nativeDialog = await openedDialog(el);
    const tooltip = el.shadowRoot!.querySelector("wt-help-tooltip")!;
    const button = tooltip.shadowRoot!.querySelector("button")!;
    button.click();
    await (tooltip as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    expect(tooltip.shadowRoot!.querySelector("[role=tooltip]")).not.toBeNull();

    button.focus();
    await userEvent.keyboard("{Escape}");
    await (tooltip as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(tooltip.shadowRoot!.querySelector("[role=tooltip]")).toBeNull();
    expect(nativeDialog.open).toBe(true);
    expect(el.open).toBe(true);
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
    const email = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=email]",
    )!;
    const select = el.shadowRoot!.querySelector("select")!;

    displayName.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Ada" } }));
    pin.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "1234" } }));
    email.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "ada@x.com" } }));
    select.value = "manager";
    select.dispatchEvent(new Event("change"));
    await el.updateComplete;
    // Sanity: the fields hold the entered values before the close.
    expect(displayName.value).toBe("Ada");
    expect(pin.value).toBe("1234");
    expect(email.value).toBe("ada@x.com");
    expect(select.value).toBe("manager");

    const closed = new Promise<void>((resolve) =>
      el.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    nativeDialog.close();
    await closed;
    await el.updateComplete;

    expect(displayName.value).toBe("");
    expect(pin.value).toBe("");
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-test=email]")!.value,
    ).toBe("");
    expect(el.shadowRoot!.querySelector("select")!.value).toBe("staff");
  });

  // The screen passes a rejected create's failure down as `error`; it renders in the dialog's own top
  // layer (role="alert"), where the page-level banner behind the backdrop could not be seen.
  it("renders the error inside the dialog when one is set", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", {
      open: true,
      error: "pin.too_short",
    });
    const alert = el
      .shadowRoot!.querySelector("wt-form-error-summary")!
      .shadowRoot!.querySelector("[role=alert]");
    // The banner shows LOCALISED copy for the code, never the raw wire code (the code stays in `error`).
    expect(alert?.textContent).toContain(codeMessage("pin.too_short", "es-ES"));
    expect(alert?.textContent).not.toContain("pin.too_short");
  });
});
