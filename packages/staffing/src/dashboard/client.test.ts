import { describe, expect, it, vi } from "vitest";
import { createRequest, LiveData, QueryController } from "@waitron/dashboard-kit";
import type { StaffRole } from "../staffing-types.js";
import { StaffingApi } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: true, status, text: async () => JSON.stringify(body) } as Response;
}
function emptyResponse(): Response {
  return { ok: true, status: 204, text: async () => "" } as Response;
}

const waiter: StaffRole = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Waiter",
  colour: "blue",
  position: 0,
  holderIds: [],
};
const BASE = "/management-api/staffing/staff-roles";

function api(fetchImpl: ReturnType<typeof vi.fn>, liveData?: LiveData) {
  return new StaffingApi(
    createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    liveData,
  );
}

function sent(fetchImpl: ReturnType<typeof vi.fn>, call = 0) {
  const [path, init] = fetchImpl.mock.calls[call]! as [string, RequestInit];
  return {
    path,
    method: init.method,
    body: init.body === undefined ? undefined : (JSON.parse(init.body as string) as unknown),
    live: new Headers(init.headers).get("x-waitron-live"),
  };
}

const host = () =>
  ({ addController: vi.fn() }) as unknown as ConstructorParameters<typeof QueryController>[0];

describe("StaffingApi", () => {
  it("watches the staff roles with a passive read, depending on the staff-roles query's tables", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ staffRoles: [waiter] }));
    const liveData = new LiveData();
    const queries = new QueryController(host(), () => liveData, vi.fn());
    const apply = vi.fn();
    await api(fetchImpl, liveData).watchStaffRoles(queries, apply);
    expect(apply).toHaveBeenCalledWith([waiter]);
    expect(sent(fetchImpl)).toMatchObject({ path: BASE, method: "GET", live: "1" });
    expect(liveData.interests).toEqual([
      { type: "staff_roles" },
      { type: "person_staff_roles" },
      { type: "persons" },
    ]);
    fetchImpl.mockResolvedValue(jsonResponse({ staffRoles: [] }));
    liveData.invalidate([{ type: "persons" }]);
    await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith([]));
    queries.hostDisconnected();
  });

  it("reads the staff roles once when there is no live data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ staffRoles: [waiter] }));
    const client = api(fetchImpl);
    expect(client.liveData).toBeUndefined();
    const apply = vi.fn();
    await client.watchStaffRoles(
      new QueryController(host(), () => client.liveData, vi.fn()),
      apply,
    );
    expect(apply).toHaveBeenCalledWith([waiter]);
    expect(sent(fetchImpl).live).toBe("1");
  });

  it("watches what deleting a staff role would do with a passive read, depending on the staff roles' tables", async () => {
    const impact = {
      target: { id: waiter.id, name: "Waiter" },
      refusals: [],
      ends: [],
      removes: [{ key: "staff_role_blocks", count: 1, targets: [] }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(impact));
    const liveData = new LiveData();
    const queries = new QueryController(host(), () => liveData, vi.fn());
    const apply = vi.fn();
    await api(fetchImpl, liveData).watchStaffRoleDeleteImpact(queries, "a/b", apply);
    expect(apply).toHaveBeenCalledWith(impact);
    expect(sent(fetchImpl)).toMatchObject({
      path: `${BASE}/a%2Fb/delete-impact`,
      method: "GET",
      live: "1",
    });
    expect(liveData.interests).toEqual([
      { type: "staff_roles" },
      { type: "person_staff_roles" },
      { type: "staffing_blocks" },
      { type: "shift_assignments" },
      { type: "persons" },
    ]);
    fetchImpl.mockResolvedValue(jsonResponse({ ...impact, removes: [] }));
    liveData.invalidate([{ type: "shift_assignments" }]);
    await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith({ ...impact, removes: [] }));
    queries.hostDisconnected();
  });

  it("creates and updates a staff role with its name and colour", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(waiter, 201));
    const client = api(fetchImpl);
    expect(await client.createStaffRole({ name: "Waiter", colour: "blue" })).toEqual(waiter);
    expect(sent(fetchImpl)).toMatchObject({
      path: BASE,
      method: "POST",
      body: { name: "Waiter", colour: "blue" },
    });
    await client.updateStaffRole(waiter.id, { name: "Runner", colour: "red" });
    expect(sent(fetchImpl, 1)).toMatchObject({
      path: `${BASE}/${waiter.id}`,
      method: "PUT",
      body: { name: "Runner", colour: "red" },
    });
  });

  it("sets who holds a staff role, reorders and deletes, answering what the delete did", async () => {
    const impact = {
      target: { id: waiter.id, name: "Waiter" },
      refusals: [],
      ends: [],
      removes: [{ key: "staff_role_blocks", count: 2, targets: [] }],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ...waiter, holderIds: ["p1"] }))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse(impact));
    const client = api(fetchImpl);
    expect(await client.setHolders(waiter.id, ["p1"])).toMatchObject({ holderIds: ["p1"] });
    expect(sent(fetchImpl)).toMatchObject({
      path: `${BASE}/${waiter.id}/holders`,
      method: "PUT",
      body: { personIds: ["p1"] },
    });
    expect(await client.reorder(["b", "a"])).toBeUndefined();
    expect(sent(fetchImpl, 1)).toMatchObject({
      path: `${BASE}/order`,
      method: "PUT",
      body: { staffRoleIds: ["b", "a"] },
    });
    expect(await client.deleteStaffRole(waiter.id)).toEqual(impact);
    expect(sent(fetchImpl, 2)).toMatchObject({ path: `${BASE}/${waiter.id}`, method: "DELETE" });
  });

  it("reads a season's and a special day's staffing with passive reads, and saves each with a PUT of its edits", async () => {
    const season = { cutover: "06:00", seasons: [], areas: [], guides: {} };
    const special = { cutover: "06:00", name: "Fiesta", areas: [], guides: {} };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(season))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse(special))
      .mockResolvedValueOnce(emptyResponse());
    const client = api(fetchImpl);
    const area = { kind: "department", id: "d1" } as const;
    const blocks = [{ staffRoleId: waiter.id, headcount: 2, startsAt: "12:00", endsAt: "16:00" }];
    const STAFFING = "/management-api/staffing";
    expect(await client.readSeason("s/1")).toEqual(season);
    expect(sent(fetchImpl)).toEqual({
      path: `${STAFFING}/seasons/s%2F1`,
      method: "GET",
      body: undefined,
      live: "1",
    });
    expect(await client.saveSeason("s/1", [{ area, weekday: 5, blocks }])).toBeUndefined();
    expect(sent(fetchImpl, 1)).toEqual({
      path: `${STAFFING}/seasons/s%2F1`,
      method: "PUT",
      body: { edits: [{ area, weekday: 5, blocks }] },
      live: null,
    });
    expect(await client.readSpecialDay("x/2")).toEqual(special);
    expect(sent(fetchImpl, 2)).toEqual({
      path: `${STAFFING}/special-days/x%2F2`,
      method: "GET",
      body: undefined,
      live: "1",
    });
    const edits = [
      { area, dateId: "a", blocks },
      { area, dateId: "b", blocks: null },
    ];
    expect(await client.saveSpecialDay("x/2", edits)).toBeUndefined();
    expect(sent(fetchImpl, 3)).toEqual({
      path: `${STAFFING}/special-days/x%2F2`,
      method: "PUT",
      body: { edits },
      live: null,
    });
  });

  it("rejects a refused save with the refusal's code and params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: { code: "staffing.invalid", params: { field: "edits.0.blocks.0.headcount" } },
      }),
    } as unknown as Response);
    const client = api(fetchImpl);
    await expect(client.saveSeason("s", [])).rejects.toEqual({
      code: "staffing.invalid",
      params: { field: "edits.0.blocks.0.headcount" },
      status: 400,
    });
    await expect(client.saveSpecialDay("x", [])).rejects.toEqual({
      code: "staffing.invalid",
      params: { field: "edits.0.blocks.0.headcount" },
      status: 400,
    });
  });

  it("encodes an id it puts in a path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    await api(fetchImpl).deleteStaffRole("a/b");
    expect(sent(fetchImpl).path).toBe(`${BASE}/a%2Fb`);
  });

  it("lists the venue's people from the staff route, keeping what the dialog shows", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          personId: "p1",
          displayName: "Ana",
          firstNames: "Ana",
          lastNames: "Ruiz",
          telephone: null,
          email: "ana@example.com",
          role: "staff",
          status: "active",
          hasPassword: false,
          hasTotp: false,
        },
      ]),
    );
    expect(await api(fetchImpl).listPeople()).toEqual([
      { personId: "p1", displayName: "Ana", status: "active" },
    ]);
    expect(sent(fetchImpl)).toMatchObject({
      path: "/management-api/staff",
      method: "GET",
      live: null,
    });
  });
});
