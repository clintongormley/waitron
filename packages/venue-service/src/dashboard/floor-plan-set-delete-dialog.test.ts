import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type {
  FloorPlanSetDeleteDialog,
  FloorPlanSetDeleteImpact,
} from "./floor-plan-set-delete-dialog.js";
import "./floor-plan-set-delete-dialog.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

const impactOf = (overrides: Partial<FloorPlanSetDeleteImpact> = {}): FloorPlanSetDeleteImpact => ({
  periods: [{ id: "dinner-period", name: "Dinner" }],
  zonesShowing: [],
  ...overrides,
});
async function mount(impact?: FloorPlanSetDeleteImpact) {
  const el = document.createElement("dashboard-floor-plan-set-delete-dialog");
  el.set = { id: "dinner", name: "Dinner" };
  el.defaultSet = { id: "standard", name: "House" };
  el.replacements = [{ id: "private", name: "Private party" }];
  el.impact = impact;
  el.open = true;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const lines = (el: FloorPlanSetDeleteDialog) =>
  [...el.shadowRoot!.querySelectorAll("[data-test=body] p")].map((p) =>
    p.textContent!.replace(/\s+/g, " ").trim(),
  );
const picker = (el: FloorPlanSetDeleteDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "wt-combobox[name=replaceWith]",
  );
const confirm = (el: FloorPlanSetDeleteDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm-delete]")!;
const bottom = (el: FloorPlanSetDeleteDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!.error;
const heading = (el: FloorPlanSetDeleteDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!.heading;
async function choose(el: FloorPlanSetDeleteDialog, value: string) {
  picker(el)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

it("asks to delete the set, lists its periods, says the tables stay and offers the default", async () => {
  const el = await mount(impactOf());
  expect(heading(el)).toBe("Delete Dinner?");
  expect(lines(el)).toEqual(["Used by Dinner.", "The tables stay: every set shares them."]);
  const field = picker(el)!;
  expect(field.label).toBe("Replace with");
  expect(field.value).toBe("");
  expect(field.showEmptyOption).toBe(true);
  expect(field.options).toEqual([
    { value: "", label: "House (default)", muted: true },
    { value: "private", label: "Private party" },
  ]);
  expect(confirm(el).textContent!.trim()).toBe("Delete Dinner");
  expect(confirm(el).variant).toBe("danger");
  expect(confirm(el).disabled).toBe(false);
});

it("adds the floor line only while a zone shows the set today", async () => {
  const el = await mount(impactOf({ zonesShowing: [{ id: "inside", name: "Inside" }] }));
  expect(lines(el)).toContain(
    "On the floor, Inside keep today's layout until someone presses Update layout.",
  );
  el.impact = impactOf({
    zonesShowing: [
      { id: "inside", name: "Inside" },
      { id: "terrace", name: "Terrace" },
    ],
  });
  await el.updateComplete;
  expect(lines(el)).toContain(
    "On the floor, Inside and Terrace keep today's layout until someone presses Update layout.",
  );
  el.impact = impactOf();
  await el.updateComplete;
  expect(lines(el).some((line) => line.startsWith("On the floor"))).toBe(false);
});

it("asks no Replace with when no period uses the set", async () => {
  const el = await mount(impactOf({ periods: [] }));
  expect(lines(el)).toEqual(["No period uses it.", "The tables stay: every set shares them."]);
  expect(picker(el)).toBeNull();
});

it("sends null for the default and the chosen set's id otherwise", async () => {
  const el = await mount(impactOf());
  const sent: unknown[] = [];
  el.addEventListener("floor-plan-set-delete-confirm", (event) =>
    sent.push((event as CustomEvent).detail),
  );
  confirm(el).click();
  await choose(el, "private");
  confirm(el).click();
  expect(sent).toEqual([
    { setId: "dinner", replaceWith: null },
    { setId: "dinner", replaceWith: "private" },
  ]);
});

it("draws Delete quiet and inert while the impact loads", async () => {
  const el = await mount();
  expect(el.shadowRoot!.querySelector("[role=status]")!.textContent!.trim()).toBe("Loading…");
  expect(confirm(el).variant).toBe("secondary");
  expect(confirm(el).disabled).toBe(true);
});

it("says the read failed and offers Try again", async () => {
  const el = await mount();
  el.readError = "What deleting it changes could not be read.";
  await el.updateComplete;
  expect(bottom(el)).toBe("What deleting it changes could not be read.");
  const retries: Event[] = [];
  el.addEventListener("floor-plan-set-delete-retry", (event) => retries.push(event));
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-delete]")!.click();
  expect(retries).toHaveLength(1);
  expect(confirm(el).disabled).toBe(true);
});

it("marks Replace with on an invalid choice, and keeps Delete live after any refusal", async () => {
  const el = await mount(impactOf());
  await choose(el, "private");
  el.refusal = { code: "floor_plan_set.invalid", params: { field: "replaceWith" } };
  await el.updateComplete;
  expect(picker(el)!.error).toBe("Choose another set.");
  expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
  expect(confirm(el).disabled).toBe(false);
  await choose(el, "");
  expect(picker(el)!.error).toBe("");
  for (const [code, words] of [
    ["floor_plan_set.not_found", "This set no longer exists."],
    ["floor_plan_set.is_default", "The default set cannot be deleted."],
    ["server.unavailable", "This could not be saved. Try again."],
  ] as const) {
    el.refusal = { code, params: {} };
    await el.updateComplete;
    expect(bottom(el), code).toBe(words);
    expect(confirm(el).disabled, code).toBe(false);
  }
});

it("closes on Cancel and stays while a delete is sent", async () => {
  const el = await mount(impactOf());
  const closes: Event[] = [];
  el.addEventListener("floor-plan-set-delete-close", (event) => closes.push(event));
  el.busy = true;
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-delete]")!.click();
  await el.updateComplete;
  expect(closes).toHaveLength(0);
  el.busy = false;
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-delete]")!.click();
  await expect.poll(() => closes.length).toBe(1);
});

it("speaks Spanish", async () => {
  setLocale("es");
  const el = await mount(impactOf({ zonesShowing: [{ id: "inside", name: "Dentro" }] }));
  expect(heading(el)).toBe("¿Eliminar Dinner?");
  expect(lines(el)).toEqual([
    "Usado por Dinner.",
    "Las mesas se quedan: son comunes a todos los conjuntos.",
    "En sala, Dentro mantienen el plano de hoy hasta que alguien pulse Actualizar plano.",
  ]);
  expect(picker(el)!.label).toBe("Sustituir por");
  expect(picker(el)!.options[0]).toEqual({
    value: "",
    label: "House (predeterminado)",
    muted: true,
  });
  expect(confirm(el).textContent!.trim()).toBe("Eliminar Dinner");
  el.refusal = { code: "floor_plan_set.invalid", params: { field: "replaceWith" } };
  await el.updateComplete;
  expect(picker(el)!.error).toBe("Elige otro conjunto.");
  el.refusal = { code: "floor_plan_set.is_default", params: {} };
  await el.updateComplete;
  expect(bottom(el)).toBe("El conjunto predeterminado no se puede eliminar.");
  el.impact = impactOf({ periods: [] });
  await el.updateComplete;
  expect(lines(el)[0]).toBe("Ningún periodo lo usa.");
  el.impact = impactOf({
    periods: [
      { id: "a", name: "Cena" },
      { id: "b", name: "Brunch" },
    ],
    zonesShowing: [
      { id: "inside", name: "Dentro" },
      { id: "terrace", name: "Terraza" },
    ],
  });
  await el.updateComplete;
  expect(lines(el)).toEqual([
    "Usado por Cena y Brunch.",
    "Las mesas se quedan: son comunes a todos los conjuntos.",
    "En sala, Dentro y Terraza mantienen el plano de hoy hasta que alguien pulse Actualizar plano.",
  ]);
});
