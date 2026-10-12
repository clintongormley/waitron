import { describe, expect, it } from "vitest";
import {
  layerPaint,
  layerZonePaint,
  paintFromEdit,
  zonePaintFromEdit,
  type PaintRange,
  type ZonePaint,
} from "./day-paint.js";
import type { ClosedRange, ServiceRange } from "./service-day.js";

const DINNER = "00000000-0000-4000-8000-000000000001";
const LUNCH = "00000000-0000-4000-8000-000000000002";
const CUTOVER = "06:00";

const winter: ServiceRange[] = [{ periodId: DINNER, startsAt: "20:00", endsAt: "23:30" }];

describe("layerPaint", () => {
  it("keeps the season's Dinner after a shorter painted Dinner, joined", () =>
    expect(
      layerPaint(winter, [{ periodId: DINNER, startsAt: "19:00", endsAt: "22:00" }], CUTOVER),
    ).toEqual([{ periodId: DINNER, startsAt: "19:00", endsAt: "23:30" }]));

  it("ends the night at 22:00 under painted Closed", () =>
    expect(
      layerPaint(
        winter,
        [
          { periodId: DINNER, startsAt: "19:00", endsAt: "22:00" },
          { periodId: null, startsAt: "22:00", endsAt: "23:30" },
        ],
        CUTOVER,
      ),
    ).toEqual([{ periodId: DINNER, startsAt: "19:00", endsAt: "22:00" }]));

  it("splits Dinner around a painted Lunch", () =>
    expect(
      layerPaint(
        [{ periodId: DINNER, startsAt: "19:00", endsAt: "23:00" }],
        [{ periodId: LUNCH, startsAt: "20:00", endsAt: "21:00" }],
        CUTOVER,
      ),
    ).toEqual([
      { periodId: DINNER, startsAt: "19:00", endsAt: "20:00" },
      { periodId: LUNCH, startsAt: "20:00", endsAt: "21:00" },
      { periodId: DINNER, startsAt: "21:00", endsAt: "23:00" },
    ]));

  it("lays paint across midnight within the business day", () =>
    expect(
      layerPaint(winter, [{ periodId: DINNER, startsAt: "23:00", endsAt: "02:00" }], CUTOVER),
    ).toEqual([{ periodId: DINNER, startsAt: "20:00", endsAt: "02:00" }]));

  it("orders the day from the changeover, not from midnight", () =>
    expect(
      layerPaint(
        [{ periodId: DINNER, startsAt: "20:00", endsAt: "01:00" }],
        [{ periodId: LUNCH, startsAt: "12:00", endsAt: "16:00" }],
        CUTOVER,
      ),
    ).toEqual([
      { periodId: LUNCH, startsAt: "12:00", endsAt: "16:00" },
      { periodId: DINNER, startsAt: "20:00", endsAt: "01:00" },
    ]));

  it("reads an end equal to the changeover as the end of the day", () =>
    expect(
      layerPaint(
        [{ periodId: DINNER, startsAt: "20:00", endsAt: "23:00" }],
        [{ periodId: DINNER, startsAt: "22:00", endsAt: "06:00" }],
        CUTOVER,
      ),
    ).toEqual([{ periodId: DINNER, startsAt: "20:00", endsAt: "06:00" }]));

  it("fills the whole day from a range that starts and ends at the changeover", () =>
    expect(
      layerPaint([], [{ periodId: LUNCH, startsAt: "06:00", endsAt: "06:00" }], CUTOVER),
    ).toEqual([{ periodId: LUNCH, startsAt: "06:00", endsAt: "06:00" }]));

  it("closes the whole day under Closed painted across it", () =>
    expect(
      layerPaint(winter, [{ periodId: null, startsAt: "06:00", endsAt: "06:00" }], CUTOVER),
    ).toEqual([]));

  it("leaves the season as it is with no paint", () =>
    expect(layerPaint(winter, [], CUTOVER)).toEqual(winter));
});

describe("layerZonePaint", () => {
  const closures: ClosedRange[] = [{ startsAt: "22:00", endsAt: "23:30" }];

  it("cuts an Open stretch out of a season closure", () =>
    expect(
      layerZonePaint(closures, [{ kind: "open", startsAt: "22:00", endsAt: "23:00" }], CUTOVER),
    ).toEqual([{ startsAt: "23:00", endsAt: "23:30" }]));

  it("adds Closed paint to the closures, joined where it touches", () =>
    expect(
      layerZonePaint(
        closures,
        [
          { kind: "closed", startsAt: "12:00", endsAt: "14:00" },
          { kind: "closed", startsAt: "23:30", endsAt: "02:00" },
        ],
        CUTOVER,
      ),
    ).toEqual([
      { startsAt: "12:00", endsAt: "14:00" },
      { startsAt: "22:00", endsAt: "02:00" },
    ]));
});

describe("paintFromEdit", () => {
  const season: ServiceRange[] = [
    { periodId: LUNCH, startsAt: "13:00", endsAt: "16:00" },
    { periodId: DINNER, startsAt: "20:00", endsAt: "23:30" },
  ];
  const cases: [string, PaintRange[]][] = [
    ["a longer Dinner", [{ periodId: DINNER, startsAt: "19:00", endsAt: "22:00" }]],
    [
      "Lunch closed and Dinner past midnight",
      [
        { periodId: null, startsAt: "13:00", endsAt: "16:00" },
        { periodId: DINNER, startsAt: "23:00", endsAt: "02:00" },
      ],
    ],
    [
      "Lunch painted over Dinner and the night closed early",
      [
        { periodId: LUNCH, startsAt: "20:00", endsAt: "21:00" },
        { periodId: null, startsAt: "22:30", endsAt: "06:00" },
      ],
    ],
  ];

  for (const [name, paint] of cases)
    it(`gives paint that lays back into the same day: ${name}`, () => {
      const edited = layerPaint(season, paint, CUTOVER);
      expect(edited).not.toEqual(season);
      expect(layerPaint(season, paintFromEdit(season, edited, CUTOVER), CUTOVER)).toEqual(edited);
    });

  it("paints only what changed", () =>
    expect(
      paintFromEdit(
        season,
        [
          { periodId: LUNCH, startsAt: "13:00", endsAt: "16:00" },
          { periodId: DINNER, startsAt: "20:00", endsAt: "22:00" },
        ],
        CUTOVER,
      ),
    ).toEqual([{ periodId: null, startsAt: "22:00", endsAt: "23:30" }]));

  it("gives no paint for an unedited day", () =>
    expect(paintFromEdit(season, season, CUTOVER)).toEqual([]));
});

describe("zonePaintFromEdit", () => {
  const season: ClosedRange[] = [{ startsAt: "22:00", endsAt: "23:30" }];

  it("opens what the edit opens", () =>
    expect(zonePaintFromEdit(season, [{ startsAt: "23:00", endsAt: "23:30" }], CUTOVER)).toEqual([
      { kind: "open", startsAt: "22:00", endsAt: "23:00" },
    ]));

  const cases: [string, ZonePaint[]][] = [
    ["an Open stretch", [{ kind: "open", startsAt: "22:00", endsAt: "23:00" }]],
    ["a Closed stretch past midnight", [{ kind: "closed", startsAt: "23:30", endsAt: "02:00" }]],
    [
      "both at once",
      [
        { kind: "closed", startsAt: "12:00", endsAt: "14:00" },
        { kind: "open", startsAt: "22:30", endsAt: "23:30" },
      ],
    ],
  ];

  for (const [name, paint] of cases)
    it(`gives paint that lays back into the same closures: ${name}`, () => {
      const edited = layerZonePaint(season, paint, CUTOVER);
      expect(edited).not.toEqual(season);
      expect(layerZonePaint(season, zonePaintFromEdit(season, edited, CUTOVER), CUTOVER)).toEqual(
        edited,
      );
    });

  it("gives no paint for unedited closures", () =>
    expect(zonePaintFromEdit(season, season, CUTOVER)).toEqual([]));
});

describe("off the quarter hour", () => {
  it("keeps the day under a changeover off the quarter hour", () =>
    expect(layerPaint(winter, [], "06:10")).toEqual(winter));

  it("keeps a zone's closures under a changeover off the quarter hour", () =>
    expect(layerZonePaint([{ startsAt: "22:00", endsAt: "23:30" }], [], "06:10")).toEqual([
      { startsAt: "22:00", endsAt: "23:30" },
    ]));

  it("keeps range times off the quarter hour as they are", () =>
    expect(
      layerPaint(
        [{ periodId: DINNER, startsAt: "20:10", endsAt: "23:20" }],
        [{ periodId: LUNCH, startsAt: "13:05", endsAt: "15:55" }],
        CUTOVER,
      ),
    ).toEqual([
      { periodId: LUNCH, startsAt: "13:05", endsAt: "15:55" },
      { periodId: DINNER, startsAt: "20:10", endsAt: "23:20" },
    ]));
});
