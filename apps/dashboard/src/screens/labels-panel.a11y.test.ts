import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { LabelsPanel } from "./labels-panel.js";
import type { DashboardApi } from "../api/client.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("labels panel (%s)", (theme) => {
  it.each(["empty", "populated", "failed", "form", "invalid", "delete"] as const)(
    "renders the %s state accessibly",
    async (state) => {
      const api = {
        listLabels: () =>
          state === "failed"
            ? Promise.reject(new Error("offline"))
            : Promise.resolve(
                state === "empty"
                  ? []
                  : [
                      { id: "l1", name: "Alcoholic", productCount: 3 },
                      { id: "l2", name: "Happy hour drinks", productCount: 0 },
                    ],
              ),
      } as unknown as DashboardApi;
      const { el, host } = await mountWidget<LabelsPanel>("dashboard-labels-panel", { api }, theme);
      await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-spinner")).toBeNull());
      const table =
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>("wt-data-table")!;
      await table.updateComplete;
      if (state === "form" || state === "invalid") {
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-label"]')!.click();
        await el.updateComplete;
        if (state === "invalid") {
          el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-label"]')!.click();
          await el.updateComplete;
          expect(
            el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!.error,
          ).not.toBe("");
        }
      }
      if (state === "delete") {
        table
          .shadowRoot!.querySelector<HTMLElement>(
            'tr[data-row-key="l1"] [data-test="delete-label"]',
          )!
          .click();
        await el.updateComplete;
        expect(
          el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
            'wt-modal[data-test="label-delete"]',
          )!.open,
        ).toBe(true);
      }
      await expectNoA11yViolations(host);
    },
  );
});
