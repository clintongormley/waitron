import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { UrlStateController } from "./url-state.js";
import { cleanup, mount } from "./test-helpers.js";

class UrlScreen extends LitElement {
  selected: string | null = null;
  readonly url = new UrlStateController(
    this,
    () => {
      this.selected = this.url.read("tab");
      this.requestUpdate();
    },
    { basePath: "/tabs", primary: "tab", children: { "*": { menu: "menu", zone: "zone" } } },
  );
  override render() {
    return html`${this.selected}`;
  }
}
customElements.define("test-url-screen", UrlScreen);
const originalUrl = location.href;
afterEach(() => {
  cleanup();
  history.replaceState(null, "", originalUrl);
});

it("restores URL state, preserves unrelated parameters and state, and follows history", async () => {
  const url = new URL(location.href);
  url.pathname = "/tabs/floor";
  url.searchParams.set("dev", "1");
  history.replaceState({ marker: "retained" }, "", url);
  const el = (await mount("<test-url-screen></test-url-screen>")) as UrlScreen;
  expect(el.shadowRoot!.textContent).toContain("floor");
  el.url.write({ tab: "counter" });
  expect(location.pathname).toBe("/tabs/counter");
  expect(new URL(location.href).searchParams.get("dev")).toBe("1");
  expect(history.state).toEqual({ marker: "retained" });
  const length = history.length;
  el.url.write({ tab: "counter" });
  expect(history.length).toBe(length);
  const back = new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );
  history.back();
  await back;
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain("floor");
  el.url.write({ tab: null }, true);
  expect(el.url.read("tab")).toBeNull();
  expect(history.length).toBe(length);
});

it("stops observing and writing browser state when its host disconnects", async () => {
  const el = (await mount("<test-url-screen></test-url-screen>")) as UrlScreen;
  el.remove();
  const url = new URL(location.href);
  url.pathname = "/tabs/floor";
  history.replaceState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(el.selected).toBeNull();
  el.url.write({ tab: "counter" });
  expect(el.url.read("tab")).toBe("floor");
});

it("encodes identifiers and distinguishes an unassigned zone from an absent selection", async () => {
  history.replaceState(null, "", "/tabs/floor?dev=1#anchor");
  const el = (await mount("<test-url-screen></test-url-screen>")) as UrlScreen;
  el.url.write({ menu: "Lunch / drinks", zone: "" });
  expect(location.pathname).toBe("/tabs/floor/menu/Lunch%20%2F%20drinks/zone/~");
  expect(location.search).toBe("?dev=1");
  expect(location.hash).toBe("#anchor");
  expect(el.url.read("menu")).toBe("Lunch / drinks");
  expect(el.url.read("zone")).toBe("");
  el.url.write({ zone: "~" });
  expect(location.pathname).toContain("/zone/%7E");
  expect(el.url.read("zone")).toBe("~");
  el.url.write({ zone: null });
  expect(el.url.read("zone")).toBeNull();
});

it("ignores paths outside its app and malformed encoded identifiers", async () => {
  history.replaceState(null, "", "/manage/staff");
  const el = (await mount("<test-url-screen></test-url-screen>")) as UrlScreen;
  expect(el.url.read("tab")).toBeNull();
  history.replaceState(null, "", "/tabs/%broken");
  expect(el.url.read("tab")).toBeNull();
});

it.each([".", "..", "~.", "~..", "a/b", "Español"])(
  "round-trips the tab identifier %s as one path segment",
  async (tab) => {
    const el = (await mount("<test-url-screen></test-url-screen>")) as UrlScreen;
    el.url.write({ tab });
    expect(el.url.read("tab")).toBe(tab);
    expect(location.pathname.split("/")).toHaveLength(3);
  },
);
