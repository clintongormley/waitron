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
  delay = 0,
): Promise<WtAddressLookup> {
  const markup =
    '<wt-address-lookup label="Street address" placeholder="Street and number" autocomplete="address-line1" country-code="ES" unavailable-label="Suggestions are not available."></wt-address-lookup>';
  const el = (await (inShadow ? mountInShadowRoot(markup) : mount(markup))) as WtAddressLookup;
  el.provider = provider ?? undefined;
  el.delay = delay;
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

test("without a provider the labelled street stays editable and supports address autofill", async () => {
  const el = await mountLookup(null);
  expect(input(el).getBoundingClientRect().height).toBeGreaterThan(0);
  expect(input(el).getAttribute("role")).toBeNull();
  expect(input(el).getAttribute("autocomplete")).toBe("address-line1");
  await userEvent.fill(input(el), "Main Street");
  expect(el.value).toBe("Main Street");
});

test("keeps the applied address credit visible when the provider disappears", async () => {
  const el = await mountLookup();
  el.appliedAttribution = "Google Maps";
  el.provider = undefined;
  await el.updateComplete;

  const credit = el.shadowRoot!.querySelector('[part="attribution"]')!;
  expect(credit?.textContent).toBe("Google Maps");
  expect(credit.getBoundingClientRect().height).toBeGreaterThan(0);
  expect(input(el).getBoundingClientRect().height).toBeGreaterThan(0);
});

test("with a provider it shows a labelled search field", async () => {
  const el = await mountLookup();
  expect(el.hidden).toBe(false);
  expect(el.getBoundingClientRect().height).toBeGreaterThan(0);
  expect(input(el).getAttribute("role")).toBe("combobox");
  expect(el.shadowRoot!.querySelector("label")!.textContent).toContain("Street address");
});

test("changing provider availability preserves the street and changes autocomplete", async () => {
  const el = await mountLookup();
  el.value = "Main Street";
  await el.updateComplete;
  expect(input(el).getAttribute("autocomplete")).toBe("off");
  el.provider = undefined;
  await el.updateComplete;
  expect(input(el).value).toBe("Main Street");
  expect(input(el).getAttribute("autocomplete")).toBe("address-line1");
});

test("waits for a word break or a one-second pause after typing", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const provider = fakeProvider();
  const el = await mountLookup(provider, false, 1000);
  type(el, "Mai");
  await vi.advanceTimersByTimeAsync(750);
  type(el, "Main");
  await vi.advanceTimersByTimeAsync(999);
  expect(provider.calls.suggest).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(provider.calls.suggest[0]).toEqual({
    query: "Main",
    countryCode: "ES",
    sessionToken: expect.stringMatching(/^[0-9a-f]{32}$/),
  });

  type(el, "Main Street,");
  await vi.advanceTimersByTimeAsync(0);
  expect(provider.calls.suggest.map(({ query }) => query)).toEqual(["Main", "Main Street"]);
  type(el, "Main Street, ");
  await vi.advanceTimersByTimeAsync(1000);
  expect(provider.calls.suggest).toHaveLength(2);
  expect(options(el)).toHaveLength(2);
});

test("shows a search answer during continued typing and skips added joining words", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const queries: string[] = [];
  const answers: ((suggestions: AddressLookupSuggestion[]) => void)[] = [];
  const el = await mountLookup(
    fakeProvider([], {
      suggest: ({ query }) => {
        queries.push(query);
        return new Promise((resolve) => answers.push(resolve));
      },
    }),
    false,
    1000,
  );
  el.ignoredSearchWords = ["avenue", "of", "the"];
  type(el, "Avenue of Saint ");
  await vi.advanceTimersByTimeAsync(0);
  type(el, "Avenue of Saint Jo");
  answers[0]!([MAYOR]);
  await vi.advanceTimersByTimeAsync(0);
  expect(options(el)).toHaveLength(1);

  type(el, "Avenue of Saint John ");
  await vi.advanceTimersByTimeAsync(0);
  expect(options(el)).toHaveLength(0);
  answers[1]!([MAYOR]);
  await vi.advanceTimersByTimeAsync(0);
  input(el).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
  await el.updateComplete;
  expect(input(el).hasAttribute("aria-activedescendant")).toBe(true);
  type(el, "Avenue of Saint John of the ");
  await vi.advanceTimersByTimeAsync(1000);
  expect(options(el)).toHaveLength(1);
  expect(input(el).hasAttribute("aria-activedescendant")).toBe(false);
  expect(queries).toEqual(["Avenue of Saint", "Avenue of Saint John"]);

  type(el, "Avenue of Saint John of the Cross 3");
  await vi.advanceTimersByTimeAsync(1000);
  expect(queries.at(-1)).toBe("Avenue of Saint John of the Cross 3");
});

test("the pause is one second unless set", () => {
  expect(document.createElement("wt-address-lookup").delay).toBe(1000);
});

test("a bare number and ignored words spend no search before or after a pause", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const provider = fakeProvider();
  const el = await mountLookup(provider);
  el.ignoredSearchWords = ["street", "of", "the"];
  await el.updateComplete;
  for (const text of ["42", "Street of the ", "42 STREET-", "123 Street"]) {
    type(el, text);
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(provider.calls.suggest).toHaveLength(0);

  type(el, "Oak ");
  await vi.advanceTimersByTimeAsync(0);
  expect(provider.calls.suggest.map(({ query }) => query)).toEqual(["Oak"]);
  type(el, "42 ");
  await vi.advanceTimersByTimeAsync(1000);
  expect(provider.calls.suggest).toHaveLength(1);
  expect(options(el)).toHaveLength(0);
});

test("a replacement street drops a queued search and closes already visible suggestions", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const provider = fakeProvider();
  const el = await mountLookup(provider, false, 1000);
  type(el, "Main Street");
  el.value = "Oak Road";
  await el.updateComplete;
  await vi.advanceTimersByTimeAsync(1000);
  expect(provider.calls.suggest).toHaveLength(0);

  type(el, "Oak Road ");
  await vi.advanceTimersByTimeAsync(0);
  expect(options(el)).toHaveLength(2);
  el.value = "Pine Road";
  await el.updateComplete;
  expect(options(el)).toHaveLength(0);
  expect(provider.calls.suggest.map(({ query }) => query)).toEqual(["Oak Road"]);
});

test("after five automatic searches, Enter can save the typed street without another search", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const provider = fakeProvider();
  const el = await mountLookup(provider);
  const automatic = ["Main", "Main S", "Main St", "Main Street", "Main Street 1"];
  for (const query of automatic) {
    type(el, query);
    await vi.advanceTimersByTimeAsync(600);
  }
  el.cancelSearch();
  type(el, "Main Street 12");
  await vi.advanceTimersByTimeAsync(600);

  const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
  input(el).dispatchEvent(enter);
  expect(enter.defaultPrevented).toBe(false);
  expect(provider.calls.suggest.map(({ query }) => query)).toEqual(automatic);
  expect(input(el).value).toBe("Main Street 12");
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

test("a click chooses a suggestion and keeps the typed street until the form fills it", async () => {
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
  expect(input(el).value).toBe("Calle Mayor");
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

test("Enter without an active suggestion keeps the surrounding form's action", async () => {
  const el = await mountLookup();
  const seen: boolean[] = [];
  host.addEventListener("keydown", (event) => seen.push(event.defaultPrevented));
  input(el).focus();
  type(el, "Calle Mayor");
  await settle(el);
  await userEvent.keyboard("{Enter}");
  expect(seen).toEqual([false]);
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

test("typing sends one ordinary field change before searching", async () => {
  const provider = fakeProvider();
  const el = await mountLookup(provider);
  const native = vi.fn();
  const changes: string[] = [];
  host.addEventListener("input", native);
  host.addEventListener("wt-change", (event) => {
    changes.push((event as CustomEvent<{ value: string }>).detail.value);
    el.cancelSearch();
  });
  await userEvent.fill(input(el), "Calle Mayor");
  await settle(el);
  expect(native).not.toHaveBeenCalled();
  expect(changes).toEqual(["Calle Mayor"]);
  expect(provider.calls.suggest.map(({ query }) => query)).toEqual(["Calle Mayor"]);
});

test("no suggestions leaves manual typing quiet", async () => {
  const el = await mountLookup(fakeProvider([]));
  type(el, "Nowhere street");
  await settle(el);
  expect(status(el)).toBe("");
  expect(input(el).getAttribute("aria-expanded")).toBe("false");
});

test("a refused or throwing search leaves manual typing quiet", async () => {
  for (const suggest of [
    () => Promise.reject(new Error("down")),
    () => {
      throw new Error("down");
    },
  ]) {
    const el = await mountLookup(fakeProvider([], { suggest }));
    type(el, "Calle Mayor");
    await settle(el);
    expect(status(el)).toBe("");
    expect(options(el)).toHaveLength(0);
    cleanup();
  }
});

test("Enter reaches the form again as soon as a chosen address is refused", async () => {
  let refuse!: (reason: Error) => void;
  const pending = new Promise<never>((_, reject) => (refuse = reject));
  const el = await mountLookup(fakeProvider([MAYOR], { resolve: () => pending }));
  const enters = vi.fn();
  host.addEventListener("keydown", (event) => {
    if (event.key === "Enter") enters(event);
  });
  await userEvent.fill(input(el), "Calle Mayor");
  await settle(el);
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await userEvent.keyboard("{Enter}");
  expect(enters).not.toHaveBeenCalled();

  refuse(new Error("unavailable"));
  await settle(el);
  expect(status(el)).toBe("Suggestions are not available.");
  await userEvent.keyboard("{Enter}");
  expect(enters).toHaveBeenCalledOnce();
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
  const el = await mountLookup();
  el.message = "That address is in another country.";
  await el.updateComplete;
  expect(status(el)).toBe("That address is in another country.");
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

test("a resolve answer is dropped when the street is edited or the field leaves the page", async () => {
  for (const after of ["typing a new street", "typing a comma", "removed"] as const) {
    const answers: ((address: AddressLookupResult) => void)[] = [];
    let pending: AbortSignal | undefined;
    const el = await mountLookup(
      fakeProvider([MAYOR], {
        resolve: (_input, signal?: AbortSignal) => {
          pending = signal;
          return new Promise((resolve) => answers.push(resolve));
        },
      }),
    );
    const chosen = vi.fn();
    el.addEventListener("wt-address-chosen", chosen);
    type(el, "Calle Mayor");
    await settle(el);
    await userEvent.click(options(el)[0]!);
    if (after === "removed") el.remove();
    else type(el, after === "typing a comma" ? "Calle Mayor," : "Calle Real");
    expect(pending?.aborted, after).toBe(true);
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

type Change = "remove the provider" | "replace the provider" | "change the country" | "disable it";

async function change(el: WtAddressLookup, what: Change): Promise<void> {
  if (what === "remove the provider") el.provider = undefined;
  if (what === "replace the provider") el.provider = fakeProvider();
  if (what === "change the country") el.countryCode = "PT";
  if (what === "disable it") el.disabled = true;
  await el.updateComplete;
}

const CHANGES: readonly Change[] = [
  "remove the provider",
  "replace the provider",
  "change the country",
  "disable it",
];

test.each(CHANGES)("a resolve answer, or its refusal, is dropped after you %s", async (what) => {
  for (const settleWith of ["answer", "refusal"] as const) {
    const answers: ((address: AddressLookupResult) => void)[] = [];
    const refusals: ((error: Error) => void)[] = [];
    const el = await mountLookup(
      fakeProvider([MAYOR], {
        resolve: () =>
          new Promise((resolve, reject) => {
            answers.push(resolve);
            refusals.push(reject);
          }),
      }),
    );
    const chosen = vi.fn();
    el.addEventListener("wt-address-chosen", chosen);
    type(el, "Calle Mayor");
    await settle(el);
    await userEvent.click(options(el)[0]!);
    await change(el, what);
    if (settleWith === "answer") answers[0]!(RESOLVED);
    else refusals[0]!(new Error("down"));
    await settle(el);
    expect(chosen, settleWith).not.toHaveBeenCalled();
    expect(status(el), settleWith).toBe("");
    cleanup();
  }
});

test.each(CHANGES)(
  "a search answer is dropped, and an open list closes, after you %s",
  async (what) => {
    const answers: ((list: readonly AddressLookupSuggestion[]) => void)[] = [];
    const el = await mountLookup(fakeProvider([MAYOR]));
    type(el, "Calle Mayor");
    await settle(el);
    expect(options(el)).toHaveLength(1);
    await change(el, what);
    expect(options(el)).toHaveLength(0);

    cleanup();
    const late = await mountLookup(
      fakeProvider([], { suggest: () => new Promise((resolve) => answers.push(resolve)) }),
    );
    type(late, "Calle Mayor");
    await settle(late);
    await change(late, what);
    answers[0]!([MAYOR]);
    await settle(late);
    expect(options(late)).toHaveLength(0);
    expect(status(late)).toBe("");
  },
);

test("leaving the field before the answer arrives keeps the list closed", async () => {
  const answers: ((list: readonly AddressLookupSuggestion[]) => void)[] = [];
  const el = await mountLookup(
    fakeProvider([], { suggest: () => new Promise((resolve) => answers.push(resolve)) }),
  );
  input(el).focus();
  type(el, "Calle Mayor");
  await settle(el);
  input(el).blur();
  answers[0]!([MAYOR]);
  await settle(el);
  expect(options(el)).toHaveLength(0);
  expect(status(el)).toBe("");
});

test("leaving the field before the pause ends asks nothing", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const provider = fakeProvider();
  const el = await mountLookup(provider);
  el.delay = 300;
  input(el).focus();
  type(el, "Calle Mayor");
  input(el).blur();
  vi.advanceTimersByTime(300);
  expect(provider.calls.suggest).toHaveLength(0);
});

test("a chosen suggestion still arrives after focus leaves the field", async () => {
  const answers: ((address: AddressLookupResult) => void)[] = [];
  const el = await mountLookup(
    fakeProvider([MAYOR], { resolve: () => new Promise((resolve) => answers.push(resolve)) }),
  );
  const chosen = vi.fn();
  el.addEventListener("wt-address-chosen", chosen);
  input(el).focus();
  type(el, "Calle Mayor");
  await settle(el);
  await userEvent.click(options(el)[0]!);
  input(el).blur();
  answers[0]!(RESOLVED);
  await settle(el);
  expect(chosen).toHaveBeenCalledOnce();
});

test("cancelSearch drops a chosen suggestion still on its way and the open list, keeping the text", async () => {
  const answers: ((address: AddressLookupResult) => void)[] = [];
  const el = await mountLookup(
    fakeProvider([MAYOR], { resolve: () => new Promise((resolve) => answers.push(resolve)) }),
  );
  const chosen = vi.fn();
  el.addEventListener("wt-address-chosen", chosen);
  type(el, "Calle Mayor");
  await settle(el);
  await userEvent.click(options(el)[0]!);
  el.cancelSearch();
  answers[0]!(RESOLVED);
  await settle(el);
  expect(chosen).not.toHaveBeenCalled();
  expect(input(el).value).toBe("Calle Mayor");

  type(el, "Calle Mayor");
  await settle(el);
  expect(options(el)).toHaveLength(1);
  el.cancelSearch();
  await el.updateComplete;
  expect(options(el)).toHaveLength(0);
});

test("Enter on an active suggestion stops at the field; Enter with none active reaches the page", async () => {
  const el = await mountLookup();
  const outside = vi.fn();
  host.addEventListener("keydown", outside);
  input(el).focus();
  type(el, "Calle Mayor");
  await settle(el);
  await userEvent.keyboard("{ArrowDown}");
  outside.mockClear();
  await userEvent.keyboard("{Enter}");
  expect(outside).not.toHaveBeenCalled();
  await settle(el);
  await userEvent.keyboard("{Enter}");
  expect(outside).toHaveBeenCalledOnce();
});

test("a click on a suggestion stops at the field", async () => {
  const el = await mountLookup();
  const outside = vi.fn();
  host.addEventListener("click", outside);
  type(el, "Calle Mayor");
  await settle(el);
  await userEvent.click(options(el)[0]!);
  expect(outside).not.toHaveBeenCalled();
});

test("each suggestion row is at least the dropdown row height tall", async () => {
  const el = await mountLookup();
  host.style.setProperty("--wt-dropdown-row-height", "90px");
  type(el, "Calle Mayor");
  await settle(el);
  expect(options(el).map((row) => row.getBoundingClientRect().height)).toEqual([90, 90]);
});

test("the search field takes the name a form gives it, and has none otherwise", async () => {
  const el = await mountLookup();
  expect(input(el).hasAttribute("name")).toBe(false);
  el.name = "domicile-search";
  await el.updateComplete;
  expect(input(el).getAttribute("name")).toBe("domicile-search");
});

test("a named search field uses its name as its input's id, as wt-input does, and its label points at it", async () => {
  const el = await mountLookup();
  expect(input(el).id).toMatch(/^wt-address-lookup/);
  el.name = "domicile-search";
  await el.updateComplete;
  expect(input(el).id).toBe("domicile-search");
  expect(el.shadowRoot?.querySelector("label")?.htmlFor).toBe("domicile-search");
});

test("a new search hides the form's line about the last choice", async () => {
  const provider = fakeProvider([MAYOR]);
  const el = await mountLookup(provider);
  el.message = "That address is in another country.";
  await el.updateComplete;
  type(el, "Nowhere");
  await el.updateComplete;
  expect(status(el)).toBe("");
  el.provider = fakeProvider([]);
  await el.updateComplete;
  type(el, "Nowhere street");
  await settle(el);
  expect(status(el)).toBe("");
  el.message = "That address is in another province.";
  await el.updateComplete;
  expect(status(el)).toBe("That address is in another province.");
});

test("the form's line shows again for the next choice, even when its text is the same", async () => {
  const el = await mountLookup(fakeProvider([MAYOR]));
  el.message = "That address is in another country.";
  await el.updateComplete;
  type(el, "Calle Mayor");
  await settle(el);
  expect(status(el)).toBe("");
  await userEvent.click(options(el)[0]!);
  await settle(el);
  expect(status(el)).toBe("That address is in another country.");
});

test.each(["isComposing", "keyCode 229"] as const)(
  "an Enter that confirms an input-method character (%s) chooses no suggestion",
  async (how) => {
    const provider = fakeProvider();
    const el = await mountLookup(provider, true);
    input(el).focus();
    type(el, "Calle Mayor");
    await settle(el);
    await userEvent.keyboard("{ArrowDown}");
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      composed: true,
      cancelable: true,
      isComposing: how === "isComposing",
    });
    if (how === "keyCode 229") Object.defineProperty(event, "keyCode", { value: 229 });
    input(el).dispatchEvent(event);
    await settle(el);
    expect(provider.calls.resolve).toEqual([]);
    expect(event.defaultPrevented).toBe(false);

    await userEvent.keyboard("{Enter}");
    await settle(el);
    expect(provider.calls.resolve).toHaveLength(1);
  },
);

test.each(["isComposing", "keyCode 229"] as const)(
  "an Escape or arrow key an input method owns (%s) leaves the list alone",
  async (how) => {
    const el = await mountLookup();
    const outside = vi.fn();
    host.addEventListener("keydown", outside);
    input(el).focus();
    type(el, "Calle Mayor");
    await settle(el);
    for (const key of ["ArrowDown", "ArrowUp", "Escape"]) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        composed: true,
        cancelable: true,
        isComposing: how === "isComposing",
      });
      if (how === "keyCode 229") Object.defineProperty(event, "keyCode", { value: 229 });
      input(el).dispatchEvent(event);
      await settle(el);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(options(el).length).toBeGreaterThan(0);
    expect(outside).toHaveBeenCalledTimes(3);
    host.removeEventListener("keydown", outside);

    await userEvent.keyboard("{Escape}");
    await el.updateComplete;
    expect(options(el)).toHaveLength(0);
  },
);

test("search text keeps a 16px minimum and follows doubled browser text", async () => {
  const rootStyle = document.documentElement.getAttribute("style");
  try {
    const el = await mountLookup();
    const control = input(el);
    expect(getComputedStyle(control).fontSize).toBe("16px");
    document.documentElement.style.fontSize = "32px";
    expect(getComputedStyle(control).fontSize).toBe("32px");
    host.style.setProperty("--wt-font-size-md", "2rem");
    expect(getComputedStyle(control).fontSize).toBe("64px");
  } finally {
    if (rootStyle === null) document.documentElement.removeAttribute("style");
    else document.documentElement.setAttribute("style", rootStyle);
  }
});
