import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { OrdinaryDateDialog } from "./ordinary-date-dialog.js";
import "./ordinary-date-dialog.js";

let el: OrdinaryDateDialog;
let opener: HTMLButtonElement;
beforeEach(() => setLocale("en"));
afterEach(async () => {
  el?.remove();
  opener?.remove();
  setLocale("en");
  await page.viewport(1280, 800);
});
const specials = [
  { id: "d1", name: "Christmas company dinners" },
  { id: "d2", name: "New Year" },
];

async function mount(setup: (dialog: OrdinaryDateDialog) => void = () => {}) {
  opener = document.createElement("button");
  opener.textContent = "10";
  document.body.append(opener);
  opener.focus();
  el = document.createElement("ordinary-date-dialog");
  el.date = "2026-12-10";
  el.season = { id: "winter", name: "Winter" };
  el.tint = "2";
  el.specialDays = specials;
  el.returnTo = () => opener;
  setup(el);
  el.open = true;
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const q = <T extends Element = HTMLElement>(selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const text = (selector: string) => q(selector)?.textContent?.replace(/\s+/g, " ").trim();
function next<T>(name: string) {
  return new Promise<CustomEvent<T>>((resolve) =>
    el.addEventListener(name, (event) => resolve(event as CustomEvent<T>), { once: true }),
  );
}

it("titles the dialog with the full date and its weekday, in English and in Spanish", async () => {
  await mount();
  expect(text("[data-test=date]")).toBe("Thursday 10 December 2026");
  expect(q("wt-modal")!.getAttribute("aria-label")).toBe("Thursday 10 December 2026");
  el.remove();
  setLocale("es");
  await mount();
  expect(text("[data-test=date]")).toBe("jueves, 10 de diciembre de 2026");
});

it("names the season in its chip, its line and its button, tinted as the month tints it", async () => {
  await mount();
  const chip = q("[data-test=season]")!;
  expect(chip.textContent!.trim()).toBe("Winter");
  expect(chip.dataset.tint).toBe("2");
  expect(text("[data-test=follows]")).toBe("This date follows the Winter week.");
  expect(q("[data-test=follows] strong")!.textContent).toBe("Winter");
  expect(text("[data-test=edit-week]")).toBe("Edit the Winter week");
  expect(text("[data-test=make-special]")).toBe("Make this a special day…");
  expect(q("[data-test=make-special]")!.getAttribute("variant")).toBe("primary");
  expect(q("[data-test=edit-week]")!.getAttribute("variant")).toBe("secondary");
});

it("reads in Spanish", async () => {
  setLocale("es");
  await mount();
  expect(text("[data-test=follows]")).toBe("Esta fecha sigue la semana de Winter.");
  expect(text("[data-test=edit-week]")).toBe("Editar la semana de Winter");
  expect(text("[data-test=make-special]")).toBe("Convertir en día especial…");
  expect(text("[data-test=add-label]")).toBe("O añádela a un día especial existente:");
  expect(text("[data-test=add-to-special]")).toBe("Añadir");
});

it("sends the season to edit, closes, and hands focus back", async () => {
  await mount();
  const sent = next<{ seasonId: string }>("ordinary-date-edit-week");
  q("[data-test=edit-week]")!.click();
  expect((await sent).detail).toEqual({ seasonId: "winter" });
  expect(el.open).toBe(false);
  await el.updateComplete;
  expect(q("wt-modal")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it("sends the date to make a special day of, and closes", async () => {
  await mount();
  const sent = next<{ date: string }>("ordinary-date-make-special");
  q("[data-test=make-special]")!.click();
  expect((await sent).detail).toEqual({ date: "2026-12-10" });
  expect(el.open).toBe(false);
  expect(document.activeElement).toBe(opener);
});

it("keeps Add secondary and disabled until a special day is chosen, then sends it and closes", async () => {
  await mount();
  const box = q<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox[name=specialDayId]")!;
  expect(box.options.map((option) => option.label)).toEqual([
    "Christmas company dinners",
    "New Year",
  ]);
  const add = q<HTMLElementTagNameMap["wt-button"]>("[data-test=add-to-special]")!;
  expect(add.disabled).toBe(true);
  expect(add.getAttribute("variant")).toBe("secondary");
  let sentEarly = false;
  el.addEventListener("ordinary-date-add-to-special", () => (sentEarly = true));
  await chooseOption(box, "d2");
  await el.updateComplete;
  expect(sentEarly).toBe(false);
  expect(add.disabled).toBe(false);
  expect(add.getAttribute("variant")).toBe("secondary");
  expect(
    [...el.shadowRoot!.querySelectorAll("wt-button[variant=primary]")].map((b) =>
      b.getAttribute("data-test"),
    ),
  ).toEqual(["make-special"]);
  const sent = next<{ date: string; specialDayId: string }>("ordinary-date-add-to-special");
  add.click();
  expect((await sent).detail).toEqual({ date: "2026-12-10", specialDayId: "d2" });
  expect(el.open).toBe(false);
});

it("keeps the picker and Add side by side, at a desktop's width and a phone's", async () => {
  const middle = (node: Element) => {
    const box = node.getBoundingClientRect();
    return box.top + box.height / 2;
  };
  for (const width of [1280, 390]) {
    await page.viewport(width, 800);
    await mount();
    await chooseOption(q("wt-combobox[name=specialDayId]")!, "d1");
    await el.updateComplete;
    const box = q("wt-combobox[name=specialDayId]")!;
    expect(middle(q("[data-test=add-to-special]")!), `${width}`).toBeCloseTo(middle(box), 0);
    expect(q("[data-test=add-to-special]")!.getBoundingClientRect().right).toBeLessThanOrEqual(
      q("[data-test=add-row]")!.getBoundingClientRect().right + 0.5,
    );
    el.remove();
  }
});

it("forgets a choice when it reopens", async () => {
  await mount();
  await chooseOption(q("wt-combobox[name=specialDayId]")!, "d1");
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  expect(q<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox[name=specialDayId]")!.value).toBe("");
  expect(q<HTMLElementTagNameMap["wt-button"]>("[data-test=add-to-special]")!.disabled).toBe(true);
});

it("leaves out the add row when the venue has no special days", async () => {
  await mount((dialog) => (dialog.specialDays = []));
  expect(q("[data-test=add-row]")).toBeNull();
  expect(q("wt-combobox")).toBeNull();
  expect(q("[data-test=make-special]")).not.toBeNull();
});

it("closes on Escape and on ✕, sending only wt-close, and hands focus back", async () => {
  for (const how of ["escape", "dismiss"]) {
    await mount();
    const sent: string[] = [];
    for (const name of [
      "ordinary-date-edit-week",
      "ordinary-date-make-special",
      "ordinary-date-add-to-special",
    ])
      el.addEventListener(name, () => sent.push(name));
    const closed = next("wt-close");
    if (how === "escape") {
      q<HTMLElement>("[data-test=make-special]")!.focus();
      await userEvent.keyboard("{Escape}");
    } else {
      expect(q("[data-test=dismiss]")!.getAttribute("aria-label")).toBe("Close");
      q("[data-test=dismiss]")!.click();
    }
    await closed;
    await el.updateComplete;
    expect(el.open).toBe(false);
    expect(q("wt-modal")).toBeNull();
    expect(sent).toEqual([]);
    await expect.poll(() => document.activeElement).toBe(opener);
    el.remove();
    opener.remove();
  }
});

it("hands focus to the element returnTo names now, when the clicked one has been redrawn", async () => {
  await mount();
  const redrawn = document.createElement("button");
  document.body.append(redrawn);
  el.returnTo = () => redrawn;
  opener.remove();
  const closed = next("wt-close");
  q<HTMLElement>("[data-test=make-special]")!.focus();
  await userEvent.keyboard("{Escape}");
  await closed;
  await expect.poll(() => document.activeElement).toBe(redrawn);
  redrawn.remove();
});

it("fits a phone's width, its buttons wrapping", async () => {
  await page.viewport(390, 800);
  await mount();
  const modal = q("wt-modal")!.shadowRoot!.querySelector("dialog")!;
  const frame = modal.getBoundingClientRect();
  for (const selector of [
    "[data-test=edit-week]",
    "[data-test=make-special]",
    "[data-test=add-to-special]",
    "wt-combobox",
    "[data-test=date]",
  ]) {
    const box = q(selector)!.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(frame.left);
    expect(box.right).toBeLessThanOrEqual(frame.right);
  }
  const body = modal.querySelector(".body")!;
  expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
});

it("names no season and offers no week when the date follows none, keeping the special-day choices", async () => {
  await mount((dialog) => (dialog.season = undefined));
  expect(text("[data-test=date]")).toBe("Thursday 10 December 2026");
  expect(q("[data-test=season]")).toBeNull();
  expect(q("[data-test=follows]")).toBeNull();
  expect(q("[data-test=edit-week]")).toBeNull();
  expect(text("[data-test=make-special]")).toBe("Make this a special day…");
  expect(q("[data-test=add-row]")).not.toBeNull();
});

it("draws the season's chip untinted when it is given no tint", async () => {
  await mount((dialog) => (dialog.tint = ""));
  expect(q("[data-test=season]")!.textContent!.trim()).toBe("Winter");
  expect(q("[data-test=season]")!.hasAttribute("data-tint")).toBe(false);
});

it("sends only the first of two actions clicked before it closes", async () => {
  await mount();
  const sent: string[] = [];
  for (const name of ["ordinary-date-edit-week", "ordinary-date-make-special"])
    el.addEventListener(name, () => sent.push(name));
  const first = next("ordinary-date-edit-week");
  q("[data-test=edit-week]")!.click();
  q("[data-test=make-special]")!.click();
  await first;
  await el.updateComplete;
  expect(sent).toEqual(["ordinary-date-edit-week"]);
});

it("sends nothing when Add is clicked with no special day chosen", async () => {
  await mount();
  let sent = false;
  el.addEventListener("ordinary-date-add-to-special", () => (sent = true));
  q("[data-test=add-to-special]")!.click();
  await el.updateComplete;
  expect(sent).toBe(false);
  expect(el.open).toBe(true);
});

it("does not take focus back on a close that arrives after an action", async () => {
  await mount();
  const modal = q("wt-modal")!;
  const sent = next("ordinary-date-make-special");
  q("[data-test=make-special]")!.click();
  await sent;
  const elsewhere = document.createElement("button");
  document.body.append(elsewhere);
  elsewhere.focus();
  modal.dispatchEvent(new CustomEvent("wt-close", { detail: { reason: "cancel" } }));
  await el.updateComplete;
  expect(document.activeElement).toBe(elsewhere);
  elsewhere.remove();
});
