import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { RoutingView } from "../routing-types.js";
import type { RoutingGrid } from "./routing-grid.js";
import type * as GridModel from "./routing-grid-model.js";

const searches = vi.hoisted(() => ({ count: 0 }));
vi.mock("./routing-grid-model.js", async (importOriginal) => {
  const original = await importOriginal<typeof GridModel>();
  return {
    ...original,
    routingSearch: (model: Parameters<typeof GridModel.routingSearch>[0]) => {
      const search = original.routingSearch(model);
      return (query: string, open?: ReadonlySet<string>) => {
        searches.count++;
        return search(query, open);
      };
    },
  };
});
await import("./routing-grid.js");

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

const model: RoutingView = {
  stationTimes: [],
  periods: [],
  todayEnds: null,
  clockReadable: true,
  zones: [{ id: "terrace", name: "Terrace", departmentId: null }],
  categories: [
    { id: "drinks", name: "Drinks", parentId: null },
    { id: "cocktails", name: "Cocktails", parentId: "drinks" },
  ],
  products: [{ id: "mojito", name: "Mojito", categoryId: "cocktails" }],
  cells: [],
  defaultStationId: "kitchen",
  stations: [
    { id: "kitchen", name: "Kitchen", active: true },
    { id: "bar", name: "Bar", active: true },
  ],
  canMakeDefault: true,
};

it("does not search again when an editor opens or a choice is waiting, and does when a category opens during the search", async () => {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("venue-routing-grid") as RoutingGrid;
  el.model = model;
  host.append(el);
  await el.updateComplete;
  const root = el.shadowRoot!;
  const field = root.querySelector<HTMLElementTagNameMap["wt-input"]>('wt-input[name="search"]')!;
  await field.updateComplete;
  await userEvent.fill(field.shadowRoot!.querySelector("input")!, "coc");
  await el.updateComplete;
  expect(root.querySelector('[role="status"]')!.textContent!.trim()).toBe("1 match");
  const afterQuery = searches.count;

  root
    .querySelector<HTMLButtonElement>('td[data-row="c:drinks"] button[data-test="routing-cell"]')!
    .click();
  await el.updateComplete;
  expect(root.querySelector("routing-cell-editor")).not.toBeNull();
  el.pending = {
    address: { row: { kind: "category", categoryId: "drinks" }, zoneId: null },
    target: { kind: "station", stationId: "bar" },
  };
  await el.updateComplete;
  expect(searches.count).toBe(afterQuery);

  root.querySelector<HTMLButtonElement>('button[data-category="cocktails"]')!.click();
  await el.updateComplete;
  expect(searches.count).toBe(afterQuery + 1);
});
