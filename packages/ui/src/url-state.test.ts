import { afterEach, expect, it, vi } from "vitest";
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

/** Runs `move` and waits for the browser to finish the history navigation it triggers. */
async function navigate(move: () => void): Promise<void> {
  const settled = new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );
  move();
  await settled;
}

it("re-reads the path when the browser goes back and then forward again", async () => {
  history.replaceState(null, "", "/tabs/floor");
  const el = (await mount("<test-url-screen></test-url-screen>")) as UrlScreen;
  el.url.write({ tab: "counter" });
  expect(el.selected).toBe("floor");
  await navigate(() => history.back());
  expect(el.selected).toBe("floor");
  await navigate(() => history.forward());
  expect(el.selected).toBe("counter");
});

it("replaces the current entry rather than adding another step to go back through", async () => {
  history.replaceState(null, "", "/tabs/floor");
  const el = (await mount("<test-url-screen></test-url-screen>")) as UrlScreen;
  el.url.write({ tab: "counter" });
  el.url.write({ tab: "kitchen" }, true);
  expect(location.pathname).toBe("/tabs/kitchen");
  await navigate(() => history.back());
  expect(location.pathname).toBe("/tabs/floor");
});

it("ignores a navigation field left with no value after it", async () => {
  history.replaceState(null, "", "/tabs/floor/menu");
  const el = (await mount("<test-url-screen></test-url-screen>")) as UrlScreen;
  expect(el.url.read("tab")).toBe("floor");
  expect(el.url.read("menu")).toBeNull();
});

it("keeps the rest of the path when an unrecognised field carries a malformed value", async () => {
  history.replaceState(null, "", "/tabs/floor/menu/lunch/bogus/%broken");
  const el = (await mount("<test-url-screen></test-url-screen>")) as UrlScreen;
  expect(el.url.read("tab")).toBe("floor");
  expect(el.url.read("menu")).toBe("lunch");
});

class KeptScreen extends LitElement {
  readonly url = new UrlStateController(this, () => {}, {
    basePath: "/cal",
    primary: "page",
    children: { calendar: { view: "view", month: "month" }, other: { view: "view" } },
    keepUnlisted: ["calendar"],
  });
}
customElements.define("test-kept-url-screen", KeptScreen);

it("keeps a kept destination's unlisted pairs where they stand while it stays there", async () => {
  history.replaceState(null, "", "/cal/calendar/view/staffing/painter/season/month/2026-12/x/1");
  const el = (await mount("<test-kept-url-screen></test-kept-url-screen>")) as KeptScreen;
  const replace = vi.spyOn(history, "replaceState");
  el.url.write({ page: "calendar" }, true);
  expect(location.pathname).toBe("/cal/calendar/view/staffing/painter/season/month/2026-12/x/1");
  expect(replace).not.toHaveBeenCalled();
  el.url.write({ month: "2027-01" }, true);
  expect(location.pathname).toBe("/cal/calendar/view/staffing/painter/season/month/2027-01/x/1");
  el.url.write({ month: null, view: "year" }, true);
  expect(location.pathname).toBe("/cal/calendar/view/year/painter/season/x/1");
  replace.mockRestore();
});

it("drops the unlisted pairs on moving to another destination, and keeps none on one not kept", async () => {
  history.replaceState(null, "", "/cal/calendar/view/staffing/week/2026-11-30");
  const el = (await mount("<test-kept-url-screen></test-kept-url-screen>")) as KeptScreen;
  el.url.write({ page: "other" }, true);
  expect(location.pathname).toBe("/cal/other/view/staffing");
  history.replaceState(null, "", "/cal/other/view/staffing/week/2026-11-30");
  el.url.write({ page: "other" }, true);
  expect(location.pathname).toBe("/cal/other/view/staffing");
  history.replaceState(null, "", "/cal/other/view/staffing/week/2026-11-30");
  el.url.write({ page: "calendar" }, true);
  expect(location.pathname).toBe("/cal/calendar/view/staffing");
});

it("keeps a kept pair's escaped value exactly as the address spells it", async () => {
  const path = "/cal/calendar/view/staffing/area/station%3Aa%2Fb/note/~/bad/%E0%A4%A";
  history.replaceState(null, "", path);
  const el = (await mount("<test-kept-url-screen></test-kept-url-screen>")) as KeptScreen;
  el.url.write({ page: "calendar" }, true);
  expect(location.pathname).toBe(path);
  el.url.write({ month: "2027-01" }, true);
  expect(location.pathname).toBe(`${path}/month/2027-01`);
});
