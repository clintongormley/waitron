import { strFromU8, unzipSync } from "fflate";
import { Hono } from "hono";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { recordActivity, withNodeTransaction, withTransaction } from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { VERIFACTU_HANDOVER } from "@waitron/fiscal-verifactu";
import { seedManager, seedPerson } from "@waitron/identity/test/fixtures.js";
import { PIN_THROTTLE_FREE_ATTEMPTS } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import { recordHandoverRestrictionTx } from "@waitron/node-db";
import { generateSync } from "otplib";
import { AppError, jobOrigin } from "@waitron/shared";
import { appendToChain } from "@waitron/workforce";
import { OLD_BOX_DATA_WORDS } from "./i18n/old-box-data.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import type { Logger } from "./logger.js";
import { oldBoxDataRoute, type OldBoxDataDeps } from "./old-box-data-page.js";
import type { PasswordThrottle } from "./password-throttle.js";
import { enrolAuthenticator, TOTP_KEY_RING } from "./testing/authenticator.js";
import { row, sheetNamed } from "./testing/xlsx-rows.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const NODE_ID = "00000000-0000-4000-8000-0000000000cc";
const ORIGIN = "https://old-box.test";
const EMAIL = "Owner.Person@Example.test";
const fiscal: WaitronModule = {
  name: "fiscal",
  version: "1.0.0",
  tier: "mandatory",
  handover: VERIFACTU_HANDOVER,
};

let socket: TLSSocket;
let lines: { level: string; event: string; fields: unknown }[];
const log: Logger = (level, event, fields) => {
  lines.push({ level, event, fields });
};

beforeEach(async () => {
  socket = new TLSSocket(new Socket());
  lines = [];
  await withNodeTransaction(suite.node, (tx) =>
    recordHandoverRestrictionTx(tx, {
      nodeId: NODE_ID,
      operationId: null,
      kind: "superseded",
      successorNodeId: "00000000-0000-4000-8000-0000000000aa",
      membershipTerm: 1,
    }),
  );
});

afterEach(() => {
  socket.destroy();
});

function appWith(
  options: {
    modules?: WaitronModule[];
    resetOrdered?: () => boolean;
    throttle?: PasswordThrottle;
    mainHoldings?: OldBoxDataDeps["mainHoldings"];
    mainCopy?: OldBoxDataDeps["mainCopy"];
    nodeId?: string;
  } = {},
) {
  const app = new Hono();
  oldBoxDataRoute({
    page: {
      venue: suite.db,
      node: suite.node,
      nodeId: options.nodeId ?? NODE_ID,
      log,
      resetOrdered: options.resetOrdered,
    },
    modules: options.modules ?? [fiscal],
    totpKeyRing: TOTP_KEY_RING,
    throttle: options.throttle,
    mainHoldings: options.mainHoldings,
    mainCopy: options.mainCopy,
  })(app);
  return app;
}

function post(
  app: Hono,
  fields: Record<string, string>,
  options: { secure?: boolean; headers?: Record<string, string> } = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(
      `${ORIGIN}/old-box-data`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
          "accept-language": "en-GB",
          ...options.headers,
        },
        body: new URLSearchParams(fields).toString(),
      },
      options.secure === false ? {} : { incoming: { socket } },
    ),
  );
}

async function expectPage(response: Response, status: number): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toMatch(/^text\/html/);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-disposition")).toBeNull();
  expect(await response.text()).toContain("<h1>");
}

const admin = () => seedManager(suite.db, { email: EMAIL, role: "admin" });
const signIn = { email: EMAIL, password: "correct horse" };

describe("POST /old-box-data on the old box", () => {
  it("answers an administrator signed in over HTTPS from this page with the workbook", async () => {
    await admin();
    const response = await post(appWith(), signIn);
    expect(response.status).toBe(200);
    const today = new Date().toISOString().slice(0, 10);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="waitron-old-main-box-${today}.xlsx"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const sheet = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]!);
    // With no main box summary heard, the tab says no comparison was made.
    expect(sheet).toContain(OLD_BOX_DATA_WORDS.en.uncomparedIntro.split("{time}")[0]!.trim());
  });

  it("compares with the main box's summary the reset-order duty last heard, naming when it arrived", async () => {
    await admin();
    const heardAt = new Date("2026-11-23T08:15:00.000Z");
    const response = await post(
      appWith({ mainHoldings: () => ({ holdings: { fiscal: [] }, heardAt }) }),
      signIn,
    );
    expect(response.status).toBe(200);
    const sheet = strFromU8(
      unzipSync(new Uint8Array(await response.arrayBuffer()))["xl/worksheets/sheet1.xml"]!,
    );
    expect(sheet).toContain(
      OLD_BOX_DATA_WORDS.en.invoiceIntro.replace("{time}", "2026-11-23 08:15 UTC"),
    );
  });

  it("follows the browser's language", async () => {
    await admin();
    const response = await post(appWith(), signIn, { headers: { "accept-language": "es-ES" } });
    expect(response.status).toBe(200);
    const sheet = strFromU8(
      unzipSync(new Uint8Array(await response.arrayBuffer()))["xl/worksheets/sheet1.xml"]!,
    );
    expect(sheet).toContain(OLD_BOX_DATA_WORDS.es.uncomparedIntro.split("{time}")[0]!.trim());
  });

  it("refuses over plain HTTP, before checking any password", async () => {
    await admin();
    await expectPage(await post(appWith(), signIn, { secure: false }), 403);
    expect(lines).toEqual([]);
  });

  it("refuses a post from another site's page", async () => {
    await admin();
    await expectPage(
      await post(appWith(), signIn, {
        headers: { origin: "https://elsewhere.test", "sec-fetch-site": "cross-site" },
      }),
      403,
    );
  });

  it("refuses while a wipe is under way, before checking any password", async () => {
    await admin();
    const app = appWith({ resetOrdered: () => true });
    await expectPage(await post(app, { ...signIn, password: "wrong horse" }), 409);
    expect(lines).toEqual([]);
  });

  it("refuses when the wipe is ordered while the password is checked", async () => {
    await admin();
    let looks = 0;
    await expectPage(await post(appWith({ resetOrdered: () => looks++ > 0 }), signIn), 409);
    expect(lines.some((line) => line.event === "old_box_data.downloaded")).toBe(false);
  });

  it("refuses a missing email or password", async () => {
    await admin();
    const app = appWith();
    await expectPage(await post(app, { email: EMAIL }), 400);
    await expectPage(await post(app, { password: "correct horse" }), 400);
    await expectPage(await post(app, { email: " ", password: "correct horse" }), 400);
  });

  it("refuses a wrong password as a failed sign-in, and a person without node.manage", async () => {
    await admin();
    const app = appWith();
    await expectPage(await post(app, { ...signIn, password: "wrong horse" }), 401);
    await seedManager(suite.db, { email: "manager@example.test", role: "manager" });
    await expectPage(
      await post(app, { email: "manager@example.test", password: "correct horse" }),
      403,
    );
  });

  it("takes an empty authenticator field as not sent", async () => {
    const personId = await admin();
    const secret = await enrolAuthenticator(suite.db, personId, TOTP_KEY_RING);
    const app = appWith();
    await expectPage(await post(app, { ...signIn, totp: "" }), 401);
    expect(lines.map((line) => (line.fields as { errorCode?: string }).errorCode)).toContain(
      "totp.required",
    );
    const response = await post(app, { ...signIn, totp: generateSync({ secret }) });
    expect(response.status).toBe(200);
  });

  it("keeps the code field on the page after a wrong code, and only for a form that had one", async () => {
    const personId = await admin();
    await enrolAuthenticator(suite.db, personId, TOTP_KEY_RING);
    const app = appWith();
    const wrongCode = await post(app, { ...signIn, totp: "000000" });
    expect(wrongCode.status).toBe(401);
    const page = await wrongCode.text();
    expect(page).toContain('name="totp"');
    expect(page).toContain("That email and password do not match an account on this box.");
    const noCode = await post(app, { email: EMAIL, password: "wrong" });
    expect(noCode.status).toBe(401);
    const plain = await noCode.text();
    expect(plain).toContain("That email and password do not match an account on this box.");
    expect(plain).not.toContain('name="totp"');
  });

  it("refuses a second download while one is being made, after its own sign-in", async () => {
    await admin();
    let entered!: () => void;
    const seatEntered = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const slow: WaitronModule = {
      ...fiscal,
      handover: {
        ...VERIFACTU_HANDOVER,
        unreturned: async () => {
          entered();
          await held;
          return [];
        },
      },
    };
    const app = appWith({ modules: [slow] });
    const first = post(app, signIn);
    try {
      await seatEntered;
      // The password is checked while the file is being made: a wrong one is told so.
      await expectPage(await post(app, { ...signIn, password: "wrong horse" }), 401);
      await expectPage(await post(app, signIn), 409);
    } finally {
      release();
    }
    expect((await first).status).toBe(200);
    // The turn is given back once the first finishes.
    expect((await post(app, signIn)).status).toBe(200);
  }, 15_000);

  it("makes the person wait after repeated wrong passwords for one address", async () => {
    await admin();
    const app = appWith();
    for (let attempt = 0; attempt <= PIN_THROTTLE_FREE_ATTEMPTS; attempt++)
      await expectPage(await post(app, { ...signIn, password: "wrong horse" }), 401);
    const held = await post(app, signIn);
    expect(Number(held.headers.get("retry-after"))).toBeGreaterThan(0);
    await expectPage(held, 429);
    // Folded: another spelling of the same address is held too.
    await expectPage(await post(app, { ...signIn, email: EMAIL.toLowerCase() }), 429);
  });

  it("refuses a form larger than the cap", async () => {
    await admin();
    await expectPage(await post(appWith(), { ...signIn, totp: "1".repeat(5000) }), 400);
    expect(lines).toEqual([]);
  });

  it("logs an unexpected refusal code as a fault and answers 500", async () => {
    await admin();
    const throttle: PasswordThrottle = {
      begin: () => {
        throw new AppError("setup.request_invalid", { field: "body" });
      },
    };
    await expectPage(await post(appWith({ throttle }), signIn), 500);
    expect(lines).toMatchObject([
      {
        level: "error",
        event: "old_box_data.failed",
        fields: { errorCode: "setup.request_invalid" },
      },
    ]);
  });

  it("logs the person's id and never the email", async () => {
    const personId = await admin();
    const app = appWith();
    expect((await post(app, signIn)).status).toBe(200);
    await post(app, { ...signIn, password: "wrong horse" });
    await post(app, { email: EMAIL });
    const downloaded = lines.find((line) => line.event === "old_box_data.downloaded");
    expect(downloaded?.fields).toMatchObject({ personId });
    expect(lines.some((line) => line.event === "old_box_data.refused")).toBe(true);
    const written = JSON.stringify(lines).toLowerCase();
    expect(written).not.toContain(EMAIL.toLowerCase());
    expect(written).not.toContain("example.test");
  });
});

describe("the since tabs of POST /old-box-data", () => {
  const COPY_AT = Date.parse("2026-11-20T10:00:00.000Z");
  const files = async (response: Response) =>
    unzipSync(new Uint8Array(await response.arrayBuffer()));

  it("after an emergency switch, adds the since tabs with the copy time the duty heard", async () => {
    await admin();
    const response = await post(appWith({ mainCopy: () => ({ lastChangeAtMs: COPY_AT }) }), signIn);
    expect(response.status).toBe(200);
    const activity = sheetNamed(await files(response), OLD_BOX_DATA_WORDS.en.activitySheet);
    expect(activity).toBeDefined();
    expect(row(activity!, 1)).toEqual([
      OLD_BOX_DATA_WORDS.en.sinceCopyIntro.replace("{time}", "2026-11-20 09:50:00.000 UTC"),
    ]);
  });

  it("still gives the file, from this box's own times, when the copy time heard is not a date", async () => {
    await admin();
    const response = await post(
      appWith({ mainCopy: () => ({ lastChangeAtMs: Number.MAX_SAFE_INTEGER }) }),
      signIn,
    );
    expect(response.status).toBe(200);
    const activity = sheetNamed(await files(response), OLD_BOX_DATA_WORDS.en.activitySheet);
    expect(row(activity!, 1)).toEqual([OLD_BOX_DATA_WORDS.en.sinceAllIntro]);
  });

  it("after a planned handover, gives only the Invoices tab", async () => {
    await admin();
    const planned = "00000000-0000-4000-8000-0000000000dd";
    const operationId = "00000000-0000-4000-8000-0000000000ee";
    const successor = "00000000-0000-4000-8000-0000000000aa";
    const deps = { node: suite.node, nodeId: planned };
    await beginHandover(
      deps,
      {
        operationId,
        scenario: "controlled",
        venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
        sourceNodeId: planned,
        destinationNodeId: successor,
        membership: { term: 3, digest: "a".repeat(64) },
      },
      "source",
    );
    await advanceHandover(deps, operationId, "source_stepped_down", {});
    await withNodeTransaction(suite.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId: planned,
        operationId,
        kind: "handed-over",
        successorNodeId: successor,
        membershipTerm: 3,
      }),
    );
    const response = await post(
      appWith({ nodeId: planned, mainCopy: () => ({ lastChangeAtMs: COPY_AT }) }),
      signIn,
    );
    expect(response.status).toBe(200);
    const sheets = await files(response);
    expect(sheets["xl/worksheets/sheet1.xml"]).toBeDefined();
    expect(sheets["xl/worksheets/sheet2.xml"]).toBeUndefined();
    const downloaded = lines.find((line) => line.event === "old_box_data.downloaded");
    expect(downloaded?.fields).not.toHaveProperty("since");
  });

  it("logs the rule and the counts, never a name", async () => {
    await admin();
    const named = await seedPerson(suite.db, "manager");
    const NAME = "Marta Ruiz Quintana";
    await suite.db.run(sql`update persons set display_name = ${NAME} where id = ${named}`);
    await withTransaction(suite.db, (tx) =>
      recordActivity(tx, {
        kind: "dashboard.signed_in",
        subjectId: named,
        personId: named,
        data: { method: "password" },
        at: new Date(COPY_AT),
      }),
    );
    const response = await post(appWith({ mainCopy: () => ({ lastChangeAtMs: COPY_AT }) }), signIn);
    expect(response.status).toBe(200);
    // The control: the name reaches the file, so its absence from the log means something.
    expect(sheetNamed(await files(response), OLD_BOX_DATA_WORDS.en.activitySheet)).toContain(NAME);
    const downloaded = lines.find((line) => line.event === "old_box_data.downloaded");
    expect(downloaded?.fields).toMatchObject({
      since: "copy",
      invoiceRows: 0,
      orderRows: 0,
      paymentRows: 0,
      activityRows: 1,
    });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(JSON.stringify(line)).not.toContain(NAME);
  });

  it("logs the working hours count, never the clocked person's name", async () => {
    await admin();
    const named = await seedPerson(suite.db, "manager");
    const NAME = "Lucy Ferrer Bell";
    await suite.db.run(sql`update persons set display_name = ${NAME} where id = ${named}`);
    await seedVenue(suite.db);
    const nodeId = await seedNode(suite.db);
    await withTransaction(suite.db, (tx) =>
      appendToChain(
        tx,
        { nodeId },
        {
          personId: named,
          entryKind: "in",
          eventAt: new Date(COPY_AT).toISOString(),
          eventOffsetMinutes: 60,
          recordedByPersonId: named,
          origin: jobOrigin("dashboard"),
        },
        () => new Date(COPY_AT),
      ),
    );
    const response = await post(appWith({ mainCopy: () => ({ lastChangeAtMs: COPY_AT }) }), signIn);
    expect(response.status).toBe(200);
    // The control: the name reaches the file, so its absence from the log means something.
    expect(sheetNamed(await files(response), OLD_BOX_DATA_WORDS.en.hoursSheet)).toContain(NAME);
    const downloaded = lines.find((line) => line.event === "old_box_data.downloaded");
    expect(downloaded?.fields).toMatchObject({ since: "copy", hoursRows: 1 });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(JSON.stringify(line)).not.toContain(NAME);
  });
});
