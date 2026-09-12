import { afterEach, describe, expect, it } from "vitest";
import type { PersonSummary } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
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
    // One shared grid gap (see profile-screen.ts's own ".fields"), not a per-field margin — so
    // every row (wt-input as well as the role/status <label>s) stacks without overlapping.
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
    // No <hr> divider ahead of role/status — the profile screen's edit form doesn't have one
    // either, one continuous field list instead.
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
    change(el, "edit-telephone", "+44 21");
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
      telephone: "+44 21",
      email: "ada@example.com",
      role: "admin",
      status: "suspended",
    });
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
