import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget, formMessageOf } from "./test-helpers.js";
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

async function bottomOf(el: PersonForm): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

const confirmOf = (el: PersonForm): HTMLElement =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!;

async function confirmDisabled(el: PersonForm): Promise<boolean> {
  const button = confirmOf(el) as HTMLElement & { updateComplete: Promise<unknown> };
  await button.updateComplete;
  return button.shadowRoot!.querySelector("button")!.disabled;
}

const fieldError = (el: PersonForm, testId: string): string | null =>
  el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.getAttribute("error");

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
      "admin",
      "staff",
      "manager",
      "supervisor",
    ]);
    expect(options.map((option) => option.textContent?.trim())).toEqual(
      ["admin", "staff", "manager", "supervisor"].map((role) => roleName(role, "es-ES")),
    );
  });

  it("starts a new person as staff even though another role is listed first", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await openedDialog(el);
    const select = el.shadowRoot!.querySelector("select")!;
    expect(select.options[0]!.value).not.toBe("staff");
    expect(select.value).toBe("staff");
    expect(select.selectedOptions[0]!.textContent?.trim()).toBe(roleName("staff", "es-ES"));
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
    expect(displayName(el)).toBe("Alex Ramos");
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
    // Clearing the field puts it back under the names' control.
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

  it("explains every missing required field under it, with one message beside a disabled Create", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await el.updateComplete;
    expect(
      ["first-names", "last-names", "display-name", "email"].map((id) => fieldError(el, id)),
    ).toEqual([
      t("form.first_names_required"),
      t("form.last_names_required"),
      t("form.display_name_required"),
      t("form.email_required"),
    ]);
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);
    expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();
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
      error: "connection.failed",
    });
    await fillRequired(el);
    expect(await bottomOf(el)).toBe(codeMessage("connection.failed"));
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

describe("person-form server refusals", () => {
  it("puts a taken display name beside its field, leaving Create working, until it is edited", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await fillRequired(el);
    el.error = "person.display_name_taken";
    await el.updateComplete;
    const message = codeMessage("person.display_name_taken");
    expect(fieldError(el, "display-name")).toBe(message);
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(await confirmDisabled(el)).toBe(false);

    change(el, "display-name", "Ada L");
    await el.updateComplete;
    expect(fieldError(el, "display-name")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("keeps any other server refusal in the bottom message alone, leaving Create working", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await fillRequired(el);
    el.error = "connection.failed";
    await el.updateComplete;
    expect(fieldError(el, "display-name")).toBe("");
    expect(await bottomOf(el)).toBe(codeMessage("connection.failed"));
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
  });

  it.each([
    ["person.email_taken", "email"],
    ["person.email_invalid", "email"],
    ["person.telephone_invalid", "telephone"],
  ])(
    "puts %s under the %s field, leaving Create working, until it is edited",
    async (code, testId) => {
      const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
      await fillRequired(el);
      change(el, "telephone", "12");
      await el.updateComplete;
      el.error = code;
      await el.updateComplete;
      expect(fieldError(el, testId)).toBe(codeMessage(code));
      expect(await bottomOf(el)).toBe(t("form.fix_fields"));
      expect(await confirmDisabled(el)).toBe(false);

      change(el, testId, testId === "email" ? "ada.l@example.com" : "");
      await el.updateComplete;
      expect(fieldError(el, testId)).toBe("");
      expect(await bottomOf(el)).toBe("");
      expect(await confirmDisabled(el)).toBe(false);
    },
  );

  it("puts a refusal whose params name a shown field under that field, leaving Create working", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await fillRequired(el);
    el.errorField = "lastNames";
    el.error = "profile.invalid";
    await el.updateComplete;
    expect(fieldError(el, "last-names")).toBe(codeMessage("profile.invalid"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(await confirmDisabled(el)).toBe(false);
  });

  it("keeps a refusal whose params name no single shown field in the bottom message", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await fillRequired(el);
    el.errorField = "displayName|firstNames|lastNames|role|telephone";
    el.error = "management.request_invalid";
    await el.updateComplete;
    for (const testId of ["first-names", "last-names", "display-name", "email", "telephone"]) {
      expect(fieldError(el, testId)).toBe("");
    }
    expect(await bottomOf(el)).toBe(codeMessage("management.request_invalid"));
    expect(await confirmDisabled(el)).toBe(false);
  });

  it("focuses the email field when a refusal naming it arrives", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await fillRequired(el);
    el.error = "person.email_taken";
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    const field = el.shadowRoot!.querySelector("[data-test=email]")!;
    expect(field.shadowRoot!.activeElement).toBe(field.shadowRoot!.querySelector("input"));
  });

  it("keeps a taken display name beside its field when another field fails its check", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await fillRequired(el);
    el.error = "person.display_name_taken";
    await el.updateComplete;
    let created = false;
    el.addEventListener("create-person", () => {
      created = true;
    });
    change(el, "email", "");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await el.updateComplete;
    const message = codeMessage("person.display_name_taken");
    expect(created).toBe(false);
    expect(fieldError(el, "display-name")).toBe(message);
    expect(fieldError(el, "email")).toBe(t("form.email_required"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  });

  it("still sends an Add whose own checks pass, for the server to judge the name again", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await fillRequired(el);
    el.error = "person.display_name_taken";
    await el.updateComplete;
    const created = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("create-person", (event) => resolve(event as CustomEvent), {
        once: true,
      }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    expect((await created).detail.displayName).toBe("Ada");
  });

  it("clears a taken display name when a name change regenerates it", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    change(el, "first-names", "Ada");
    change(el, "last-names", "Lovelace");
    change(el, "email", "ada@example.com");
    await el.updateComplete;
    el.error = "person.display_name_taken";
    await el.updateComplete;
    change(el, "last-names", "Byron");
    await el.updateComplete;
    expect(displayName(el)).toBe("Ada Byron");
    expect(fieldError(el, "display-name")).toBe("");
    expect(await bottomOf(el)).toBe("");
  });

  it("keeps a taken display name when a name change leaves a customised one alone", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await fillRequired(el);
    el.error = "person.display_name_taken";
    await el.updateComplete;
    change(el, "last-names", "Byron");
    await el.updateComplete;
    const message = codeMessage("person.display_name_taken");
    expect(displayName(el)).toBe("Ada");
    expect(fieldError(el, "display-name")).toBe(message);
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  });
});

describe("person-form validation and keyboard submit", () => {
  it("says nothing about errors before the first submission, and Create works", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    change(el, "email", "ada@");
    await el.updateComplete;

    expect(fieldError(el, "email")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("on an invalid submission focuses the first invalid field and keeps what was typed", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    change(el, "first-names", "Ada");
    await el.updateComplete;
    confirmOf(el).click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    const lastNames = el.shadowRoot!.querySelector("[data-test=last-names]")!;
    expect(lastNames.shadowRoot!.activeElement).toBe(lastNames.shadowRoot!.querySelector("input"));
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-test=first-names]")!
        .value,
    ).toBe("Ada");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);
  });

  it("re-checks every change after a failed submission, and Create works again once all are fixed", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    change(el, "first-names", "Ada");
    change(el, "last-names", "Lovelace");
    change(el, "display-name", "Ada");
    await el.updateComplete;
    confirmOf(el).click();
    await el.updateComplete;
    expect(fieldError(el, "email")).toBe(t("form.email_required"));

    change(el, "email", "ada@example");
    await el.updateComplete;
    expect(fieldError(el, "email")).toBe(codeMessage("person.email_invalid"));
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);

    change(el, "email", "ada@example.com");
    await el.updateComplete;
    expect(fieldError(el, "email")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);

    change(el, "first-names", "");
    await el.updateComplete;
    expect(fieldError(el, "first-names")).toBe(t("form.first_names_required"));
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);
  });

  it("focuses the display name when a refusal naming it arrives", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    await fillRequired(el);
    el.error = "person.display_name_taken";
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    const field = el.shadowRoot!.querySelector("[data-test=display-name]")!;
    expect(field.shadowRoot!.activeElement).toBe(field.shadowRoot!.querySelector("input"));
  });

  it("drops a refusal that names no field when the form is submitted again", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", {
      open: true,
      error: "connection.failed",
    });
    expect(await bottomOf(el)).toBe(codeMessage("connection.failed"));

    confirmOf(el).click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  });

  it("shows a refusal and the generic sentence together when both apply", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    confirmOf(el).click();
    await el.updateComplete;
    el.error = "server.internal";
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(`${codeMessage("server.internal")} ${t("form.fix_fields")}`);
  });

  it("starts again when reopened: no messages and Create working", async () => {
    const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
    confirmOf(el).click();
    await el.updateComplete;
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;

    expect(fieldError(el, "first-names")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
  });

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
