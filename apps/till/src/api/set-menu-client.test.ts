import { expect, it } from "vitest";
import { TillApi } from "./client.js";

const edit = { billId: "bill", editorVersion: 3, draftId: "draft", draftRevision: 2 };
const moves = [{ lineId: "dish", to: { setMenuLineId: "menu-line", place: 0 } }];
const revision = { expectedPartyRevision: 7, expectedEdit: edit };

it.each([
  ["GET", "set-menus", undefined, (api: TillApi) => api.readBillSetMenus("bill")],
  [
    "PUT",
    "set-menus/daily",
    { count: 2, ...revision },
    (api: TillApi) => api.setSetMenuCount("bill", "daily", 2, 7, edit),
  ],
  [
    "DELETE",
    "set-menu-lines/menu-line",
    revision,
    (api: TillApi) => api.removeSetMenu("bill", "menu-line", 7, edit),
  ],
  [
    "POST",
    "set-menu-moves",
    { moves, ...revision },
    (api: TillApi) => api.moveSetMenuDishes("bill", moves, 7, edit),
  ],
] as const)(
  "sends %s %s using the bill editor and its revisions",
  async (method, path, body, call) => {
    const answer = {
      partyRevision: 8,
      setMenus: { copies: [], recorded: {}, setMenus: [], dishes: [] },
    };
    const requests: unknown[] = [];
    const api = new TillApi("https://venue.test", async (url, init) => {
      requests.push([
        url,
        init?.method,
        init?.credentials,
        init?.body && JSON.parse(String(init.body)),
      ]);
      return Response.json(answer);
    });
    expect(await call(api)).toEqual(answer);
    expect(requests).toEqual([
      [`https://venue.test/api/bills/bill/${path}`, method, "include", body],
    ]);
  },
);
