import { describe, expect, it } from "vitest";
import type { CurrentOrderGroup, TillCourse } from "../api/client.js";
import type { OrderLine } from "./working-order.js";
import { draftLayout, fireGroups, sendAllGroups, panelTotal } from "./draft-layout.js";

const courses: TillCourse[] = [
  { id: "starter", name: "Starters", displayOrder: 1, heldUntilFired: false },
  { id: "main", name: "Mains", displayOrder: 2, heldUntilFired: true },
  { id: "dessert", name: "Desserts", displayOrder: 3, heldUntilFired: true },
];
const line = (
  name: string,
  place: OrderLine["place"],
  courseId?: string,
  over: Partial<OrderLine> = {},
): OrderLine => ({
  product: {
    id: name,
    name,
    unitPrice: "1.00",
    vatClass: "general",
    pricingUnit: "each",
    category: null,
    allergens: null,
  },
  quantity: "1",
  place,
  ...(courseId === undefined ? {} : { courseId }),
  ...over,
});
const group = (
  id: string,
  position: number,
  displayNumber: number,
  state: "held" | "fired" = "held",
): CurrentOrderGroup => ({
  id,
  position,
  displayNumber,
  numberPartyId: "party",
  state,
  firedAt: null,
  remindAt: null,
  sentAt: "2026-10-17T12:00:00.000Z",
  sentBy: null,
  rows: [],
});
const context = (lines: OrderLine[], groups: CurrentOrderGroup[] = []) => ({
  lines,
  courses,
  groups,
  locale: "en",
  nextDisplayNumber: 12,
});

describe("New order layout (A773)", () => {
  it("shows Fire now, new slots and joins in firing order, never the group's sent rows", () => {
    const groups = [group("later", 9, 3), group("early", 2, 7)];
    const lines = [
      line("new later", { kind: "new", slot: 4 }),
      line("join later", { kind: "join", groupId: "later" }),
      line("fire", { kind: "fire" }),
      line("new first", { kind: "new", slot: 2 }),
      line("join first", { kind: "join", groupId: "early" }),
    ];
    const layout = draftLayout(context(lines, groups));
    expect(
      layout.map((part) => ({
        key: part.key,
        kind: part.kind,
        slot: part.slot,
        groupId: part.groupId,
        displayNumber: part.displayNumber,
        indexes: part.sections.flatMap((section) => section.indexes),
      })),
    ).toEqual([
      { key: "fire", kind: "fire", slot: null, groupId: null, displayNumber: null, indexes: [2] },
      { key: "new:2", kind: "new", slot: 2, groupId: null, displayNumber: 13, indexes: [3] },
      { key: "new:4", kind: "new", slot: 4, groupId: null, displayNumber: 14, indexes: [0] },
      {
        key: "join:early",
        kind: "join",
        slot: null,
        groupId: "early",
        displayNumber: 7,
        indexes: [4],
      },
      {
        key: "join:later",
        kind: "join",
        slot: null,
        groupId: "later",
        displayNumber: 3,
        indexes: [1],
      },
    ]);
    expect(groups[0]!.rows).toEqual([]);
  });

  it("starts the first new slot at the server's next number without allocating for an empty Fire now", () => {
    expect(draftLayout(context([line("main", { kind: "new", slot: 8 }, "main")]))[0]).toMatchObject(
      { displayNumber: 12, kind: "new" },
    );
    expect(draftLayout(context([]))).toEqual([]);
  });

  it("shows no-course first and courses by rank, with staff variant names sorted in the chosen locale", () => {
    const lines = [
      line("Z dessert", { kind: "new", slot: 1 }, "dessert"),
      line("Z drink", { kind: "new", slot: 1 }),
      line("Dish", { kind: "new", slot: 1 }, "main", {
        product: {
          ...line("Dish", undefined).product,
          variantName: "Z special",
          customerName: { en: "A customer" },
        },
      }),
      line("A main", { kind: "new", slot: 1 }, "main"),
      line("A drink", { kind: "new", slot: 1 }),
    ];
    const layout = draftLayout({ ...context(lines), courses: [...courses].reverse() });
    expect(layout[0]!.courseNames).toEqual(["Mains", "Desserts"]);
    expect(
      layout[0]!.sections.map((section) => ({
        course: section.course?.id ?? null,
        heading: section.heading,
        indexes: section.indexes,
      })),
    ).toEqual([
      { course: null, heading: true, indexes: [4, 1] },
      { course: "main", heading: true, indexes: [3, 2] },
      { course: "dessert", heading: true, indexes: [0] },
    ]);
  });

  it("does not add a course heading to a single kind and uses matching retained course metadata", () => {
    const retired = { id: "old", name: "Retired course", displayOrder: 4, heldUntilFired: true };
    const data = [
      line("Z", { kind: "fire" }, "old", { course: retired }),
      line("A", { kind: "fire" }, "old", { course: retired }),
    ];
    expect(draftLayout(context(data))[0]).toMatchObject({
      courseNames: ["Retired course"],
      sections: [{ course: retired, heading: false, indexes: [1, 0] }],
    });
    const mismatch = line("No course", { kind: "fire" }, "missing", { course: retired });
    expect(draftLayout(context([mismatch]))[0]).toMatchObject({
      courseNames: [],
      sections: [{ course: null, heading: false, indexes: [0] }],
    });
  });

  it("keeps fired and vanished join targets explicit and invalid until send recovery", () => {
    const lines = [
      line("fired", { kind: "join", groupId: "fired" }),
      line("vanished", { kind: "join", groupId: "gone" }),
    ];
    const layout = draftLayout(context(lines, [group("fired", 1, 5, "fired")]));
    expect(
      layout.map(({ kind, groupId, invalidTarget, displayNumber }) => ({
        kind,
        groupId,
        invalidTarget,
        displayNumber,
      })),
    ).toEqual([
      { kind: "join", groupId: "fired", invalidTarget: true, displayNumber: 5 },
      { kind: "join", groupId: "gone", invalidTarget: true, displayNumber: null },
    ]);
  });

  it("honours product course defaults and uses locale ordering instead of codepoint ordering", () => {
    const data = [
      line("ä", { kind: "fire" }, undefined, {
        product: { ...line("ä", undefined).product, courseId: "main" },
      }),
      line("z", { kind: "fire" }, "main"),
    ];
    expect(draftLayout({ ...context(data), locale: "de" })[0]!.sections[0]!.indexes).toEqual([
      0, 1,
    ]);
    expect(draftLayout({ ...context(data), locale: "sv" })[0]!.sections[0]!.indexes).toEqual([
      1, 0,
    ]);
    expect(draftLayout(context(data))[0]!.courseNames).toEqual(["Mains"]);
  });
});

describe("New order submissions (A773)", () => {
  const groups = [group("g", 1, 9)];
  const lines = [
    line("fire", { kind: "fire" }),
    line("held", { kind: "new", slot: 2, afterGroupId: "g" }),
    line("join", { kind: "join", groupId: "g" }),
    line("held 2", { kind: "new", slot: 2, afterGroupId: "g" }),
    line("sold out", { kind: "fire" }),
  ];
  const sendable = (index: number) => index !== 4;
  it("sends only permitted indexes in the arrangement and preserves held anchors", () => {
    expect(sendAllGroups(lines, groups, sendable)).toEqual([
      { release: "fire", indexes: [0] },
      { release: "hold", indexes: [1, 3], afterGroupId: "g" },
      { release: "hold", indexes: [2], joinGroupId: "g" },
    ]);
  });
  it("fires only selected permitted lines as one batch, leaving every other place untouched", () => {
    const before = structuredClone(lines);
    expect(fireGroups(lines, new Set([0, 2, 4, 99]), sendable)).toEqual([
      { release: "fire", indexes: [0, 2] },
    ]);
    expect(fireGroups(lines, new Set(), sendable)).toEqual([]);
    expect(lines).toEqual(before);
  });
  it("keeps stale join and anchor IDs for server refusal rather than silently sending somewhere else", () => {
    const data = [
      line("stale join", { kind: "join", groupId: "gone" }),
      line("stale anchor", { kind: "new", slot: 1, afterGroupId: "gone" }),
    ];
    expect(sendAllGroups(data, [], () => true)).toEqual([
      { release: "hold", indexes: [1], afterGroupId: "gone" },
      { release: "hold", indexes: [0], joinGroupId: "gone" },
    ]);
    expect(sendAllGroups(data, [], () => false)).toEqual([]);
  });
});

describe("table panel amount (A773)", () => {
  it("adds only this owner's fresh dishes to the stored bill total, including fresh extras", () => {
    const fresh = line("fresh", { kind: "fire" }, undefined, {
      quantity: "2",
      extras: [{ listId: "extras", productId: "sauce", name: "Sauce", quantity: 1, price: "0.25" }],
    });
    const source: NonNullable<OrderLine["source"]> = {
      line: {
        id: "source",
        lineNo: 1,
        name: "already charged",
        productId: "dish",
        parentLineNo: null,
        quantity: "1.000",
        priceQuantity: "1.000",
        unitPrecision: 0,
        unitPriceGross: "7.25",
        servedAt: null,
        courseId: null,
        sentAt: null,
        firedAt: null,
        state: null,
        stationId: null,
        movable: false,
        groupId: null,
        note: null,
        listId: null,
        menuItemId: null,
        parentProductId: null,
      },
      extras: [],
      netAmount: "7.25",
    };
    const recalled = line(
      "live price must not be added",
      { kind: "join", groupId: "held" },
      undefined,
      { source, product: { ...fresh.product, unitPrice: "999.00" } },
    );
    expect(panelTotal("20.00", [fresh, recalled])).toBe("22.50");
    expect(panelTotal("20.00", [recalled])).toBe("20.00");
    expect(panelTotal("20.00", [])).toBe("20.00");
  });
});
