import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi, ServerRow } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { ServersScreen } from "./servers-screen.js";
import "./servers-screen.js";

const locale = currentLocale();
beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

const ownBox: ServerRow = {
  nodeId: "11111111-1111-4111-8111-111111111111",
  contactUrl: "https://waitron.local",
  standing: "serving-primary",
  isSelf: true,
  removable: false,
  canClear: false,
  requiresRetirementConfirmation: false,
  returnOutstanding: false,
  needsResetStatement: false,
  reset: null,
  canReset: false,
  canWipeWithLoss: false,
  returnScenario: null,
  recoveredRecordsBackup: null,
};

async function mount(
  sendsReset = vi.fn<DashboardApi["resetThisBox"]>(),
  onboardingIntent: "demo" | "prepare" = "demo",
) {
  const api = {
    listServers: async () => ({ term: 0, nodes: [ownBox], resetThisBox: "available" }),
    resetThisBox: sendsReset,
  } as unknown as DashboardApi;
  const { el } = await mountWidget<ServersScreen>("dashboard-servers-screen", {
    api,
    canPromote: true,
    onboardingIntent,
    canOpenBackups: true,
  });
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  const menu = () => table.shadowRoot!.querySelector("wt-row-actions");
  await expect.poll(() => Boolean(menu()?.querySelector("[data-test=reset-this-box]"))).toBe(true);
  await userEvent.click(menu()!.shadowRoot!.querySelector("button")!);
  await userEvent.click(menu()!.querySelector<HTMLElement>("[data-test=reset-this-box]")!);
  const root = el.shadowRoot!.querySelector("dashboard-reset-this-box-dialog")!.shadowRoot!;
  const dialog = root.querySelector("wt-dialog")!;
  const field = root.querySelector("wt-input")!;
  const confirm = root.querySelector<HTMLElementTagNameMap["wt-button"]>("wt-button:not([slot])")!;
  await expect.poll(() => dialog.shadowRoot!.querySelector(":modal")).not.toBeNull();
  return { el, root, field, confirm, sendsReset };
}

it("keeps Reset disabled while the word differs and allows the exact word", async () => {
  const { field, confirm } = await mount();
  const input = page.elementLocator(field.shadowRoot!.querySelector("input")!);
  await input.fill("Reset");
  expect(confirm.disabled).toBe(true);
  await input.fill("reset");
  expect(confirm.disabled).toBe(false);
});

it("stops after typing without requesting a reset", async () => {
  const { el, root, field, sendsReset } = await mount();
  expect(root.querySelector('a[href="/backup"]')).toBeNull();
  await page.elementLocator(field.shadowRoot!.querySelector("input")!).fill("reset");
  const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve, { once: true }));
  await userEvent.click(root.querySelector('wt-button[slot="cancel"]')!);
  await closed;
  expect(sendsReset).not.toHaveBeenCalled();
});

it("leaves a refused reset in the dialog with the reason and lets the operator try again", async () => {
  const send = vi.fn<DashboardApi["resetThisBox"]>().mockRejectedValue({
    code: "membership.self_reset_unavailable",
    params: { reason: "remove_other_boxes" },
  });
  const { root, field, confirm } = await mount(send, "prepare");
  expect(root.querySelector('a[href="/backup"]')).not.toBeNull();
  await page.elementLocator(field.shadowRoot!.querySelector("input")!).fill("reset");
  await userEvent.click(confirm);
  await vi.waitFor(async () => {
    const message = await formMessageOf(root.querySelector("wt-form-actions")!);
    expect(message?.textContent).toContain("Remove the other boxes");
    expect(confirm.disabled).toBe(false);
  });
});
