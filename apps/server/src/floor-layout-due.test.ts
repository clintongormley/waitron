import { describe, expect, it } from "vitest";
import { layoutOffer, type ZoneLayoutState } from "./floor-layout-due.js";

const LUNCH = "lunch-12:00";
const DINNER = "dinner-20:00";

function state(
  recorded: ZoneLayoutState["recorded"],
  due: ZoneLayoutState["due"],
): ZoneLayoutState {
  return { zoneId: "zone", recorded, due };
}

const standard = (revision: number, occurrence: string | null = LUNCH) => ({
  setId: "standard",
  setName: "Standard",
  revision,
  occurrence,
  periodName: occurrence === null ? null : occurrence === LUNCH ? "Lunch" : "Dinner",
});

describe("the layout offered to a zone", () => {
  it("is nothing when the recorded set and revision are the due ones", () => {
    expect(
      layoutOffer(state({ setId: "standard", revision: 3, occurrence: LUNCH }, standard(3))),
    ).toBeNull();
  });

  it("names no period for a newer revision of the same set", () => {
    expect(
      layoutOffer(state({ setId: "standard", revision: 3, occurrence: LUNCH }, standard(4))),
    ).toEqual({ setId: "standard", revision: 4, periodName: null });
  });

  it("names the due period for another set of another occurrence", () => {
    expect(
      layoutOffer(
        state(
          { setId: "standard", revision: 3, occurrence: LUNCH },
          {
            setId: "dinner",
            setName: "Dinner",
            revision: 2,
            occurrence: DINNER,
            periodName: "Dinner",
          },
        ),
      ),
    ).toEqual({ setId: "dinner", revision: 2, periodName: "Dinner" });
  });

  it("names no period for another set of the same occurrence", () => {
    expect(
      layoutOffer(
        state(
          { setId: "standard", revision: 3, occurrence: LUNCH },
          { setId: "party", setName: "Party", revision: 1, occurrence: LUNCH, periodName: "Lunch" },
        ),
      ),
    ).toEqual({ setId: "party", revision: 1, periodName: null });
  });

  it("names no period when the due layout has no occurrence", () => {
    expect(
      layoutOffer(state({ setId: "dinner", revision: 2, occurrence: DINNER }, standard(3, null))),
    ).toEqual({ setId: "standard", revision: 3, periodName: null });
  });

  it("names no period when the recorded set was deleted and Standard is due", () => {
    expect(
      layoutOffer(state({ setId: null, revision: 2, occurrence: DINNER }, standard(3, DINNER))),
    ).toEqual({ setId: "standard", revision: 3, periodName: null });
  });

  it("names the new period when the recorded set was deleted and the due run is another", () => {
    expect(
      layoutOffer(state({ setId: null, revision: 2, occurrence: LUNCH }, standard(3, DINNER))),
    ).toEqual({ setId: "standard", revision: 3, periodName: "Dinner" });
  });

  it("is nothing before the day's first reset has recorded a layout", () => {
    expect(layoutOffer(state(null, standard(3)))).toBeNull();
  });

  it("is nothing when no layout is due", () => {
    expect(
      layoutOffer(state({ setId: "standard", revision: 3, occurrence: LUNCH }, null)),
    ).toBeNull();
  });
});
