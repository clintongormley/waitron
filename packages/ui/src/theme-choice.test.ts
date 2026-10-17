import { LitElement, html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_CHOICES,
  THEME_SELECTED_EVENT,
  THEME_STORAGE_KEY,
  ThemeChoiceController,
  chooseTheme,
  currentThemeChoice,
  isThemeChoice,
  startThemeChoice,
  subscribeThemeChoice,
} from "./theme-choice.js";

class ThemeChoiceProbe extends LitElement {
  readonly #theme = new ThemeChoiceController(this);
  override render() {
    return html`<span>${this.#theme.choice}</span>`;
  }
}
customElements.define("theme-choice-probe", ThemeChoiceProbe);

class ThemeChoiceApplyingProbe extends LitElement {
  readonly #theme = new ThemeChoiceController(this, { applies: true });
  override render() {
    return html`<span>${this.#theme.choice}</span>`;
  }
}
customElements.define("theme-choice-applying-probe", ThemeChoiceApplyingProbe);

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  vi.restoreAllMocks();
  chooseTheme("device");
  localStorage.removeItem(THEME_STORAGE_KEY);
  root.remove();
  for (const probe of document.querySelectorAll("theme-choice-probe, theme-choice-applying-probe"))
    probe.remove();
});

async function mount(tag: string): Promise<LitElement> {
  const element = document.createElement(tag) as LitElement;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

function pick(probe: LitElement, detail: unknown): void {
  const span = probe.shadowRoot?.querySelector("span");
  if (!span) throw new Error("probe has not rendered");
  span.dispatchEvent(
    new CustomEvent("wt-theme-selected", { detail, bubbles: true, composed: true }),
  );
}

describe("the saved theme choice", () => {
  // Runs first on purpose: every later case has started the choice on its own root.
  it("applies to the document when nothing has started yet", () => {
    chooseTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    chooseTheme("device");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("names the choices in menu order and the event and key it uses", () => {
    expect(THEME_CHOICES).toEqual(["light", "dark", "device"]);
    expect(THEME_SELECTED_EVENT).toBe("wt-theme-selected");
    expect(THEME_STORAGE_KEY).toBe("waitron-theme");
    expect(THEME_CHOICES.every(isThemeChoice)).toBe(true);
    for (const value of ["sepia", "Dark", "", null, undefined, 1, { choice: "dark" }])
      expect(isThemeChoice(value)).toBe(false);
  });

  it("starts on Follow device with nothing saved, and leaves data-theme off", () => {
    startThemeChoice(root);
    expect(currentThemeChoice()).toBe("device");
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it.each(["light", "dark"] as const)(
    "applies a saved %s choice to the root as it starts",
    (choice) => {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
      startThemeChoice(root);
      expect(root.getAttribute("data-theme")).toBe(choice);
      expect(currentThemeChoice()).toBe(choice);
    },
  );

  it("starting tells subscribers when the saved choice differs, and only then", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThemeChoice(listener);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    startThemeChoice(root);
    expect(listener).toHaveBeenCalledOnce();
    startThemeChoice(root);
    expect(listener).toHaveBeenCalledOnce();
    chooseTheme("device");
    listener.mockClear();
    startThemeChoice(root);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it.each(["Dark", "", "auto", "device", '{"theme":"dark"}'])(
    "treats a saved %j as Follow device",
    (saved) => {
      localStorage.setItem(THEME_STORAGE_KEY, saved);
      startThemeChoice(root);
      expect(root.hasAttribute("data-theme")).toBe(false);
      expect(currentThemeChoice()).toBe("device");
    },
  );

  it("reading blocked storage falls back to Follow device without throwing", () => {
    const denied = () => {
      throw new DOMException("Denied", "SecurityError");
    };
    for (const block of [
      () => vi.spyOn(window, "localStorage", "get").mockImplementation(denied),
      () => vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied),
    ]) {
      localStorage.setItem(THEME_STORAGE_KEY, "dark");
      block();
      expect(() => startThemeChoice(root)).not.toThrow();
      expect(currentThemeChoice()).toBe("device");
      expect(root.hasAttribute("data-theme")).toBe(false);
      vi.restoreAllMocks();
    }
  });

  it.each(["light", "dark"] as const)(
    "a choice of %s is saved under waitron-theme and applied at once",
    (choice) => {
      startThemeChoice(root);
      chooseTheme(choice);
      expect(localStorage.getItem("waitron-theme")).toBe(choice);
      expect(root.getAttribute("data-theme")).toBe(choice);
    },
  );

  it("Follow device removes the saved value and the attribute", () => {
    startThemeChoice(root);
    chooseTheme("dark");
    chooseTheme("device");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("a save the browser refuses still changes the open page", () => {
    startThemeChoice(root);
    const full = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(full);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(full);
    expect(() => chooseTheme("dark")).not.toThrow();
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(currentThemeChoice()).toBe("dark");
    expect(() => chooseTheme("device")).not.toThrow();
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("tells subscribers once per change, and nothing after they unsubscribe", () => {
    startThemeChoice(root);
    const listener = vi.fn();
    const unsubscribe = subscribeThemeChoice(listener);
    chooseTheme("dark");
    chooseTheme("dark");
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    chooseTheme("light");
    expect(listener).toHaveBeenCalledOnce();
  });

  // Another tab's write lands in this tab's localStorage before its storage event arrives, so
  // each case writes the shared value first and then dispatches the event that would follow it.
  function otherTabSaved(key: string | null, newValue: string | null): void {
    if (key !== null && newValue !== null) localStorage.setItem(key, newValue);
    else if (key !== null) localStorage.removeItem(key);
    else localStorage.removeItem(THEME_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea: localStorage }));
  }

  it("follows a choice made in another tab of this browser", () => {
    startThemeChoice(root);
    const listener = vi.fn();
    const unsubscribe = subscribeThemeChoice(listener);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    otherTabSaved(THEME_STORAGE_KEY, "dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(currentThemeChoice()).toBe("dark");
    expect(listener).toHaveBeenCalledOnce();
    window.dispatchEvent(
      new StorageEvent("storage", { key: "other", newValue: "light", storageArea: localStorage }),
    );
    expect(currentThemeChoice()).toBe("dark");
    expect(listener).toHaveBeenCalledOnce();
    otherTabSaved(null, null);
    expect(currentThemeChoice()).toBe("device");
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(setItem.mock.calls).toEqual([[THEME_STORAGE_KEY, "dark"]]);
    unsubscribe();
  });

  it("a storage event older than this tab's own later choice does not undo it", () => {
    startThemeChoice(root);
    chooseTheme("light");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: THEME_STORAGE_KEY,
        newValue: "dark",
        storageArea: localStorage,
      }),
    );
    expect(currentThemeChoice()).toBe("light");
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it("a change to session storage under the theme's key, or a session storage clear, changes nothing", () => {
    startThemeChoice(root);
    chooseTheme("dark");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: THEME_STORAGE_KEY,
        newValue: "light",
        storageArea: sessionStorage,
      }),
    );
    expect(currentThemeChoice()).toBe("dark");
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: sessionStorage }));
    expect(currentThemeChoice()).toBe("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("a storage event when this page cannot reach localStorage changes nothing", () => {
    startThemeChoice(root);
    chooseTheme("dark");
    const storageArea = localStorage;
    storageArea.setItem(THEME_STORAGE_KEY, "light");
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, storageArea }));
    expect(currentThemeChoice()).toBe("dark");
  });

  it("starting twice still follows other tabs only once", () => {
    startThemeChoice(root);
    startThemeChoice(root);
    const listener = vi.fn();
    const unsubscribe = subscribeThemeChoice(listener);
    otherTabSaved(THEME_STORAGE_KEY, "light");
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("a host with the controller redraws when the choice changes", async () => {
    startThemeChoice(root);
    const probe = await mount("theme-choice-probe");
    chooseTheme("dark");
    await probe.updateComplete;
    expect(probe.shadowRoot?.textContent).toBe("dark");
  });

  it("a host that applies picks saves and applies a wt-theme-selected sent from inside its shadow root", async () => {
    startThemeChoice(root);
    const probe = await mount("theme-choice-applying-probe");
    pick(probe, { choice: "light" });
    expect(currentThemeChoice()).toBe("light");
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("a host that does not apply picks leaves the choice alone", async () => {
    startThemeChoice(root);
    const probe = await mount("theme-choice-probe");
    pick(probe, { choice: "light" });
    expect(currentThemeChoice()).toBe("device");
  });

  it("a wt-theme-selected naming no known choice changes nothing", async () => {
    startThemeChoice(root);
    const probe = await mount("theme-choice-applying-probe");
    pick(probe, { choice: "sepia" });
    pick(probe, null);
    expect(currentThemeChoice()).toBe("device");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("once its host leaves the page it neither redraws nor applies picks", async () => {
    startThemeChoice(root);
    const probe = await mount("theme-choice-applying-probe");
    probe.remove();
    const requestUpdate = vi.spyOn(probe, "requestUpdate");
    chooseTheme("dark");
    expect(requestUpdate).not.toHaveBeenCalled();
    pick(probe, { choice: "light" });
    expect(currentThemeChoice()).toBe("dark");
  });
});
