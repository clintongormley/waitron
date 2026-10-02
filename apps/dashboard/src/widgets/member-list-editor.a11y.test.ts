import { afterEach, describe, it } from "vitest";
import { page } from "vitest/browser";
import type { SectionMember } from "@waitron/catalogue/src/section-types.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { MemberListEditor } from "./member-list-editor.js";

afterEach(async () => {
  cleanupWidgets();
  await page.viewport(1280, 900);
});

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

const states = ["empty", "populated", "filtered", "busy", "invalid", "included menu open"] as const;

describe.each(["light", "dark"] as const)("member list editor (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    if (state === "included menu open") await page.viewport(390, 900);
    const { el, host } = await mountWidget<MemberListEditor>(
      "dashboard-member-list-editor",
      {
        members: state === "empty" ? [] : members,
        products,
        nodes: sections.map((section) => ({
          memberId: `m-${section.id.slice(2)}`,
          ref: { kind: "section" as const, sectionId: section.id },
          internalName: section.internalName,
          includedMenuId:
            state === "included menu open" && section.id === "s-drinks" ? "drinks" : undefined,
          names: {},
          children: [],
        })),
        // Filtered: every section is excluded, so the picker offers products alone.
        excludeSectionIds: state === "filtered" ? ["s-drinks", "s-beer"] : [],
        busy: state === "busy",
        replaceable: state === "invalid" ? new Set(["m-drinks"]) : new Set(),
        label: "Members of Lunch specials",
      },
      theme,
    );
    if (state === "invalid") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="replace-m-drinks"]')!.click();
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="add"]')!.click();
      await el.updateComplete;
    }
    if (state === "included menu open") {
      const actions = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
        '[data-test="actions-m-drinks"]',
      )!;
      await actions.updateComplete;
      actions.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    }
    await expectNoA11yViolations(host);
  });
});
