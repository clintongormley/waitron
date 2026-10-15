import { describe, expect, it } from "vitest";
import * as painter from "@waitron/venue-service/painter";
import { PainterFrame } from "./painter-frame.js";
import { stepAt, stepMinuteAt } from "../paint-model.js";
import { clockAt } from "../day-paint.js";
import { periodColourStyles } from "./period-colour-styles.js";
import { paintRowStyles } from "./paint-row.js";
import { seasonLastDay } from "../season-rules.js";

describe("@waitron/venue-service/painter", () => {
  it("exposes the painter frame and the helpers another module's painter draws with", () => {
    expect({ ...painter }).toEqual({
      PainterFrame,
      stepAt,
      stepMinuteAt,
      clockAt,
      periodColourStyles,
      paintRowStyles,
      seasonLastDay,
    });
  });

  it("registers the frame's element", () => {
    expect(customElements.get("painter-frame")).toBe(painter.PainterFrame);
  });
});
