import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtCombobox } from "@waitron/ui";
import type { TillModifierPicker } from "../widgets/modifier-picker.js";
import type { TillBasket } from "../widgets/basket.js";
import { DraftStore } from "../state/draft-sync.js";
import type { TillDeadEndsSection } from "../widgets/dead-ends-section.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { beer, mount, resized, store } from "./till-table-order-screen.test-helpers.js";
import { heldViews, placeFor } from "../state/draft-place.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

beforeEach(() => setLocale("en"));
afterEach(async () => {
  cleanupWidgets();
  await page.viewport(1280, 900);
});

async function holding() {
  const mounted = await mount({
    courses: [
      { id: "mains", name: "Mains", displayOrder: 1, heldUntilFired: true },
      { id: "dessert", name: "Dessert", displayOrder: 2, heldUntilFired: true },
    ],
  });
  mounted.host.style.width = "1280px";
  await resized(mounted.el);
  const draft = store(mounted.el) as DraftStore;
  draft.placer = (courseId, exceptIndex) =>
    placeFor(courseId, {
      courses: mounted.el.courses,
      held: heldViews(mounted.el.currentOrders, mounted.el.groups),
      firstOrder: true,
      placed: draft.lines.flatMap((line, index) =>
        index === exceptIndex
          ? []
          : [
              {
                courseId: line.courseId ?? line.product.courseId ?? null,
                place: line.place ?? { kind: "fire" as const },
              },
            ],
      ),
    });
  draft.addProduct(beer, "2");
  await mounted.el.updateComplete;
  return mounted;
}
async function open(el: TillTableOrderScreen, index = 0) {
  const basket = [...el.shadowRoot!.querySelectorAll<TillBasket>("till-basket")].find((each) =>
    each.lineIndexes?.includes(index),
  )!;
  await basket.updateComplete;
  const info = basket.shadowRoot!.querySelector<HTMLElement>(`[data-line-detail="${index}"]`);
  expect(info).not.toBeNull();
  await userEvent.click(info!);
  await basket.updateComplete;
  const picker = basket.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!;
  await picker.updateComplete;
  return picker;
}
function save(picker: TillModifierPicker) {
  return picker.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(".confirm")!;
}
async function course(picker: TillModifierPicker, value: string) {
  const field = picker.shadowRoot!.querySelector<WtCombobox>('[name="course"]')!;
  expect(field).not.toBeNull();
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await picker.updateComplete;
}

it("opens an unsent dish's existing editor with a staged Course and Close, without selecting or sending it", async () => {
  const { el } = await holding();
  const original = store(el).lines[0]!;
  let sends = 0;
  el.addEventListener("submit-draft", () => sends++);
  const picker = await open(el);
  expect(picker.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Beer");
  expect(picker.shadowRoot!.querySelector(".cancel")!.textContent!.trim()).toBe(
    t("table.submitted_close"),
  );
  expect(save(picker).disabled).toBe(true);
  await course(picker, "mains");
  expect(original.courseId).toBeUndefined();
  expect(save(picker).disabled).toBe(false);
  await userEvent.click(save(picker));
  await el.updateComplete;
  expect(store(el).lines[0]).toBe(original);
  expect(original.courseId).toBe("mains");
  expect(original.place).toEqual({ kind: "new", slot: 1 });
  expect(original.quantity).toBe("2");
  expect(original.product.unitPrice).toBe("3.00");
  expect(sends).toBe(0);
  expect(
    el.shadowRoot!.querySelector('[data-draft-select="0"]')!.getAttribute("aria-pressed"),
  ).toBe("false");
});

it("closing an unsaved course leaves the dish and its arrangement unchanged", async () => {
  const { el } = await holding();
  const picker = await open(el);
  await course(picker, "dessert");
  await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".cancel")!);
  await el.updateComplete;
  expect(store(el).lines[0]!.courseId).toBeUndefined();
  expect(store(el).lines[0]!.place).toEqual({ kind: "fire" });
});

it("a retained line editor cannot write after bill takeover", async () => {
  const { el } = await holding();
  const picker = await open(el);
  await course(picker, "mains");
  store(el).lockEdits();
  picker.dispatchEvent(
    new CustomEvent("wt-modifier-confirm", {
      detail: { product: beer, courseId: "mains", note: "stale" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(store(el).lines[0]!.courseId).toBeUndefined();
  expect(store(el).lines[0]!.note).toBeUndefined();
  expect(store(el).lines[0]!.place).toEqual({ kind: "fire" });
});

it("keeps an unavailable reason and symbol in the row and moves Keep/Remove into its line window", async () => {
  const { el } = await holding();
  store(el).lines[0]!.unavailableOnServer = true;
  store(el).emit("changed");
  await el.updateComplete;
  const warning = el.shadowRoot!.querySelector<HTMLElement>("[data-flag-warning]");
  expect(warning).not.toBeNull();
  expect(warning!.textContent).toContain("⚠");
  const controls = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-line-details]")!;
  expect(controls.checkVisibility()).toBe(false);
  const picker = await open(el);
  expect(controls.checkVisibility()).toBe(true);
  const keep = controls.querySelector<HTMLElement>("[data-flag-keep]")!;
  expect(keep.checkVisibility()).toBe(true);
  await userEvent.click(keep);
  await el.updateComplete;
  expect(controls.textContent).toContain(t("table.flag_kept"));
  expect(el.shadowRoot!.activeElement).toBe(controls.querySelector("[data-flag-kept]"));
  expect(store(el).lines[0]!.unavailableOnServer).toBe(true);
  expect(store(el).lines[0]!.quantity).toBe("2");
  expect(picker.shadowRoot!.querySelector("[data-more]")).toBeNull();
});

it("keeps a routing reason on the row and resolves it through its line window", async () => {
  const { el } = await holding();
  const checked = new Promise<{
    sent: readonly import("../state/working-order.js").OrderLine[];
    checkId: number;
  }>((resolve) =>
    el.addEventListener(
      "check-dead-ends",
      (event) => {
        event.preventDefault();
        resolve((event as CustomEvent).detail);
      },
      { once: true },
    ),
  );
  el.billEdit = { billId: el.orderId!, editorVersion: 1, draftId: "draft", draftRevision: 1 };
  el.routingRevision = 1;
  const check = await checked;
  el.answerDeadEnds(
    check.sent,
    {
      sends: true,
      deadEnds: [
        {
          key: "0",
          name: "Beer",
          quantity: "2",
          stationId: "bar",
          stationName: "Bar",
          why: "closed",
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    },
    check.checkId,
  );
  await el.updateComplete;
  const warning = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-routing-warning]")!;
  expect(warning.textContent).toContain("Bar");
  expect(warning.textContent).toContain("⚠");
  expect(warning.querySelector("till-dead-ends-section")).toBeNull();
  await open(el);
  const details = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-line-details]")!;
  const choices = details.querySelector<TillDeadEndsSection>("till-dead-ends-section")!;
  await choices.updateComplete;
  expect(choices.checkVisibility()).toBe(true);
  choices.dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
  await el.updateComplete;
  expect(store(el).lines[0]!.makeAt).toBe("kitchen");
  expect(el.shadowRoot!.querySelector("[data-draft-routing-warning]")).toBeNull();
  expect(store(el).lines[0]!.quantity).toBe("2");
});

it.each(["sending", "locked", "group-command", "departed"] as const)(
  "retained unavailable choices cannot mutate after %s",
  async (state) => {
    const { el } = await holding();
    store(el).lines[0]!.unavailableOnServer = true;
    store(el).emit("changed");
    await el.updateComplete;
    await open(el);
    const remove = el.shadowRoot!.querySelector<HTMLElement>("[data-flag-remove]")!;
    const keep = el.shadowRoot!.querySelector<HTMLElement>("[data-flag-keep]")!;
    if (state === "sending") store(el).sending = true;
    if (state === "locked") store(el).lockEdits();
    if (state === "group-command") el.groupCommandBusy = true;
    if (state === "departed") el.remove();
    keep.click();
    remove.click();
    await el.updateComplete;
    expect(store(el).lines.map((line) => [line.product.id, line.quantity])).toEqual([
      ["beer", "2"],
    ]);
    if (state !== "departed") expect(el.shadowRoot!.querySelector("[data-flag-kept]")).toBeNull();
  },
);

it.each(["group-command", "departed", "other-bill"] as const)(
  "a retained making-station choice refuses edits after %s",
  async (state) => {
    const { el } = await holding();
    el.stations = ["bar", "kitchen"].map((id) => ({
      id,
      name: id,
      open: true,
      active: true,
      isDefault: false,
      byHand: null,
      sendsTo: null,
      why: "default" as const,
    }));
    await el.updateComplete;
    await open(el);
    const station = el.shadowRoot!.querySelector<WtCombobox>('[data-make-at="0"]')!;
    expect(station.checkVisibility()).toBe(true);
    const original = store(el);
    if (state === "group-command") el.groupCommandBusy = true;
    if (state === "departed") el.remove();
    if (state === "other-bill") {
      el.draftStore = new DraftStore();
      el.draftStore.addProduct(beer, "1");
      el.orderId = "other-bill";
    }
    station.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "kitchen" } }));
    expect(original.lines[0]!.makeAt).toBeUndefined();
    expect(original.lines[0]!.quantity).toBe("2");
  },
);

it("shows a retained course without offering that retired course for a new choice", async () => {
  const { el } = await holding();
  store(el).setLineCourse(0, "retired", {
    id: "retired",
    name: "Recorded course",
    displayOrder: 3,
    heldUntilFired: true,
  });
  await el.updateComplete;
  const picker = await open(el);
  const field = picker.shadowRoot!.querySelector<WtCombobox>('[name="course"]')!;
  await field.updateComplete;
  expect(field.options.map((option) => option.value)).toEqual(["", "mains", "dessert"]);
  expect(field.shadowRoot!.querySelector("button .value")!.textContent).toBe("Recorded course");
});
