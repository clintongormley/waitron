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
  it("presents one populated form and emits the full edit through one Save", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person,
      open: true,
    });
    change(el, "edit-first-names", "Ada Augusta Byron");
    change(el, "edit-telephone", "+44 21");
    const role = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=edit-role]")!;
    role.value = "admin";
    role.dispatchEvent(new Event("change"));
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
      status: "active",
    });
  });

  it("offers reset login, reset PIN and mark inactive as separate actions", async () => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person,
      open: true,
    });
    for (const [testId, eventName] of [
      ["reset-login", "reset-login"],
      ["reset-pin", "reset-pin"],
      ["mark-inactive", "deactivate-person"],
    ] as const) {
      const seen = new Promise<Event>((resolve) =>
        el.addEventListener(eventName, resolve, { once: true }),
      );
      el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!.click();
      const event = await seen;
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
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
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
