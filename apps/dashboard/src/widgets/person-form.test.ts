import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { roleName } from "../i18n/domain.js";
import { t } from "../i18n/t.js";
import { PersonForm } from "./person-form.js";

afterEach(cleanupWidgets);

async function openedDialog(el: PersonForm): Promise<HTMLDialogElement> {
  const dialog = el.shadowRoot!.querySelector("wt-modal")!;
  await dialog.updateComplete;
  return dialog.shadowRoot!.querySelector("dialog")!;
}

function change(el: PersonForm, testId: string, value: string): void {
  el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}

const displayName = (el: PersonForm): string =>
  (el.shadowRoot!.querySelector("[data-test=display-name]") as HTMLElement & { value: string })
    .value;

async function fillRequired(el: PersonForm): Promise<void> {
  change(el, "first-names", "Ada");
  change(el, "last-names", "Lovelace");
  change(el, "display-name", "Ada");
  change(el, "email", "ada@example.com");
  await el.updateComplete;
}

describe("person-form", () => {
  it("stacks contact fields above a divider and the role selector", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await openedDialog(el);
    const fields = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".field")];
    expect(
      fields.map((field) => field.getAttribute("data-test") ?? field.querySelector("select")!.name),
    ).toEqual(["first-names", "last-names", "display-name", "email", "telephone", "role"]);
    for (let i = 1; i < fields.length; i++) {
      expect(fields[i]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        fields[i - 1]!.getBoundingClientRect().bottom,
      );
    }
    const divider = el.shadowRoot!.querySelector("hr")!;
    expect(divider.previousElementSibling!.getAttribute("data-test")).toBe("telephone");
    expect(divider.nextElementSibling!.querySelector("select")!.name).toBe("role");
  });

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

  it("uses both names as the display-name default until that field is edited", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    change(el, "first-names", "Alex Maria");
    change(el, "last-names", "Ramos");
    await el.updateComplete;
    expect(displayName(el)).toBe("Alex Maria Ramos");
    change(el, "display-name", "Lex");
    change(el, "first-names", "Alexandra");
    await el.updateComplete;
    expect(displayName(el)).toBe("Lex");
  });

  it("fills the display name in from both names", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    change(el, "first-names", "Clinton");
    change(el, "last-names", "Gormley");
    await el.updateComplete;
    expect(displayName(el)).toBe("Clinton Gormley");
  });

  it("stops following the names once the display name is edited", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    change(el, "first-names", "Clinton");
    change(el, "display-name", "Clint");
    change(el, "last-names", "Gormley");
    await el.updateComplete;
    expect(displayName(el)).toBe("Clint");
  });

  it("resumes generating the display name once it is cleared again", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    change(el, "first-names", "Alex");
    change(el, "last-names", "Ramos");
    await el.updateComplete;
    expect(displayName(el)).toBe("Alex Ramos");
    // Customise it, then confirm the customised value survives a further name change.
    change(el, "display-name", "Lex");
    change(el, "last-names", "Soler");
    await el.updateComplete;
    expect(displayName(el)).toBe("Lex");
    // Clearing the field puts it back under the names' control — the old edited-flag could not.
    change(el, "display-name", "");
    change(el, "first-names", "Alexandra");
    await el.updateComplete;
    expect(displayName(el)).toBe("Alexandra Soler");
  });

  it("rejects a malformed telephone beside the field and blocks Create, then submits a valid one", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    change(el, "first-names", "Ada");
    change(el, "last-names", "Lovelace");
    change(el, "display-name", "Ada");
    change(el, "email", "ada@example.com");
    change(el, "telephone", "12345"); // 5 digits — below the 6-digit floor
    let created = false;
    el.addEventListener("create-person", () => {
      created = true;
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await el.updateComplete;
    expect(created).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-test=telephone]")!.getAttribute("error")).toBe(
      codeMessage("person.telephone_invalid"),
    );

    change(el, "telephone", "+44 20 7946 0958");
    const event = await new Promise<CustomEvent>((resolve) => {
      el.addEventListener("create-person", (e) => resolve(e as CustomEvent), { once: true });
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    });
    expect(event.detail.telephone).toBe("+44 20 7946 0958");
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

    let closed = false;
    el.addEventListener("wt-close", () => {
      closed = true;
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
    await el.updateComplete;
    expect(closed).toBe(true);
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-test=email]")!.value,
    ).toBe("");
  });
});

describe("person-form validation and keyboard submit", () => {
  it("rejects a malformed email beside the field without emitting create-person", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await fillRequired(el);
    change(el, "email", "ada@example");
    await el.updateComplete;
    let created = false;
    el.addEventListener("create-person", () => {
      created = true;
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await el.updateComplete;
    expect(created).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-test=email]")!.getAttribute("error")).toBe(
      codeMessage("person.email_invalid"),
    );
  });

  it("submits on Enter in a field, sending a blank telephone as null", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await fillRequired(el);
    const events: CustomEvent[] = [];
    el.addEventListener("create-person", (event) => events.push(event as CustomEvent));
    const field = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "[data-test=email]",
    )!;
    await field.updateComplete;
    field.shadowRoot!.querySelector("input")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(events.map((event) => event.detail)).toEqual([
      {
        firstNames: "Ada",
        lastNames: "Lovelace",
        displayName: "Ada",
        email: "ada@example.com",
        telephone: null,
        role: "staff",
      },
    ]);
  });
});
