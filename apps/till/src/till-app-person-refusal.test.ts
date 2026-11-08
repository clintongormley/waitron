import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceZonesFixture } from "../test/device-zones.js";
import { billOf, mesa, offers, till, zone } from "../test/bill-pay-app.js";
import "./till-app.js";
import type { TillApp } from "./till-app.js";
import { TillApi, type Draft, type FetchLike, type TableState } from "./api/client.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";

/** One request as the stub received it, after the client's own wrapping. */
interface SeenRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

interface Refusal {
  status: number;
  code: string;
  params?: Record<string, unknown>;
}

const ANA = { personId: "p1", displayName: "Ana" };
const PIN = "1234";

function anaDraft(): Draft {
  return {
    id: "draft-ana",
    partyId: "v1",
    billId: "wo-4",
    ownerId: ANA.personId,
    ownerName: ANA.displayName,
    revision: 3,
    takenOverFrom: null,
    lines: [
      {
        slot: 0,
        joinGroupId: null,
        afterGroupId: null,
        id: "draft-line-ana",
        sourceLineId: null,
        source: null,
        menuItemId: "menu-item-cafe-0",
        variantId: null,
        menuVersionId: null,
        options: [],
        extras: [],
        note: null,
        quantity: "1",
        courseId: null,
        makeAt: "switched-off",
        noMerge: false,
        unavailable: false,
      },
    ],
  };
}

function anaTable(): TableState {
  return mesa({
    unsentDrafts: [
      {
        billId: "wo-4",
        billNumber: 1,
        ownerId: ANA.personId,
        ownerName: ANA.displayName,
        lineCount: 1,
        savedAt: "2026-10-31T10:00:00.000Z",
      },
    ],
  });
}

/**
 * A box behind `fetch`: answers keyed `"METHOD /path"` (query left off), every request recorded with
 * the headers the client sent, and any route made to refuse with `refuse`. A route nobody serves
 * answers 404 and is listed in `unserved`, so a case can tell a missing answer from a refusal.
 */
function tillServer() {
  const requests: SeenRequest[] = [];
  const unserved: string[] = [];
  const refusals = new Map<string, Refusal>();
  const drafts = [anaDraft()];
  const answers = new Map<string, (request: SeenRequest) => unknown>([
    ["GET /api/till", () => till],
    ["GET /api/content-languages", () => ({ defaultLanguage: "en", languages: ["en", "es"] })],
    [
      "GET /api/locales",
      () => ({
        locales: [{ code: "en-GB", label: "English" }],
        venueDefault: "en-GB",
        loginDefault: "en-GB",
      }),
    ],
    ["GET /api/device/me", () => ({ deviceId: "till-dev", name: "Till 1", formFactor: "till" })],
    // A production box has no dev route.
    [
      "GET /api/dev/devices",
      () => {
        throw refusalOf(404, "server.not_found");
      },
    ],
    ["PUT /api/device/battery", () => undefined],
    ["GET /api/device/equipment", () => ({ roles: [] })],
    ["GET /api/stations", () => []],
    [
      "GET /api/menu-state",
      () => ({
        service: offers.service,
        menus: offers.menus.map((menu) => ({
          menuId: menu.id,
          versionId: menu.versionId,
          orderable: menu.orderable,
          endedPeriodName: menu.endedPeriodName,
        })),
        unavailable: { products: [], optionLabels: [] },
      }),
    ],
    ["GET /api/device/zones", () => deviceZonesFixture(undefined, ["z1"])],
    ["GET /api/staff", () => [ANA, { personId: "p2", displayName: "Luis" }]],
    [
      "POST /api/session",
      ({ body }) => {
        const { personId, pin } = body as { personId: string; pin: string };
        if (personId !== ANA.personId || pin !== PIN) throw refusalOf(401, "pin.invalid");
        return { personId, permissions: [], locale: null };
      },
    ],
    ["DELETE /api/session", () => ({ ok: true })],
    ["GET /api/default-service-zone/offers", () => offers],
    ["GET /api/service-zones/z1/offers", () => offers],
    ["GET /api/zones", () => [zone]],
    ["GET /api/tables/state", () => [anaTable()]],
    ["GET /api/working-orders", () => []],
    ["GET /api/orders/counter-waiting", () => []],
    ["GET /api/parties/v1/bills", () => [billOf()]],
    [
      "GET /api/parties/v1/drafts",
      () => {
        const draft = drafts[0];
        return {
          drafts: structuredClone(drafts),
          billEdits: [
            {
              billId: "wo-4",
              editorId: draft?.ownerId ?? null,
              editorName: draft?.ownerName ?? null,
              editorVersion: 1,
              draftId: draft?.id ?? null,
              draftRevision: draft?.revision ?? null,
            },
          ],
        };
      },
    ],
    ["GET /api/parties/v1/groups", () => ({ revision: 3, groups: [], printProblems: [] })],
    [
      "GET /api/parties/v1/current-orders",
      () => ({
        revision: 3,
        hasGroups: false,
        nextDisplayNumber: 1,
        retainedCourses: [],
        groups: [],
        ungrouped: [],
        reminder: null,
      }),
    ],
    [
      "GET /api/parties/v1/allergy",
      () => ({
        partyId: "v1",
        snapshot: {
          answer: "none",
          guests: [],
          ticks: [],
          changedAt: null,
          changedBy: null,
          revision: 3,
        },
        dishes: [],
      }),
    ],
    ["GET /api/working-orders/wo-4/lines", () => ({ lines: [], revision: 0 })],
    ["GET /api/invoice-delivery-options", () => ({ invoicePrinter: null })],
  ]);

  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input), location.origin);
    const method = init?.method ?? "GET";
    const seen: SeenRequest = {
      method,
      path: url.pathname,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(seen);
    const key = `${method} ${url.pathname}`;
    const refused = refusals.get(key);
    if (refused !== undefined) return errorResponse(refused);
    const answer = answers.get(key);
    if (answer === undefined) {
      unserved.push(key);
      return errorResponse({ status: 404, code: "test.unserved" });
    }
    try {
      const body = answer(seen);
      return new Response(body === undefined ? "" : JSON.stringify(body), { status: 200 });
    } catch (error) {
      if (isRefusal(error)) return errorResponse(error);
      throw error;
    }
  };

  return {
    requests,
    unserved,
    drafts,
    fetch: fetchImpl,
    /** Replace or add the answer `"METHOD /path"` gives. */
    serve(route: string, answer: (request: SeenRequest) => unknown): void {
      answers.set(route, answer);
    },
    /** Every later request to `"METHOD /path"` answers `status` with the error envelope. */
    refuse(route: string, status: number, code: string, params?: Record<string, unknown>): void {
      refusals.set(route, { status, code, ...(params === undefined ? {} : { params }) });
    },
    /** Stop refusing `"METHOD /path"`; it answers as served again. */
    allow(route: string): void {
      refusals.delete(route);
    },
    /** The requests sent to `"METHOD /path"`, in order. */
    sentTo(route: string): SeenRequest[] {
      return requests.filter((request) => `${request.method} ${request.path}` === route);
    },
  };
}

type TillServer = ReturnType<typeof tillServer>;

const refusalMark = Symbol("refusal");
function refusalOf(status: number, code: string): Refusal & { [refusalMark]: true } {
  return { status, code, [refusalMark]: true };
}
function isRefusal(value: unknown): value is Refusal {
  return typeof value === "object" && value !== null && refusalMark in value;
}

function errorResponse({ status, code, params }: Refusal): Response {
  return new Response(JSON.stringify({ error: { code, ...(params ? { params } : {}) } }), {
    status,
  });
}

async function flush(el: TillApp, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

/** The app on a real `TillApi` over `server`, left at the lock screen. */
async function mountTill(server: TillServer) {
  const api = new TillApi("", server.fetch);
  const mounted = await mountWidget<TillApp>("till-app", { api });
  await vi.waitFor(() =>
    expect(mounted.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
  );
  return { ...mounted, api };
}

/** Ana taps her name, keys her PIN and presses Log in on the real lock screen. */
async function signInAsAna(el: TillApp): Promise<void> {
  const lock = () => el.shadowRoot!.querySelector("till-lock-screen")!.shadowRoot!;
  const operator = `wt-button.operator-button[data-person="${ANA.personId}"]`;
  await vi.waitFor(() => expect(lock().querySelector(operator)).not.toBeNull());
  lock().querySelector<HTMLElement>(operator)!.click();
  await vi.waitFor(() => expect(lock().querySelector("till-numeric-pad")).not.toBeNull());
  const pad = lock().querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "till-numeric-pad",
  )!;
  await pad.updateComplete;
  for (const key of PIN) {
    pad.shadowRoot!.querySelector<HTMLElement>(`[data-key="${key}"]`)!.click();
    await pad.updateComplete;
    await el.updateComplete;
  }
  lock().querySelector<HTMLElement>(".submit")!.click();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-shell")).not.toBeNull());
  await flush(el);
}

/** From the shell, Ana opens table 4, the table holding her unsent draft. */
async function openAnasTable(el: TillApp): Promise<TillTableOrderScreen> {
  emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-floor-screen")).not.toBeNull());
  await flush(el);
  emit(el.shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
    tableId: "t4",
    seated: true,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("till-table-order-screen")).not.toBeNull(),
  );
  const order = el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
  await vi.waitFor(() => expect(order.draftStore?.lineCount).toBe(1));
  return order;
}

beforeEach(() => {
  setLocale("en");
  localStorage.clear();
});
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en");
});

describe("the till through its real client", () => {
  it("signs Ana in and opens the table holding her unsent draft", async () => {
    const server = tillServer();
    const { el } = await mountTill(server);

    await signInAsAna(el);
    const order = await openAnasTable(el);

    expect(server.sentTo("POST /api/session").map((request) => request.body)).toEqual([
      { personId: ANA.personId, pin: PIN },
    ]);
    expect(server.sentTo("GET /api/parties/v1/drafts").length).toBeGreaterThan(0);
    expect(order.draftStore!.lineCount).toBe(1);
    expect(server.unserved).toEqual([]);
  });
});
