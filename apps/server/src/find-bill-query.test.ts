import { describe, expect, it } from "vitest";
import { parseBillsQuery, parseTransactionsQuery } from "./find-bill-query.js";
import "./errors.js";

const uuid = "60a3e5fb-8f20-4ed5-a932-145ab46fd7bf";

describe("Find a bill query", () => {
  it("defaults only absent parameters and keeps the search word boundary", () => {
    expect(parseBillsQuery(new URLSearchParams())).toEqual({
      q: "",
      page: 0,
      sort: { key: "openedAt", direction: "descending" },
    });
    expect(parseTransactionsQuery(new URLSearchParams())).toEqual({
      q: "",
      page: 0,
      sort: { key: "when", direction: "descending" },
      dates: { preset: "today" },
    });
    expect(
      parseBillsQuery(
        new URLSearchParams({
          q: "  café ",
          page: "2",
          sort: "total",
          direction: "ascending",
          staffId: uuid.toUpperCase(),
          zoneId: uuid,
          state: "part-paid",
        }),
      ),
    ).toEqual({
      q: "café ",
      page: 2,
      sort: { key: "total", direction: "ascending" },
      staffId: uuid,
      zoneId: uuid,
      state: "part-paid",
    });
    expect(
      parseTransactionsQuery(
        new URLSearchParams({
          q: "0091",
          preset: "custom",
          from: "2026-10-01",
          to: "2026-10-15",
          method: "card",
          type: "full-invoice",
          staffId: uuid,
        }),
      ),
    ).toEqual({
      q: "0091",
      page: 0,
      sort: { key: "when", direction: "descending" },
      dates: { preset: "custom", from: "2026-10-01", to: "2026-10-15" },
      method: "card",
      type: "full-invoice",
      staffId: uuid,
    });
  });
  for (const [query, field] of [
    ["page=-1", "page"],
    ["page=1.5", "page"],
    ["page=", "page"],
    ["page=+1", "page"],
    ["page=9007199254740992", "page"],
    ["page=180143985094820", "page"],
    ["q=" + "a".repeat(101), "q"],
    ["q=a&q=b", "q"],
    ["page=0&page=1", "page"],
    ["direction=up", "direction"],
    ["direction=", "direction"],
    ["staffId=abc", "staffId"],
    ["staffId=", "staffId"],
    ["offset=50", "offset"],
    ["pageSize=100", "pageSize"],
    ["limit=100", "limit"],
    ["unexpected=x", "unexpected"],
  ]) {
    it.each([parseBillsQuery, parseTransactionsQuery])(
      "rejects invalid list query " + query,
      (parse) => {
        expect(() => parse(new URLSearchParams(query))).toThrow(
          expect.objectContaining({ code: "management.request_invalid", params: { field } }),
        );
      },
    );
  }
  it.each([
    ["sort=when", "sort"],
    ["sort=", "sort"],
    ["zoneId=bad", "zoneId"],
    ["zoneId=", "zoneId"],
    ["state=paid", "state"],
    ["state=", "state"],
    ["preset=today", "preset"],
    ["method=card", "method"],
  ])("rejects invalid Bills query %s", (query, field) => {
    expect(() => parseBillsQuery(new URLSearchParams(query))).toThrow(
      expect.objectContaining({ code: "management.request_invalid", params: { field } }),
    );
  });
  it.each([
    ["sort=openedAt", "sort"],
    ["type=credit-note", "type"],
    ["type=", "type"],
    ["method=crypto", "method"],
    ["preset=week", "preset"],
    ["preset=", "preset"],
    ["state=unpaid", "state"],
    ["zoneId=" + uuid, "zoneId"],
    ["preset=custom&from=2026-02-29&to=2026-03-01", "from"],
    ["preset=custom&from=2026-10-16&to=2026-10-15", "to"],
    ["preset=custom&from=2026-10-15", "to"],
    ["preset=custom&to=2026-10-15", "from"],
    ["preset=today&from=2026-10-15", "from"],
    ["preset=any&to=2026-10-15", "to"],
    ["preset=custom&from=2026-10-01&to=bad", "to"],
  ])("rejects invalid Transactions query %s", (query, field) => {
    expect(() => parseTransactionsQuery(new URLSearchParams(query))).toThrow(
      expect.objectContaining({ code: "management.request_invalid", params: { field } }),
    );
  });
  it.each(["openedAt", "tableName", "zone", "staff", "items", "total", "paid", "state"])(
    "accepts Bills sort %s",
    (sort) => {
      expect(parseBillsQuery(new URLSearchParams({ sort })).sort.key).toBe(sort);
    },
  );
  it.each(["when", "invoice", "type", "tableName", "method", "staff", "amount"])(
    "accepts Transactions sort %s",
    (sort) => {
      expect(parseTransactionsQuery(new URLSearchParams({ sort })).sort.key).toBe(sort);
    },
  );
  it.each(["today", "yesterday", "business-day", "last-7-days", "this-month", "any"])(
    "accepts date preset %s",
    (preset) => {
      expect(parseTransactionsQuery(new URLSearchParams({ preset })).dates).toEqual({ preset });
    },
  );
  it("accepts the largest exact page offset and bounds by trimmed search length", () => {
    expect(
      parseBillsQuery(
        new URLSearchParams({ page: "180143985094819", q: "  " + "a".repeat(100) + "  " }),
      ),
    ).toMatchObject({ page: 180143985094819, q: "a".repeat(100) + "  " });
    expect(parseBillsQuery(new URLSearchParams({ q: "   " })).q).toBe("");
  });
});
