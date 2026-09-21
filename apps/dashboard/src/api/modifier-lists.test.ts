import { expect, it, vi } from "vitest";
import { DashboardApi, type ExtraListInput, type OptionListInput } from "./client.js";

/**
 * The twelve `/management-api/modifiers/{options,extras}` methods: each unwraps the server's
 * envelope key (`optionLists`/`optionList`, `extraLists`/`extraList`, `dependants`), and each sends
 * the URL, verb and body the route expects. One queued `fetch` stub, then one `toEqual` over the
 * whole call table, so a wrong URL, a wrong verb or a dropped body field fails here rather than at
 * runtime in a screen.
 */
it("unwraps the option- and extras-list envelopes and sends the authoring bodies", async () => {
  const optionInput: OptionListInput = {
    name: "Cooking temperature",
    customerName: { en: "How would you like it?" },
    kitchenName: "TEMP",
    defaultLabelId: null,
    active: true,
    labels: [{ name: "Rare", customerName: null, kitchenName: null, available: true }],
  };
  const optionList = {
    id: "o1",
    ...optionInput,
    labels: [{ id: "l1", ...optionInput.labels[0]! }],
  };
  const optionDependants = { products: [{ id: "p1", name: "Steak" }], menus: [] };

  const extraInput: ExtraListInput = {
    name: "Toppings",
    customerName: null,
    kitchenName: null,
    minPicks: 0,
    maxPicks: 2,
    active: true,
    items: [{ productId: "p1", maxQuantity: 1, preselected: false, price: "1.50" }],
  };
  const extraList = { id: "e1", ...extraInput, items: [{ id: "i1", ...extraInput.items[0]! }] };
  const extraDependants = { products: [], menus: [{ id: "m1", name: "Burger" }] };

  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ optionLists: [optionList] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ optionList })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ optionList }), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ optionList })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ dependants: optionDependants })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ extraLists: [extraList] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ extraList })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ extraList }), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ extraList })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ dependants: extraDependants })));
  const api = new DashboardApi("", fetchImpl);

  expect(await api.listOptionLists()).toEqual([optionList]);
  expect(await api.getOptionList("o1")).toEqual(optionList);
  expect(await api.createOptionList(optionInput)).toEqual(optionList);
  expect(await api.updateOptionList("o1", optionInput)).toEqual(optionList);
  // The route answers `{ ok: true }`, not an empty 204 — the method swallows it and resolves to
  // undefined, so a caller cannot come to depend on the envelope.
  expect(await api.deleteOptionList("o1")).toBeUndefined();
  expect(await api.getOptionListDependants("o1")).toEqual(optionDependants);

  expect(await api.listExtraLists()).toEqual([extraList]);
  expect(await api.getExtraList("e1")).toEqual(extraList);
  expect(await api.createExtraList(extraInput)).toEqual(extraList);
  expect(await api.updateExtraList("e1", extraInput)).toEqual(extraList);
  expect(await api.deleteExtraList("e1")).toBeUndefined();
  expect(await api.getExtraListDependants("e1")).toEqual(extraDependants);

  expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
    ["/management-api/modifiers/options", "GET", undefined],
    ["/management-api/modifiers/options/o1", "GET", undefined],
    ["/management-api/modifiers/options", "POST", JSON.stringify(optionInput)],
    ["/management-api/modifiers/options/o1", "PATCH", JSON.stringify(optionInput)],
    ["/management-api/modifiers/options/o1", "DELETE", undefined],
    ["/management-api/modifiers/options/o1/dependants", "GET", undefined],
    ["/management-api/modifiers/extras", "GET", undefined],
    ["/management-api/modifiers/extras/e1", "GET", undefined],
    ["/management-api/modifiers/extras", "POST", JSON.stringify(extraInput)],
    ["/management-api/modifiers/extras/e1", "PATCH", JSON.stringify(extraInput)],
    ["/management-api/modifiers/extras/e1", "DELETE", undefined],
    ["/management-api/modifiers/extras/e1/dependants", "GET", undefined],
  ]);
});
