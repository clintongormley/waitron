import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import { cleanupWidgets, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { beer, flan, jamon, mount, resized } from "./till-table-order-screen.test-helpers.js";
import { storedDish, storedExtra } from "./till-table-order-screen.sent-fallback.test-helpers.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe("phone Review counts dishes without changing their draft", () => {
  for (const locale of ["en", "es"] as const)
    for (const theme of ["light", "dark"] as const)
      for (const width of [360, 390]) {
        it(`${locale}, ${theme}, ${width}px keeps whole, weighed and recalled families across Back`, async () => {
          setLocale(locale);
          await page.viewport(width, 900);
          const draft = new DraftStore();
          draft.appendLines([
            { product: beer, quantity: "2" },
            {
              product: flan,
              quantity: "1",
              extras: [
                { listId: "extras", productId: "sauce", name: "Sauce", quantity: 3, price: "0.25" },
              ],
            },
            { product: jamon, quantity: "0.375" },
            {
              product: { ...beer, id: "retired", name: "Recorded dish" },
              quantity: "2.000",
              noMerge: true,
              source: { line: storedDish, extras: [storedExtra], netAmount: "8.00" },
            },
          ]);
          draft.setLinePlaces([1, 2], { kind: "new", slot: 1 });
          draft.setLinePlaces([3], { kind: "join", groupId: "held" });
          const { el, host } = await mount({
            draftStore: draft,
            lines: [storedDish, storedExtra],
            groups: [
              {
                id: "held",
                position: 1,
                displayNumber: 7,
                numberPartyId: "party",
                state: "held",
                firedAt: null,
                remindAt: null,
                lineIds: [storedDish.id, storedExtra.id],
                courseIds: [],
                summary: "Recorded dish ×2",
              },
            ],
          });
          host.setAttribute("data-theme", theme);
          host.style.width = "100%";
          await resized(el);
          const q = (selector: string) => el.shadowRoot!.querySelector<HTMLElement>(selector)!;
          const before = structuredClone(draft.lines);
          let submits = 0;
          el.addEventListener("submit-draft", () => submits++);
          expect(window.innerWidth).toBe(width);
          const reviewBox = q("[data-review-open]").getBoundingClientRect();
          expect(reviewBox.width).toBeGreaterThanOrEqual(44);
          expect(reviewBox.height).toBeGreaterThanOrEqual(44);
          expect(reviewBox.left).toBeGreaterThanOrEqual(0);
          expect(reviewBox.right).toBeLessThanOrEqual(width);
          expect(q("[data-review-open]").textContent!.trim()).toBe(
            locale === "es" ? "Revisar (6)" : "Review (6)",
          );
          expect(q("[data-browsing]").checkVisibility()).toBe(true);
          expect(q("[data-draft-pane]").checkVisibility()).toBe(false);
          await expectNoA11yViolations(host);

          await userEvent.click(q("[data-review-open]"));
          await resized(el);
          expect(q("[data-browsing]").checkVisibility()).toBe(false);
          expect(q("[data-draft-pane]").checkVisibility()).toBe(true);
          expect(el.shadowRoot!.activeElement).toBe(q("[data-review-back]"));
          const paneBox = q("[data-draft-pane]").getBoundingClientRect();
          expect(paneBox.left).toBeGreaterThanOrEqual(0);
          expect(paneBox.right).toBeLessThanOrEqual(width);
          expect(
            [...el.shadowRoot!.querySelectorAll("[data-draft-group]")].map((group) =>
              group.getAttribute("data-draft-group"),
            ),
          ).toEqual(["fire", "new:1", "join:held"]);
          expect(el.shadowRoot!.querySelectorAll("[data-draft-select]")).toHaveLength(4);
          await userEvent.click(q('[data-draft-select="0"]'));
          await el.updateComplete;
          await expectNoA11yViolations(host);

          await userEvent.click(q("[data-review-back]"));
          await resized(el);
          expect(q("[data-browsing]").checkVisibility()).toBe(true);
          expect(q("[data-draft-pane]").checkVisibility()).toBe(false);
          expect(el.shadowRoot!.activeElement).toBe(q("[data-review-open]"));
          expect(q("[data-review-open]").textContent!.trim()).toBe(
            locale === "es" ? "Revisar (6)" : "Review (6)",
          );
          expect(draft.lines).toEqual(before);
          expect(submits).toBe(0);

          draft.setLineQuantity(0, "3");
          await el.updateComplete;
          expect(q("[data-review-open]").textContent!.trim()).toBe(
            locale === "es" ? "Revisar (7)" : "Review (7)",
          );
          await userEvent.click(q("[data-review-open]"));
          await resized(el);
          expect(q('[data-draft-select="0"]').getAttribute("aria-pressed")).toBe("true");
          expect(draft.lines.map((line) => line.quantity)).toEqual(["3", "1", "0.375", "2.000"]);
          expect(submits).toBe(0);
        });
      }
});
