import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { roleName } from "../i18n/domain.js";
import { t } from "../i18n/t.js";
import { PersonForm } from "./person-form.js";

afterEach(cleanupWidgets);

async function openedDialog(el: PersonForm): Promise<HTMLDialogElement> {
  const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await dialog.updateComplete;
  return dialog.shadowRoot!.querySelector("dialog")!;
}

function change(el: PersonForm, testId: string, value: string): void {
  el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}

async function fillRequired(el: PersonForm): Promise<void> {
  change(el, "first-names", "Ada");
  change(el, "last-names", "Lovelace");
  change(el, "display-name", "Ada");
  change(el, "email", "ada@example.com");
  await el.updateComplete;
}

describe("person-form", () => {
  it("opens only when requested and offers every role", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", {});
    expect((await openedDialog(el)).open).toBe(false);
    el.open = true;
    await el.updateComplete;
    expect((await openedDialog(el)).open).toBe(true);
    const options = [...el.shadowRoot!.querySelectorAll("option")];
    expect(options.map((option) => option.value)).toEqual([
      "staff",
      "supervisor",
      "manager",
      "admin",
    ]);
    expect(options.map((option) => option.textContent?.trim())).toEqual(
      ["staff", "supervisor", "manager", "admin"].map((role) => roleName(role, "es-ES")),
    );
  });

  it("emits trimmed account details without asking the administrator for a PIN", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    change(el, "first-names", "  Ada Augusta ");
    change(el, "last-names", " Lovelace ");
    change(el, "display-name", " Ada ");
    change(el, "email", " ADA@example.com ");
    change(el, "telephone", " +44 20 1234 ");
    const select = el.shadowRoot!.querySelector("select")!;
    select.value = "manager";
    select.dispatchEvent(new Event("change"));
    await el.updateComplete;

    const created = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("create-person", (event) => resolve(event as CustomEvent), {
        once: true,
      }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    const event = await created;
    expect(event.detail).toEqual({
      firstNames: "Ada Augusta",
      lastNames: "Lovelace",
      displayName: "Ada",
      email: "ADA@example.com",
      telephone: "+44 20 1234",
      role: "manager",
    });
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
    expect(el.shadowRoot!.querySelector('[name="pin"]')).toBeNull();
  });

  it("uses first names as the display-name default until that field is edited", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    change(el, "first-names", "Alex Maria");
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-test=display-name]")!
        .value,
    ).toBe("Alex Maria");
    change(el, "display-name", "Lex");
    change(el, "first-names", "Alexandra");
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-test=display-name]")!
        .value,
    ).toBe("Lex");
  });

  it("explains every missing required field in one form summary", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await el.updateComplete;
    const summary = el.shadowRoot!.querySelector("wt-form-error-summary")!;
    expect(summary.shadowRoot!.querySelector("[data-heading]")?.textContent).toBe(
      t("form.error_heading"),
    );
    expect(summary.shadowRoot!.querySelectorAll("li")).toHaveLength(4);
  });

  it("gives every field a semantic name and marks telephone optional", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    const fields = [...el.shadowRoot!.querySelectorAll("wt-input")].map((field) => {
      const input = field.shadowRoot!.querySelector("input")!;
      return { name: input.name, required: input.required, autocomplete: input.autocomplete };
    });
    expect(fields).toEqual([
      { name: "given-name", required: true, autocomplete: "given-name" },
      { name: "family-name", required: true, autocomplete: "family-name" },
      { name: "nickname", required: true, autocomplete: "nickname" },
      { name: "email", required: true, autocomplete: "email" },
      { name: "tel", required: false, autocomplete: "tel" },
    ]);
  });

  it("keeps entered values on a server error and clears them after Cancel", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", {
      open: true,
      error: "person.email_taken",
    });
    await fillRequired(el);
    expect(
      el.shadowRoot!.querySelector("wt-form-error-summary")!.shadowRoot!.textContent,
    ).toContain("correo");
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-test=email]")!.value,
    ).toBe("ada@example.com");

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
    await el.updateComplete;
    const closed = new Promise<void>((resolve) => el.addEventListener("wt-close", () => resolve()));
    await (await openedDialog(el)).close();
    await closed;
    el.open = true;
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-test=email]")!.value,
    ).toBe("");
  });
});
