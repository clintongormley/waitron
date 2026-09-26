import { afterEach, describe, it } from "vitest";
import type { MenuPreview, MenuStatus } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { MenuPreviewPanel } from "./menu-preview.js";

afterEach(cleanupWidgets);

const live: MenuStatus = {
  state: "changed",
  version: 2,
  publishedAt: "2026-09-26T10:15:00.000Z",
  hash: "a".repeat(64),
};

const changes: MenuPreview = {
  hash: "b".repeat(64),
  changes: [
    {
      kind: "price_changed",
      productId: "p-burger",
      name: "Burger",
      from: "12.00",
      to: "13.00",
      source: "shared_product",
      alsoOn: ["Dinner Menu"],
    },
    {
      kind: "section_changed",
      sectionId: "s-drinks",
      name: "Drinks",
      fields: ["names"],
      source: "shared_section",
    },
  ],
  warnings: [{ kind: "shortcut_omitted", layoutName: "Home", name: "Lemonade" }],
};

const states: Record<string, Partial<MenuPreviewPanel>> = {
  loading: { status: null, preview: null },
  "live version unread": { status: null, statusFailed: true, preview: changes },
  failed: { preview: null, failed: true },
  "changes and a warning": { preview: changes },
  unpublished: { status: { state: "unpublished" }, preview: changes },
  "nothing to publish": {
    status: { ...live, state: "current", hash: changes.hash },
    preview: { ...changes, changes: [], warnings: [] },
  },
  publishing: { preview: changes, publishing: true },
  published: { preview: changes, result: { kind: "published", number: 3 } },
  stale: { preview: changes, result: { kind: "stale" } },
  "publish failed": { preview: changes, result: { kind: "failed", reason: "Try again." } },
};

describe.each(["light", "dark"] as const)("menu preview (%s)", (theme) => {
  it.each(Object.keys(states))("renders %s accessibly", async (state) => {
    const { host } = await mountWidget<MenuPreviewPanel>(
      "dashboard-menu-preview",
      { menuName: "Lunch Menu", status: live, ...states[state] },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
