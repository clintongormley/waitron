import { useLocale } from "../testing/locale-setup.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardApi, type PersonSummary } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { chooseOption, chooseOptions, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { statusName } from "../i18n/domain.js";
import { setLocale, t } from "../i18n/t.js";
import { PersonEdit } from "./person-edit.js";

useLocale("es-ES");

afterEach(() => {
  cleanupWidgets();
});

const person: PersonSummary = {
  personId: "p1",
  displayName: "Ada",
  firstNames: "Ada Augusta",
  lastNames: "Lovelace",
  telephone: "+44 20",
  roleIds: ["manager"],
  status: "active",
  hasPassword: true,
  hasTotp: false,
  email: "ada@example.com",
};

function change(el: PersonEdit, testId: string, value: string): void {
  el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}

async function edited(el: PersonEdit): Promise<void> {
  change(el, "edit-first-names", "Augusta");
  await el.updateComplete;
}

async function bottomOf(el: PersonEdit): Promise<string> {
  const actions = el.shadowRoot!.querySelector('wt-form-actions[slot="footer"]')!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

const saveOf = (el: PersonEdit): HTMLElement =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!;

async function saveDisabled(el: PersonEdit): Promise<boolean> {
  const button = saveOf(el) as HTMLElement & { updateComplete: Promise<unknown> };
  await button.updateComplete;
  return button.shadowRoot!.querySelector("button")!.disabled;
}

type Box = HTMLElement & {
  value: string;
  label: string;
  required: boolean;
  disabled: boolean;
  search: string;
  options: { value: string; label: string }[];
  updateComplete: Promise<unknown>;
};

const box = (el: PersonEdit, name: "status"): Box =>
  el.shadowRoot!.querySelector<Box>(`wt-combobox[name="${name}"]`)!;

/** What the closed dropdown shows on its trigger, not what its properties say it holds. */
async function shown(el: PersonEdit, name: "status"): Promise<string | undefined> {
  const found = box(el, name);
  await found.updateComplete;
  return found.shadowRoot!.querySelector(".trigger .value")?.textContent?.trim();
}

describe("person-edit", () => {
  it("picks the status from a required shared dropdown showing the person's own", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      person,
      open: true,
    });
    const status = box(el, "status");
    expect(status.label).toBe(t("person.status_label", "es-ES"));
    expect(status.required).toBe(true);
    expect(status.search).toBe("auto");
    expect(status.options).toEqual([
      { value: "active", label: statusName("active", "es-ES") },
      { value: "suspended", label: statusName("suspended", "es-ES") },
    ]);
    expect(status.value).toBe("active");
    expect(await shown(el, "status")).toBe(statusName("active", "es-ES"));
    change(el, "edit-telephone", "+44 20 7946 0958");
    await chooseOption(status, "suspended");
    await el.updateComplete;
    const saved = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("save-person", (event) => resolve(event as CustomEvent), { once: true }),
    );
    saveOf(el).click();
    expect((await saved).detail.status).toBe("suspended");
  });

  it("locks the status dropdown when the person is the one signed in", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      currentPersonId: person.personId,
      open: true,
    });
    expect(box(el, "status").disabled).toBe(true);
  });

  it("uses the shared modal with one field per row, the same field-list shape as the profile screen's own edit form", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    const modal = el.shadowRoot!.querySelector("wt-modal");
    expect(modal).not.toBeNull();
    await modal!.updateComplete;
    // One shared grid gap, not a per-field margin — so every row (wt-input as well as the
    // status dropdown) stacks without overlapping.
    const rows = [...el.shadowRoot!.querySelector(".fields")!.children] as HTMLElement[];
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        rows[i - 1]!.getBoundingClientRect().bottom,
      );
    }
    for (const name of ["status"] as const) {
      const select = box(el, name);
      await select.updateComplete;
      expect(select.required).toBe(true);
      expect(select.shadowRoot!.querySelector("[data-required]")!.textContent).toContain("*");
    }
    // No <hr> divider ahead of status — one continuous field list instead.
    expect(el.shadowRoot!.querySelector("hr")).toBeNull();
  });

  it("presents one populated form and emits the full edit through one Save", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    expect(box(el, "status").value).toBe("active");
    expect(await shown(el, "status")).toBe(statusName("active", "es-ES"));
    expect(box(el, "status").options.map((option) => option.value)).toEqual([
      "active",
      "suspended",
    ]);
    change(el, "edit-first-names", "Ada Augusta Byron");
    change(el, "edit-telephone", "+44 20 7946 0958");
    await chooseOption(box(el, "status"), "suspended");
    await el.updateComplete;
    const saved = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("save-person", (event) => resolve(event as CustomEvent), { once: true }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    expect((await saved).detail).toEqual({
      displayName: "Ada",
      firstNames: "Ada Augusta Byron",
      lastNames: "Lovelace",
      telephone: "+44 20 7946 0958",
      email: "ada@example.com",
      status: "suspended",
    });
  });

  it("regenerates the display name from the names, keeps a customised one, and resumes once cleared", async () => {
    // A person whose display name still equals first+last, so editing a name regenerates it.
    const generated: PersonSummary = {
      ...person,
      displayName: "Ada Lovelace",
      firstNames: "Ada",
      lastNames: "Lovelace",
    };
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person: generated,
      open: true,
    });
    const displayValue = (): string =>
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
        "[data-test=edit-display-name]",
      )!.value;
    change(el, "edit-last-names", "Byron");
    await el.updateComplete;
    expect(displayValue()).toBe("Ada Byron");
    // Customise it: a later name change must leave the customised value alone.
    change(el, "edit-display-name", "Chef Ada");
    change(el, "edit-first-names", "Augusta");
    await el.updateComplete;
    expect(displayValue()).toBe("Chef Ada");
    // Clear it: generation resumes.
    change(el, "edit-display-name", "");
    change(el, "edit-last-names", "Lovelace");
    await el.updateComplete;
    expect(displayValue()).toBe("Augusta Lovelace");
  });

  it("rejects a malformed telephone beside the field and blocks Save, then saves a valid or blank one", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    change(el, "edit-telephone", "12345"); // 5 digits — below the 6-digit floor
    let saved = false;
    el.addEventListener("save-person", () => {
      saved = true;
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await el.updateComplete;
    expect(saved).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-test=edit-telephone]")!.getAttribute("error")).toBe(
      codeMessage("person.telephone_invalid"),
    );

    change(el, "edit-telephone", ""); // blank is allowed — telephone is optional
    const savedEvent = await new Promise<CustomEvent>((resolve) => {
      el.addEventListener("save-person", (event) => resolve(event as CustomEvent), { once: true });
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    });
    expect(savedEvent.detail.telephone).toBeNull();
  });

  it("resends a pending invitation without a confirmation step — it isn't destructive", async () => {
    const pending = { ...person, status: "pending" as const };
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person: pending,
      open: true,
    });
    const events: Event[] = [];
    el.addEventListener("resend-invitation", (event) => events.push(event), { once: true });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=resend-invitation]")!.click();
    expect(events).toHaveLength(1);
    expect(events[0]!.bubbles).toBe(true);
    expect(events[0]!.composed).toBe(true);
  });

  it("hides Resend invitation once the account is no longer pending", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    expect(el.shadowRoot!.querySelector("[data-test=resend-invitation]")).toBeNull();
  });

  it("no longer offers reset login/PIN or deactivate/reactivate from the form — those live on the row's kebab menu now", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    for (const testId of ["reset-login", "reset-pin", "mark-inactive", "reactivate"]) {
      expect(el.shadowRoot!.querySelector(`[data-test=${testId}]`)).toBeNull();
    }
  });

  it("keeps inactive users' status dropdown constrained to suspended while editing", async () => {
    const inactive = { ...person, status: "suspended" as const };
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person: inactive,
      open: true,
    });
    const status = box(el, "status");
    expect(status.options.map((option) => option.value)).toEqual(["suspended"]);
  });

  it("Cancel discards edits and secret actions never retain an entered credential", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    change(el, "edit-display-name", "Unsaved");
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
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
        "[data-test=edit-display-name]",
      )!.value,
    ).toBe("Ada");
  });
});

describe("person-edit server refusals", () => {
  const fieldError = (el: PersonEdit, testId: string): string | null =>
    el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.getAttribute("error");

  it("puts a taken display name beside its field, leaving Save working, until it is edited", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    await edited(el);
    el.error = "person.display_name_taken";
    await el.updateComplete;
    const message = codeMessage("person.display_name_taken");
    expect(fieldError(el, "edit-display-name")).toBe(message);
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(await saveDisabled(el)).toBe(false);

    change(el, "edit-display-name", "Ada L");
    await el.updateComplete;
    expect(fieldError(el, "edit-display-name")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(saveOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("keeps any other server refusal in the bottom message alone, leaving Save working", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    await edited(el);
    el.error = "connection.failed";
    await el.updateComplete;
    expect(fieldError(el, "edit-display-name")).toBe("");
    expect(await bottomOf(el)).toBe(codeMessage("connection.failed"));
    expect(saveOf(el).hasAttribute("disabled")).toBe(false);
  });

  it.each([
    ["person.email_taken", "edit-email", "ada.l@example.com"],
    ["person.email_invalid", "edit-email", "ada.l@example.com"],
    ["person.telephone_invalid", "edit-telephone", ""],
  ])("puts %s under %s, leaving Save working, until it is edited", async (code, testId, fixed) => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    await edited(el);
    el.error = code;
    await el.updateComplete;
    expect(fieldError(el, testId)).toBe(codeMessage(code));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(await saveDisabled(el)).toBe(false);

    change(el, testId, fixed);
    await el.updateComplete;
    expect(fieldError(el, testId)).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(await saveDisabled(el)).toBe(false);
  });

  it("puts a refusal whose params name a shown field under that field, leaving Save working", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    await edited(el);
    el.errorField = "email";
    el.error = "management.request_invalid";
    await el.updateComplete;
    expect(fieldError(el, "edit-email")).toBe(codeMessage("management.request_invalid"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(await saveDisabled(el)).toBe(false);
  });

  it("keeps a refusal whose params name a field the form does not show in the bottom message", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    await edited(el);
    el.errorField = "role";
    el.error = "management.request_invalid";
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(codeMessage("management.request_invalid"));
    expect(await saveDisabled(el)).toBe(false);
  });

  it("focuses the email field when a refusal naming it arrives", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    el.error = "person.email_taken";
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    const field = el.shadowRoot!.querySelector("[data-test=edit-email]")!;
    expect(field.shadowRoot!.activeElement).toBe(field.shadowRoot!.querySelector("input"));
  });

  const displayName = (el: PersonEdit): string =>
    (
      el.shadowRoot!.querySelector("[data-test=edit-display-name]") as HTMLElement & {
        value: string;
      }
    ).value;

  it("keeps a taken display name beside its field when another field fails its check", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    el.error = "person.display_name_taken";
    await el.updateComplete;
    let saved = false;
    el.addEventListener("save-person", () => {
      saved = true;
    });
    change(el, "edit-telephone", "+44 20 7946 0958");
    change(el, "edit-last-names", "");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await el.updateComplete;
    const message = codeMessage("person.display_name_taken");
    expect(saved).toBe(false);
    expect(fieldError(el, "edit-display-name")).toBe(message);
    expect(fieldError(el, "edit-last-names")).toBe(t("form.last_names_required"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  });

  it("still sends a Save whose own checks pass, for the server to judge the name again", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    change(el, "edit-telephone", "+44 20 7946 0958");
    el.error = "person.display_name_taken";
    await el.updateComplete;
    const saved = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("save-person", (event) => resolve(event as CustomEvent), { once: true }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    expect((await saved).detail.displayName).toBe("Ada");
  });

  it("clears a taken display name when a name change regenerates it", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person: { ...person, displayName: "Ada Lovelace" },
      open: true,
    });
    el.error = "person.display_name_taken";
    await el.updateComplete;
    change(el, "edit-last-names", "Byron");
    await el.updateComplete;
    expect(displayName(el)).toBe("Ada Byron");
    expect(fieldError(el, "edit-display-name")).toBe("");
    expect(await bottomOf(el)).toBe("");
  });

  it("keeps a taken display name when a name change leaves a customised one alone", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    el.error = "person.display_name_taken";
    await el.updateComplete;
    change(el, "edit-last-names", "Byron");
    await el.updateComplete;
    const message = codeMessage("person.display_name_taken");
    expect(displayName(el)).toBe("Ada");
    expect(fieldError(el, "edit-display-name")).toBe(message);
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  });
});

describe("person-edit validation and keyboard submit", () => {
  const fieldError = (el: PersonEdit, testId: string): string | null =>
    el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.getAttribute("error");

  it("says nothing about errors before the first submission, and Save works", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    change(el, "edit-first-names", "");
    await el.updateComplete;

    expect(fieldError(el, "edit-first-names")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(saveOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("on an invalid submission shows one message at the bottom of the form, disables Save and focuses the first invalid field", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    change(el, "edit-last-names", "");
    change(el, "edit-email", "ada@");
    await el.updateComplete;
    saveOf(el).click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(saveOf(el).hasAttribute("disabled")).toBe(true);
    const lastNames = el.shadowRoot!.querySelector("[data-test=edit-last-names]")!;
    expect(lastNames.shadowRoot!.activeElement).toBe(lastNames.shadowRoot!.querySelector("input"));
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-test=edit-email]")!
        .value,
    ).toBe("ada@");
  });

  it("re-checks every change after a failed submission, and Save works again once all are fixed", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    change(el, "edit-telephone", "+44 20 7946 0958");
    change(el, "edit-email", "");
    await el.updateComplete;
    saveOf(el).click();
    await el.updateComplete;

    change(el, "edit-email", "ada@example");
    await el.updateComplete;
    expect(fieldError(el, "edit-email")).toBe(codeMessage("person.email_invalid"));
    expect(saveOf(el).hasAttribute("disabled")).toBe(true);

    change(el, "edit-email", "ada@example.com");
    await el.updateComplete;
    expect(fieldError(el, "edit-email")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(saveOf(el).hasAttribute("disabled")).toBe(false);

    change(el, "edit-email", " ");
    await el.updateComplete;
    expect(fieldError(el, "edit-email")).toBe(t("form.email_required"));
    expect(saveOf(el).hasAttribute("disabled")).toBe(true);
  });

  it("focuses the display name when a refusal naming it arrives", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    el.error = "person.display_name_taken";
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    const field = el.shadowRoot!.querySelector("[data-test=edit-display-name]")!;
    expect(field.shadowRoot!.activeElement).toBe(field.shadowRoot!.querySelector("input"));
  });

  it("drops a refusal that names no field when the form is submitted again", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
      error: "connection.failed",
    });
    expect(await bottomOf(el)).toBe(codeMessage("connection.failed"));

    change(el, "edit-first-names", "");
    await el.updateComplete;
    saveOf(el).click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  });

  it("shows a refusal and the generic sentence together when both apply", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    change(el, "edit-first-names", "");
    await el.updateComplete;
    saveOf(el).click();
    await el.updateComplete;
    el.error = "server.internal";
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(`${codeMessage("server.internal")} ${t("form.fix_fields")}`);
  });

  it("starts again when reopened: no messages, Save quiet until an edit and then working", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    change(el, "edit-first-names", "");
    await el.updateComplete;
    saveOf(el).click();
    await el.updateComplete;
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;

    expect(fieldError(el, "edit-first-names")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(saveOf(el).hasAttribute("disabled")).toBe(true);
    change(el, "edit-first-names", "Ada");
    await el.updateComplete;
    expect(saveOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("names every blank required field under its own message and does not save", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    change(el, "edit-first-names", " ");
    change(el, "edit-last-names", "");
    change(el, "edit-display-name", "");
    change(el, "edit-email", "  ");
    await el.updateComplete;
    let saved = false;
    el.addEventListener("save-person", () => {
      saved = true;
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await el.updateComplete;
    expect(saved).toBe(false);
    const error = (testId: string) =>
      el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.getAttribute("error");
    expect(error("edit-first-names")).toBe(t("form.first_names_required"));
    expect(error("edit-last-names")).toBe(t("form.last_names_required"));
    expect(error("edit-display-name")).toBe(t("form.display_name_required"));
    expect(error("edit-email")).toBe(t("form.email_required"));
  });

  it("rejects a malformed email beside the field and does not save", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    change(el, "edit-email", "ada at example.com");
    await el.updateComplete;
    let saved = false;
    el.addEventListener("save-person", () => {
      saved = true;
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await el.updateComplete;
    expect(saved).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-test=edit-email]")!.getAttribute("error")).toBe(
      codeMessage("person.email_invalid"),
    );
  });

  it("saves on Enter in a field", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      canAdminister: true,
      canChangeEmail: true,
      person,
      open: true,
    });
    change(el, "edit-telephone", "+34 600 000 000");
    await el.updateComplete;
    const events: CustomEvent[] = [];
    el.addEventListener("save-person", (event) => events.push(event as CustomEvent));
    const field = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "[data-test=edit-email]",
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
        displayName: "Ada",
        firstNames: "Ada Augusta",
        lastNames: "Lovelace",
        telephone: "+34 600 000 000",
        email: "ada@example.com",
        status: "active",
      },
    ]);
  });
});

describe("job roles on the person editor", () => {
  const roles = [
    {
      id: "waiter",
      name: "Waiter",
      colour: "blue",
      position: 0,
      holderIds: ["p1"],
      holderNames: ["Ada"],
    },
    { id: "chef", name: "Chef", colour: "red", position: 1, holderIds: [], holderNames: [] },
  ];
  it("saves job roles with the set it read, independently of the person's details", async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const api = new DashboardApi("", async (path, init) => {
      calls.push({ path: String(path), init: init! });
      return new Response(
        JSON.stringify(init?.method === "PUT" ? { staffRoleIds: ["chef"] } : { staffRoles: roles }),
        { headers: { "content-type": "application/json" } },
      );
    });
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person,
      open: true,
      api,
      canManageSchedule: true,
    });
    const field = () =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
        'wt-combobox[name="jobRoles"]',
      )!;
    await vi.waitFor(() => expect(field()).not.toBeNull());
    await vi.waitFor(() => expect(field().values).toEqual(["waiter"]));
    await chooseOptions(field(), ["chef"]);
    await el.updateComplete;
    const saveDetails = vi.fn();
    el.addEventListener("save-person", saveDetails);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-job-roles"]')!.click();
    await vi.waitFor(() => expect(calls.filter((c) => c.init.method === "PUT")).toHaveLength(1));
    const put = calls.find((c) => c.init.method === "PUT")!;
    expect(put.path).toBe("/management-api/staffing/people/p1/staff-roles");
    expect(JSON.parse(String(put.init.body))).toEqual({
      staffRoleIds: ["chef"],
      expectedStaffRoleIds: ["waiter"],
    });
    expect(saveDetails).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
          '[data-test="save-job-roles"]',
        )!.disabled,
      ).toBe(true),
    );
    expect(el.open).toBe(true);
  });

  it("keeps the draft after a stale save until Reload is pressed", async () => {
    setLocale("en-GB");
    let reads = 0;
    const api = new DashboardApi("", async (_path, init) => {
      if (init?.method === "PUT")
        return new Response(
          JSON.stringify({ error: { code: "person.job_roles_changed", params: {} } }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      reads++;
      return new Response(
        JSON.stringify({
          staffRoles: roles.map((r) => ({ ...r, holderIds: reads === 1 ? r.holderIds : [] })),
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person,
      open: true,
      api,
      canManageSchedule: true,
    });
    const field = () =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
        'wt-combobox[name="jobRoles"]',
      )!;
    await vi.waitFor(() => expect(field()?.values).toEqual(["waiter"]));
    await chooseOptions(field(), ["chef"]);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-job-roles"]')!.click();
    const actions = () =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
        '[data-test="job-role-actions"]',
      )!;
    await vi.waitFor(() =>
      expect(actions().error).toContain("Someone changed this person's job roles"),
    );
    expect(field().values).toEqual(["chef"]);
    expect(reads).toBe(1);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="reload-job-roles"]')!.click();
    await vi.waitFor(() => expect(field().values).toEqual([]));
    expect(actions().error).toBe("");
  });
});
