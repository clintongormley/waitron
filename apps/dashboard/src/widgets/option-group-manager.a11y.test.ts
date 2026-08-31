import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./option-group-manager.js";
import type { OptionGroupManager } from "./option-group-manager.js";
import type { OptionGroup, OptionGroupItem } from "../api/client.js";

/**
 * The option-group manager owns two create forms (group + item, each with a per-locale `wt-input`, two
 * numeric `wt-input`s, two `wt-switch`es and a button) plus, per group row, the same set of inline-edit
 * controls and a VAT-override `<select>`. It holds no `api`, so there is no in-flight fetch to settle.
 * Mounted with a non-empty `groups` list, once with a group's items panel EXPANDED (exercising the item
 * rows + the VAT select) and once collapsed, in both themes; axe runs against the themed host so a
 * color-contrast check means what it means in the app.
 */
const groups: OptionGroup[] = [
  {
    id: "g1",
    name: { es: "Tamaño" },
    minSelect: 1,
    maxSelect: 1,
    required: true,
    sort: 0,
    active: true,
  },
];

const items: OptionGroupItem[] = [
  {
    id: "i1",
    groupId: "g1",
    name: { es: "Pequeño" },
    priceDelta: "0.00",
    vatClass: null,
    sort: 0,
    active: true,
    maxQuantity: 1,
    addAllergens: null,
    removeAllergens: null,
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("option-group-manager a11y (%s theme)", (theme) => {
  it("renders accessibly with groups collapsed", async () => {
    const { host } = await mountWidget<OptionGroupManager>(
      "dashboard-option-group-manager",
      { groups },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a group's items panel expanded", async () => {
    const { host } = await mountWidget<OptionGroupManager>(
      "dashboard-option-group-manager",
      { groups, expandedGroupId: "g1", items },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a group error shown", async () => {
    const { host } = await mountWidget<OptionGroupManager>(
      "dashboard-option-group-manager",
      { groups, groupError: "options.group_invalid" },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
