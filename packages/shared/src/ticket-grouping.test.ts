import { describe, expect, it } from "vitest";
import { TICKET_GROUPINGS, isTicketGrouping } from "./ticket-grouping.js";

describe("ticket grouping", () => {
  it("lists the two ways identical dishes print", () => {
    expect(TICKET_GROUPINGS).toEqual(["combined", "separate"]);
  });

  it("accepts each grouping and nothing else", () => {
    for (const grouping of TICKET_GROUPINGS) expect(isTicketGrouping(grouping)).toBe(true);
    for (const value of ["Combined", "", null, 1]) expect(isTicketGrouping(value)).toBe(false);
  });
});
