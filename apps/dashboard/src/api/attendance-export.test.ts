import { expect, it } from "vitest";
import { createRequest, type FetchLike } from "@waitron/dashboard-kit";
import type { AttendanceExportSelection } from "@waitron/dashboard-modules";
const modules = import.meta.glob<typeof import("./attendance-export.js")>("./attendance-export.ts");
const selection: AttendanceExportSelection = {
  locationId: "place & one",
  from: "2020-01-01",
  before: "2026-02-01",
  audience: "representatives",
  format: "pdf",
  locale: "es",
};
async function client(
  response = () =>
    new Response(new Uint8Array([0, 127, 255]), { headers: { "content-type": "application/pdf" } }),
) {
  const load = modules["./attendance-export.ts"];
  expect(load, "export client exists").toBeTypeOf("function");
  const { AttendanceExportApi } = await load!();
  const calls: { path: string; init: RequestInit }[] = [],
    active: string[] = [];
  const fetchImpl: FetchLike = async (path, init) => {
    calls.push({ path, init });
    return response();
  };
  return {
    api: new AttendanceExportApi(
      createRequest({ baseUrl: "/box", fetchImpl, onSuccess: (path) => active.push(path) }),
    ),
    calls,
    active,
  };
}
it("projects exact selections, sends cookies and keeps only options passive", async () => {
  const { api, calls, active } = await client();
  const blob = await api.own({ ...selection, personId: "injected" } as AttendanceExportSelection);
  expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 127, 255]);
  await api.manager(selection);
  await api.manager({ ...selection, personId: "worker & two" });
  expect(calls.map((c) => c.path)).toEqual([
    "/box/management-api/me/attendance/export?locationId=place+%26+one&from=2020-01-01&before=2026-02-01&format=pdf&audience=representatives&locale=es",
    "/box/management-api/attendance/export?locationId=place+%26+one&from=2020-01-01&before=2026-02-01&format=pdf&audience=representatives&locale=es",
    "/box/management-api/attendance/export?locationId=place+%26+one&from=2020-01-01&before=2026-02-01&format=pdf&audience=representatives&locale=es&personId=worker+%26+two",
  ]);
  for (const { init } of calls) {
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).has("x-waitron-live")).toBe(false);
  }
  expect(active).toHaveLength(3);
  const options = await client(
    () => new Response(JSON.stringify({ available: true, canExportAll: false })),
  );
  expect(await options.api.options("place & one")).toEqual({
    available: true,
    canExportAll: false,
  });
  expect(options.calls[0]!.path).toBe(
    "/box/management-api/me/attendance/export-options?locationId=place+%26+one",
  );
  expect(new Headers(options.calls[0]!.init.headers).get("x-waitron-live")).toBe("1");
  expect(options.active).toEqual([]);
});
it.each([401, 403])(
  "preserves a JSON %s refusal instead of treating it as a blob",
  async (status) => {
    const { api } = await client(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: status === 401 ? "management_session.expired" : "authorization.not_permitted",
              params: { permission: "report.export" },
            },
          }),
          { status, headers: { "content-type": "application/json" } },
        ),
    );
    await expect(api.own(selection)).rejects.toMatchObject({
      status,
      code: status === 401 ? "management_session.expired" : "authorization.not_permitted",
    });
  },
);
