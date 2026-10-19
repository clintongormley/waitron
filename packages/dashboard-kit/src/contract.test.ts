import { html } from "lit";
import { expect, it } from "vitest";
import { contributedScreens, type DashboardContribution } from "./contract.js";

const strings = { en: {}, es: {} };
const placement = (id: string) => ({
  id,
  navLabelKey: `nav.${id}`,
  group: "reports",
  requiresPermission: "test.use",
});
const create = () => ({ render: () => html`` });

it("lists a contribution's own screen first, then its further screens", () => {
  const report = { screen: placement("report"), create };
  const audit = { screen: placement("audit"), create };
  const c: DashboardContribution = {
    module: "widgets",
    strings,
    screen: placement("widgets"),
    create,
    moreScreens: [report, audit],
  };
  expect(contributedScreens(c)).toEqual([c, report, audit]);
});

it("lists only the own screen when there are no further screens", () => {
  const c: DashboardContribution = { module: "widgets", strings, screen: placement("w"), create };
  expect(contributedScreens(c)).toEqual([c]);
});

it("lists no screen for a contribution that brings only settings panels", () => {
  const c: DashboardContribution = {
    module: "certs",
    strings,
    settingsPanels: [{ id: "certs", tab: "venue-details", requiresPermission: "test.use", create }],
  };
  expect(contributedScreens(c)).toEqual([]);
});

it("lists only the further screens for a contribution with no own screen", () => {
  const report = { screen: placement("report"), create };
  const c: DashboardContribution = { module: "certs", strings, moreScreens: [report] };
  expect(contributedScreens(c)).toEqual([report]);
});
