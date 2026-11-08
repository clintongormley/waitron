import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceZonesFixture } from "../test/device-zones.js";
import { billOf, mesa, offers, till, zone } from "../test/bill-pay-app.js";
import "./till-app.js";
import type { TillApp } from "./till-app.js";
import { PERSON_HEADER } from "@waitron/shared";
import {
  SESSION_PERSON_REFUSAL,
  TillApi,
  type Draft,
  type DraftSave,
  type FetchLike,
  type TableState,
} from "./api/client.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import { cleanupWidgets, draftSnapshot, mountWidget } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";

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
const LUIS = { personId: "p2", displayName: "Luis" };
const PIN = "1234";
const LUIS_PIN = "5678";
const PINS = new Map([
  [ANA.personId, PIN],
  [LUIS.personId, LUIS_PIN],
]);

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
    [
      "PUT /api/parties/v1/drafts",
      ({ body }) => {
        const save = body as DraftSave;
        const saved = { ...drafts[0]!, revision: save.revision + 1 };
        drafts[0] = saved;
        return draftSnapshot(saved);
      },
    ],
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
    ["GET /api/staff", () => [ANA, LUIS]],
    [
      "POST /api/session",
      ({ body }) => {
        const { personId, pin } = body as { personId: string; pin: string };
        if (PINS.get(personId) !== pin) throw refusalOf(401, "pin.invalid");
        return { personId, permissions: [], locale: null };
      },
    ],
    ["DELETE /api/session", () => ({ ok: true })],
    ["PUT /api/session/locale", () => undefined],
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
      const body = await answer(seen);
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
    /** The next request to `"METHOD /path"` waits until the test answers it. */
    hold(route: string) {
      let arrived!: (request: SeenRequest) => void;
      let settle!: (answer: (request: SeenRequest) => unknown) => void;
      const sent = new Promise<SeenRequest>((resolve) => (arrived = resolve));
      const settled = new Promise<(request: SeenRequest) => unknown>(
        (resolve) => (settle = resolve),
      );
      const served = answers.get(route);
      answers.set(route, async (request) => {
        if (served === undefined) answers.delete(route);
        else answers.set(route, served);
        arrived(request);
        return (await settled)(request);
      });
      return {
        sent,
        answer: () => settle((request) => served?.(request)),
        refuse: (status: number, code: string) =>
          settle(() => {
            throw refusalOf(status, code);
          }),
      };
    },
    /** The requests sent to `"METHOD /path"`, in order. */
    sentTo(route: string): SeenRequest[] {
      return requests.filter((request) => `${request.method} ${request.path}` === route);
    },
  };
}

type TillServer = ReturnType<typeof tillServer>;

const refusalMark = Symbol("refusal");
function refusalOf(
  status: number,
  code: string,
  params?: Record<string, unknown>,
): Refusal & { [refusalMark]: true } {
  return { status, code, ...(params === undefined ? {} : { params }), [refusalMark]: true };
}
function isRefusal(value: unknown): value is Refusal {
  return typeof value === "object" && value !== null && refusalMark in value;
}

function errorResponse({ status, code, params }: Refusal): Response {
  return new Response(JSON.stringify({ error: { code, ...(params ? { params } : {}) } }), {
    status,
  });
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

const lockScreen = (el: TillApp) => el.shadowRoot!.querySelector("till-lock-screen");
const shellOf = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-shell");

/** `person` taps their name and keys `pin` on the real lock screen, then presses Log in. */
async function keyIn(el: TillApp, person: typeof ANA, pin: string): Promise<void> {
  const lock = () => lockScreen(el)!.shadowRoot!;
  const operator = `wt-button.operator-button[data-person="${person.personId}"]`;
  // After a sign-out the lock screen keeps the last person chosen.
  await vi.waitFor(() => expect(lock().querySelector(`${operator}, .operator`)).not.toBeNull());
  const chosen = lock().querySelector(".operator")?.textContent?.trim();
  if (chosen !== undefined && chosen !== person.displayName) {
    lock().querySelector<HTMLElement>(".cancel")!.click();
    await vi.waitFor(() => expect(lock().querySelector(operator)).not.toBeNull());
  }
  if (chosen !== person.displayName) lock().querySelector<HTMLElement>(operator)!.click();
  await vi.waitFor(() => expect(lock().querySelector("till-numeric-pad")).not.toBeNull());
  const pad = lock().querySelector<HTMLElement>("till-numeric-pad")!;
  for (const [index, key] of [...pin].entries()) {
    await vi.waitFor(() =>
      expect(pad.shadowRoot?.querySelector(`[data-key="${key}"]`)).not.toBeNull(),
    );
    pad.shadowRoot!.querySelector<HTMLElement>(`[data-key="${key}"]`)!.click();
    await vi.waitFor(() =>
      expect(lock().querySelector(".pin-display")!.textContent).toBe("●".repeat(index + 1)),
    );
  }
  lock().querySelector<HTMLElement>(".submit")!.click();
}

async function signIn(el: TillApp, person: typeof ANA, pin: string): Promise<void> {
  await keyIn(el, person, pin);
  await vi.waitFor(() => expect(shellOf(el)).not.toBeNull());
}

/** Ana taps her name, keys her PIN and presses Log in on the real lock screen. */
const signInAsAna = (el: TillApp) => signIn(el, ANA, PIN);

/** The sign-out the shell offers, with no table open. */
async function signOut(el: TillApp): Promise<void> {
  emit(shellOf(el)!, "logout");
  await vi.waitFor(() => expect(lockScreen(el)).not.toBeNull());
}

const named = (request: SeenRequest) => request.headers[PERSON_HEADER];

/** The requests after the `nth` sign-in request (0-based), the sign-ins themselves left out. */
function afterSignIn(server: TillServer, nth: number): SeenRequest[] {
  const signIns = server.requests.flatMap((request, index) =>
    request.method === "POST" && request.path === "/api/session" ? [index] : [],
  );
  return server.requests
    .slice(signIns[nth]! + 1)
    .filter((request) => !(request.method === "POST" && request.path === "/api/session"));
}

/** A locale change from the shell: a request outside drafts that the app sends at once. */
function chooseLocale(el: TillApp, code = "es"): void {
  emit(shellOf(el)!, "wt-locale-selected", { code });
}

/** From the shell, Ana opens table 4, the table holding her unsent draft. */
async function openAnasTable(el: TillApp): Promise<TillTableOrderScreen> {
  emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
  const floor = () => el.shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen");
  await vi.waitFor(() => {
    expect(floor()?.tablesAnswered).toBe(true);
    expect(floor()!.tables.map((table) => table.id)).toContain("t4");
  });
  emit(floor()!, "open-table", {
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

let localeBefore: string;
beforeEach(() => {
  localeBefore = currentLocale();
  setLocale("en");
  localStorage.clear();
});
afterEach(() => {
  cleanupWidgets();
  setLocale(localeBefore);
});

describe("the till through its real client", () => {
  it("signs Ana in and opens the table holding her unsent draft", async () => {
    const server = tillServer();
    const { el } = await mountTill(server);

    await signInAsAna(el);
    await openAnasTable(el);

    expect(server.sentTo("POST /api/session").map((request) => request.body)).toEqual([
      { personId: ANA.personId, pin: PIN },
    ]);
    expect(server.sentTo("GET /api/parties/v1/drafts").length).toBeGreaterThan(0);
    expect(server.unserved).toEqual([]);
  });
  it("names nobody before a sign-in, and names Ana from her sign-in until the next one, sign-out included", async () => {
    const server = tillServer();
    const { el } = await mountTill(server);
    await vi.waitFor(() => expect(server.sentTo("GET /api/staff").length).toBeGreaterThan(0));

    await signInAsAna(el);
    await openAnasTable(el);
    emit(el.shadowRoot!.querySelector("till-table-order-screen")!, "logout");
    await vi.waitFor(() => expect(server.sentTo("DELETE /api/session")).toHaveLength(1));
    await signIn(el, LUIS, LUIS_PIN);
    await vi.waitFor(() => expect(afterSignIn(server, 1).length).toBeGreaterThan(0));
    chooseLocale(el);
    await vi.waitFor(() => expect(server.sentTo("PUT /api/session/locale")).toHaveLength(1));

    const firstSignIn = server.requests.indexOf(server.sentTo("POST /api/session")[0]!);
    expect(server.requests.slice(0, firstSignIn + 1).map(named)).toEqual(
      Array(firstSignIn + 1).fill(undefined),
    );
    const secondSignIn = server.requests.indexOf(server.sentTo("POST /api/session")[1]!);
    const anas = server.requests.slice(firstSignIn + 1, secondSignIn);
    expect(anas.map(named)).toEqual(Array(anas.length).fill(ANA.personId));
    expect(named(server.sentTo("DELETE /api/session")[0]!)).toBe(ANA.personId);
    expect(named(server.requests[secondSignIn]!)).toBeUndefined();
    expect(named(server.sentTo("PUT /api/session/locale")[0]!)).toBe(LUIS.personId);
    const luiss = afterSignIn(server, 1);
    const firstLuis = luiss.findIndex((request) => named(request) === LUIS.personId);
    expect(luiss.slice(firstLuis).map(named)).toEqual(
      Array(luiss.length - firstLuis).fill(LUIS.personId),
    );
    expect(server.unserved).toEqual([]);
  });

  it("names Ana on her sign-out held back behind a save while Luis's sign-in is under way", async () => {
    const server = tillServer();
    const { el } = await mountTill(server);
    await signInAsAna(el);
    const order = await openAnasTable(el);
    const save = server.hold("PUT /api/parties/v1/drafts");
    order.draftStore!.setLineExtras(0, { note: "No sugar" });
    await save.sent;

    emit(order, "logout");
    await vi.waitFor(() => expect(lockScreen(el)).not.toBeNull());
    const luisSignIn = server.hold("POST /api/session");
    await keyIn(el, LUIS, LUIS_PIN);
    await luisSignIn.sent;
    expect(server.sentTo("DELETE /api/session")).toEqual([]);
    save.answer();
    await vi.waitFor(() => expect(server.sentTo("DELETE /api/session")).toHaveLength(1));

    expect(named(server.sentTo("DELETE /api/session")[0]!)).toBe(ANA.personId);
  });

  it("locks once, ends no session, and gives Ana her lines back, when her discard is refused for her person", async () => {
    const server = tillServer();
    const { el } = await mountTill(server);
    await signInAsAna(el);
    const order = await openAnasTable(el);
    server.refuse("POST /api/parties/v1/drafts/draft-ana/discard", 409, SESSION_PERSON_REFUSAL);

    order.shadowRoot!.querySelector<HTMLElement>("[data-discard-draft]")!.click();
    await vi.waitFor(() => expect(lockScreen(el)).not.toBeNull());

    expect(server.sentTo("POST /api/parties/v1/drafts/draft-ana/discard")).toHaveLength(1);
    expect(server.sentTo("DELETE /api/session")).toEqual([]);
    await signInAsAna(el);
    await openAnasTable(el);
    const sent = afterSignIn(server, 0);
    expect(sent.map(named)).toEqual(Array(sent.length).fill(ANA.personId));
    expect(server.sentTo("DELETE /api/session")).toEqual([]);
  });

  it.each([409, 400])(
    "locks, and ends no session, when a request outside drafts is refused at %i for naming Ana",
    async (status) => {
      const server = tillServer();
      const { el } = await mountTill(server);
      await signInAsAna(el);
      server.refuse("PUT /api/session/locale", status, SESSION_PERSON_REFUSAL);

      chooseLocale(el);
      await vi.waitFor(() => expect(lockScreen(el)).not.toBeNull());

      expect(named(server.sentTo("PUT /api/session/locale")[0]!)).toBe(ANA.personId);
      expect(server.sentTo("DELETE /api/session")).toEqual([]);
    },
  );

  it("does nothing when a refusal for a request from Ana's earlier sign-in lands after she signs in again", async () => {
    const server = tillServer();
    const { el } = await mountTill(server);
    await signInAsAna(el);
    const earlier = server.hold("PUT /api/session/locale");
    chooseLocale(el);
    await earlier.sent;
    await signOut(el);
    await signInAsAna(el);
    const signOuts = server.sentTo("DELETE /api/session").length;

    earlier.refuse(409, SESSION_PERSON_REFUSAL);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".error")?.textContent ?? "").not.toBe(""),
    );

    expect(lockScreen(el)).toBeNull();
    expect(shellOf(el)).not.toBeNull();
    expect(server.sentTo("DELETE /api/session")).toHaveLength(signOuts);
  });

  it("still locks for a request sent before a profile switch", async () => {
    const server = tillServer();
    server.serve("GET /api/device/me", () => ({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      profileId: "pr-counter",
      approvedProfiles: [
        { id: "pr-counter", name: "Counter till" },
        { id: "pr-bar", name: "Bar till" },
      ],
    }));
    server.serve("POST /api/device/active-profile", () => ({ activeProfileId: "pr-bar" }));
    const { el } = await mountTill(server);
    await signInAsAna(el);
    const before = server.hold("PUT /api/session/locale");
    chooseLocale(el);
    await before.sent;
    const tills = server.sentTo("GET /api/till").length;

    shellOf(el)!.shadowRoot!.querySelector<HTMLElement>("wt-button.profile")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-profile-dialog")).not.toBeNull(),
    );
    emit(el.shadowRoot!.querySelector("till-profile-dialog")!, "profile-switch", {
      profileId: "pr-bar",
    });
    await vi.waitFor(() => expect(server.sentTo("GET /api/till").length).toBeGreaterThan(tills));
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-profile-dialog")).toBeNull());
    expect(shellOf(el)).not.toBeNull();

    before.refuse(409, SESSION_PERSON_REFUSAL);
    await vi.waitFor(() => expect(lockScreen(el)).not.toBeNull());
    expect(server.sentTo("DELETE /api/session")).toEqual([]);
  });

  it("still locks for a request sent before the device zones' Retry", async () => {
    const server = tillServer();
    let zones = deviceZonesFixture([], []);
    server.serve("GET /api/device/zones", () => zones);
    const { el } = await mountTill(server);
    await signInAsAna(el);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-retry-device-zones]")).not.toBeNull(),
    );
    const before = server.hold("PUT /api/session/locale");
    chooseLocale(el);
    await before.sent;
    zones = deviceZonesFixture(undefined, ["z1"]);
    const reads = server.sentTo("GET /api/device/zones").length;

    el.shadowRoot!.querySelector<HTMLElement>("[data-retry-device-zones]")!.click();
    await vi.waitFor(() =>
      expect(server.sentTo("GET /api/device/zones").length).toBeGreaterThan(reads),
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-retry-device-zones]")).toBeNull(),
    );

    before.refuse(409, SESSION_PERSON_REFUSAL);
    await vi.waitFor(() => expect(lockScreen(el)).not.toBeNull());
    expect(server.sentTo("DELETE /api/session")).toEqual([]);
  });
});
