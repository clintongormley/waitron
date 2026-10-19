import { afterEach, describe, expect, it, vi } from "vitest";
import type { Draft, DraftLine, RecalledDraftLine, TabLine } from "../api/client.js";
import { draftSnapshot, partyDraftSnapshot, draftServer } from "../widgets/test-helpers.js";
import {
  fromDraftLine,
  orderLineMergeKey,
  rebuildReturned,
  toDraftLineInput,
} from "./draft-lines.js";
import { DraftSync } from "./draft-sync.js";
import { lineGross } from "./order-line.js";
import { WorkingOrderStore, type OrderLine } from "./working-order.js";

const parent = (): TabLine => ({
  id: "sent-dish",
  name: "Recorded double burger",
  productId: "variant-retired",
  parentProductId: "burger",
  menuItemId: null,
  lineNo: 7,
  parentLineNo: null,
  quantity: "2.000",
  priceQuantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "7.50",
  listUnitPriceGross: "10.00",
  servedAt: null,
  courseId: "course-old",
  sentAt: "2026-10-16T18:00:00.000Z",
  firedAt: null,
  state: null,
  stationId: "grill",
  movable: true,
  groupId: "g1",
  note: "Recorded note",
  listId: null,
  optionSnapshots: [
    {
      listName: { "es-ES": "Recorded doneness" },
      listCustomerName: { "es-ES": "Customer doneness" },
      listKitchenName: "Kitchen doneness",
      labelName: { "es-ES": "Recorded rare" },
      labelCustomerName: { "es-ES": "Customer rare" },
      labelKitchenName: "Kitchen rare",
    },
  ],
});

const recalled = (id = "reference-1", sourceId = "sent-dish"): RecalledDraftLine => ({
  id,
  sourceLineId: sourceId,
  source: {
    line: { ...parent(), id: sourceId },
    extras: [
      {
        ...parent(),
        id: `${sourceId}-extra`,
        name: "Recorded cheese",
        lineNo: 8,
        parentLineNo: 7,
        productId: "cheese-retired",
        parentProductId: null,
        quantity: "4.000",
        unitPriceGross: "0.75",
        listUnitPriceGross: "1.00",
        listId: "toppings-retired",
        optionSnapshots: undefined,
      },
    ],
    netAmount: "17.25",
  },
  quantity: "2.000",
  note: "Recorded note",
  courseId: "course-old",
  course: { id: "course-old", name: "Recorded course", displayOrder: 3, heldUntilFired: true },
  makeAt: "grill",
  noMerge: true,
  unavailable: false,
  slot: 0,
  joinGroupId: "g1",
  afterGroupId: null,
});

const own = (lines: DraftLine[]): Draft => ({
  id: "draft-1",
  partyId: "party-1",
  billId: "bill-1",
  ownerId: "person-1",
  ownerName: "Ana",
  revision: 1,
  lines,
  takenOverFrom: null,
});

afterEach(() => vi.useRealTimers());

describe("recalled draft sources", () => {
  it.each(["missing-source", "different-source", "detached-row"] as const)(
    "keeps the recorded family when a %s refresh answers an earlier edit",
    (stale) => {
      const store = new WorkingOrderStore();
      const original = fromDraftLine(recalled(), new Map());
      store.loadFrom("draft-1", [original]);
      const line = store.lines[0]!;
      const source = line.source;
      const incoming = fromDraftLine(recalled("other-reference", "other-recorded"), new Map());
      if (stale === "missing-source") delete incoming.source;
      let changes = 0;
      store.subscribe(() => changes++);
      store.refreshRecalledLine(stale === "detached-row" ? { ...line } : line, incoming);
      expect(store.lines[0]).toBe(line);
      expect(line.source).toBe(source);
      expect(line.source!.line.id).toBe("sent-dish");
      expect(line.source!.extras[0]!.id).toBe("sent-dish-extra");
      expect(lineGross(line)).toBe("17.25");
      expect(store.dirty).toBe(false);
      expect(changes).toBe(0);
    },
  );

  it("hydrates a menu-less family from its frozen names, choices, price and original allergy identity", () => {
    let restored!: OrderLine;
    expect(() => {
      restored = fromDraftLine(recalled(), new Map());
    }).not.toThrow();
    expect(restored).toMatchObject({
      draftLineId: "reference-1",
      workingOrderLineId: "sent-dish",
      product: { id: "variant-retired", name: "Recorded double burger", unitPrice: "7.50" },
      quantity: "2",
      note: "Recorded note",
      courseId: "course-old",
      course: { id: "course-old", name: "Recorded course", displayOrder: 3, heldUntilFired: true },
      makeAt: "grill",
      place: { kind: "join", groupId: "g1" },
      optionSnapshots: parent().optionSnapshots,
      noMerge: true,
    });
    expect(restored.notOfferedExtras).toEqual([
      { productId: "cheese-retired", name: "Recorded cheese", price: "0.75", quantity: 2 },
    ]);
    for (const flag of ["notOffered", "blocked", "earlierPriceUnknown", "unavailableOnServer"])
      expect(restored).not.toHaveProperty(flag);
  });

  it("sends source identity and placement without menu identity, frozen prices or display choices", () => {
    const line: OrderLine = Object.assign(
      {
        product: {
          id: "gone",
          name: "Recorded",
          unitPrice: "7.50",
          vatClass: "general" as const,
          category: null,
          allergens: null,
        },
        quantity: "2",
        draftLineId: "reference-1",
        note: " Recorded note ",
        courseId: "course-old",
        makeAt: "grill",
        place: { kind: "new" as const, slot: 2, afterGroupId: "g2" },
      },
      { source: recalled().source },
    );
    let input: unknown;
    expect(() => {
      input = toDraftLineInput(line);
    }).not.toThrow();
    expect(input).toEqual({
      id: "reference-1",
      sourceLineId: "sent-dish",
      quantity: "2",
      note: "Recorded note",
      courseId: "course-old",
      makeAt: "grill",
      slot: 2,
      joinGroupId: null,
      afterGroupId: "g2",
    });
  });

  it("uses the stored family net amount, including discounts and extras, for the draft total", () => {
    const line: OrderLine = Object.assign(
      {
        product: {
          id: "gone",
          name: "Recorded",
          unitPrice: "7.50",
          vatClass: "general" as const,
          category: null,
          allergens: null,
        },
        quantity: "2",
        notOfferedExtras: [
          { productId: "cheese-retired", name: "Recorded cheese", price: "0.75", quantity: 2 },
        ],
      },
      { source: recalled().source },
    );
    expect(lineGross(line)).toBe("17.25");
    const store = new WorkingOrderStore();
    store.loadFrom("draft", [line]);
    expect(store.total).toBe("17.25");
  });

  it("keeps source identities out of fresh-dish merging even with a retained menu item", () => {
    const line: OrderLine = Object.assign(
      {
        product: {
          id: "burger",
          menuItemId: "offer-burger",
          name: "Recorded",
          unitPrice: "7.50",
          vatClass: "general" as const,
          category: null,
          allergens: null,
        },
        quantity: "2",
        draftLineId: "reference-1",
      },
      { source: recalled().source },
    );
    expect(orderLineMergeKey(line)).toBeNull();
    const store = new WorkingOrderStore();
    store.loadFrom("draft", [line]);
    store.addMerging(line.product, "1");
    expect(store.lines.map((row) => row.quantity)).toEqual(["2", "1"]);
  });

  it("round-trips a source with no product or retained menu and preserves weighed precision", () => {
    const wire = recalled();
    wire.source.line.productId = null;
    wire.source.line.unitPrecision = 3;
    wire.source.line.quantity = "0.350";
    Object.assign(wire, {
      quantity: "0.350",
      courseId: null,
      course: undefined,
      note: null,
      makeAt: null,
      joinGroupId: null,
    });
    let line!: OrderLine;
    expect(() => {
      line = fromDraftLine(wire, new Map());
    }).not.toThrow();
    expect(line.quantity).toBe("0.350");
    expect(line.product.name).toBe("Recorded double burger");
    expect(line.product.menuItemId).toBeUndefined();
    expect(toDraftLineInput(line)).toEqual({
      id: "reference-1",
      sourceLineId: "sent-dish",
      quantity: "0.350",
      note: null,
      courseId: null,
      makeAt: null,
      slot: 0,
      joinGroupId: null,
      afterGroupId: null,
    });
    expect(rebuildReturned([line], new Map(), new Map()).size).toBe(0);
  });

  it("does not keep a save answer that swapped the source behind the same reference", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const first = recalled();
    const api = {
      listDrafts: vi.fn(async () => Promise.resolve([own([first])]).then(partyDraftSnapshot)),
      saveDraft: vi.fn(async () =>
        Promise.resolve({
          ...own([{ ...recalled("reference-1", "replacement"), slot: 2, joinGroupId: null }]),
          revision: 2,
        }).then(draftSnapshot),
      ),
      takeOverDraft: vi.fn(),
    };
    const sync = new DraftSync({
      api,
      partyId: "party-1",
      billId: "bill-1",
      personId: "person-1",
      rebuild: (lines) => lines.map((line) => fromDraftLine(line, new Map())),
      onRefused: vi.fn(),
      requestLimitMs: 5000,
    });
    try {
      expect(await sync.load()).toBe(true);
      sync.store.setLinePlaces([0], { kind: "new", slot: 2 });
      expect(await sync.flush()).toBe("saved");
      expect(sync.store.lines[0]?.workingOrderLineId).toBe("replacement");
      expect(sync.lineIds([0])).toEqual(["reference-1"]);
    } finally {
      sync.drop();
    }
  });

  it.each([false, true])(
    "refreshes the frozen source after a save, with an in-flight edit: %s",
    async (edit) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let answer!: (draft: Draft) => void;
      const api = {
        listDrafts: vi.fn(async () =>
          Promise.resolve([own([recalled()])]).then(partyDraftSnapshot),
        ),
        saveDraft: vi.fn(() =>
          Promise.resolve(
            new Promise<Draft>((resolve) => {
              answer = resolve;
            }),
          ).then(draftSnapshot),
        ),
        takeOverDraft: vi.fn(),
      };
      const sync = new DraftSync({
        api,
        partyId: "party-1",
        billId: "bill-1",
        personId: "person-1",
        rebuild: (lines) => lines.map((line) => fromDraftLine(line, new Map())),
        onRefused: vi.fn(),
        requestLimitMs: 5000,
      });
      try {
        await sync.load();
        const local = sync.store.lines[0]!;
        sync.store.setLinePlaces([0], { kind: "new", slot: 2 });
        expect(sync.store.total).toBe("17.25");
        const saving = sync.flush();
        await vi.waitFor(() => expect(api.saveDraft).toHaveBeenCalledOnce());
        if (edit) sync.store.setLineExtras(0, { note: "Local note" });
        const changed = recalled();
        changed.source.netAmount = "12.00";
        changed.source.line.name = "Latest stored name";
        changed.slot = 2;
        changed.joinGroupId = null;
        answer({ ...own([changed]), revision: 2 });
        expect(await saving).toBe("saved");
        expect(sync.store.lines[0]).toBe(local);
        expect(sync.store.total).toBe("12.00");
        expect(sync.store.lines[0]?.source?.line.name).toBe("Latest stored name");
        expect(sync.store.lines[0]?.product.name).toBe("Latest stored name");
        expect(toDraftLineInput(sync.store.lines[0]!)).toMatchObject({
          id: "reference-1",
          sourceLineId: "sent-dish",
          note: edit ? "Local note" : "Recorded note",
        });
        expect(sync.lineIds([0])).toEqual(edit ? null : ["reference-1"]);
      } finally {
        sync.drop();
      }
    },
  );

  it("keeps the frozen extras visible when only the source's placement changes", () => {
    const store = new WorkingOrderStore();
    store.loadFrom("draft", [fromDraftLine(recalled(), new Map())]);
    store.setLinePlaces([0], { kind: "new", slot: 2 });
    expect(store.lines[0]?.notOfferedExtras).toEqual([
      { productId: "cheese-retired", name: "Recorded cheese", price: "0.75", quantity: 2 },
    ]);
  });

  it("does not attach a save's changed source reference to a local in-flight edit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let answer!: (draft: Draft) => void;
    const api = {
      listDrafts: vi.fn(async () => Promise.resolve([own([recalled()])]).then(partyDraftSnapshot)),
      saveDraft: vi.fn(() =>
        Promise.resolve(
          new Promise<Draft>((resolve) => {
            answer = resolve;
          }),
        ).then(draftSnapshot),
      ),
      takeOverDraft: vi.fn(),
    };
    const sync = new DraftSync({
      api,
      partyId: "party-1",
      billId: "bill-1",
      personId: "person-1",
      rebuild: (lines) => lines.map((line) => fromDraftLine(line, new Map())),
      onRefused: vi.fn(),
      requestLimitMs: 5000,
    });
    try {
      await sync.load();
      sync.store.setLinePlaces([0], { kind: "new", slot: 2 });
      const saving = sync.flush();
      await vi.waitFor(() => expect(api.saveDraft).toHaveBeenCalledOnce());
      sync.store.setLineExtras(0, { note: "Local note" });
      answer({ ...own([recalled("reference-1", "replacement")]), revision: 2 });
      expect(await saving).toBe("saved");
      expect(sync.store.lines[0]?.workingOrderLineId).toBe("sent-dish");
      expect(sync.store.lines[0]).not.toHaveProperty("draftLineId");
      expect(await sync.flush()).toBe("failed");
      expect(api.saveDraft).toHaveBeenCalledOnce();
    } finally {
      sync.drop();
    }
  });

  it("the shared draft server retains frozen sources across save and takeover", () => {
    const server = draftServer();
    server.personId = "person-1";
    server.drafts = [own([recalled()])];
    server.linesById.set("reference-1", recalled());
    const input = {
      id: "reference-1",
      sourceLineId: "sent-dish",
      quantity: "2.000",
      note: "Recorded note",
      courseId: "course-old",
      makeAt: "grill",
      slot: 2,
      joinGroupId: null,
      afterGroupId: null,
    };
    const saved = server.save("party-1", {
      billId: "bill-1",
      draftId: "draft-1",
      revision: 1,
      lines: [input],
    });
    expect(saved.lines[0]).toMatchObject({ ...recalled(), slot: 2, joinGroupId: null });
    server.personId = "person-2";
    const taken = server.takeOver("party-1", "draft-1", 2);
    expect(taken.lines[0]).toMatchObject({ ...recalled(), slot: 2, joinGroupId: null });
    expect(taken.ownerId).toBe("person-2");
  });

  it("sends explicitly edited recalled choices, without frozen names or prices", () => {
    const store = new WorkingOrderStore();
    store.loadFrom("draft", [fromDraftLine(recalled(), new Map())]);
    store.setLineModifiers(0, {
      options: [{ listId: "doneness", labelId: "medium" }],
      optionSnapshots: [{ ...parent().optionSnapshots![0]!, labelKitchenName: "Medium" }],
      extras: [
        {
          listId: "toppings",
          productId: "bacon",
          name: "Fresh bacon",
          price: "99.00",
          quantity: 2,
        },
      ],
    });
    expect(toDraftLineInput(store.lines[0]!)).toEqual({
      id: "reference-1",
      sourceLineId: "sent-dish",
      quantity: "2",
      note: "Recorded note",
      courseId: "course-old",
      makeAt: "grill",
      slot: 0,
      joinGroupId: "g1",
      afterGroupId: null,
      options: [{ listId: "doneness", labelId: "medium" }],
      extras: [{ listId: "toppings", picks: [{ productId: "bacon", quantity: 2 }] }],
    });
    expect(store.lines[0]?.optionSnapshots?.[0]?.labelKitchenName).toBe("Medium");
    expect(store.lines[0]?.notOfferedExtras).toBeUndefined();
    expect(store.total).toBe("17.25");
  });

  it("sends explicit empty recalled choices when the picker removes them all", () => {
    const store = new WorkingOrderStore();
    store.loadFrom("draft", [fromDraftLine(recalled(), new Map())]);
    store.setLineModifiers(0, {});
    expect(toDraftLineInput(store.lines[0]!)).toMatchObject({ options: [], extras: [] });
    store.setLineExtras(0, { note: "New note" });
    expect(toDraftLineInput(store.lines[0]!)).toMatchObject({
      options: [],
      extras: [],
      note: "New note",
    });
  });

  it.each(["none", "note", "choices"])(
    "acknowledges source choices while preserving a later %s edit",
    async (later) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let answer!: (draft: Draft) => void;
      const api = {
        listDrafts: vi.fn(async () =>
          Promise.resolve([own([recalled()])]).then(partyDraftSnapshot),
        ),
        saveDraft: vi.fn(() =>
          Promise.resolve(
            new Promise<Draft>((resolve) => {
              answer = resolve;
            }),
          ).then(draftSnapshot),
        ),
        takeOverDraft: vi.fn(),
      };
      const sync = new DraftSync({
        api,
        partyId: "party-1",
        billId: "bill-1",
        personId: "person-1",
        rebuild: (lines) => lines.map((line) => fromDraftLine(line, new Map())),
        onRefused: vi.fn(),
        requestLimitMs: 5000,
      });
      try {
        await sync.load();
        sync.store.setLineModifiers(0, {
          options: [{ listId: "doneness", labelId: "medium" }],
          optionSnapshots: [{ ...parent().optionSnapshots![0]!, labelKitchenName: "Medium" }],
        });
        const saving = sync.flush();
        await vi.waitFor(() => expect(api.saveDraft).toHaveBeenCalledOnce());
        if (later === "note") sync.store.setLineExtras(0, { note: "Later note" });
        if (later === "choices")
          sync.store.setLineModifiers(0, {
            options: [{ listId: "doneness", labelId: "well" }],
            optionSnapshots: [{ ...parent().optionSnapshots![0]!, labelKitchenName: "Well done" }],
            extras: [
              { listId: "toppings", productId: "bacon", name: "Bacon", price: "3.00", quantity: 1 },
            ],
          });
        const changed = recalled();
        changed.source.line.optionSnapshots = [
          { ...parent().optionSnapshots![0]!, labelKitchenName: "Saved medium" },
        ];
        changed.source.extras = [];
        changed.source.netAmount = "15.00";
        answer({ ...own([changed]), revision: 2 });
        expect(await saving).toBe("saved");
        const line = sync.store.lines[0]!;
        expect(line.source?.line.optionSnapshots?.[0]?.labelKitchenName).toBe("Saved medium");
        expect(line.optionSnapshots?.[0]?.labelKitchenName).toBe(
          later === "choices" ? "Well done" : "Saved medium",
        );
        expect(toDraftLineInput(line)).toMatchObject({
          sourceLineId: "sent-dish",
          note: later === "note" ? "Later note" : "Recorded note",
        });
        if (later === "choices") {
          expect(toDraftLineInput(line)).toMatchObject({
            options: [{ listId: "doneness", labelId: "well" }],
            extras: [{ listId: "toppings", picks: [{ productId: "bacon", quantity: 1 }] }],
          });
        } else {
          expect(toDraftLineInput(line)).not.toHaveProperty("options");
          expect(toDraftLineInput(line)).not.toHaveProperty("extras");
          expect(line.extras).toBeUndefined();
          expect(line.options).toBeUndefined();
        }
        expect(sync.store.total).toBe("15.00");
      } finally {
        sync.drop();
      }
    },
  );

  it("consumes an acknowledged empty picker edit before another note save", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const changed = recalled();
    changed.source.line.optionSnapshots = [];
    changed.source.extras = [];
    const api = {
      listDrafts: vi.fn(async () => Promise.resolve([own([recalled()])]).then(partyDraftSnapshot)),
      saveDraft: vi.fn(async () =>
        Promise.resolve({ ...own([changed]), revision: 2 }).then(draftSnapshot),
      ),
      takeOverDraft: vi.fn(),
    };
    const sync = new DraftSync({
      api,
      partyId: "party-1",
      billId: "bill-1",
      personId: "person-1",
      rebuild: (lines) => lines.map((line) => fromDraftLine(line, new Map())),
      onRefused: vi.fn(),
      requestLimitMs: 5000,
    });
    try {
      await sync.load();
      sync.store.setLineModifiers(0, {});
      expect(await sync.flush()).toBe("saved");
      sync.store.setLineExtras(0, { note: "Later note" });
      expect(toDraftLineInput(sync.store.lines[0]!)).not.toHaveProperty("options");
      expect(toDraftLineInput(sync.store.lines[0]!)).not.toHaveProperty("extras");
      expect(sync.store.lines[0]?.optionSnapshots).toBeUndefined();
      expect(sync.store.lines[0]?.notOfferedExtras).toBeUndefined();
    } finally {
      sync.drop();
    }
  });

  it("does not restore frozen extras over a picker edit made during a note save", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let answer!: (draft: Draft) => void;
    const api = {
      listDrafts: vi.fn(async () => Promise.resolve([own([recalled()])]).then(partyDraftSnapshot)),
      saveDraft: vi.fn(() =>
        Promise.resolve(
          new Promise<Draft>((resolve) => {
            answer = resolve;
          }),
        ).then(draftSnapshot),
      ),
      takeOverDraft: vi.fn(),
    };
    const sync = new DraftSync({
      api,
      partyId: "party-1",
      billId: "bill-1",
      personId: "person-1",
      rebuild: (lines) => lines.map((line) => fromDraftLine(line, new Map())),
      onRefused: vi.fn(),
      requestLimitMs: 5000,
    });
    try {
      await sync.load();
      sync.store.setLineExtras(0, { note: "New note" });
      const saving = sync.flush();
      await vi.waitFor(() => expect(api.saveDraft).toHaveBeenCalledOnce());
      sync.store.setLineModifiers(0, {
        extras: [
          { listId: "toppings", productId: "bacon", name: "Bacon", price: "3.00", quantity: 1 },
        ],
      });
      answer({ ...own([{ ...recalled(), note: "New note" }]), revision: 2 });
      expect(await saving).toBe("saved");
      expect(sync.store.lines[0]?.notOfferedExtras).toBeUndefined();
      expect(sync.store.lines[0]?.extras?.map((extra) => extra.productId)).toEqual(["bacon"]);
      expect(toDraftLineInput(sync.store.lines[0]!)).toMatchObject({
        options: [],
        extras: [{ listId: "toppings", picks: [{ productId: "bacon", quantity: 1 }] }],
      });
      expect(sync.store.total).toBe("17.25");
    } finally {
      sync.drop();
    }
  });
});
