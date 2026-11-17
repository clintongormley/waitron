import { expect, it, vi } from "vitest";
import { createRequest } from "@waitron/dashboard-kit";
import { DashboardApi } from "./api/client.js";
import { readerSettingSearchDestinations } from "./reader-setting-search.js";
import { reader } from "./testing/reader-settings-fixture.js";
it("resolves all listed readers passively with exact labels, location and encoded paths", async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response(
        JSON.stringify([
          { ...reader, id: "r/+" },
          { ...reader, id: "off", name: "Bar", active: false, provider: "other" },
        ]),
      ),
  );
  const api = new DashboardApi("", fetchImpl);
  const foreground = vi.spyOn(api, "listReaders").mockRejectedValue(new Error("foreground read"));
  const entries = readerSettingSearchDestinations(api);
  expect(entries.map((e) => [e.id, e.labelKey, e.locationKey, e.screen])).toEqual([
    ["dashboard:reader:reader-name", "payments.reader_col_name", "action.edit", "payments"],
    [
      "dashboard:reader:prints-own-slip-automatically",
      "payments.prints_own_slip_automatically",
      "action.edit",
      "payments",
    ],
  ]);
  for (const entry of entries)
    expect(await entry.resolve({ request: createRequest({ fetchImpl }) })).toEqual([
      { id: "r/+", label: "Counter", path: "/payments/reader/r%2F%2B" },
      { id: "off", label: "Bar", path: "/payments/reader/off" },
    ]);
  expect(foreground).not.toHaveBeenCalled();
  expect(fetchImpl.mock.calls).toHaveLength(2);
  vi.restoreAllMocks();
});
