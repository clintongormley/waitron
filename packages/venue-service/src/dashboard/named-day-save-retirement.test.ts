import { expect, it } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { parseSpecialDateInput } from "../hours-rules.js";
import { NamedDaysApi } from "./named-days-client.js";

const input = {
  date: "2026-10-20",
  name: "Anniversary",
  kind: "working_day" as const,
  repeats: true,
  ownHours: true,
  closeWholeVenue: false,
};

it("edits named-day facts without reading station hours or sending station cells", async () => {
  const requests: unknown[][] = [];
  const api = new NamedDaysApi((async (path, method, body, options) => {
    requests.push([path, method, body, options]);
    if (method === "GET") throw new Error("retired station-hours reader");
    expect(parseSpecialDateInput(body)).toEqual(input);
    return { id: "named day", ...input };
  }) as DashboardRequest);
  expect(await api.saveDay("named day", input)).toEqual({ id: "named day", ...input });
  expect(requests).toEqual([
    ["/management-api/venue-service/special-dates/named%20day", "PUT", input, undefined],
  ]);
});

it("creates a named day with exactly its calendar facts", async () => {
  const requests: unknown[][] = [];
  const api = new NamedDaysApi((async (path, method, body, options) => {
    requests.push([path, method, body, options]);
    expect(parseSpecialDateInput(body)).toEqual(input);
    return { id: "created", ...input };
  }) as DashboardRequest);
  expect(await api.saveDay(null, input)).toEqual({ id: "created", ...input });
  expect(requests).toEqual([
    ["/management-api/venue-service/special-dates", "POST", input, undefined],
  ]);
});

it("does not begin a create or edit after its editor has left", async () => {
  for (const id of [null, "source"]) {
    const requests: unknown[][] = [];
    const api = new NamedDaysApi((async (...args) => {
      requests.push(args);
      return {};
    }) as DashboardRequest);
    const save = api.saveDay as unknown as (
      id: string | null,
      value: typeof input,
      current: () => boolean,
    ) => Promise<unknown>;
    await save.call(api, id, input, () => false);
    expect(requests).toEqual([]);
  }
});

it("returns a calendar write refusal without a preceding station read", async () => {
  const refusal = { code: "special_date.date_taken", params: { date: input.date } };
  const requests: unknown[][] = [];
  const api = new NamedDaysApi((async (path, method, body, options) => {
    requests.push([path, method, body, options]);
    if (method === "GET") throw new Error("retired station-hours reader");
    throw refusal;
  }) as DashboardRequest);
  await expect(api.saveDay("source", input)).rejects.toEqual(refusal);
  expect(requests).toEqual([
    ["/management-api/venue-service/special-dates/source", "PUT", input, undefined],
  ]);
});
