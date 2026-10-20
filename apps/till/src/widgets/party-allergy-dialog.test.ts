import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WtInput, WtTextarea } from "@waitron/ui";
import { page, userEvent } from "vitest/browser";
import type { PartyAllergyRead, AllergyPatch } from "@waitron/module";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { TillPartyAllergyDialog } from "./party-allergy-dialog.js";

const original = currentLocale();
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale(original);
});
function view(answer: "allergies" | "none" | null = null): PartyAllergyRead {
  return {
    partyId: "party-a",
    snapshot: {
      answer,
      revision: 7,
      changedBy: null,
      changedAt: null,
      guests:
        answer === "allergies"
          ? [
              {
                id: "guest-a",
                position: 0,
                who: "Seat 3",
                allergens: { gluten: { kinds: ["wheat"] }, milk: {} },
                note: "Severe",
              },
              {
                id: "guest-b",
                position: 1,
                who: "Blue shirt",
                allergens: { eggs: {} },
                note: null,
              },
            ]
          : [],
      ticks:
        answer === "allergies"
          ? [{ guestId: "guest-a", draftLineId: "new", workingLineId: null }]
          : [],
    },
    dishes: [
      {
        line: { kind: "draft", id: "new" },
        billId: "bill-a",
        name: "Pasta",
        quantity: "2.000",
        allergens: { gluten: { kinds: ["rye"] } },
        extras: [
          { name: "Egg sauce", quantity: "2.000", allergens: { eggs: {} } },
          { name: "Mystery garnish", quantity: "1.000", allergens: null },
        ],
        sentAt: null,
        offeredBefore: false,
      },
      {
        line: { kind: "working", id: "old" },
        billId: "bill-b",
        name: "Roast",
        quantity: "1.000",
        allergens: {},
        extras: [],
        sentAt: "2026-10-19T13:24:00Z",
        offeredBefore: true,
      },
      {
        line: { kind: "draft", id: "unknown" },
        billId: "bill-b",
        name: "Special",
        quantity: "1.000",
        allergens: null,
        extras: [],
        sentAt: null,
        offeredBefore: false,
      },
    ],
  };
}
async function mount(
  answer: "allergies" | "none" | null = null,
  mode: "send" | "edit" = "send",
  read: PartyAllergyRead = view(answer),
) {
  const { el } = await mountWidget<TillPartyAllergyDialog>("till-party-allergy-dialog", {
    view: read,
    mode,
    scopeKey: "opening-a",
  });
  return el;
}
async function click(el: TillPartyAllergyDialog, selector: string) {
  const target = el.shadowRoot!.querySelector<HTMLElement>(selector);
  expect(target, selector).not.toBeNull();
  await userEvent.click(page.elementLocator(target!));
  await el.updateComplete;
}
async function fill(el: TillPartyAllergyDialog, name: string, value: string) {
  const field = el.shadowRoot!.querySelector(
    `wt-input[name="${name}"],wt-textarea[name="${name}"]`,
  )!;
  expect(field, name).not.toBeNull();
  await (field as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await userEvent.fill(
    page.elementLocator(field.shadowRoot!.querySelector("input,textarea")!),
    value,
  );
  await el.updateComplete;
}
function confirmations(el: TillPartyAllergyDialog) {
  const results: { scopeKey: string; expectedPartyRevision: number | null; patch: AllergyPatch }[] =
    [];
  el.addEventListener("allergy-confirm", (e) => results.push((e as CustomEvent).detail));
  return results;
}

describe("A669 refreshed editor recovery", () => {
  it("keeps local note, allergen and deletion edits beside a remotely renamed guest", async () => {
    const el = await mount("allergies", "edit");
    const result = confirmations(el);
    await click(el, '[data-delete="1"]');
    await click(el, '[data-edit="0"]');
    await fill(el, "guest-0-note", "Local kitchen instruction");
    await click(el, '[data-guest="0"] [data-code="milk"]');
    await click(el, '[data-guest="0"] [data-code="eggs"]');
    const latest = view("allergies");
    latest.snapshot.revision = 8;
    latest.snapshot.guests[0]!.who = "Name corrected elsewhere";
    latest.snapshot.guests[0]!.note = "Remote instruction";
    latest.snapshot.guests[0]!.allergens = { fish: {} };
    el.reviewLatest("opening-a", latest);
    await el.updateComplete;
    await click(el, "[data-primary]");
    expect(result).toEqual([
      {
        scopeKey: "opening-a",
        expectedPartyRevision: 8,
        patch: {
          party: {
            answer: "allergies",
            guests: [
              {
                id: "guest-a",
                who: "Name corrected elsewhere",
                note: "Local kitchen instruction",
                allergens: { gluten: { kinds: ["wheat"] }, eggs: {} },
              },
            ],
          },
          ticks: [],
        },
      },
    ]);
  });

  it("does not recreate an unchanged guest deleted by another waiter", async () => {
    const el = await mount("allergies", "edit");
    const result = confirmations(el);
    await click(el, '[data-edit="0"]');
    await fill(el, "guest-0-who", "Local correction");
    const latest = view("allergies");
    latest.snapshot.revision = 8;
    latest.snapshot.guests.splice(1, 1);
    el.reviewLatest("opening-a", latest);
    await el.updateComplete;
    await click(el, "[data-primary]");
    expect(result[0]!.patch.party!.guests).toEqual([
      {
        id: "guest-a",
        who: "Local correction",
        note: "Severe",
        allergens: { gluten: { kinds: ["wheat"] }, milk: {} },
      },
    ]);
  });

  it.each(["code", "kind"] as const)(
    "clears a guest's allergen refusal when its %s choice changes",
    async (choice) => {
      const el = await mount("allergies", "edit");
      await click(el, '[data-edit="0"]');
      el.fieldRefusal = {
        guestIndex: 0,
        field: "allergens",
        message: "Review the avoided ingredients",
      };
      await el.updateComplete;
      const selector = choice === "code" ? '[data-code="milk"]' : '[data-kind="wheat"]';
      await click(el, `[data-guest="0"] ${selector}`);
      expect(el.fieldRefusal).toBeNull();
      if (choice === "kind") {
        expect(
          el.shadowRoot!.querySelector<HTMLInputElement>(`[data-guest="0"] ${selector}`)!.checked,
        ).toBe(false);
        await click(el, `[data-guest="0"] ${selector}`);
      }
      await fill(el, "guest-0-who", "Confirmed guest");
      const result = confirmations(el);
      await click(el, "[data-primary]");
      expect(result[0]!.patch.party!.guests[0]!.allergens).toEqual(
        choice === "code"
          ? { gluten: { kinds: ["wheat"] } }
          : { gluten: { kinds: ["wheat"] }, milk: {} },
      );
    },
  );

  it("returns from dish ticking without losing guest edits or assignments", async () => {
    const el = await mount("allergies");
    await click(el, "[data-primary]");
    await click(el, "[data-back]");
    expect(el.shadowRoot!.querySelector('[data-guest="0"]')).not.toBeNull();
    await click(el, "[data-primary]");
    expect(el.shadowRoot!.querySelector<HTMLInputElement>('[data-tick="0:0"]')!.checked).toBe(true);
  });

  it("Escape dismisses only deletion confirmation and retains the guest and their dish", async () => {
    const el = await mount("allergies", "edit");
    await click(el, '[data-delete="0"]');
    const confirm = el.shadowRoot!.querySelectorAll("wt-dialog")[1]!;
    await confirm.updateComplete;
    const closed = new Promise<void>((resolve) =>
      confirm.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    await userEvent.keyboard("{Escape}");
    await closed;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("wt-dialog")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector('[data-delete="0"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector<HTMLInputElement>('[data-tick="0:0"]')!.checked).toBe(true);
  });

  it("retries an uncertain No allergies answer without changing its patch", async () => {
    const el = await mount();
    const result = confirmations(el);
    await click(el, "[data-none]");
    el.retryOnly = true;
    el.refusal = "The answer has not arrived";
    await el.updateComplete;
    await click(el, "[data-none]");
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(result[0]);
  });

  it("ignores a refreshed view from another dialog opening", async () => {
    const el = await mount("allergies", "edit");
    await click(el, '[data-edit="0"]');
    await fill(el, "guest-0-who", "My pending edit");
    const latest = view("allergies");
    latest.snapshot.revision = 99;
    latest.snapshot.guests = [];
    el.reviewLatest("an-old-opening", latest);
    await el.updateComplete;
    const result = confirmations(el);
    await click(el, "[data-primary]");
    expect(result[0]!.expectedPartyRevision).toBe(7);
    expect(result[0]!.patch.party!.guests[0]!.who).toBe("My pending edit");
  });
});

describe("A669 allergy dialog", () => {
  it("asks before sending and returns an explicit No allergies without mutating the view", async () => {
    const el = await mount();
    const results = confirmations(el);
    expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Any allergies at this table?");
    await click(el, "[data-none]");
    expect(results).toEqual([
      {
        scopeKey: "opening-a",
        expectedPartyRevision: 7,
        patch: { party: { answer: "none", guests: [] }, ticks: [] },
      },
    ]);
    expect(el.view.snapshot!.answer).toBeNull();
  });
  it("validates Who and allergens, requires cereal/nut kinds and sends multiple guests", async () => {
    const el = await mount();
    const results = confirmations(el);
    await click(el, "[data-allergies]");
    expect(el.shadowRoot!.querySelectorAll('[data-guest="0"] [data-code]')).toHaveLength(14);
    await click(el, "[data-primary]");
    expect(
      el
        .shadowRoot!.querySelector<WtInput>('wt-input[name="guest-0-who"]')!
        .getAttribute("required"),
    ).not.toBeNull();
    expect((el.shadowRoot!.querySelector("[data-primary]") as HTMLButtonElement).disabled).toBe(
      true,
    );
    await fill(el, "guest-0-who", "  Seat 4  ");
    await click(el, '[data-guest="0"] [data-code="gluten"]');
    expect((el.shadowRoot!.querySelector("[data-primary]") as HTMLButtonElement).disabled).toBe(
      true,
    );
    await click(el, '[data-guest="0"] [data-kind="wheat"]');
    await fill(el, "guest-0-note", "Avoid cross contact");
    await click(el, "[data-add]");
    await fill(el, "guest-1-who", "Red hat");
    await click(el, '[data-guest="1"] [data-code="nuts"]');
    await click(el, '[data-guest="1"] [data-kind="almonds"]');
    await click(el, "[data-primary]");
    await click(el, '[data-tick="0:0"]');
    await click(el, "[data-primary]");
    expect(results[0]!.patch).toEqual({
      party: {
        answer: "allergies",
        guests: [
          {
            who: "Seat 4",
            allergens: { gluten: { kinds: ["wheat"] } },
            note: "Avoid cross contact",
          },
          { who: "Red hat", allergens: { nuts: { kinds: ["almonds"] } }, note: null },
        ],
      },
      ticks: [{ line: { kind: "draft", id: "new" }, guestIndex: 0 }],
    });
  });
  it("offers only new whole lines, shows extra nutrition separately and explains clashes by code", async () => {
    const el = await mount("allergies");
    const results = confirmations(el);
    expect(el.shadowRoot!.textContent).not.toContain("Roast");
    expect(el.shadowRoot!.textContent).toContain("Egg sauce");
    expect(el.shadowRoot!.textContent).toContain("Mystery garnish");
    expect(el.shadowRoot!.querySelectorAll("[data-extra] input")).toHaveLength(0);
    expect(el.shadowRoot!.querySelector('[data-extra="0:0"] wt-icon')!.getAttribute("name")).toBe(
      "allergen-eggs",
    );
    expect(el.shadowRoot!.querySelector('[data-extra="0:1"]')!.textContent).toContain(
      "Not reviewed",
    );
    expect(el.shadowRoot!.querySelector('[data-dish="0"]')!.textContent).toContain("Rye");
    expect(el.shadowRoot!.querySelector("[data-clash]")!.textContent).toContain("Seat 3");
    expect(el.shadowRoot!.querySelector("[data-primary]")!.textContent).toContain("Send anyway");
    await click(el, '[data-tick="1:0"]');
    expect(el.shadowRoot!.querySelector<HTMLInputElement>('[data-tick="0:0"]')!.checked).toBe(
      false,
    );
    expect(el.shadowRoot!.querySelector<HTMLInputElement>('[data-tick="1:0"]')!.checked).toBe(true);
    await click(el, "[data-primary]");
    expect(results[0]!.patch.ticks).toEqual([
      { line: { kind: "draft", id: "new" }, guestIndex: 1 },
    ]);
    expect(results[0]!.patch.party).toBeUndefined();
  });
  it("lists all bills and drafts in Edit, and does not enable an unchanged Save", async () => {
    const el = await mount("allergies", "edit");
    expect(el.shadowRoot!.textContent).toContain("Roast");
    expect(el.shadowRoot!.querySelectorAll("[data-dish]")).toHaveLength(3);
    expect(el.shadowRoot!.querySelector("[data-sent]")).not.toBeNull();
    const save = el.shadowRoot!.querySelector("[data-primary]") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.getAttribute("variant")).toBe("secondary");
    await click(el, '[data-edit="0"]');
    await fill(el, "guest-0-who", "Seat 5");
    expect(save.disabled).toBe(false);
  });
  it("confirms deletion with ticks, preserves Cancel and leaves Allergies after the last deletion", async () => {
    const el = await mount("allergies", "edit");
    const results = confirmations(el);
    await click(el, '[data-delete="0"]');
    await click(el, "[data-confirm-cancel]");
    expect(el.shadowRoot!.textContent).toContain("Seat 3");
    await click(el, '[data-delete="0"]');
    await click(el, "[data-confirm-delete]");
    await click(el, '[data-delete="0"]');
    await click(el, "[data-primary]");
    expect(results[0]!.patch).toEqual({
      party: { answer: "allergies", guests: [] },
      ticks: [{ line: { kind: "draft", id: "new" }, guestIndex: null }],
    });
  });
  it("confirms No allergies before clearing every guest and tick", async () => {
    const el = await mount("allergies", "edit");
    const results = confirmations(el);
    await click(el, "[data-none]");
    expect((el.shadowRoot!.querySelector("[data-primary]") as HTMLButtonElement).disabled).toBe(
      true,
    );
    await click(el, "[data-confirm-cancel]");
    expect(el.shadowRoot!.textContent).toContain("Blue shirt");
    await click(el, "[data-none]");
    await click(el, "[data-confirm-delete]");
    await click(el, "[data-primary]");
    expect(results[0]!.patch).toEqual({
      party: { answer: "none", guests: [] },
      ticks: [{ line: { kind: "draft", id: "new" }, guestIndex: null }],
    });
  });
  it("retains failed input for retry and commits only the confirmed opening", async () => {
    const el = await mount("allergies", "edit");
    const results = confirmations(el);
    await click(el, '[data-edit="0"]');
    await fill(el, "guest-0-who", "Changed");
    await click(el, "[data-primary]");
    el.busy = true;
    await el.updateComplete;
    el.busy = false;
    el.refusal = "Connection lost";
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("Connection lost");
    expect((el.shadowRoot!.querySelector("[data-primary]") as HTMLButtonElement).disabled).toBe(
      false,
    );
    await click(el, "[data-primary]");
    expect(results).toHaveLength(2);
    expect(results[1]).toEqual(results[0]);
    el.commitConfirmed("different-opening");
    await el.updateComplete;
    expect((el.shadowRoot!.querySelector("[data-primary]") as HTMLButtonElement).disabled).toBe(
      false,
    );
    el.commitConfirmed("opening-a");
    await el.updateComplete;
    expect((el.shadowRoot!.querySelector("[data-primary]") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  it("does not silently replace dirty input with a newer read", async () => {
    const el = await mount("allergies", "edit");
    await click(el, '[data-edit="0"]');
    await fill(el, "guest-0-who", "My edit");
    const next = view("allergies");
    next.snapshot.revision = 8;
    el.view = next;
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector<HTMLInputElement>('wt-input[name="guest-0-who"]')!.value,
    ).toBe("My edit");
    const results = confirmations(el);
    await click(el, "[data-primary]");
    expect(results[0]!.expectedPartyRevision).toBe(7);
  });
  it("returns no revision for a preview of a free table", async () => {
    const el = await mount();
    const results = confirmations(el);
    el.view = { billId: "counter", tableId: "table-a", partyId: null, snapshot: null, dishes: [] };
    await el.updateComplete;
    await click(el, "[data-none]");
    expect(results[0]!.expectedPartyRevision).toBeNull();
  });
  it("keeps focus while typing a new guest across consecutive native keys", async () => {
    const el = await mount();
    await click(el, "[data-allergies]");
    const field = el.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-0-who"]')!;
    await field.updateComplete;
    (field as HTMLElement).focus();
    await userEvent.keyboard("Alex");
    expect(
      el.shadowRoot!.querySelector<HTMLInputElement>('wt-input[name="guest-0-who"]')!.value,
    ).toBe("Alex");
  });
  it("rejects overlong printable names and notes and clears each error as it is fixed", async () => {
    const el = await mount("allergies", "edit");
    await click(el, '[data-edit="0"]');
    await fill(el, "guest-0-who", "x".repeat(41));
    await fill(el, "guest-0-note", "n".repeat(2001));
    await click(el, "[data-primary]");
    expect(el.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-0-who"]')!.error).not.toBe(
      "",
    );
    expect(
      el.shadowRoot!.querySelector<WtTextarea>('wt-textarea[name="guest-0-note"]')!.error,
    ).not.toBe("");
    await fill(el, "guest-0-who", "x".repeat(40));
    await fill(el, "guest-0-note", "n".repeat(2000));
    expect(el.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-0-who"]')!.error).toBe("");
    expect(
      el.shadowRoot!.querySelector<WtTextarea>('wt-textarea[name="guest-0-note"]')!.error,
    ).toBe("");
    const results = confirmations(el);
    await click(el, "[data-primary]");
    expect(results).toHaveLength(1);
  });

  it("places a request refusal under its guest field without disabling retry", async () => {
    const el = await mount("allergies", "edit");
    await click(el, '[data-edit="0"]');
    await fill(el, "guest-0-who", "Edited");
    await click(el, "[data-primary]");
    el.fieldRefusal = { guestIndex: 0, field: "who", message: "Check this guest" };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-0-who"]')!.error).toBe(
      "Check this guest",
    );
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBeTruthy();
    expect((el.shadowRoot!.querySelector("[data-primary]") as HTMLButtonElement).disabled).toBe(
      false,
    );
    await fill(el, "guest-0-who", "Fixed guest");
    expect(el.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-0-who"]')!.error).toBe("");
  });
  it("focuses the first guest on the guest page and Enter advances only a valid form", async () => {
    const el = await mount();
    await click(el, "[data-allergies]");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const field = el.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-0-who"]')!;
    await field.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(field);
    await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), "Seat 1");
    await click(el, '[data-guest="0"] [data-code="milk"]');
    field.focus();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-dish]")).not.toBeNull();
  });
  it("focuses missing allergen choices after Who is filled", async () => {
    const el = await mount();
    await click(el, "[data-allergies]");
    await fill(el, "guest-0-who", "Seat 1");
    await click(el, "[data-primary]");
    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("fieldset"));
  });
  it("focuses the newly added guest without replacing the first guest", async () => {
    const el = await mount();
    await click(el, "[data-allergies]");
    await fill(el, "guest-0-who", "First guest");
    await click(el, "[data-add]");
    const field = el.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-1-who"]')!;
    await field.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(field);
    await userEvent.keyboard("Second guest");
    expect(el.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-0-who"]')!.value).toBe(
      "First guest",
    );
    expect(field.value).toBe("Second guest");
  });
  it("reopens a guest field when Send is refused from the ticking page", async () => {
    const el = await mount("allergies");
    await click(el, "[data-primary]");
    el.fieldRefusal = { guestIndex: 1, field: "who", message: "Check this guest" };
    await el.updateComplete;
    const field = el.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-1-who"]');
    expect(field).not.toBeNull();
    expect(field!.error).toBe("Check this guest");
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
  });
  it("keeps the edited guest's control and assignments when a refreshed review reorders guests", async () => {
    const el = await mount("allergies", "edit");
    const result = confirmations(el);
    await click(el, '[data-edit="0"]');
    await fill(el, "guest-0-who", "Corrected guest");
    const latest = view("allergies");
    latest.snapshot.revision = 8;
    latest.snapshot.guests.reverse();
    latest.snapshot.guests[0]!.position = 0;
    latest.snapshot.guests[1]!.position = 1;
    latest.snapshot.guests[1]!.note = "New kitchen note";
    el.reviewLatest("opening-a", latest);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-1-who"]')?.value).toBe(
      "Corrected guest",
    );
    expect(
      el.shadowRoot!.querySelector<WtTextarea>('wt-textarea[name="guest-1-note"]')?.value,
    ).toBe("New kitchen note");
    await click(el, "[data-primary]");
    expect(result).toEqual([
      {
        scopeKey: "opening-a",
        expectedPartyRevision: 8,
        patch: {
          party: {
            answer: "allergies",
            guests: [
              { id: "guest-b", who: "Blue shirt", allergens: { eggs: {} }, note: null },
              {
                id: "guest-a",
                who: "Corrected guest",
                allergens: { gluten: { kinds: ["wheat"] }, milk: {} },
                note: "New kitchen note",
              },
            ],
          },
          ticks: [],
        },
      },
    ]);
  });
  it("reconciles ticks by guest identity and recreates an edited guest removed elsewhere", async () => {
    const el = await mount("allergies", "edit");
    const result = confirmations(el);
    await click(el, '[data-edit="0"]');
    await fill(el, "guest-0-who", "Corrected removed guest");
    await click(el, '[data-tick="1:2"]');
    const latest = view("allergies");
    latest.snapshot.revision = 8;
    latest.snapshot.guests = [
      { ...latest.snapshot.guests[1]!, position: 0 },
      { id: "guest-c", position: 1, who: "New guest", allergens: { peanuts: {} }, note: null },
    ];
    latest.snapshot.ticks = [
      { guestId: "guest-b", draftLineId: "new", workingLineId: null },
      { guestId: "guest-c", draftLineId: null, workingLineId: "old" },
    ];
    el.reviewLatest("opening-a", latest);
    await el.updateComplete;
    for (const tick of ["0:0", "1:1", "0:2"])
      expect(el.shadowRoot!.querySelector<HTMLInputElement>(`[data-tick="${tick}"]`)?.checked).toBe(
        true,
      );
    expect(el.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-2-who"]')?.value).toBe(
      "Corrected removed guest",
    );
    await click(el, "[data-primary]");
    expect(result).toEqual([
      {
        scopeKey: "opening-a",
        expectedPartyRevision: 8,
        patch: {
          party: {
            answer: "allergies",
            guests: [
              { id: "guest-b", who: "Blue shirt", allergens: { eggs: {} }, note: null },
              { id: "guest-c", who: "New guest", allergens: { peanuts: {} }, note: null },
              {
                who: "Corrected removed guest",
                allergens: { gluten: { kinds: ["wheat"] }, milk: {} },
                note: "Severe",
              },
            ],
          },
          ticks: [{ line: { kind: "draft", id: "unknown" }, guestIndex: 0 }],
        },
      },
    ]);
  });
  it("keeps a concurrent allergen edit when the local allergen choices only changed key order", async () => {
    const el = await mount("allergies", "edit");
    const result = confirmations(el);
    await click(el, '[data-edit="0"]');
    await fill(el, "guest-0-who", "Corrected guest");
    await click(el, '[data-guest="0"] [data-code="gluten"]');
    await click(el, '[data-guest="0"] [data-code="gluten"]');
    await click(el, 'input[name="guest-0-gluten-wheat"]');
    const latest = view("allergies");
    latest.snapshot.revision = 8;
    latest.snapshot.guests[0]!.allergens = { peanuts: {} };
    el.reviewLatest("opening-a", latest);
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector<HTMLInputElement>('[data-guest="0"] [data-code="peanuts"]')!
        .checked,
    ).toBe(true);
    expect(
      el.shadowRoot!.querySelector<HTMLInputElement>('[data-guest="0"] [data-code="gluten"]')!
        .checked,
    ).toBe(false);
    await click(el, "[data-primary]");
    expect(result[0]!.patch.party?.guests[0]).toEqual({
      id: "guest-a",
      who: "Corrected guest",
      allergens: { peanuts: {} },
      note: "Severe",
    });
  });
});

describe("A931 a clash carried by an extra", () => {
  type Dish = PartyAllergyRead["dishes"][number];
  async function mountDish(
    allergens: Dish["allergens"],
    extras: Dish["extras"],
  ): Promise<TillPartyAllergyDialog> {
    const read = view("allergies");
    read.dishes = [{ ...read.dishes[0]!, allergens, extras }];
    return mount("allergies", "send", read);
  }
  function clash(el: TillPartyAllergyDialog) {
    return {
      section: el.shadowRoot!.querySelector('[data-dish="0"]')!.classList.contains("clash"),
      reason: el.shadowRoot!.querySelector("[data-clash]")?.textContent ?? null,
      primary: el.shadowRoot!.querySelector("[data-primary]")!.textContent!.trim(),
    };
  }

  it("warns when only an extra carries an allergen the ticked guest avoids, labelled with the extra's kinds", async () => {
    const el = await mountDish({}, [
      { name: "Toast", quantity: "1.000", allergens: { gluten: { kinds: ["wheat"] } } },
    ]);
    const result = clash(el);
    expect(result.section).toBe(true);
    expect(result.reason).toContain("Seat 3");
    expect(result.reason).toContain("Cereals containing gluten (Wheat)");
    expect(result.primary).toBe("Send anyway");
  });

  it("warns when the dish itself carries the allergen", async () => {
    const el = await mountDish({ milk: {} }, []);
    const result = clash(el);
    expect(result.section).toBe(true);
    expect(result.reason).toContain("Milk");
    expect(result.primary).toBe("Send anyway");
  });

  it("does not warn when an extra carries only allergens the ticked guest does not avoid", async () => {
    const el = await mountDish({}, [
      { name: "Egg sauce", quantity: "1.000", allergens: { eggs: {} } },
    ]);
    expect(clash(el)).toEqual({ section: false, reason: null, primary: "Send" });
  });

  it("warns on an extra's allergen when the dish itself is not reviewed", async () => {
    const el = await mountDish(null, [
      { name: "Cream", quantity: "1.000", allergens: { milk: {} } },
    ]);
    const result = clash(el);
    expect(result.section).toBe(true);
    expect(result.reason).toContain("Milk");
    expect(result.primary).toBe("Send anyway");
  });

  it("adds nothing for an extra that is not reviewed", async () => {
    const el = await mountDish({}, [{ name: "Garnish", quantity: "1.000", allergens: null }]);
    expect(clash(el)).toEqual({ section: false, reason: null, primary: "Send" });
  });
});
