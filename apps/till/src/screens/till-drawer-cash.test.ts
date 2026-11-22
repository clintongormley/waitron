import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { mountEquipmentApp, signIn } from "../../test/equipment-app.js";
import { TillApi } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";

const previousLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(previousLocale);
});

const action = (dialog: HTMLElement, name: string) =>
  dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `[data-cash-action=${name}]`,
  )!;

function input(dialog: HTMLElement, name: string) {
  return dialog.shadowRoot!.querySelector(`[name=${name}]`)!.shadowRoot!.querySelector("input")!;
}

async function choose(dialog: HTMLElement, direction: number) {
  const choices = dialog.shadowRoot!.querySelector("wt-segmented-control")!;
  await userEvent.click(choices.shadowRoot!.querySelectorAll("button")[direction]!);
}

it("records cash out from a signed-in Spanish till, using the key when the drawer fails to open", async () => {
  const openDrawer = vi.fn().mockRejectedValue({ code: "drawer.no_printer" });
  const bodies: unknown[] = [];
  const api = new TillApi("", async (url, init) => {
    expect(String(url)).toBe("/api/drawer/entries");
    expect(init?.method).toBe("POST");
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "entry", printerId: "bar" });
  });
  const { el } = await mountEquipmentApp({
    getDeviceEquipment: vi
      .fn()
      .mockResolvedValue({ roles: [], drawerPrinterId: "bar", opensDrawer: true }),
    openDrawer,
    saveDrawerEntry: api.saveDrawerEntry.bind(api),
  });
  await signIn(el, "es-ES");
  const menu = () =>
    el.shadowRoot!.querySelector("till-shell")?.shadowRoot?.querySelector("[data-test=more-menu]");
  await vi.waitFor(() => expect(menu()?.querySelector(".drawer-cash")).toBeTruthy());
  await userEvent.click(menu()!.shadowRoot!.querySelector("button")!);
  await userEvent.click(menu()!.querySelector<HTMLElement>(".drawer-cash")!);
  const dialog = el.shadowRoot!.querySelector("till-drawer-cash")!;
  await userEvent.click(page.elementLocator(action(dialog, "open")));
  await vi.waitFor(() =>
    expect(dialog.shadowRoot!.textContent).toContain("Abre el cajón con la llave"),
  );
  await choose(dialog, 1);
  await userEvent.fill(input(dialog, "amount"), "12.50");
  expect(input(dialog, "amount").value).toBe("12,50");
  await userEvent.fill(input(dialog, "reason"), "Proveedor");
  await userEvent.click(action(dialog, "save"));
  await expect
    .poll(() => dialog.shadowRoot!.querySelector('[role="status"]')?.textContent)
    .toContain("Movimiento guardado");
  expect(bodies).toEqual([
    {
      printerId: "bar",
      submissionId: expect.any(String),
      kind: "cash_out",
      amount: "12.50",
      reason: "Proveedor",
    },
  ]);
  expect(openDrawer).toHaveBeenCalledExactlyOnceWith(undefined, "bar");
});

it("marks the reason after an invalid Save and uses the same submission on a retry", async () => {
  setLocale("en-GB");
  const saveDrawerEntry = vi
    .fn()
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValue({ id: "entry", printerId: "bar" });
  const openDrawer = vi.fn();
  const { el } = await mountWidget<HTMLElementTagNameMap["till-drawer-cash"]>("till-drawer-cash", {
    api: { saveDrawerEntry, openDrawer },
    printerId: "bar",
  });
  expect(action(el, "save").disabled).toBe(true);
  await choose(el, 0);
  await userEvent.fill(input(el, "amount"), "4,20");
  await userEvent.click(action(el, "save"));
  const reason =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=reason]")!;
  await expect.poll(() => reason.error).toContain("reason");
  expect(input(el, "reason")).toBe(reason.shadowRoot!.activeElement);
  expect(action(el, "save").disabled).toBe(true);
  expect(saveDrawerEntry).not.toHaveBeenCalled();
  await userEvent.fill(input(el, "reason"), "Change");
  await userEvent.click(action(el, "save"));
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions")?.error)
    .toContain("Try again");
  expect(action(el, "save").disabled).toBe(false);
  await userEvent.click(action(el, "save"));
  await expect
    .poll(() => el.shadowRoot!.querySelector('[role="status"]')?.textContent)
    .toContain("Cash entry saved");
  expect(saveDrawerEntry.mock.calls).toEqual([
    [
      {
        printerId: "bar",
        submissionId: expect.any(String),
        kind: "cash_in",
        amount: "4.20",
        reason: "Change",
      },
    ],
    [saveDrawerEntry.mock.calls[0]![0]],
  ]);
  expect(openDrawer).not.toHaveBeenCalled();
});
