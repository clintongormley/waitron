import { expect, it } from "vitest";
import { Hono } from "hono";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { mountManagementApi } from "./management-api.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
async function fixture() {
  const { token } = await openManagementSession(suite.db, "admin");
  await seedPersons(suite.db, { displayName: "Needle", role: "staff" });
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
    },
    () => {},
  );
  return (query = "") =>
    app.request(`/management-api/staff/page${query ? `?${query}` : ""}`, {
      headers: { cookie: `waitron_management_session=${token}` },
    });
}
it("returns one capped page and preserves a trailing space in the whole-word search", async () => {
  const send = await fixture();
  const response = await send("sortKey=&page=0&locale=en-GB");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ page: 0, pageSize: 50, total: 2, anyPeople: true });
  const exact = await send("search=Need&status=all");
  expect((await exact.json()).rows).toHaveLength(1);
  const whole = await send("search=Need%20&status=all");
  expect((await whole.json()).rows).toEqual([]);
});
it("refuses malformed paging/filter input and attempts to override the page size", async () => {
  const send = await fixture();
  for (const [query, field] of [
    ["page=-1", "page"],
    ["page=1.5", "page"],
    ["page=9007199254740991", "page"],
    ["page=", "page"],
    ["page=0&page=1", "page"],
    ["pageSize=100", "pageSize"],
    ["limit=100", "limit"],
    ["sortKey=unknown", "sortKey"],
    ["sortDirection=sideways", "sortDirection"],
    ["locale=unknown", "locale"],
    ["status=unknown", "status"],
    ["roleId=unknown", "roleId"],
  ]) {
    const response = await send(query);
    expect(response.status, query).toBe(400);
    expect(await response.json(), query).toMatchObject({
      error: { code: "management.request_invalid", params: { field } },
    });
  }
});
