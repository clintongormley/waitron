import { describe, expect, it } from "vitest";
import { navMatches } from "./nav-search.js";

const pages = ["Users", "Teamwork board", "Shifts", "Team rota"].map((label) => ({ label }));
const labels = (query: string, heading = "Team") =>
  navMatches(query, pages, heading).map((page) => page.label);

describe("navMatches", () => {
  it("lists the pages matching by their own label first, in match order, then the rest of the group in its own order", () => {
    expect(labels("team")).toEqual(["Team rota", "Teamwork board", "Users", "Shifts"]);
  });

  it("finds a page by words split between its label and the heading", () => {
    expect(labels("shifts team")).toEqual(["Shifts"]);
    expect(labels("rota team")).toEqual(["Team rota"]);
  });

  it("returns every page in order for a blank search, and none for punctuation", () => {
    expect(labels("  ")).toEqual(["Users", "Teamwork board", "Shifts", "Team rota"]);
    expect(labels("&")).toEqual([]);
  });

  it("matches the label alone for a group with no heading", () => {
    expect(labels("team", "")).toEqual(["Team rota", "Teamwork board"]);
  });
});
