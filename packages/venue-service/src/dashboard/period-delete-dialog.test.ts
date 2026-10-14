import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { PeriodDeleteImpact } from "./opening-hours-client.js";
import type { PeriodDeleteDialog } from "./period-delete-dialog.js";
import "./period-delete-dialog.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

const replacements = [
  { id: "p2", name: "Dinner" },
  { id: "p3", name: "Brunch" },
];
function impactOf(overrides: Partial<PeriodDeleteImpact> = {}): PeriodDeleteImpact {
  return {
    seasons: 0,
    specialDays: 0,
    routingUses: [],
    keptOpenToday: false,
    replacements,
    ...overrides,
  };
}
async function mount(impact?: PeriodDeleteImpact) {
  const el = document.createElement("period-delete-dialog");
  el.period = { id: "p1", name: "Lunch" };
  el.impact = impact;
  el.open = true;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const body = (el: PeriodDeleteDialog) =>
  (el.shadowRoot!.querySelector("[data-test=body]")?.textContent ?? "").replace(/\s+/g, " ").trim();
const picker = (el: PeriodDeleteDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "wt-combobox[name=replacementPeriodId]",
  );
const confirm = (el: PeriodDeleteDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm-delete]")!;
const cancel = (el: PeriodDeleteDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=cancel-delete]")!;
const bottom = (el: PeriodDeleteDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!.error;
const heading = (el: PeriodDeleteDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!.heading;
async function choose(el: PeriodDeleteDialog, value: string) {
  picker(el)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function listen(el: PeriodDeleteDialog, name: string) {
  const seen: unknown[] = [];
  el.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

it("says where the period is painted and which routing cells name it, as counted", async () => {
  const el = await mount(
    impactOf({
      seasons: 4,
      specialDays: 2,
      routingUses: [{ rowKind: "category", rowLabel: "Cocktails", zoneName: null }],
    }),
  );
  const text = body(el);
  expect(text).toContain("Painted in 4 seasons.");
  expect(text).toContain("Painted on 2 special days.");
  expect(text).toContain("Named in 1 routing cell: Cocktails · Every zone.");
  expect(heading(el)).toBe("Delete Lunch?");
});

it("counts one season, one special day and several cells in the singular and plural", async () => {
  const el = await mount(
    impactOf({
      seasons: 1,
      specialDays: 1,
      routingUses: [
        { rowKind: "product", rowLabel: "Gin", zoneName: "Terrace" },
        { rowKind: "all", rowLabel: null, zoneName: null },
      ],
    }),
  );
  const text = body(el);
  expect(text).toContain("Painted in 1 season.");
  expect(text).toContain("Painted on 1 special day.");
  expect(text).toContain("Named in 2 routing cells: Gin · Terrace, All categories · Every zone.");
});

it("a period painted nowhere and named nowhere says only that no hours change", async () => {
  const el = await mount(impactOf());
  expect(body(el)).toBe("Not painted anywhere. No hours change.");
  expect(picker(el)).toBeNull();
  expect(heading(el)).toBe("Delete Lunch?");
  expect(confirm(el).textContent!.trim()).toBe("Delete Lunch");
});

it("a period named only in routing says its lines are deleted and offers no replacement", async () => {
  const el = await mount(
    impactOf({ routingUses: [{ rowKind: "category", rowLabel: "Cocktails", zoneName: null }] }),
  );
  const text = body(el);
  expect(text).toContain("Its routing lines are deleted.");
  expect(text).not.toContain("painted time");
  expect(picker(el)).toBeNull();
});

it("without a replacement it says the time closes and the routing lines are deleted; choosing one says that period takes the time, and still that the lines are deleted", async () => {
  const el = await mount(
    impactOf({
      seasons: 2,
      routingUses: [{ rowKind: "category", rowLabel: "Cocktails", zoneName: null }],
    }),
  );
  const closes =
    "Its painted time becomes closed in the seasons, and the season shows through on special days.";
  expect(body(el)).toContain(closes);
  expect(body(el)).toContain("Its routing lines are deleted.");
  expect(body(el)).toContain("To keep the hours, pick a period to take its place.");
  await choose(el, "p2");
  expect(body(el)).toContain("Dinner takes its painted time.");
  expect(body(el)).not.toContain(closes);
  expect(body(el)).toContain("Its routing lines are deleted.");
  await choose(el, "");
  expect(body(el)).toContain(closes);
});

it("a keep-open extension today ends without a replacement and moves to the one chosen", async () => {
  const el = await mount(impactOf({ keptOpenToday: true }));
  expect(body(el)).toContain("Today's later opening of it ends.");
  expect(body(el)).not.toContain("painted time");
  await choose(el, "p3");
  expect(body(el)).toContain("Today's later opening moves to Brunch.");
  expect(body(el)).not.toContain("ends.");
});

it("the replacement offers None then the department's other periods, and Confirm sends the choice", async () => {
  const el = await mount(impactOf({ seasons: 1 }));
  const field = picker(el)!;
  expect(field.label).toBe("Replace with");
  expect(field.showEmptyOption).toBe(true);
  expect(field.value).toBe("");
  expect(field.options).toEqual([
    { value: "", label: "None" },
    { value: "p2", label: "Dinner" },
    { value: "p3", label: "Brunch" },
  ]);
  const confirmed = listen(el, "period-delete-confirm");
  confirm(el).click();
  await choose(el, "p2");
  expect(field.value).toBe("p2");
  confirm(el).click();
  expect(confirmed).toEqual([
    { periodId: "p1", replacementPeriodId: null },
    { periodId: "p1", replacementPeriodId: "p2" },
  ]);
});

it("the Replace-with choice resets when another period is shown", async () => {
  const el = await mount(impactOf({ seasons: 1 }));
  await choose(el, "p2");
  el.period = { id: "p9", name: "Tea" };
  el.impact = impactOf({ seasons: 1 });
  await el.updateComplete;
  expect(picker(el)!.value).toBe("");
  expect(body(el)).toContain("Its painted time becomes closed");
});

it("a new impact replaces the cells and counts shown, keeps a refusal, and drops a replacement it no longer lists", async () => {
  const el = await mount(
    impactOf({
      seasons: 4,
      routingUses: [{ rowKind: "category", rowLabel: "Cocktails", zoneName: null }],
    }),
  );
  await choose(el, "p2");
  el.refusal = { code: "hours.clock_changed" };
  await el.updateComplete;
  el.impact = impactOf({
    seasons: 3,
    routingUses: [{ rowKind: "category", rowLabel: "Wine", zoneName: "Bar" }],
    replacements: [{ id: "p3", name: "Brunch" }],
  });
  await el.updateComplete;
  const text = body(el);
  expect(text).toContain("Painted in 3 seasons.");
  expect(text).not.toContain("Painted in 4 seasons.");
  expect(text).toContain("Named in 1 routing cell: Wine · Bar.");
  expect(text).not.toContain("Cocktails");
  expect(picker(el)!.value).toBe("");
  expect(text).toContain("Its painted time becomes closed");
  expect(bottom(el)).toBe("The business-day start changed. Reload hours.");
  const confirmed = listen(el, "period-delete-confirm");
  confirm(el).click();
  expect(confirmed).toEqual([{ periodId: "p1", replacementPeriodId: null }]);
});

it("a new impact that still lists the chosen replacement keeps it", async () => {
  const el = await mount(impactOf({ seasons: 4 }));
  await choose(el, "p3");
  el.impact = impactOf({ seasons: 2 });
  await el.updateComplete;
  expect(picker(el)!.value).toBe("p3");
});

it("a replacement refusal marks Replace with and the bottom asks to correct it; Confirm stays enabled", async () => {
  const el = await mount(impactOf({ seasons: 1 }));
  await choose(el, "p2");
  el.refusal = { code: "menu_period.invalid", params: { field: "replacementPeriodId" } };
  await el.updateComplete;
  expect(picker(el)!.error).toBe("Choose another period.");
  expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
  expect(confirm(el).disabled).toBe(false);

  el.refusal = {
    code: "menu_timetable.invalid",
    params: { field: "replacementPeriodId", reason: "end_offset", periodId: "p2" },
  };
  await el.updateComplete;
  expect(picker(el)!.error).toBe("Change the end offset of Dinner to fit these times.");
  expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
  expect(confirm(el).disabled).toBe(false);
});

it("any other refusal shows one sentence at the bottom and keeps Confirm", async () => {
  const el = await mount(impactOf({ seasons: 1 }));
  const cases: [Record<string, unknown>, string][] = [
    [{ code: "hours.clock_changed" }, "The business-day start changed. Reload hours."],
    [
      { code: "hours.clock_change_pending" },
      "Cancel the pending business-day change before editing hours.",
    ],
    [{ code: "menu_period.not_found" }, "This period no longer exists."],
    [{ code: "department.not_found" }, "This department no longer exists."],
    [
      {
        code: "menu_timetable.invalid",
        params: { field: "periodId", reason: "end_offset", periodId: "p3" },
      },
      "Change the end offset of Brunch to fit these times.",
    ],
    [{ code: "network" }, "This could not be saved. Try again."],
  ];
  for (const [refusal, sentence] of cases) {
    el.refusal = refusal as PeriodDeleteDialog["refusal"];
    await el.updateComplete;
    expect(bottom(el), String(refusal.code)).toBe(sentence);
    expect(picker(el)!.error).toBe("");
    expect(confirm(el).disabled).toBe(false);
  }
});

it("choosing another replacement clears a refusal that named Replace with", async () => {
  const el = await mount(impactOf({ seasons: 1 }));
  el.refusal = { code: "menu_period.invalid", params: { field: "replacementPeriodId" } };
  await el.updateComplete;
  await choose(el, "p3");
  expect(picker(el)!.error).toBe("");
  expect(bottom(el)).toBe("");
});

it("Spanish: Eliminar Lunch y Sin categoría · Terraza", async () => {
  setLocale("es");
  const el = await mount(
    impactOf({
      seasons: 2,
      routingUses: [{ rowKind: "no_category", rowLabel: null, zoneName: "Terraza" }],
    }),
  );
  expect(heading(el)).toBe("¿Eliminar Lunch?");
  expect(confirm(el).textContent!.trim()).toBe("Eliminar Lunch");
  const text = body(el);
  expect(text).toContain("Pintado en 2 temporadas.");
  expect(text).toContain("Nombrado en 1 celda de asignación: Sin categoría · Terraza.");
  expect(text).toContain("Se eliminan sus líneas de asignación.");
  expect(picker(el)!.label).toBe("Sustituir por");
  expect(picker(el)!.options[0]).toEqual({ value: "", label: "Ninguno" });
  el.impact = impactOf();
  await el.updateComplete;
  expect(body(el)).toBe("Sin pintar en ningún sitio. No cambia ningún horario.");
});

it("while loading Confirm is quiet (secondary) and disabled; a failed read shows Retry, which emits period-delete-retry", async () => {
  const el = await mount();
  expect(confirm(el).variant).toBe("secondary");
  expect(confirm(el).disabled).toBe(true);
  expect(el.shadowRoot!.querySelector("[role=status]")!.textContent!.trim()).toBe("Loading…");
  expect(el.shadowRoot!.querySelector("[data-test=retry-delete]")).toBeNull();

  el.readError = "The deletion impact could not be loaded. Try again.";
  await el.updateComplete;
  expect(bottom(el)).toBe("The deletion impact could not be loaded. Try again.");
  const retries = listen(el, "period-delete-retry");
  const retry = el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-delete]")!;
  expect(retry.textContent!.trim()).toBe("Try again");
  retry.click();
  expect(retries).toEqual([{}]);
  expect(confirm(el).disabled).toBe(true);

  el.readError = "";
  el.impact = impactOf();
  await el.updateComplete;
  expect(confirm(el).variant).toBe("danger");
  expect(confirm(el).disabled).toBe(false);
  expect(el.shadowRoot!.querySelector("[role=status]")).toBeNull();
});

it("a failed re-read while an earlier impact is on screen shows the error and Retry, and keeps the impact", async () => {
  const el = await mount(impactOf({ seasons: 2 }));
  expect(el.shadowRoot!.querySelector("[data-test=retry-delete]")).toBeNull();
  el.readError = "What deleting it changes could not be read.";
  await el.updateComplete;
  expect(bottom(el)).toBe("What deleting it changes could not be read.");
  expect(body(el)).toContain("Painted in 2 seasons.");
  const retries = listen(el, "period-delete-retry");
  const retry = el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-delete]");
  expect(retry, "Retry beside a shown impact").not.toBeNull();
  retry!.click();
  expect(retries).toEqual([{}]);
  expect(confirm(el).disabled).toBe(false);
});

it("Cancel and the modal's close emit period-delete-close", async () => {
  const el = await mount(impactOf());
  const closes = listen(el, "period-delete-close");
  cancel(el).click();
  await expect.poll(() => closes.length).toBe(1);
});

it("busy blocks Cancel, close and a second confirm", async () => {
  const el = await mount(impactOf({ seasons: 1 }));
  el.busy = true;
  await el.updateComplete;
  const closes = listen(el, "period-delete-close");
  const confirmed = listen(el, "period-delete-confirm");
  expect(cancel(el).disabled).toBe(true);
  expect(confirm(el).disabled).toBe(true);
  expect(confirm(el).loading).toBe(true);
  expect(picker(el)!.disabled).toBe(true);
  const modal = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
  expect(modal.dismissible).toBe(false);
  cancel(el).click();
  confirm(el).click();
  await modal.requestClose("cancel");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(closes).toEqual([]);
  expect(confirmed).toEqual([]);
});
