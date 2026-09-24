import { afterEach, describe, expect, it } from "vitest";
import type { PersonSummary } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { PersonEdit } from "./person-edit.js";

afterEach(cleanupWidgets);

const person: PersonSummary = {
  personId: "p1",
  displayName: "Ada",
  firstNames: "Ada Augusta",
  lastNames: "Lovelace",
  telephone: "+44 20",
  role: "manager",
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

describe("person-edit", () => {
  it("uses the shared modal with one field per row, the same field-list shape as the profile screen's own edit form", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", { person, open: true });
    const modal = el.shadowRoot!.querySelector("wt-modal");
    expect(modal).not.toBeNull();
    await modal!.updateComplete;
    // One shared grid gap, not a per-field margin — so every row (wt-input as well as the
    // role/status <label>s) stacks without overlapping.
    const rows = [...el.shadowRoot!.querySelector(".fields")!.children] as HTMLElement[];
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        rows[i - 1]!.getBoundingClientRect().bottom,
      );
    }
    for (const name of ["role", "status"]) {
      const select = el.shadowRoot!.querySelector<HTMLSelectElement>(`select[name=${name}]`)!;
      expect(select.required).toBe(true);
      expect(select.parentElement!.textContent).toContain("*");
    }
    // No <hr> divider ahead of role/status — one continuous field list instead.
    expect(el.shadowRoot!.querySelector("hr")).toBeNull();
  });

  it("presents one populated form and emits the full edit through one Save", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person,
      open: true,
    });
    expect(el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=edit-role]")!.value).toBe(
      "manager",
    );
    expect(el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=edit-status]")!.value).toBe(
      "active",
    );
    expect(
      [...el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=edit-status]")!.options].map(
        (option) => option.value,
      ),
    ).toEqual(["active", "suspended"]);
    change(el, "edit-first-names", "Ada Augusta Byron");
    change(el, "edit-telephone", "+44 20 7946 0958");
    const role = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=edit-role]")!;
    role.value = "admin";
    role.dispatchEvent(new Event("change"));
    const status = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=edit-status]")!;
    status.value = "suspended";
    status.dispatchEvent(new Event("change"));
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
      role: "admin",
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
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", { person, open: true });
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
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", { person, open: true });
    expect(el.shadowRoot!.querySelector("[data-test=resend-invitation]")).toBeNull();
  });

  it("no longer offers reset login/PIN or deactivate/reactivate from the form — those live on the row's kebab menu now", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", { person, open: true });
    for (const testId of ["reset-login", "reset-pin", "mark-inactive", "reactivate"]) {
      expect(el.shadowRoot!.querySelector(`[data-test=${testId}]`)).toBeNull();
    }
  });

  it("keeps inactive users' status select constrained to suspended while editing", async () => {
    const inactive = { ...person, status: "suspended" as const };
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: inactive,
      open: true,
    });
    const status = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=edit-status]")!;
    expect([...status.options].map((option) => option.value)).toEqual(["suspended"]);
  });

  it("Cancel discards edits and secret actions never retain an entered credential", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
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

describe("person-edit validation and keyboard submit", () => {
  it("names every blank required field under its own message and does not save", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", { person, open: true });
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
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", { person, open: true });
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
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", { person, open: true });
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
        role: "manager",
        status: "active",
      },
    ]);
  });
});
