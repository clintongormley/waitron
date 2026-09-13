import { expect, it, vi } from "vitest";
import { DashboardApi } from "./client.js";
it("unwraps canonical modifier envelopes and sends full create/update inputs", async () => {
  const input = { type: "text" as const, name: { es: "Nota" }, available: true };
  const modifier = { id: "m", ...input };
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ modifiers: [modifier] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ modifier })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ modifier })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ modifier })))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const api = new DashboardApi("", fetchImpl);
  expect(await api.listModifiers()).toEqual([modifier]);
  expect(await api.getModifier("m")).toEqual(modifier);
  expect(await api.createModifier(input)).toEqual(modifier);
  expect(await api.updateModifier("m", input)).toEqual(modifier);
  await api.deleteModifier("m");
  expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
    ["/management-api/modifiers", "GET", undefined],
    ["/management-api/modifiers/m", "GET", undefined],
    ["/management-api/modifiers", "POST", JSON.stringify(input)],
    ["/management-api/modifiers/m", "PATCH", JSON.stringify(input)],
    ["/management-api/modifiers/m", "DELETE", undefined],
  ]);
});
