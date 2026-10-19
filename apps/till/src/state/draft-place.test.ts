import { describe, expect, it } from "vitest";
import type {
  CurrentOrderRow,
  CurrentOrders,
  OrderGroup,
  TillCourse,
  TillProduct,
} from "../api/client.js";
import { heldViews, placeFor, type PlaceContext } from "./draft-place.js";
import { draftLayout, sendAllGroups } from "./draft-layout.js";
import { DraftStore } from "./draft-sync.js";

const courses: TillCourse[] = [
  { id: "starters", name: "Starters", displayOrder: 1, heldUntilFired: false },
  { id: "mains", name: "Mains", displayOrder: 2, heldUntilFired: true },
  { id: "desserts", name: "Desserts", displayOrder: 3, heldUntilFired: true },
];

const context = (changes: Partial<PlaceContext> = {}): PlaceContext => ({
  courses,
  held: [],
  firstOrder: true,
  placed: [],
  ...changes,
});

describe("placeFor: the first order", () => {
  it("sends a switched-off product course first as Fire now, ahead of live held Mains", () => {
    const store = new DraftStore();
    store.placer = (courseId) => placeFor(courseId, context());
    const product: TillProduct = {
      id: "live",
      name: "Main",
      courseId: "mains",
      unitPrice: "2.00",
      vatClass: "general",
      pricingUnit: "each",
      category: null,
      allergens: null,
    };
    store.addProduct(product, "1");
    store.addProduct(
      { ...product, id: "inactive", name: "Switched-off course", courseId: "switched-off" },
      "2",
    );
    expect(sendAllGroups(store.lines, [], () => true)).toEqual([
      { release: "fire", indexes: [1] },
      { release: "hold", indexes: [0] },
    ]);
    expect(
      draftLayout({
        lines: store.lines,
        courses,
        groups: [],
        locale: "en",
        nextDisplayNumber: 1,
      }).map((group) => ({
        kind: group.kind,
        indexes: group.sections.flatMap((section) => section.indexes),
      })),
    ).toEqual([
      { kind: "fire", indexes: [1] },
      { kind: "new", indexes: [0] },
    ]);
  });

  it.each([true, false])(
    "fires an unlisted course before considering matching held work (first order: %s)",
    (firstOrder) => {
      expect(
        placeFor(
          "switched-off",
          context({
            firstOrder,
            held: [{ id: "old-held", position: 1, courseIds: new Set(["switched-off"]) }],
            placed: [{ courseId: "switched-off", place: { kind: "new", slot: 2 } }],
          }),
        ),
      ).toEqual({ place: { kind: "fire" } });
    },
  );

  it.each([null, "starters"])("puts %s in Fire now", (id) => {
    expect(placeFor(id, context())).toEqual({ place: { kind: "fire" } });
  });

  it("starts a held Mains group", () => {
    expect(placeFor("mains", context())).toEqual({ place: { kind: "new", slot: 1 } });
  });

  it("puts Desserts after draft Mains", () => {
    expect(
      placeFor(
        "desserts",
        context({
          placed: [{ courseId: "mains", place: { kind: "new", slot: 1 } }],
        }),
      ),
    ).toEqual({ place: { kind: "new", slot: 2 } });
  });

  it("adds another Main to draft Mains", () => {
    expect(
      placeFor(
        "mains",
        context({
          placed: [{ courseId: "mains", place: { kind: "new", slot: 2 } }],
        }),
      ),
    ).toEqual({ place: { kind: "new", slot: 2 } });
  });

  it("inserts Mains before draft Desserts and shifts that slot", () => {
    expect(
      placeFor(
        "mains",
        context({
          placed: [{ courseId: "desserts", place: { kind: "new", slot: 1 } }],
        }),
      ),
    ).toEqual({ place: { kind: "new", slot: 1 }, shift: { from: 1 } });
  });

  it("inserts Mains before a manually held no-course slot", () => {
    expect(
      placeFor(
        "mains",
        context({
          placed: [{ courseId: null, place: { kind: "new", slot: 1 } }],
        }),
      ),
    ).toEqual({ place: { kind: "new", slot: 1 }, shift: { from: 1 } });
  });

  it("fires a course no longer listed instead of allocating a held slot", () => {
    expect(
      placeFor(
        "retained",
        context({
          placed: [{ courseId: "desserts", place: { kind: "new", slot: 3 } }],
        }),
      ),
    ).toEqual({ place: { kind: "fire" } });
  });

  it("uses course order rather than the input array order", () => {
    expect(
      placeFor(
        "mains",
        context({
          courses: [...courses].reverse(),
          placed: [{ courseId: "desserts", place: { kind: "new", slot: 4 } }],
        }),
      ),
    ).toEqual({ place: { kind: "new", slot: 4 }, shift: { from: 4 } });
  });
});

describe("placeFor: later additions", () => {
  const held = [{ id: "g3", position: 3, courseIds: new Set(["mains"]) }];

  it.each(["starters", "mains", "desserts"])(
    "puts %s in Fire now when nothing remains held",
    (id) => {
      expect(placeFor(id, context({ firstOrder: false }))).toEqual({ place: { kind: "fire" } });
    },
  );

  it("joins the table's held Mains", () => {
    expect(placeFor("mains", context({ firstOrder: false, held }))).toEqual({
      place: { kind: "join", groupId: "g3" },
    });
  });

  it.each([null, "starters"])("keeps %s in Fire now beside held Mains", (id) => {
    expect(placeFor(id, context({ firstOrder: false, held }))).toEqual({ place: { kind: "fire" } });
  });

  it("makes a new Desserts group after held Mains", () => {
    expect(placeFor("desserts", context({ firstOrder: false, held }))).toEqual({
      place: { kind: "new", slot: 1 },
    });
  });

  it("fires a late main when only Desserts remains held", () => {
    expect(
      placeFor(
        "mains",
        context({
          firstOrder: false,
          held: [{ id: "dessert-group", position: 4, courseIds: new Set(["desserts"]) }],
        }),
      ),
    ).toEqual({ place: { kind: "fire" } });
  });

  it("compares a late main with every held course, not only the last group", () => {
    expect(
      placeFor(
        "mains",
        context({
          firstOrder: false,
          held: [
            { id: "dessert-group", position: 4, courseIds: new Set(["desserts"]) },
            { id: "manually-late-starter", position: 8, courseIds: new Set(["starters"]) },
          ],
        }),
      ),
    ).toEqual({ place: { kind: "fire" } });
  });

  it("includes later courses in a mixed held group when placing a late main", () => {
    expect(
      placeFor(
        "mains",
        context({
          firstOrder: false,
          held: [{ id: "mixed", position: 4, courseIds: new Set(["starters", "desserts"]) }],
        }),
      ),
    ).toEqual({ place: { kind: "fire" } });
  });

  it("fires a retained course with no known rank when it has no existing destination", () => {
    expect(placeFor("retained", context({ firstOrder: false, held }))).toEqual({
      place: { kind: "fire" },
    });
  });

  it("fires a new dessert when a retained held course has no known rank", () => {
    expect(
      placeFor(
        "desserts",
        context({
          firstOrder: false,
          held: [...held, { id: "retained-group", position: 5, courseIds: new Set(["retained"]) }],
        }),
      ),
    ).toEqual({ place: { kind: "fire" } });
  });

  it("does not place a different course with the same rank after a held course", () => {
    expect(
      placeFor(
        "another-main",
        context({
          firstOrder: false,
          courses: [
            ...courses,
            { id: "another-main", name: "Another main", displayOrder: 2, heldUntilFired: true },
          ],
          held,
        }),
      ),
    ).toEqual({ place: { kind: "fire" } });
  });

  it("fires an unlisted retained course instead of joining its old held group", () => {
    expect(
      placeFor(
        "retained",
        context({
          firstOrder: false,
          held: [{ id: "retained-group", position: 5, courseIds: new Set(["retained"]) }],
        }),
      ),
    ).toEqual({ place: { kind: "fire" } });
  });

  it("fires an unlisted retained course instead of joining its old draft slot", () => {
    expect(
      placeFor(
        "retained",
        context({
          firstOrder: false,
          held,
          placed: [{ courseId: "retained", place: { kind: "new", slot: 2, afterGroupId: "g3" } }],
        }),
      ),
    ).toEqual({ place: { kind: "fire" } });
  });

  it("joins draft Desserts and keeps its manually chosen anchor", () => {
    expect(
      placeFor(
        "desserts",
        context({
          firstOrder: false,
          held,
          placed: [{ courseId: "desserts", place: { kind: "new", slot: 2, afterGroupId: "g3" } }],
        }),
      ),
    ).toEqual({ place: { kind: "new", slot: 2, afterGroupId: "g3" } });
  });

  it("uses an unsent course already joining a held group", () => {
    expect(
      placeFor(
        "desserts",
        context({
          firstOrder: false,
          held,
          placed: [{ courseId: "desserts", place: { kind: "join", groupId: "g3" } }],
        }),
      ),
    ).toEqual({ place: { kind: "join", groupId: "g3" } });
  });

  it("joins the first matching held group by firing order", () => {
    expect(
      placeFor(
        "mains",
        context({
          firstOrder: false,
          held: [{ id: "g9", position: 9, courseIds: new Set(["mains"]) }, ...held],
        }),
      ),
    ).toEqual({ place: { kind: "join", groupId: "g3" } });
  });

  it("joins an earlier new group rather than a later sent group of the same course", () => {
    expect(
      placeFor(
        "desserts",
        context({
          firstOrder: false,
          held: [...held, { id: "g9", position: 9, courseIds: new Set(["desserts"]) }],
          placed: [{ courseId: "desserts", place: { kind: "new", slot: 1, afterGroupId: "g3" } }],
        }),
      ),
    ).toEqual({ place: { kind: "new", slot: 1, afterGroupId: "g3" } });
  });

  it("uses the first matching draft slot despite line order", () => {
    expect(
      placeFor(
        "desserts",
        context({
          firstOrder: false,
          held,
          placed: [
            { courseId: "desserts", place: { kind: "new", slot: 8 } },
            { courseId: "desserts", place: { kind: "new", slot: 2 } },
          ],
        }),
      ),
    ).toEqual({ place: { kind: "new", slot: 2 } });
  });

  it("keeps using a manually created draft group after all sent groups were fired", () => {
    expect(
      placeFor(
        "mains",
        context({
          firstOrder: false,
          placed: [{ courseId: "mains", place: { kind: "new", slot: 3 } }],
        }),
      ),
    ).toEqual({ place: { kind: "new", slot: 3 } });
  });
});

const row = (lineId: string, courseId: string | null): CurrentOrderRow => ({
  billStatus: "open",
  netAmount: "2.00",
  readyAt: null,
  firedAt: null,
  lineId,
  courseId,
  workingOrderId: "bill1",
  lineNo: 1,
  name: lineId,
  quantity: "1",
  unitPrecision: 0,
  servedQuantity: "0",
  servedAt: null,
  released: false,
  kitchen: null,
  note: null,
  extras: [],
});
const group = (id: string, position: number, state: "held" | "fired" = "held"): OrderGroup => ({
  courseIds: [],
  id,
  position,
  displayNumber: position,
  numberPartyId: "v1",
  state,
  firedAt: state === "held" ? null : "2026-10-16T20:00:00Z",
  remindAt: null,
  lineIds: [],
  summary: id,
});

describe("heldViews", () => {
  it("keeps the retained course set when the group's dishes are hidden from Sent", () => {
    expect(
      heldViews(null, [{ ...group("g3", 3), courseIds: ["mains", "retained", "mains"] }]),
    ).toEqual([{ id: "g3", position: 3, courseIds: new Set(["mains", "retained"]) }]);
  });

  it("keeps held groups in firing order and collects recorded courses from every bill", () => {
    const current: CurrentOrders = {
      hasGroups: true,
      nextDisplayNumber: 4,
      retainedCourses: [],
      revision: 3,
      reminder: null,
      ungrouped: [row("ungrouped", "desserts")],
      groups: [
        {
          ...group("g3", 3),
          sentAt: "2026-10-16T20:00:00Z",
          sentBy: null,
          rows: [
            row("one", "mains"),
            { ...row("two", "retained"), workingOrderId: "bill2" },
            row("three", "mains"),
            row("drink", null),
          ],
        },
        {
          ...group("g2", 2),
          sentAt: "2026-10-16T20:00:00Z",
          sentBy: null,
          rows: [row("stale", "desserts")],
        },
      ],
    };
    expect(heldViews(current, [group("g3", 3), group("g2", 2, "fired"), group("g1", 1)])).toEqual([
      { id: "g1", position: 1, courseIds: new Set() },
      { id: "g3", position: 3, courseIds: new Set(["mains", "retained"]) },
    ]);
  });

  it("keeps held groups when their rows have not arrived", () => {
    expect(heldViews(null, [group("g3", 3)])).toEqual([
      { id: "g3", position: 3, courseIds: new Set() },
    ]);
  });
});
