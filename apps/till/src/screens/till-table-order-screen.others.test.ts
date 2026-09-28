import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { OrderLine } from "../state/working-order.js";
import type { OtherDraft, TillTableOrderScreen } from "./till-table-order-screen.js";
import {
  beer,
  burger,
  mount,
  resized,
  shown,
  tap,
} from "./till-table-order-screen.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

const burgerLine: OrderLine = {
  product: burger,
  quantity: "1",
  optionSnapshots: [
    {
      listName: { en: "Doneness" },
      listCustomerName: { en: "How cooked" },
      listKitchenName: "Punto KDS",
      labelName: { en: "Rare" },
      labelCustomerName: { en: "Pink" },
      labelKitchenName: "Poco KDS",
    },
  ],
  extras: [
    { listId: "list-extras", productId: "p-bacon", name: "Bacon", price: "1.00", quantity: 2 },
  ],
  note: "no onion",
};

/** A dish the table's menu no longer offers: the server sends no name for it. */
const gone: OrderLine = {
  product: { ...beer, id: "gone", menuItemId: "offer-gone", name: "", available: false },
  quantity: "3",
  notOffered: true,
  blocked: "removed",
};

const alexs = (over: Partial<OtherDraft> = {}): OtherDraft => ({
  id: "draft-alex",
  revision: 3,
  ownerName: "Alex",
  takenFromYou: false,
  lines: [{ product: beer, quantity: "2" }, burgerLine],
  ...over,
});

const panels = (el: TillTableOrderScreen) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-other-draft]"),
];
const heading = (panel: HTMLElement) =>
  panel.querySelector(".other-draft-title")!.textContent!.trim();
const lineTexts = (panel: HTMLElement) =>
  [...panel.querySelectorAll("[data-other-draft-line]")].map((line) =>
    line.textContent!.replace(/\s+/g, " ").trim(),
  );
const takeOverButton = (panel: HTMLElement) =>
  panel.querySelector<HTMLElement>("[data-take-over]")!;
const dialog = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("[data-take-over-dialog]")!;
const confirmButton = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-take-over-confirm]")!;

/** Settles once the dialog reports it has closed, which the browser does a task after closing. */
const closing = (el: TillTableOrderScreen) =>
  new Promise((resolve) => dialog(el).addEventListener("wt-close", resolve, { once: true }));

/** A screen wide enough to show the draft beside browsing. */
async function wide(over: Partial<TillTableOrderScreen> = {}) {
  const mounted = await mount(over);
  mounted.host.style.width = "1280px";
  await resized(mounted.el);
  return mounted;
}

describe("till-table-order-screen: other people's drafts", () => {
  it("shows no read-only panel when only the person's own draft is on the party", async () => {
    const { el } = await wide();
    await tap(el, "Beer");

    expect(panels(el)).toEqual([]);
    expect(el.shadowRoot!.querySelector("[data-take-over]")).toBeNull();
  });

  it("shows Alex's draft read-only under the person's own, headed with Alex's name, its lines summarised", async () => {
    const { el } = await wide({ otherDrafts: [alexs()] });

    const [panel] = panels(el);
    expect(panel).toBeDefined();
    expect(shown(panel!)).toBe(true);
    expect(el.shadowRoot!.querySelector("[data-draft-pane]")!.contains(panel!)).toBe(true);
    expect(heading(panel!)).toBe("Alex has an unsent order");
    expect(lineTexts(panel!)).toEqual([
      "Beer ×2",
      `Burger ×1 Doneness: Rare Bacon ×2 ${t("line.note.label")}: no onion`,
    ]);
    expect(shown(takeOverButton(panel!))).toBe(true);
    expect(takeOverButton(panel!).textContent!.trim()).toBe(t("table.take_over"));
  });

  it("offers nothing in a read-only panel that changes or sends the lines", async () => {
    const { el } = await wide({ otherDrafts: [alexs()] });
    const [panel] = panels(el);

    expect(
      panel!.querySelectorAll(
        "till-basket, input, select, [data-draft-select], [data-draft-action], [data-split-draft-line], [data-last-added-step]",
      ),
    ).toHaveLength(0);
    expect([...panel!.querySelectorAll("wt-button, button")]).toEqual([takeOverButton(panel!)]);
  });

  it("gives Take over draft a tap target of 44 px each way", async () => {
    const { el } = await wide({ otherDrafts: [alexs()] });
    const box = takeOverButton(panels(el)[0]!).getBoundingClientRect();

    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  it("names an owner the server has no name for as the floor does, and a dish no longer offered honestly", async () => {
    const { el } = await wide({
      otherDrafts: [
        alexs({
          ownerName: "",
          lines: [
            gone,
            {
              product: burger,
              quantity: "1",
              extras: [
                {
                  listId: "list-extras",
                  productId: "p-gone",
                  name: "",
                  price: "0.00",
                  quantity: 1,
                },
              ],
            },
          ],
        }),
      ],
    });
    const [panel] = panels(el);

    expect(heading(panel!)).toBe(t("table.others_draft_unnamed"));
    expect(lineTexts(panel!)).toEqual([
      `${t("basket.not_offered")} ×3`,
      `Burger ×1 ${t("basket.not_offered")}`,
    ]);
  });

  it("heads a draft taken over from the signed-in person with who took it, still read-only with Take over", async () => {
    const { el } = await wide({
      otherDrafts: [alexs({ ownerName: "Sam", takenFromYou: true })],
    });
    const [panel] = panels(el);

    expect(heading(panel!)).toBe("Taken over by Sam");
    expect(panel!.querySelector("[data-draft-action]")).toBeNull();
    expect(shown(takeOverButton(panel!))).toBe(true);
  });

  it("heads one taken over by a person with no name as taken over by someone else", async () => {
    const { el } = await wide({ otherDrafts: [alexs({ ownerName: "", takenFromYou: true })] });

    expect(heading(panels(el)[0]!)).toBe(t("table.draft_taken_by_unnamed"));
  });

  it("shows the panels on Review at phone width, not while browsing", async () => {
    const { el, host } = await mount({ otherDrafts: [alexs()] });
    host.style.width = "390px";
    await resized(el);

    expect(shown(panels(el)[0]!)).toBe(false);
    el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!.click();
    await el.updateComplete;
    expect(shown(panels(el)[0]!)).toBe(true);
  });

  it("reads each heading in Spanish", async () => {
    setLocale("es");
    const { el } = await wide({
      otherDrafts: [alexs(), alexs({ id: "draft-sam", ownerName: "Sam", takenFromYou: true })],
    });

    expect(panels(el).map(heading)).toEqual(["Alex tiene un pedido sin enviar", "Tomado por Sam"]);
  });
});

describe("till-table-order-screen: Take over draft", () => {
  it("asks first, naming whose order and what happens, and Cancel sends nothing", async () => {
    const { el } = await wide({ otherDrafts: [alexs()] });
    const heard = vi.fn();
    el.addEventListener("take-over-draft", heard);

    takeOverButton(panels(el)[0]!).click();
    await el.updateComplete;

    expect(dialog(el).open).toBe(true);
    expect((dialog(el) as unknown as { heading: string }).heading).toBe("Take over Alex's order?");
    expect(el.shadowRoot!.querySelector("[data-take-over-body]")!.textContent!.trim()).toBe(
      "It becomes yours to change and send; Alex can no longer change or send it.",
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-take-over-cancel]")!.click();
    await el.updateComplete;

    expect(dialog(el).open).toBe(false);
    expect(heard).not.toHaveBeenCalled();
  });

  it("names no one in the question when the owner has no name", async () => {
    const { el } = await wide({ otherDrafts: [alexs({ ownerName: "" })] });
    takeOverButton(panels(el)[0]!).click();
    await el.updateComplete;

    expect((dialog(el) as unknown as { heading: string }).heading).toBe(
      t("table.take_over_title_unnamed"),
    );
    expect(el.shadowRoot!.querySelector("[data-take-over-body]")!.textContent!.trim()).toBe(
      t("table.take_over_body_unnamed"),
    );
  });

  it("sends one take-over of the draft at the revision shown, and keeps Confirm off until it is answered", async () => {
    const { el } = await wide({ otherDrafts: [alexs()] });
    const heard: unknown[] = [];
    el.addEventListener("take-over-draft", (event) => heard.push((event as CustomEvent).detail));
    takeOverButton(panels(el)[0]!).click();
    await el.updateComplete;

    confirmButton(el).click();
    await el.updateComplete;
    confirmButton(el).click();
    await el.updateComplete;

    expect(heard).toEqual([{ draftId: "draft-alex", revision: 3 }]);
    expect(dialog(el).open).toBe(true);
    expect(confirmButton(el).disabled).toBe(true);
    expect(takeOverButton(panels(el)[0]!).hasAttribute("disabled")).toBe(true);

    el.takeOversAnswered += 1;
    await el.updateComplete;

    expect(dialog(el).open).toBe(false);
    expect(takeOverButton(panels(el)[0]!).hasAttribute("disabled")).toBe(false);
    takeOverButton(panels(el)[0]!).click();
    await el.updateComplete;
    expect(confirmButton(el).disabled).toBe(false);
    confirmButton(el).click();
    expect(heard).toHaveLength(2);
  });

  it("keeps the dialog open on Escape while the take-over is out, and lets Escape close it before", async () => {
    const { el } = await wide({ otherDrafts: [alexs()] });
    const heard = vi.fn();
    el.addEventListener("take-over-draft", heard);
    takeOverButton(panels(el)[0]!).click();
    await el.updateComplete;

    confirmButton(el).click();
    await el.updateComplete;
    await userEvent.keyboard("{Escape}");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await el.updateComplete;

    expect(dialog(el).open).toBe(true);
    expect(heard).toHaveBeenCalledOnce();
    el.takeOversAnswered += 1;
    await el.updateComplete;
    takeOverButton(panels(el)[0]!).click();
    await el.updateComplete;
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(dialog(el).open).toBe(false));
    expect(heard).toHaveBeenCalledOnce();
  });

  it("puts focus on the person's own order once the taken draft has left the panels", async () => {
    const { el } = await wide({ otherDrafts: [alexs()] });
    takeOverButton(panels(el)[0]!).click();
    await el.updateComplete;
    confirmButton(el).click();
    await el.updateComplete;

    const closed = closing(el);
    el.otherDrafts = [];
    el.takeOversAnswered += 1;
    await closed;
    await el.updateComplete;

    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("#draft-title"));
  });

  it("leaves focus on Take over when the draft is still there after the answer", async () => {
    const { el } = await wide({ otherDrafts: [alexs()] });
    takeOverButton(panels(el)[0]!).click();
    await el.updateComplete;
    confirmButton(el).click();
    await el.updateComplete;

    const closed = closing(el);
    el.takeOversAnswered += 1;
    await closed;
    await el.updateComplete;

    expect(el.shadowRoot!.activeElement).toBe(takeOverButton(panels(el)[0]!));
  });

  it("stays open through three Escapes while the take-over is out, and moves focus when it answers", async () => {
    const { el } = await wide({ otherDrafts: [alexs()] });
    takeOverButton(panels(el)[0]!).click();
    await el.updateComplete;
    confirmButton(el).click();
    await el.updateComplete;
    const cancel = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-take-over-cancel]",
    )!;

    for (let press = 0; press < 3; press += 1) {
      await userEvent.keyboard("{Escape}");
      await new Promise((resolve) => setTimeout(resolve, 50));
      await el.updateComplete;
      expect(dialog(el).shadowRoot!.querySelector("dialog")!.open).toBe(true);
    }
    expect(cancel.disabled).toBe(true);

    const closed = closing(el);
    el.otherDrafts = [];
    el.takeOversAnswered += 1;
    await closed;
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("#draft-title"));
  });

  it("names the last-added bar's steps for a dish no longer offered", async () => {
    const { el } = await wide();
    el.draftStore!.addProduct({ ...beer, id: "gone", menuItemId: "offer-gone", name: "" }, "2");
    await el.updateComplete;

    const steps = [...el.shadowRoot!.querySelectorAll("[data-last-added-step]")].map((step) =>
      step.getAttribute("aria-label"),
    );
    expect(steps).toEqual([
      `${t("basket.decrease")} · ${t("basket.not_offered")}`,
      `${t("basket.increase")} · ${t("basket.not_offered")}`,
    ]);
  });

  it("says a take-over is out, not a send, while it locks the person's own order", async () => {
    const { el } = await wide({ otherDrafts: [alexs()] });
    await tap(el, "Flan");
    takeOverButton(panels(el)[0]!).click();
    await el.updateComplete;
    confirmButton(el).click();
    el.draftStore!.sending = true;
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("[data-round-sending]")!.textContent!.trim()).toBe(
      t("table.taking_over"),
    );
  });

  it("offers no Take over while the person's own draft is being sent", async () => {
    const { el } = await wide({ otherDrafts: [alexs()] });
    await tap(el, "Flan");
    el.draftStore!.sending = true;
    el.requestUpdate();
    await el.updateComplete;

    expect(takeOverButton(panels(el)[0]!).hasAttribute("disabled")).toBe(true);
  });
});
