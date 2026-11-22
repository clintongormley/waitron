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

it.each(["read", "finish"] as const)(
  "offers another sign-in when the %s is refused for its drawer grant",
  async (stage) => {
    setLocale("en-GB");
    const requests = api();
    if (stage === "read") {
      requests.readDrawerClose.mockRejectedValue({ code: "authorization.not_permitted" });
    } else {
      requests.readDrawerClose.mockResolvedValue(pending);
      requests.finishDrawerClose.mockRejectedValue({ code: "authorization.not_permitted" });
    }
    const { el } = await mountWidget<TillDrawerClose>("till-drawer-close", {
      api: requests,
      printerId: "bar",
    });
    if (stage === "finish") await press(el, "finish");
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("wt-form-actions")?.error).toContain("Open cash drawers"),
    );
    const signingOut = vi.fn();
    el.addEventListener("logout", signingOut);
    expect(action(el, "sign-in")?.textContent?.trim()).toBe("Log out");
    await press(el, "sign-in");
    expect(signingOut).toHaveBeenCalledOnce();
    expect(requests.openDrawer).not.toHaveBeenCalled();
  },
);

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

const footerError = (el: TillDrawerClose) => el.shadowRoot?.querySelector("wt-form-actions")?.error;

it("does not kick the drawer when the dialog closed before its read answered", async () => {
  const requests = api();
  let answer!: (value: unknown) => void;
  const read = new Promise((resolve) => (answer = resolve));
  requests.readDrawerClose.mockReturnValue(read);
  const { el } = await mountWidget<TillDrawerClose>("till-drawer-close", {
    api: requests,
    printerId: "bar",
    opensDrawer: true,
  });
  el.remove();
  answer({ ...drawer, state: "new", startSequence: 7 });
  await read;
  expect(requests.openDrawer).not.toHaveBeenCalled();
});

it("asks to reopen when the read answers for another drawer", async () => {
  setLocale("en-GB");
  const requests = api();
  requests.readDrawerClose.mockResolvedValue({ ...pending, printerId: "kitchen" });
  const { el } = await mountWidget<TillDrawerClose>("till-drawer-close", {
    api: requests,
    printerId: "bar",
  });
  await vi.waitFor(() => expect(footerError(el)).toContain("Open Close drawer again to continue"));
  expect(action(el, "finish")).toBeNull();
  expect(el.shadowRoot?.querySelector("wt-input")).toBeNull();
});

it("says the drawer could not be read when the read fails for another reason", async () => {
  setLocale("en-GB");
  const requests = api();
  requests.readDrawerClose.mockRejectedValue({ code: "server.unavailable" });
  const { el } = await mountWidget<TillDrawerClose>("till-drawer-close", {
    api: requests,
    printerId: "bar",
  });
  await vi.waitFor(() => expect(footerError(el)).toContain("Could not read the drawer"));
  expect(action(el, "sign-in")).toBeNull();
  expect(action(el, "count")).toBeNull();
});

it("refuses an amount with more than two decimal places without saving", async () => {
  setLocale("en-GB");
  const requests = api();
  const { el } = await mountWidget<TillDrawerClose>("till-drawer-close", {
    api: requests,
    printerId: "bar",
  });
  await vi.waitFor(() => expect(action(el, "count")).toBeTruthy());
  await fill(el, "counted", "4.567");
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!;
  await vi.waitFor(() =>
    expect(field.error).toBe("Enter a cash amount with up to two decimal places."),
  );
  expect(footerError(el)).toBe("Check the cash amount above.");
  expect((action(el, "count") as HTMLElementTagNameMap["wt-button"]).disabled).toBe(true);
  expect(requests.saveDrawerCount).not.toHaveBeenCalled();
});

it("saves the count once when the button is pressed twice before the dialog redraws", async () => {
  const requests = api();
  const { el } = await mountWidget<TillDrawerClose>("till-drawer-close", {
    api: requests,
    printerId: "bar",
  });
  await vi.waitFor(() => expect(action(el, "count")).toBeTruthy());
  await fill(el, "counted", "42");
  await el.updateComplete;
  const button = action(el, "count")!;
  button.click();
  button.click();
  await vi.waitFor(() => expect(action(el, "finish")).toBeTruthy());
  expect(requests.saveDrawerCount).toHaveBeenCalledOnce();
});

it("saves the count when Enter is pressed in the amount field", async () => {
  const requests = api();
  const { el } = await mountWidget<TillDrawerClose>("till-drawer-close", {
    api: requests,
    printerId: "bar",
  });
  await vi.waitFor(() => expect(action(el, "count")).toBeTruthy());
  await fill(el, "counted", "42");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(requests.saveDrawerCount).toHaveBeenCalledWith({
      printerId: "bar",
      startSequence: 7,
      counted: "42.00",
    }),
  );
});

it.each(["drawer.close_changed", "drawer.recount_unavailable", "drawer.close_not_found"])(
  "reloads the same count and says cash moved when finishing is refused with %s",
  async (code) => {
    setLocale("en-GB");
    const requests = api();
    requests.readDrawerClose.mockResolvedValue(pending);
    requests.finishDrawerClose.mockRejectedValue({ code });
    const { el } = await mountWidget<TillDrawerClose>("till-drawer-close", {
      api: requests,
      printerId: "bar",
    });
    await press(el, "finish");
    await vi.waitFor(() => expect(requests.readDrawerClose).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(footerError(el)).toContain("Cash moved after this count"));
    expect(action(el, "finish")).toBeTruthy();
  },
);

it("asks to reopen when the reload after a refused finish shows another count", async () => {
  setLocale("en-GB");
  const requests = api();
  requests.readDrawerClose
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce({ ...pending, first: { ...first, id: "other" } });
  requests.finishDrawerClose.mockRejectedValue({ code: "drawer.close_changed" });
  const { el } = await mountWidget<TillDrawerClose>("till-drawer-close", {
    api: requests,
    printerId: "bar",
  });
  await press(el, "finish");
  await vi.waitFor(() => expect(footerError(el)).toContain("Open Close drawer again to continue"));
  expect(action(el, "finish")).toBeNull();
});

it.each(["drawer.close_changed", "drawer.no_printer"])(
  "asks to reopen when the first count is refused with %s",
  async (code) => {
    setLocale("en-GB");
    const requests = api();
    requests.saveDrawerCount.mockRejectedValue({ code });
    const { el } = await mountWidget<TillDrawerClose>("till-drawer-close", {
      api: requests,
      printerId: "bar",
    });
    await vi.waitFor(() => expect(action(el, "count")).toBeTruthy());
    await fill(el, "counted", "42");
    await press(el, "count");
    await vi.waitFor(() =>
      expect(footerError(el)).toContain("Open Close drawer again to continue"),
    );
    expect(action(el, "count")).toBeNull();
    expect(requests.readDrawerClose).toHaveBeenCalledOnce();
  },
);

it("keeps the count open with a retry message when saving fails for another reason", async () => {
  setLocale("en-GB");
  const requests = api();
  requests.saveDrawerCount.mockRejectedValue({ code: "server.unavailable" });
  const { el } = await mountWidget<TillDrawerClose>("till-drawer-close", {
    api: requests,
    printerId: "bar",
  });
  await vi.waitFor(() => expect(action(el, "count")).toBeTruthy());
  await fill(el, "counted", "42");
  await press(el, "count");
  await vi.waitFor(() =>
    expect(footerError(el)).toBe("Could not save the drawer close. Try again."),
  );
  expect(action(el, "count")).toBeTruthy();
});
