import { describe, expect, it } from "vitest";
import { navMatches, destinationMatches } from "./nav-search.js";

const pages = ["Users", "Teamwork board", "Shifts", "Team rota"].map((label) => ({ label }));
const labels = (query: string, heading = "Team") =>
  navMatches(query, pages, heading).map((page) => page.label);

describe("navMatches", () => {
  it("lists the pages matching by their own label first, in match order, then the rest of the group, closest first", () => {
    expect(labels("team")).toEqual(["Team rota", "Teamwork board", "Users", "Shifts"]);
  });

  it("finds a page by words split between its label and the heading", () => {
    expect(labels("shifts team")).toEqual(["Shifts"]);
    expect(labels("rota team")).toEqual(["Team rota"]);
  });

  it("orders the pages that match only with the heading by how closely they match", () => {
    const menuPages = ["Products", "Menus", "Modifiers", "Units"].map((label) => ({ label }));
    expect(
      navMatches("menus u", menuPages, "Products and menus").map((page) => page.label),
    ).toEqual(["Menus", "Units", "Products", "Modifiers"]);
  });

  it("keeps the pages that match equally closely only with the heading in nav order", () => {
    const menuPages = ["Menus", "Products", "Modifiers", "Units"].map((label) => ({ label }));
    expect(navMatches("menus", menuPages, "Products and menus").map((page) => page.label)).toEqual([
      "Menus",
      "Products",
      "Modifiers",
      "Units",
    ]);
  });

  it("puts a whole-word match ahead of a start-of-word one among the pages needing the heading", () => {
    const drinks = ["Ginger", "Gin"].map((label) => ({ label }));
    expect(navMatches("menu gin", drinks, "Menu").map((page) => page.label)).toEqual([
      "Gin",
      "Ginger",
    ]);
  });

  it("returns every page in order for a blank search, and none for punctuation", () => {
    expect(labels("  ")).toEqual(["Users", "Teamwork board", "Shifts", "Team rota"]);
    expect(labels("&")).toEqual([]);
  });

  it("matches the label alone for a group with no heading", () => {
    expect(labels("team", "")).toEqual(["Team rota", "Teamwork board"]);
  });
});

describe("destinationMatches", () => {
  const destinations = [
    {
      id: "staffing",
      screen: "opening-hours",
      label: "Staffing",
      pageLabel: "Calendar",
      heading: "Operations",
      href: "/manage/opening-hours/view/staffing",
    },
    {
      id: "rota",
      screen: "opening-hours",
      label: "Rota",
      pageLabel: "Calendar",
      heading: "Operations",
      href: "/manage/opening-hours/view/rota",
    },
    {
      id: "routes",
      screen: "prep-stations",
      label: "Routes",
      pageLabel: "Prep stations",
      heading: "Operations",
      href: "/manage/prep-stations/view/routing",
    },
  ];
  it("finds inner labels and words split with their containing page", () => {
    expect(destinationMatches("staff", destinations).map((x) => x.id)).toEqual(["staffing"]);
    expect(destinationMatches("calendar rota", destinations).map((x) => x.id)).toEqual(["rota"]);
    expect(destinationMatches("operations routes", destinations).map((x) => x.id)).toEqual([
      "routes",
    ]);
    expect(
      destinationMatches("rutas preparacion", [
        { ...destinations[2]!, label: "Rutas", pageLabel: "Estaciones de preparación" },
      ]).map((x) => x.id),
    ).toEqual(["routes"]);
  });
  it("returns no inner destinations for a blank or punctuation-only search", () => {
    expect(destinationMatches("  ", destinations)).toEqual([]);
    expect(destinationMatches("&", destinations)).toEqual([]);
  });
  it("keeps trailing-space word semantics and ranks the own label before a parent-only match", () => {
    expect(destinationMatches("staff ", destinations)).toEqual([]);
    expect(destinationMatches("rota ", destinations).map((x) => x.id)).toEqual(["rota"]);
    expect(
      destinationMatches("routes", [
        { ...destinations[0]!, pageLabel: "Routes" },
        destinations[2]!,
      ]).map((x) => x.id),
    ).toEqual(["routes", "staffing"]);
  });
});
