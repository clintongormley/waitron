import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { deferred } from "../../test/clock-app.js";
import { mountEquipmentApp, signIn, till } from "../../test/equipment-app.js";
import { TillApi } from "../api/client.js";
import { es } from "../i18n/strings.js";
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
  const choice = dialog.shadowRoot!.querySelectorAll("wt-choice-tile")[direction]!;
  await userEvent.click(choice.shadowRoot!.querySelector("button")!);
}

async function enterAmount(dialog: HTMLElement, amount: string) {
  const pad = dialog.shadowRoot!.querySelector("till-numeric-pad")!;
  for (const key of amount) {
    await userEvent.click(pad.shadowRoot!.querySelector<HTMLElement>(`[data-key="${key}"]`)!);
  }
}

it.each([
  ["till", true],
  ["phone-portrait", false],
])(
  "records cash out with one action on a signed-in Spanish %s (opens drawer: %s)",
  async (formFactor, opensDrawer) => {
    const openDrawer = vi.fn();
    const bodies: unknown[] = [];
    const api = new TillApi("", async (url, init) => {
      expect(String(url)).toBe("/api/drawer/entries");
      expect(init?.method).toBe("POST");
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "entry", printerId: "bar" });
    });
    const { el } = await mountEquipmentApp({
      getTill: vi.fn().mockResolvedValue({ ...till, formFactor }),
      getDeviceEquipment: vi.fn().mockResolvedValue({
        roles: [
          {
            role: "cash_drawer",
            selection: "default",
            chosenId: null,
            resolved: { id: "bar", name: "Bar", available: opensDrawer },
            chosen: null,
            default: {
              id: "bar",
              name: "Bar",
              available: opensDrawer,
              portable: false,
              busy: false,
              heldBy: null,
            },
            choices: [],
          },
        ],
        drawerPrinterId: "bar",
        opensDrawer,
      }),
      openDrawer,
      saveDrawerEntry: api.saveDrawerEntry.bind(api),
    });
    await signIn(el, "es-ES");
    const menu = () =>
      el
        .shadowRoot!.querySelector("till-shell")
        ?.shadowRoot?.querySelector("[data-test=more-menu]");
    await vi.waitFor(() => expect(menu()?.querySelector(".drawer-cash")).toBeTruthy());
    await page.getByRole("button", { name: es["shell.more"], exact: true }).click();
    await userEvent.click(menu()!.querySelector<HTMLElement>(".drawer-cash")!);
    const dialog = el.shadowRoot!.querySelector("till-drawer-cash")!;
    const bar = dialog.shadowRoot!.querySelector("wt-top-bar")!;
    expect(bar.backLabel).toBe(es["tab.floor"]);
    expect(bar.subtitle).toBe(es["drawer_entry.printer"].replace("{printer}", "Bar"));
    if (!opensDrawer) expect(dialog.shadowRoot!.textContent).toContain(es["drawer_close.use_key"]);
    await choose(dialog, 1);
    for (const tile of dialog.shadowRoot!.querySelectorAll("wt-choice-tile")) {
      const text = document.createRange();
      text.selectNodeContents(tile.shadowRoot!.querySelector('[part="label"]')!);
      const labelBox = text.getBoundingClientRect();
      const tileBox = tile.getBoundingClientRect();
      expect(
        Math.abs(labelBox.left + labelBox.width / 2 - tileBox.left - tileBox.width / 2),
      ).toBeLessThan(1);
    }
    const firstPadKey = dialog
      .shadowRoot!.querySelector("till-numeric-pad")!
      .shadowRoot!.querySelector("[data-key]");
    expect(firstPadKey?.textContent?.trim()).toBe("1");
    await enterAmount(dialog, "12.50");
    await userEvent.fill(input(dialog, "reason"), "Paid supplier");
    const reasonLabel = input(dialog, "reason").getRootNode() as ShadowRoot;
    expect(reasonLabel.querySelector("label")?.textContent ?? "").toContain(
      es["drawer_entry.reason"],
    );
    expect(reasonLabel.querySelector("[data-required]")?.checkVisibility()).toBe(true);
    const saveLabel = action(dialog, "save").textContent!;
    expect(saveLabel).toContain("12,50");
    expect(saveLabel.includes(es["drawer_entry.opens_drawer"])).toBe(opensDrawer);
    await userEvent.click(action(dialog, "save"));
    await expect.poll(() => el.shadowRoot!.querySelector("till-drawer-cash")).toBeNull();
    await expect
      .poll(
        () =>
          el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-toast"]>("[data-drawer-key-toast]")
            ?.open,
      )
      .toBe(true);
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-toast"]>("[data-drawer-key-toast]")
        ?.message,
    ).toBe(opensDrawer ? es["drawer_close.key_if_needed"] : es["drawer_close.use_key"]);
    expect(bodies).toEqual([
      {
        printerId: "bar",
        submissionId: expect.any(String),
        kind: "cash_out",
        amount: "12.50",
        reason: "Paid supplier",
      },
    ]);
    expect(openDrawer).not.toHaveBeenCalled();
  },
);

it("marks the reason after an invalid Save and uses the same submission on a retry", async () => {
  setLocale("en-GB");
  const pending = deferred<{ id: string; printerId: string }>();
  const saveDrawerEntry = vi
    .fn()
    .mockRejectedValueOnce(new Error("network"))
    .mockReturnValueOnce(pending.promise);
  const { el } = await mountWidget<HTMLElementTagNameMap["till-drawer-cash"]>("till-drawer-cash", {
    api: { saveDrawerEntry },
    printerId: "bar",
  });
  expect(action(el, "save").disabled).toBe(true);
  await choose(el, 0);
  await enterAmount(el, "4.20");
  await userEvent.click(action(el, "save"));
  const reason =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=reason]")!;
  await expect.poll(() => reason.error).toContain("reason");
  expect(input(el, "reason")).toBe(reason.shadowRoot!.activeElement);
  expect(action(el, "save").disabled).toBe(true);
  expect(saveDrawerEntry).not.toHaveBeenCalled();
  const reportedSaved = vi.fn();
  el.addEventListener("drawer-cash-saved", reportedSaved);
  await userEvent.fill(input(el, "reason"), "Change");
  await userEvent.click(action(el, "save"));
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-cash-feedback]")?.textContent)
    .toContain("Try again");
  expect(action(el, "save").disabled).toBe(false);
  expect(reportedSaved).not.toHaveBeenCalled();
  const closed = new Promise<Event>((resolve) =>
    el.addEventListener("drawer-cash-dismiss", resolve, { once: true }),
  );
  await userEvent.click(action(el, "save"));
  expect(action(el, "save").loading).toBe(true);
  const pad = el.shadowRoot!.querySelector("till-numeric-pad")!;
  const keys = [...pad.shadowRoot!.querySelectorAll("wt-button")];
  expect(keys.filter((key) => key.disabled)).toHaveLength(keys.length);
  pending.resolve({ id: "entry", printerId: "bar" });
  expect(await closed).toBeInstanceOf(CustomEvent);
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
});
