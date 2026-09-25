import { afterEach, describe, it } from "vitest";
import type { SectionMember } from "@waitron/catalogue/src/section-types.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { MemberListEditor } from "./member-list-editor.js";

afterEach(cleanupWidgets);

const products = [
  { id: "p-burger", name: "Burger" },
  { id: "p-chips", name: "Chips" },
];
const sections = [
  { id: "s-drinks", internalName: "Drinks" },
  { id: "s-beer", internalName: "Beer" },
];
const members: SectionMember[] = [
  { id: "m-burger", position: 0, ref: { kind: "product", productId: "p-burger" } },
  { id: "m-drinks", position: 1, ref: { kind: "section", sectionId: "s-drinks" } },
];

const states = ["empty", "populated", "filtered", "busy", "invalid"] as const;

describe.each(["light", "dark"] as const)("member list editor (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    const { el, host } = await mountWidget<MemberListEditor>(
      "dashboard-member-list-editor",
      {
        members: state === "empty" ? [] : members,
        products,
        sections,
        // Filtered: every section is excluded, so the picker offers products alone.
        excludeSectionIds: state === "filtered" ? ["s-drinks", "s-beer"] : [],
        busy: state === "busy",
        label: "Members of Lunch specials",
      },
      theme,
    );
    if (state === "invalid") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="add"]')!.click();
      await el.updateComplete;
    }
    await expectNoA11yViolations(host);
  });
});
