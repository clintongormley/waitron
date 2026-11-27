import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { ShareListShare, WtShareList } from "./wt-share-list.js";
import "./wt-share-list.js";

afterEach(cleanup);

const SHARES: ShareListShare[] = [
  { name: "Guest 1", detail: "card · tip €2.44", amount: "€24.44", state: "paid" },
  { name: "Guest 2", detail: "card in progress", amount: "€24.43", state: "due" },
  { name: "Guest 3", detail: "paying now", amount: "€24.43", state: "current" },
  { name: "Guest 4", detail: "to pay", amount: "€24.43", state: "due" },
];

describe.each(["light", "dark"] as const)("wt-share-list a11y (%s theme)", (theme) => {
  test("paid, card in progress, current and due shares", async () => {
    const el = (await mountThemed(
      '<wt-share-list label="Shares"></wt-share-list>',
      theme,
    )) as WtShareList;
    el.shares = SHARES;
    await el.updateComplete;
    await expectNoA11yViolations(host);
    const list = page.getByRole("list", { name: "Shares" });
    await expect.element(list).toBeInTheDocument();
    expect(list.getByRole("listitem").elements()).toHaveLength(4);
    expect(
      list
        .getByRole("listitem")
        .elements()
        .map((item) => item.textContent?.replace(/\s+/g, " ").trim()),
    ).toEqual([
      "Guest 1 card · tip €2.44 €24.44",
      "Guest 2 card in progress €24.43",
      "Guest 3 paying now €24.43",
      "Guest 4 to pay €24.43",
    ]);
  });
});
