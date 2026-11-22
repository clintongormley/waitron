import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "../till-app.js";
import { mountEquipmentApp, signIn } from "../../test/equipment-app.js";
import type { TillDrawerClose } from "./till-drawer-close.js";

const previousLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(previousLocale);
});

const drawer = { printerId: "bar", openingCash: "5.00" };
const first = {
  id: "first",
  personId: "ada",
  recordedAt: "2026-11-21T20:00:00.000Z",
  counted: "42.00",
  expected: "40.00",
  difference: "2.00",
  cashMovedWhileCounting: false,
  throughSequence: 7,
};
const pending = {
  ...drawer,
  state: "counted",
  first,
  recount: null,
  confirmSequence: 8,
  available: "42.00",
} as const;
const recounted = {
  ...pending,
  recount: { ...first, id: "recount", counted: "45.00", difference: "5.00", throughSequence: 8 },
  confirmSequence: 9,
  available: "45.00",
};

function api() {
  return {
    readDrawerClose: vi.fn().mockResolvedValue({ ...drawer, state: "new", startSequence: 7 }),
    openDrawer: vi.fn().mockRejectedValue({ code: "drawer.no_printer" }),
    saveDrawerCount: vi.fn().mockResolvedValue(pending),
    recountDrawer: vi.fn().mockResolvedValue(recounted),
    finishDrawerClose: vi.fn().mockResolvedValue({
      ...drawer,
      state: "finished",
      id: "close",
      firstCountId: "first",
      personId: "ada",
      recordedAt: first.recordedAt,
      bankWithdrawal: "39.00",
      amountLeft: "6.00",
      difference: "5.00",
      throughSequence: 9,
      slip: "unavailable",
    }),
  };
}

const action = (el: TillDrawerClose, name: string) =>
  el.shadowRoot?.querySelector<HTMLElement>(`[data-drawer-action="${name}"]`);
async function press(el: TillDrawerClose, name: string) {
  await vi.waitFor(() => expect(action(el, name)).toBeTruthy());
  await userEvent.click(page.elementLocator(action(el, name)!));
}
async function fill(el: TillDrawerClose, name: string, value: string) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name=${name}]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
}
const words = (el: TillDrawerClose) => el.shadowRoot?.textContent ?? "";

it("opens the close dialog through a signed-in till's More menu when the drawer printer is off", async () => {
  setLocale("en-GB");
  const requests = api();
  const { el } = await mountEquipmentApp({
    ...requests,
    getDeviceEquipment: vi
      .fn()
      .mockResolvedValue({ roles: [], drawerPrinterId: "bar", opensDrawer: false }),
  });
  await signIn(el);
  const menu = () =>
    el.shadowRoot?.querySelector("till-shell")?.shadowRoot?.querySelector("[data-test=more-menu]");
  await vi.waitFor(() => expect(menu()?.querySelector(".drawer-close")).toBeTruthy());
  await userEvent.click(menu()!.shadowRoot!.querySelector("button")!);
  await userEvent.click(menu()!.querySelector<HTMLElement>(".drawer-close")!);
  await vi.waitFor(() =>
    expect(el.shadowRoot?.querySelector("till-drawer-close")?.shadowRoot?.textContent).toContain(
      "Open the drawer with the key",
    ),
  );
  expect(requests.openDrawer).not.toHaveBeenCalled();
});

it("saves the count before showing the difference, allows a recount and saves the withdrawal after using the key", async () => {
  setLocale("en-GB");
  const requests = api();
  const { el } = await mountWidget<TillDrawerClose>("till-drawer-close", {
    api: requests,
    printerId: "bar",
    opensDrawer: true,
  });
  await vi.waitFor(() => expect(words(el)).toContain("Open the drawer with the key"));
  expect(requests.openDrawer).toHaveBeenCalledOnce();
  expect(words(el)).not.toContain("Expected cash");
  await fill(el, "counted", "42");
  await press(el, "count");
  expect(requests.saveDrawerCount).toHaveBeenCalledWith({
    printerId: "bar",
    startSequence: 7,
    counted: "42.00",
  });
  await vi.waitFor(() => expect(words(el)).toContain("Expected cash"));
  expect(words(el)).toContain("€2.00");

  await press(el, "recount");
  await fill(el, "counted", "45");
  await press(el, "count");
  expect(requests.recountDrawer).toHaveBeenCalledWith("first", {
    startSequence: 8,
    counted: "45.00",
  });
  await vi.waitFor(() => expect(action(el, "recount")).toBeNull());
  const left = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "wt-input[name=amountLeft]",
  )!;
  expect(left.value).toBe("5.00");
  await fill(el, "amountLeft", "6");
  expect(words(el)).toContain("€39.00");
  await press(el, "finish");
  expect(requests.finishDrawerClose).toHaveBeenCalledWith("first", {
    confirmSequence: 9,
    amountLeft: "6.00",
  });
  await vi.waitFor(() => expect(words(el)).toContain("reprint the slip in Sales"));
});

it("offers another sign-in when this operator has no drawer permission", async () => {
  setLocale("en-GB");
  const requests = api();
  requests.readDrawerClose.mockRejectedValue({ code: "authorization.not_permitted" });
  const { el } = await mountWidget<TillDrawerClose>("till-drawer-close", {
    api: requests,
    printerId: "bar",
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot?.querySelector("wt-form-actions")?.error).toContain(
      "Your role cannot close this drawer",
    ),
  );
  const signingOut = vi.fn();
  el.addEventListener("logout", signingOut);
  await press(el, "sign-in");
  expect(signingOut).toHaveBeenCalledOnce();
  expect(requests.openDrawer).not.toHaveBeenCalled();
});

it("resumes the saved count without a new kick and leaves it available on Back", async () => {
  const requests = api();
  requests.readDrawerClose.mockResolvedValue(pending);
  const { el } = await mountWidget<TillDrawerClose>("till-drawer-close", {
    api: requests,
    printerId: "bar",
  });
  await vi.waitFor(() => expect(action(el, "finish")).toBeTruthy());
  expect(requests.openDrawer).not.toHaveBeenCalled();
  const closed = new Promise<void>((resolve) =>
    el.addEventListener("drawer-close-dismiss", () => resolve(), { once: true }),
  );
  await press(el, "back");
  await closed;
  expect(requests.finishDrawerClose).not.toHaveBeenCalled();
});

it.each(["light", "dark"] as const)(
  "exposes labeled count and withdrawal controls in %s",
  async (theme) => {
    const requests = api();
    requests.readDrawerClose.mockResolvedValue({ ...drawer, state: "new", startSequence: 7 });
    const { el, host } = await mountWidget<TillDrawerClose>(
      "till-drawer-close",
      { api: requests, printerId: "bar" },
      theme,
    );
    await vi.waitFor(() => expect(action(el, "count")).toBeTruthy());
    expect(requests.openDrawer).not.toHaveBeenCalled();
    await expectNoA11yViolations(host);
    await fill(el, "counted", "42");
    await press(el, "count");
    await vi.waitFor(() => expect(action(el, "finish")).toBeTruthy());
    await expectNoA11yViolations(host);
  },
);
