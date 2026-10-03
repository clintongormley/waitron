import type { WtCombobox, WtFormActions } from "@waitron/ui";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./vat-return-screen.js";
import type { VatReturnScreen } from "./vat-return-screen.js";

async function flush(el: VatReturnScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const field = (el: VatReturnScreen, name: string) =>
  el.shadowRoot!.querySelector<WtCombobox>(`wt-combobox[name=${name}]`)!;

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("vat-return-screen a11y (%s theme)", (theme) => {
  it.each([
    ["fresh", false, null],
    ["after a failed press", true, null],
    ["refused naming period", true, "period"],
    ["refused naming no field", true, "none"],
  ] as const)("renders the %s state accessibly", async (_state, press, refusedField) => {
    const api = {
      downloadVatReturnFile: vi.fn(() =>
        Promise.reject(
          refusedField === "none"
            ? { code: "authorization.not_permitted" }
            : { code: "management.request_invalid", params: { field: refusedField } },
        ),
      ),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<VatReturnScreen>(
      "dashboard-vat-return-screen",
      { api },
      theme,
    );
    await flush(el);
    if (refusedField !== null) await chooseOption(field(el, "declarationType"), "I");
    if (press) {
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=download]")!.click();
      await flush(el);
      if (refusedField === "none") {
        const actions = el.shadowRoot!.querySelector<WtFormActions>("wt-form-actions")!;
        await vi.waitFor(async () =>
          expect((await formMessageOf(actions))?.textContent?.trim()).toBe(
            codeMessage("authorization.not_permitted"),
          ),
        );
      } else {
        const marked = refusedField ?? "declarationType";
        await vi.waitFor(() => expect(field(el, marked).error).not.toBe(""));
      }
    }
    await expectNoA11yViolations(host);
  });
});
