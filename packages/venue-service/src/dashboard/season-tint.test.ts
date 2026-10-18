import { afterEach, describe, expect, it } from "vitest";
import { CALENDAR_COLOURS } from "@waitron/shared";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import {
  SEASON_TINT_TOKENS,
  SPECIAL_DAY_LINE,
  seasonTintStyles,
  seasonTints,
} from "./season-tint.js";
import { STATION_COLOUR_TOKENS } from "./station-colour-styles.js";

afterEach(cleanup);

const spring = { id: "sp", startsOn: "03-01", colour: "green" };
const summer = { id: "su", startsOn: "06-01", colour: "amber" };
const autumn = { id: "a", startsOn: "09-01", colour: "orange" };
const winter = { id: "w", startsOn: "12-01", colour: "blue" };

describe("seasonTints", () => {
  it("tints each season by its stored colour, whatever the list", () => {
    const four = seasonTints([summer, winter, spring, autumn]);
    expect([...four]).toEqual([
      ["su", "amber"],
      ["w", "blue"],
      ["sp", "green"],
      ["a", "orange"],
    ]);
    // A day in February belongs to Winter whether the list holds every season or Winter alone.
    expect(seasonTints([winter]).get("w")).toBe(four.get("w"));
  });

  it("reads an unknown colour as grey", () => {
    expect([
      ...seasonTints([
        { id: "x", colour: "mauve" },
        { id: "y", colour: "" },
      ]),
    ]).toEqual([
      ["x", "grey"],
      ["y", "grey"],
    ]);
  });
});

describe("season tint tokens", () => {
  it("paints every calendar colour's tint, text and line with the station tokens", () => {
    expect(Object.keys(SEASON_TINT_TOKENS)).toEqual([...CALENDAR_COLOURS]);
    for (const colour of CALENDAR_COLOURS) {
      const { fill, dot } = STATION_COLOUR_TOKENS[colour];
      expect(SEASON_TINT_TOKENS[colour], colour).toEqual({
        tint: fill,
        onTint: "var(--wt-color-text)",
        line: dot,
      });
      expect(seasonTintStyles.cssText).toContain(
        `[data-tint="${colour}"] { --season-tint: ${fill}; --season-on-tint: var(--wt-color-text); --season-tint-line: ${dot}; }`,
      );
    }
  });
});

/** Reads a computed colour, as `rgb(…)`/`rgba(…)` or the `color(srgb …)` Chromium gives a
 *  `color-mix`, into 0–1 channels. One not fully opaque throws: an undeclared tint token computes,
 *  as a background, to transparent black, whose channels alone read as black. */
function channels(value: string): [number, number, number] {
  const srgb = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/.exec(value);
  const rgb = /^rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? ([\d.]+))?\)$/.exec(value);
  const scale = srgb ? 1 : 255;
  const found = srgb ?? rgb;
  if (!found) throw new Error(`unreadable colour ${value}`);
  if (found[4] !== undefined && Number(found[4]) < 1)
    throw new Error(`translucent colour ${value}`);
  return [Number(found[1]) / scale, Number(found[2]) / scale, Number(found[3]) / scale];
}
function contrast(a: string, b: string): number {
  const luminance = (value: string) => {
    const [r, g, bl] = channels(value).map((v) =>
      v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

describe.each(["light", "dark"] as const)("season paints (%s)", (theme) => {
  it("each season paint reads in both themes", async () => {
    await mountThemed("<div></div>", theme);
    const surface = document.createElement("span");
    surface.style.color = "var(--wt-color-surface)";
    host.append(surface);
    const surfaceColour = getComputedStyle(surface).color;
    for (const colour of CALENDAR_COLOURS) {
      const { tint, onTint, line } = SEASON_TINT_TOKENS[colour];
      const probe = document.createElement("span");
      probe.style.backgroundColor = tint;
      probe.style.color = onTint;
      probe.style.borderTopColor = line;
      host.append(probe);
      const painted = getComputedStyle(probe);
      const [fill, text, edge] = [painted.backgroundColor, painted.color, painted.borderTopColor];
      expect(contrast(text, fill), `${colour} text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(edge, fill), `${colour} line on tint`).toBeGreaterThanOrEqual(3);
      expect(contrast(edge, surfaceColour), `${colour} line on surface`).toBeGreaterThanOrEqual(3);
    }
  });

  it("each season's line and the special-day line read on the painter's raised surface", async () => {
    await mountThemed("<div></div>", theme);
    const paint = (property: "color" | "backgroundColor", value: string) => {
      const probe = document.createElement("span");
      probe.style[property] = value;
      host.append(probe);
      return getComputedStyle(probe)[property];
    };
    const raised = paint("color", "var(--wt-color-surface-raised)");
    for (const colour of CALENDAR_COLOURS) {
      const line = paint("color", SEASON_TINT_TOKENS[colour].line);
      expect(contrast(line, raised), `${colour} line on raised`).toBeGreaterThanOrEqual(3);
    }
    const special = paint("color", SPECIAL_DAY_LINE);
    for (const ground of ["--wt-color-surface", "--wt-color-surface-raised", "--wt-color-bg"]) {
      expect(contrast(special, paint("color", `var(${ground})`)), ground).toBeGreaterThanOrEqual(3);
    }
    expect(special).toBe(paint("color", "var(--wt-color-palette-purple)"));
  });
});
