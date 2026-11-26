// The till's Give money back requests, built by its real client, read by the server's real parsers.
import { expect, it } from "vitest";
import { TillApi } from "../apps/till/src/api/client.js";
import type { GiveBackAsk, GiveBackRequest } from "../apps/till/src/api/give-back-types.js";
import { GiveBackSession } from "../apps/till/src/state/give-back.js";
import { parseGiveBackRequest } from "../apps/server/src/give-back-plan.js";
import { parseGiveBackWrite } from "../apps/server/src/give-back-press.js";

const SALE = "0b8f3c1e-7a52-4d1e-9a8b-1f2e3d4c5b6a";
const LINE_1 = "1d7e9a40-2c3b-4e5f-8a9b-0c1d2e3f4a5b";
const LINE_2 = "2e8f0b51-3d4c-4f6a-9b0c-1d2e3f4a5b6c";
const CANCEL = "3f9a1c62-4e5d-4a7b-8c1d-2e3f4a5b6c7d";
const CARD = "4a0b2d73-5f6e-4b8c-9d2e-3f4a5b6c7d8e";
const REASON = "5b1c3e84-6a7f-4c9d-8e3f-4a5b6c7d8e9f";
const BOSS = "6c2d4f95-7b8a-4d0e-9f4a-5b6c7d8e9f0a";

const request: GiveBackRequest = {
  purpose: "dishes",
  lineIds: [LINE_1, LINE_2],
  amount: "20.00",
  extra: "1.50",
  way: CARD,
  fromCancel: [CANCEL],
};

function capturing(): { client: TillApi; bodies: { url: string; body: unknown }[] } {
  const bodies: { url: string; body: unknown }[] = [];
  const client = new TillApi("", async (input, init) => {
    bodies.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ parts: [], refusal: null, underWay: null, rest: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { client, bodies };
}

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

it("a press the till sends parses on the server as the same request, ids and override", async () => {
  const { client, bodies } = capturing();
  const session = new GiveBackSession(
    { deviceId: "device-1", personId: "person-1" },
    client,
    memoryStorage(),
  );
  const ask: GiveBackAsk = {
    request,
    reasonId: REASON,
    note: "  wrong dish  ",
    expected: [
      { kind: "refund", amount: "8.00", way: CARD, cancellationIds: [CANCEL] },
      { kind: "extra", amount: "1.50", way: CARD },
      { kind: "correction", amount: "12.00", way: CARD, lineIds: [LINE_2, LINE_1] },
    ],
    manualConfirmed: true,
  };
  await session.submit(SALE, ask, { personId: BOSS, pin: "1234" });

  expect(bodies).toHaveLength(1);
  expect(bodies[0]!.url).toBe(`/api/transactions/${SALE}/give-back`);
  const body = bodies[0]!.body as Record<string, unknown>;
  const parsed = parseGiveBackWrite(body);
  const sentIds = body.submissionIds as Record<string, string>;
  expect(parsed).toEqual({
    request,
    reasonId: REASON,
    note: "wrong dish",
    ids: sentIds,
    expected: [
      { kind: "refund", amount: 800, way: CARD, cancellationIds: [CANCEL], lineIds: null },
      { kind: "extra", amount: 150, way: CARD, cancellationIds: null, lineIds: null },
      {
        kind: "correction",
        amount: 1200,
        way: CARD,
        cancellationIds: null,
        lineIds: [LINE_1, LINE_2].sort(),
      },
    ],
    manualConfirmed: true,
  });
  expect(new Set(Object.values(sentIds)).size).toBe(4);
  expect(body.override).toEqual({ personId: BOSS, pin: "1234" });
});

it("a preview the till sends parses on the server as the same request", async () => {
  const { client, bodies } = capturing();
  await client.previewGiveBack(SALE, request);
  expect(bodies[0]!.url).toBe(`/api/transactions/${SALE}/give-back/preview`);
  expect(parseGiveBackRequest(bodies[0]!.body as Record<string, unknown>)).toEqual(request);
});
