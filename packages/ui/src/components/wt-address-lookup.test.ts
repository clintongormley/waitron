import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-address-lookup.js";
import type {
  AddressLookupProvider,
  AddressLookupResult,
  AddressLookupSuggestion,
  WtAddressLookup,
} from "./wt-address-lookup.js";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const MAYOR: AddressLookupSuggestion = {
  id: "s1",
  label: "Calle Mayor 1",
  secondaryLabel: "28013 Madrid",
};
const MAYOR_2: AddressLookupSuggestion = { id: "s2", label: "Calle Mayor 2" };
const RESOLVED: AddressLookupResult = {
  lines: ["Calle Mayor 1"],
  locality: "Madrid",
  administrativeAreaCode: "M",
  postalCode: "28013",
  countryCode: "ES",
};

interface FakeCalls {
  suggest: { query: string; countryCode: string; sessionToken: string }[];
  resolve: { suggestionId: string; sessionToken: string }[];
}

function fakeProvider(
  suggestions: readonly AddressLookupSuggestion[] = [MAYOR, MAYOR_2],
  overrides: Partial<AddressLookupProvider> = {},
): AddressLookupProvider & { calls: FakeCalls } {
  const calls: FakeCalls = { suggest: [], resolve: [] };
  return {
    calls,
    suggest: async (input) => {
      calls.suggest.push(input);
      return suggestions;
    },
    resolve: async (input) => {
      calls.resolve.push(input);
      return RESOLVED;
    },
    ...overrides,
  };
}

async function mountLookup(
  provider: AddressLookupProvider | null = fakeProvider(),
  inShadow = false,
): Promise<WtAddressLookup> {
  const markup =
    '<wt-address-lookup label="Find the address" placeholder="Street and number" country-code="ES" no-results-label="No address found." unavailable-label="Suggestions are not available."></wt-address-lookup>';
  const el = (await (inShadow ? mountInShadowRoot(markup) : mount(markup))) as WtAddressLookup;
  el.provider = provider ?? undefined;
  el.delay = 0;
  await el.updateComplete;
  return el;
}

const input = (el: WtAddressLookup) => el.shadowRoot!.querySelector("input")!;
const options = (el: WtAddressLookup) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]'),
];
const status = (el: WtAddressLookup) =>
  el.shadowRoot!.querySelector('[role="status"]')?.textContent?.trim() ?? "";

function type(el: WtAddressLookup, text: string): void {
  const field = input(el);
  field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

async function settle(el: WtAddressLookup): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

test("without a provider it is hidden and draws nothing", async () => {
  const el = await mountLookup(null);
  expect(el.hidden).toBe(true);
  expect(el.getBoundingClientRect().height).toBe(0);
});

test("stays hidden when the page around it gives it a display", async () => {
  const el = await mountLookup(null);
  el.style.display = "block";
  expect(el.getBoundingClientRect().height).toBe(0);
});

test("with a provider it shows a labelled search field", async () => {
  const el = await mountLookup();
  expect(el.hidden).toBe(false);
  expect(el.getBoundingClientRect().height).toBeGreaterThan(0);
  expect(input(el).getAttribute("role")).toBe("combobox");
  expect(el.shadowRoot!.querySelector("label")!.textContent).toContain("Find the address");
});

test("removing the provider hides it again", async () => {
  const el = await mountLookup();
  el.provider = undefined;
  await el.updateComplete;
  expect(el.hidden).toBe(true);
});

test("asks only after the typing pauses, with the form's country and a session token", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const provider = fakeProvider();
  const el = await mountLookup(provider);
  el.delay = 300;
  type(el, "Calle M");
  vi.advanceTimersByTime(200);
  type(el, "Calle Ma");
  vi.advanceTimersByTime(299);
  expect(provider.calls.suggest).toHaveLength(0);
  vi.advanceTimersByTime(1);
  expect(provider.calls.suggest).toHaveLength(1);
  expect(provider.calls.suggest[0]!.query).toBe("Calle Ma");
  expect(provider.calls.suggest[0]!.countryCode).toBe("ES");
  expect(provider.calls.suggest[0]!.sessionToken).toMatch(/^[0-9a-f]{32}$/);
});

test("the pause is 300 ms unless set", async () => {
  const el = document.createElement("wt-address-lookup");
  expect(el.delay).toBe(300);
});

test("asks nothing for fewer than three characters, and a shorter text closes the list", async () => {
  const provider = fakeProvider();
  const el = await mountLookup(provider);
  type(el, "Ca");
  await settle(el);
  expect(provider.calls.suggest).toHaveLength(0);
  type(el, "Calle");
  await settle(el);
  expect(options(el)).toHaveLength(2);
  type(el, "  C  ");
  await settle(el);
  expect(options(el)).toHaveLength(0);
  expect(input(el).getAttribute("aria-expanded")).toBe("false");
  expect(provider.calls.suggest).toHaveLength(1);
});

test("lists each suggestion with its second line and opens the field", async () => {
  const el = await mountLookup();
  type(el, "Calle Mayor");
  await settle(el);
  const rows = options(el);
  expect(rows.map((row) => row.textContent!.replace(/\s+/g, " ").trim())).toEqual([
    "Calle Mayor 1 28013 Madrid",
    "Calle Mayor 2",
  ]);
  expect(input(el).getAttribute("aria-expanded")).toBe("true");
  expect(input(el).getAttribute("aria-controls")).toBe(
    el.shadowRoot!.querySelector('[role="listbox"]')!.id,
  );
});

test("an answer to an older text is dropped", async () => {
  const answers: ((list: readonly AddressLookupSuggestion[]) => void)[] = [];
  const provider = fakeProvider([], {
    suggest: () => new Promise((resolve) => answers.push(resolve)),
  });
  const el = await mountLookup(provider);
  type(el, "Calle Mayor");
  await settle(el);
  type(el, "Calle Mayor 2");
  await settle(el);
  answers[1]!([MAYOR_2]);
  await settle(el);
  answers[0]!([MAYOR]);
  await settle(el);
  expect(options(el).map((row) => row.textContent!.trim())).toEqual(["Calle Mayor 2"]);
});

test("Down then Enter resolves the active suggestion and sends wt-address-chosen out of a shadow root", async () => {
  const provider = fakeProvider();
  const el = await mountLookup(provider, true);
  const chosen = vi.fn();
  document.addEventListener("wt-address-chosen", chosen);
  try {
    input(el).focus();
    type(el, "Calle Mayor");
    await settle(el);
    await userEvent.keyboard("{ArrowDown}");
    await el.updateComplete;
    expect(input(el).getAttribute("aria-activedescendant")).toBe(options(el)[0]!.id);
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{ArrowUp}");
    await userEvent.keyboard("{Enter}");
    await settle(el);
    expect(provider.calls.resolve).toEqual([
      { suggestionId: "s1", sessionToken: provider.calls.suggest[0]!.sessionToken },
    ]);
    expect(chosen).toHaveBeenCalledOnce();
    const event = chosen.mock.calls[0]![0] as CustomEvent<{ address: AddressLookupResult }>;
    expect(event.detail.address).toEqual(RESOLVED);
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  } finally {
    document.removeEventListener("wt-address-chosen", chosen);
  }
});

test("a click chooses a suggestion, then the text clears and the list closes", async () => {
  const provider = fakeProvider();
  const el = await mountLookup(provider);
  const chosen = vi.fn();
  el.addEventListener("wt-address-chosen", chosen);
  input(el).focus();
  type(el, "Calle Mayor");
  await settle(el);
  await userEvent.click(options(el)[1]!);
  await settle(el);
  expect(provider.calls.resolve[0]!.suggestionId).toBe("s2");
  expect(chosen).toHaveBeenCalledOnce();
  expect(input(el).value).toBe("");
  expect(options(el)).toHaveLength(0);
});

test("the next search after a choice takes a new session token", async () => {
  const provider = fakeProvider();
  const el = await mountLookup(provider);
  type(el, "Calle Mayor");
  await settle(el);
  await userEvent.click(options(el)[0]!);
  await settle(el);
  type(el, "Calle Real");
  await settle(el);
  const [first, second] = provider.calls.suggest;
  expect(second!.sessionToken).not.toBe(first!.sessionToken);
  expect(second!.sessionToken).toMatch(/^[0-9a-f]{32}$/);
});

test("Arrow keys wrap around the list", async () => {
  const el = await mountLookup();
  input(el).focus();
  type(el, "Calle Mayor");
  await settle(el);
  await userEvent.keyboard("{ArrowUp}");
  await el.updateComplete;
  expect(input(el).getAttribute("aria-activedescendant")).toBe(options(el)[1]!.id);
  await userEvent.keyboard("{ArrowDown}");
  await el.updateComplete;
  expect(input(el).getAttribute("aria-activedescendant")).toBe(options(el)[0]!.id);
  expect(options(el)[0]!.getAttribute("aria-selected")).toBe("true");
});

test("Escape closes an open list and does not reach the page", async () => {
  const el = await mountLookup();
  const outside = vi.fn();
  host.addEventListener("keydown", outside);
  input(el).focus();
  type(el, "Calle Mayor");
  await settle(el);
  await userEvent.keyboard("{Escape}");
  await el.updateComplete;
  expect(options(el)).toHaveLength(0);
  expect(outside).not.toHaveBeenCalled();
});

test("Enter in the field never submits the form around it", async () => {
  const el = await mountLookup();
  const seen: boolean[] = [];
  host.addEventListener("keydown", (event) => seen.push(event.defaultPrevented));
  input(el).focus();
  type(el, "Calle Mayor");
  await settle(el);
  await userEvent.keyboard("{Enter}");
  expect(seen).toEqual([true]);
});

test("leaving the field closes the list", async () => {
  const el = await mountLookup();
  input(el).focus();
  type(el, "Calle Mayor");
  await settle(el);
  input(el).blur();
  await el.updateComplete;
  expect(options(el)).toHaveLength(0);
});

test("typing does not send input or wt-change out of the field", async () => {
  const el = await mountLookup();
  const outside = vi.fn();
  host.addEventListener("input", outside);
  host.addEventListener("wt-change", outside);
  input(el).focus();
  await userEvent.keyboard("Calle");
  expect(outside).not.toHaveBeenCalled();
});

test("no suggestions says so", async () => {
  const el = await mountLookup(fakeProvider([]));
  type(el, "Nowhere street");
  await settle(el);
  expect(status(el)).toBe("No address found.");
  expect(input(el).getAttribute("aria-expanded")).toBe("false");
});

test("a refused or throwing search says suggestions are unavailable", async () => {
  for (const suggest of [
    () => Promise.reject(new Error("down")),
    () => {
      throw new Error("down");
    },
  ]) {
    const el = await mountLookup(fakeProvider([], { suggest }));
    type(el, "Calle Mayor");
    await settle(el);
    expect(status(el)).toBe("Suggestions are not available.");
    expect(options(el)).toHaveLength(0);
    cleanup();
  }
});

test("a refused resolve says suggestions are unavailable and sends nothing", async () => {
  const el = await mountLookup(
    fakeProvider([MAYOR], { resolve: () => Promise.reject(new Error("down")) }),
  );
  const chosen = vi.fn();
  el.addEventListener("wt-address-chosen", chosen);
  type(el, "Calle Mayor");
  await settle(el);
  await userEvent.click(options(el)[0]!);
  await settle(el);
  expect(chosen).not.toHaveBeenCalled();
  expect(status(el)).toBe("Suggestions are not available.");
});

test("new typing clears an earlier line", async () => {
  const el = await mountLookup(fakeProvider([]));
  type(el, "Nowhere street");
  await settle(el);
  expect(status(el)).not.toBe("");
  type(el, "No");
  await el.updateComplete;
  expect(status(el)).toBe("");
});

test("a form's own message shows on the line and describes the field", async () => {
  const el = await mountLookup();
  el.message = "That address is in another country.";
  await el.updateComplete;
  expect(status(el)).toBe("That address is in another country.");
  const line = el.shadowRoot!.querySelector('[role="status"]')!;
  expect(input(el).getAttribute("aria-describedby")).toBe(line.id);
});

test("a disabled field asks nothing", async () => {
  const provider = fakeProvider();
  const el = await mountLookup(provider);
  el.disabled = true;
  await el.updateComplete;
  expect(input(el).disabled).toBe(true);
  type(el, "Calle Mayor");
  await settle(el);
  expect(provider.calls.suggest).toHaveLength(0);
});

test("meets the tap target and paints from the field tokens", async () => {
  const el = await mountLookup();
  host.style.setProperty("--wt-tap-min", "52px");
  host.style.setProperty("--wt-color-field-fill", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-field-line", "rgb(4, 5, 6)");
  const field = el.shadowRoot!.querySelector(".field")!;
  expect(input(el).getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
  expect(getComputedStyle(field).backgroundColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(field).boxShadow).toBe("rgb(4, 5, 6) 0px -1px 0px 0px inset");
});

test("the list paints from the surface and border tokens, and a second line in the muted one", async () => {
  const el = await mountLookup();
  host.style.setProperty("--wt-color-surface", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-border", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-color-text-muted", "rgb(13, 14, 15)");
  type(el, "Calle Mayor");
  await settle(el);
  const list = el.shadowRoot!.querySelector('[role="listbox"]')!;
  expect(getComputedStyle(list).backgroundColor).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(list).borderTopColor).toBe("rgb(10, 11, 12)");
  expect(getComputedStyle(options(el)[0]!.querySelector(".secondary")!).color).toBe(
    "rgb(13, 14, 15)",
  );
});

test("is no wider than the field cap a container sets, and as wide as its container without one", async () => {
  const el = await mountLookup();
  host.style.width = "600px";
  expect(el.getBoundingClientRect().width).toBe(600);
  host.style.setProperty("--wt-field-max-width", "200px");
  expect(el.getBoundingClientRect().width).toBe(200);
  expect(input(el).getBoundingClientRect().width).toBe(200);
});

test("Escape with the list closed reaches the page, so a dialog around the field can close", async () => {
  const el = await mountLookup();
  const outside = vi.fn();
  host.addEventListener("keydown", outside);
  input(el).focus();
  await userEvent.keyboard("{Escape}");
  expect(outside).toHaveBeenCalledOnce();
});

test("a resolve that throws at once says suggestions are unavailable", async () => {
  const el = await mountLookup(
    fakeProvider([MAYOR], {
      resolve: () => {
        throw new Error("down");
      },
    }),
  );
  type(el, "Calle Mayor");
  await settle(el);
  await userEvent.click(options(el)[0]!);
  await settle(el);
  expect(status(el)).toBe("Suggestions are not available.");
});

test("a resolve answer is dropped once a newer search began or the field left the page", async () => {
  for (const after of ["typing", "removed"] as const) {
    const answers: ((address: AddressLookupResult) => void)[] = [];
    const el = await mountLookup(
      fakeProvider([MAYOR], { resolve: () => new Promise((resolve) => answers.push(resolve)) }),
    );
    const chosen = vi.fn();
    el.addEventListener("wt-address-chosen", chosen);
    type(el, "Calle Mayor");
    await settle(el);
    await userEvent.click(options(el)[0]!);
    if (after === "typing") type(el, "Calle Real");
    else el.remove();
    answers[0]!(RESOLVED);
    await settle(el);
    expect(chosen, after).not.toHaveBeenCalled();
    cleanup();
  }
});

test("the line under the field is drawn, in the muted text colour", async () => {
  const el = await mountLookup();
  host.style.setProperty("--wt-color-text-muted", "rgb(16, 17, 18)");
  el.message = "That address is in another country.";
  await el.updateComplete;
  const line = el.shadowRoot!.querySelector<HTMLElement>('[role="status"]')!;
  const box = line.getBoundingClientRect();
  expect(box.height).toBeGreaterThan(8);
  expect(box.width).toBeGreaterThan(100);
  expect(getComputedStyle(line).color).toBe("rgb(16, 17, 18)");
});

test("a refused answer to an older search says nothing", async () => {
  for (const which of ["suggest", "resolve"] as const) {
    const refusals: ((error: Error) => void)[] = [];
    const late = () => new Promise<never>((_, reject) => refusals.push(reject));
    const el = await mountLookup(
      fakeProvider([MAYOR], which === "suggest" ? { suggest: late } : { resolve: late }),
    );
    type(el, "Calle Mayor");
    await settle(el);
    if (which === "resolve") await userEvent.click(options(el)[0]!);
    type(el, "Ca");
    refusals[0]!(new Error("down"));
    await settle(el);
    expect(status(el), which).toBe("");
    cleanup();
  }
});

test("removing the provider drops a pending search and an open list", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const provider = fakeProvider();
  const el = await mountLookup(provider);
  el.delay = 300;
  type(el, "Calle Mayor");
  el.provider = undefined;
  await el.updateComplete;
  vi.advanceTimersByTime(300);
  expect(provider.calls.suggest).toHaveLength(0);
  vi.useRealTimers();

  el.provider = provider;
  el.delay = 0;
  await el.updateComplete;
  type(el, "Calle Mayor");
  await settle(el);
  expect(options(el)).toHaveLength(2);
  input(el).focus();
  await userEvent.keyboard("{ArrowDown}");
  el.provider = undefined;
  await el.updateComplete;
  expect(options(el)).toHaveLength(0);
  input(el).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
  await settle(el);
  expect(provider.calls.resolve).toHaveLength(0);
});

test("a key the list does not use leaves it as it is", async () => {
  const el = await mountLookup();
  type(el, "Calle Mayor");
  await settle(el);
  const key = new KeyboardEvent("keydown", { key: "Home", cancelable: true });
  input(el).dispatchEvent(key);
  await el.updateComplete;
  expect(key.defaultPrevented).toBe(false);
  expect(options(el)).toHaveLength(2);
  expect(input(el).hasAttribute("aria-activedescendant")).toBe(false);
});
