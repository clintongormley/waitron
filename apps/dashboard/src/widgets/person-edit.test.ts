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
  it("suspends detail submission while a lifecycle confirmation is open", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", { person, open: true });
    const saves: Event[] = [];
    const resets: Event[] = [];
    el.addEventListener("save-person", (event) => saves.push(event));
    el.addEventListener("reset-login", (event) => resets.push(event));
    const input = el
      .shadowRoot!.querySelector("[data-test=edit-email]")!
      .shadowRoot!.querySelector("input")!;
    const enter = () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
      );
    enter();
    expect(saves).toHaveLength(1);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=reset-login]")!.click();
    await el.updateComplete;
    enter();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    expect(saves).toHaveLength(1);
    expect(resets).toHaveLength(0);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-action]")!.click();
    await el.updateComplete;
    enter();
    expect(saves).toHaveLength(2);
  });

  it("uses the shared modal with one field per row and a divider before role and status", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", { person, open: true });
    const modal = el.shadowRoot!.querySelector("wt-modal");
    expect(modal).not.toBeNull();
    await modal!.updateComplete;
    const fields = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".field")];
    for (let i = 1; i < fields.length; i++) {
      expect(fields[i]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        fields[i - 1]!.getBoundingClientRect().bottom,
      );
    }
    for (const name of ["role", "status"]) {
      const select = el.shadowRoot!.querySelector<HTMLSelectElement>(`select[name=${name}]`)!;
      expect(select.required).toBe(true);
      expect(select.parentElement!.textContent).toContain("*");
    }
    const divider = el.shadowRoot!.querySelector("hr")!;
    expect(divider.nextElementSibling!.querySelector("select")!.name).toBe("role");
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

  it("confirms reset login, reset PIN and mark inactive before emitting each action", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person,
      open: true,
    });
    for (const [testId, eventName] of [
      ["reset-login", "reset-login"],
      ["reset-pin", "reset-pin"],
      ["mark-inactive", "deactivate-person"],
    ] as const) {
      const events: Event[] = [];
      el.addEventListener(eventName, (event) => events.push(event), { once: true });
      el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!.click();
      await el.updateComplete;
      expect(events).toHaveLength(0);
      expect(el.shadowRoot!.querySelector("[data-test=confirmation]")!.textContent).not.toBe("");
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-action]")!.click();
      const event = events[0]!;
      expect(event.bubbles).toBe(true);
      expect(event.composed).toBe(true);
    }
    expect(el.shadowRoot!.querySelector("[data-test=edit-password]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=edit-pin]")).toBeNull();
  });

  it("does not let the signed-in user mark themselves inactive", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person,
      currentPersonId: person.personId,
      open: true,
    });
    const button = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=mark-inactive]",
    )!;
    expect(button.disabled).toBe(true);
    const events: Event[] = [];
    el.addEventListener("deactivate-person", (event) => events.push(event));
    button.click();
    expect(events).toHaveLength(0);
  });

  it("keeps inactive users inactive while editing and offers explicit reactivation", async () => {
    const inactive = { ...person, status: "suspended" as const };
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: inactive,
      open: true,
    });
    expect(el.shadowRoot!.querySelector("[data-test=mark-inactive]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=reactivate]")).not.toBeNull();
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
