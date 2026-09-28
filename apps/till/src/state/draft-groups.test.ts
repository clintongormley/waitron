import { describe, expect, it } from "vitest";
import {
  draftPreview,
  draftSections,
  draftSubmission,
  itemCount,
  type DraftAction,
  type DraftEntry,
} from "./draft-groups.js";

// Listed out of display order, so sections that follow the list rather than `displayOrder` fail.
const drinks = { id: "drinks", name: "Drinks", displayOrder: 0 };
const starters = { id: "starters", name: "Starters", displayOrder: 1 };
const mains = { id: "mains", name: "Mains", displayOrder: 2 };
const courses = [mains, drinks, starters];

const entry = (courseId: string | null, quantity = "1", wholeUnits = true): DraftEntry => ({
  courseId,
  quantity,
  wholeUnits,
});

describe("draftSections (pre-sorting the draft)", () => {
  it("puts Steak, Beer and Croquetas in three sections in the venue's course order", () => {
    // Steak (default "Mains"), Beer ("Drinks"), Croquetas ("Starters"), rung in that order.
    const sections = draftSections([entry("mains"), entry("drinks"), entry("starters")], courses);

    expect(sections).toEqual([
      { course: drinks, lineIndexes: [1] },
      { course: starters, lineIndexes: [2] },
      { course: mains, lineIndexes: [0] },
    ]);
  });

  it("puts a line with no default course, or a course the till does not list, in the first section", () => {
    const sections = draftSections(
      [entry("mains"), entry(null), entry("starters"), entry("retired"), entry("starters")],
      courses,
    );

    expect(sections).toEqual([
      { course: starters, lineIndexes: [1, 2, 3, 4] },
      { course: mains, lineIndexes: [0] },
    ]);
  });

  it("makes one section with no course when no line has a course the till lists", () => {
    expect(draftSections([entry(null), entry("retired")], courses)).toEqual([
      { course: null, lineIndexes: [0, 1] },
    ]);
    expect(draftSections([entry("mains"), entry(null)], [])).toEqual([
      { course: null, lineIndexes: [0, 1] },
    ]);
  });

  it("makes no section for an empty draft", () => {
    expect(draftSections([], courses)).toEqual([]);
  });
});

describe("itemCount", () => {
  it("counts a line sold by the unit by its quantity, and a weighed line as one item", () => {
    expect(itemCount(entry(null, "3"))).toBe(3);
    expect(itemCount(entry(null, "3.000"))).toBe(3);
    expect(itemCount(entry(null, "0.450", false))).toBe(1);
    expect(itemCount(entry(null, "2", false))).toBe(1);
  });
});

// Beer ×2 (Drinks), Steak ×2 and Fish (Mains), Croquetas ×4 (Starters), a weighed Octopus with no
// course: rung out of course order so a group that follows the ringing order rather than the
// screen's fails.
const draft = [
  entry("drinks", "2"),
  entry("mains", "2"),
  entry("starters", "4"),
  entry(null, "0.450", false),
  entry("mains"),
];

describe("draftSubmission", () => {
  it("Send all holds one group per section, in section order, and empties the draft", () => {
    expect(draftSubmission({ kind: "send-all" }, draft, courses, new Set())).toEqual({
      groups: [
        { release: "hold", lineIndexes: [0, 3] },
        { release: "hold", lineIndexes: [2] },
        { release: "hold", lineIndexes: [1, 4] },
      ],
      remaining: [],
    });
  });

  it("Fire all now fires the whole draft as one group, in the order the screen shows it", () => {
    expect(draftSubmission({ kind: "fire-all" }, draft, courses, new Set())).toEqual({
      groups: [{ release: "fire", lineIndexes: [0, 3, 2, 1, 4] }],
      remaining: [],
    });
  });

  it("Send selected holds the selection as one group and leaves the rest in the draft", () => {
    expect(draftSubmission({ kind: "send-selected" }, draft, courses, new Set([4, 2]))).toEqual({
      groups: [{ release: "hold", lineIndexes: [2, 4] }],
      remaining: [0, 1, 3],
    });
  });

  it("Fire selected now fires the selection as one group and leaves the rest in the draft", () => {
    expect(draftSubmission({ kind: "fire-selected" }, draft, courses, new Set([1, 0]))).toEqual({
      groups: [{ release: "fire", lineIndexes: [0, 1] }],
      remaining: [2, 3, 4],
    });
  });

  it("sends nothing for a selected action with nothing selected", () => {
    for (const kind of ["send-selected", "fire-selected"] as const) {
      expect(draftSubmission({ kind }, draft, courses, new Set())).toEqual({
        groups: [],
        remaining: [0, 1, 2, 3, 4],
      });
    }
  });

  it("ignores a selected index the draft does not have", () => {
    expect(draftSubmission({ kind: "fire-selected" }, draft, courses, new Set([7, 3]))).toEqual({
      groups: [{ release: "fire", lineIndexes: [3] }],
      remaining: [0, 1, 2, 4],
    });
  });

  it("a later addition fires, joins or adds as a new group the selection, or everything when nothing is selected", () => {
    const selected = new Set([4, 1]);
    expect(draftSubmission({ kind: "fire-now" }, draft, courses, selected)).toEqual({
      groups: [{ release: "fire", lineIndexes: [1, 4] }],
      remaining: [0, 2, 3],
    });
    expect(
      draftSubmission({ kind: "add-to-held", groupId: "g-3" }, draft, courses, selected),
    ).toEqual({
      groups: [{ release: "hold", lineIndexes: [1, 4] }],
      joinGroupId: "g-3",
      remaining: [0, 2, 3],
    });
    expect(draftSubmission({ kind: "add-as-new" }, draft, courses, selected)).toEqual({
      groups: [{ release: "hold", lineIndexes: [1, 4] }],
      remaining: [0, 2, 3],
    });
    expect(draftSubmission({ kind: "fire-now" }, draft, courses, new Set())).toEqual({
      groups: [{ release: "fire", lineIndexes: [0, 3, 2, 1, 4] }],
      remaining: [],
    });
    expect(
      draftSubmission({ kind: "add-to-held", groupId: "g-3" }, draft, courses, new Set()),
    ).toEqual({
      groups: [{ release: "hold", lineIndexes: [0, 3, 2, 1, 4] }],
      joinGroupId: "g-3",
      remaining: [],
    });
    expect(draftSubmission({ kind: "add-as-new" }, draft, courses, new Set())).toEqual({
      groups: [{ release: "hold", lineIndexes: [0, 3, 2, 1, 4] }],
      remaining: [],
    });
  });

  it("submits nothing, and joins no group, for an empty draft", () => {
    const actions: DraftAction[] = [
      { kind: "send-all" },
      { kind: "fire-all" },
      { kind: "fire-now" },
      { kind: "add-to-held", groupId: "g-3" },
      { kind: "add-as-new" },
    ];
    for (const action of actions) {
      expect(draftSubmission(action, [], courses, new Set())).toEqual({
        groups: [],
        remaining: [],
      });
    }
  });
});

describe("draftPreview", () => {
  const preview = (action: DraftAction, selected: ReadonlySet<number>) =>
    draftPreview(draftSubmission(action, draft, courses, selected), draft);

  it("counts the items it fires and the groups it holds", () => {
    const none = new Set<number>();
    // Items: Beer 2 + Steak 2 + Croquetas 4 + one weighed Octopus + Fish 1.
    expect(preview({ kind: "fire-all" }, none)).toEqual({
      fireItems: 10,
      holdGroups: 0,
      holdItems: 0,
    });
    expect(preview({ kind: "send-all" }, none)).toEqual({
      fireItems: 0,
      holdGroups: 3,
      holdItems: 10,
    });
    // The weighed Octopus (0.450) is one item; Beer ×2 is two.
    expect(preview({ kind: "fire-selected" }, new Set([0, 3]))).toEqual({
      fireItems: 3,
      holdGroups: 0,
      holdItems: 0,
    });
    expect(preview({ kind: "add-to-held", groupId: "g-3" }, new Set([2]))).toEqual({
      fireItems: 0,
      holdGroups: 1,
      holdItems: 4,
    });
  });
});

describe("draftSubmission: lines that cannot be sold now", () => {
  // Beer ×2 (Drinks) and Steak ×2 (Mains) can be sent; Croquetas ×4 (Starters) cannot.
  const flaggedDraft = [
    entry("drinks", "2"),
    { ...entry("starters", "4"), flagged: true },
    entry("mains", "2"),
  ];

  it("leaves a flagged line out of Send all and Fire all, keeping it in the draft and naming it", () => {
    expect(draftSubmission({ kind: "send-all" }, flaggedDraft, courses, new Set())).toEqual({
      groups: [
        { release: "hold", lineIndexes: [0] },
        { release: "hold", lineIndexes: [2] },
      ],
      remaining: [1],
      leftOut: [1],
    });
    expect(draftSubmission({ kind: "fire-all" }, flaggedDraft, courses, new Set())).toEqual({
      groups: [{ release: "fire", lineIndexes: [0, 2] }],
      remaining: [1],
      leftOut: [1],
    });
  });

  it("leaves a flagged line out of a selection and of a later addition the same way", () => {
    const selected = new Set([1, 2]);
    for (const kind of ["send-selected", "fire-selected", "fire-now", "add-as-new"] as const) {
      const submission = draftSubmission({ kind }, flaggedDraft, courses, selected);
      expect(submission.groups.flatMap((group) => group.lineIndexes)).toEqual([2]);
      expect(submission.leftOut).toEqual([1]);
      expect(submission.remaining).toEqual([0, 1]);
    }
    const joining = draftSubmission(
      { kind: "add-to-held", groupId: "g-3" },
      flaggedDraft,
      courses,
      new Set(),
    );
    expect(joining).toEqual({
      groups: [{ release: "hold", lineIndexes: [0, 2] }],
      joinGroupId: "g-3",
      remaining: [1],
      leftOut: [1],
    });
  });

  it("names no flagged line outside the selection as left out", () => {
    expect(draftSubmission({ kind: "fire-selected" }, flaggedDraft, courses, new Set([0]))).toEqual(
      { groups: [{ release: "fire", lineIndexes: [0] }], remaining: [1, 2] },
    );
  });

  it("sends nothing, and joins no group, when every line in scope is flagged", () => {
    const allFlagged = flaggedDraft.map((each) => ({ ...each, flagged: true }));
    expect(
      draftSubmission({ kind: "add-to-held", groupId: "g-3" }, allFlagged, courses, new Set()),
    ).toEqual({ groups: [], remaining: [0, 1, 2], leftOut: [0, 1, 2] });
  });
});
