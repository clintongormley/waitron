import { strFromU8, unzipSync } from "fflate";
import { Hono } from "hono";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { recordActivity, withNodeTransaction, withTransaction } from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { VERIFACTU_HANDOVER } from "@waitron/fiscal-verifactu";
import { seedManager, seedPerson } from "@waitron/identity/test/fixtures.js";
import { signingPasskey } from "@waitron/identity/test/passkey-signer.js";
import { PIN_THROTTLE_FREE_ATTEMPTS, webauthnCredentials } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import { recordHandoverRestrictionTx } from "@waitron/node-db";
import { generateSync } from "otplib";
import { AppError, jobOrigin } from "@waitron/shared";
import { appendToChain } from "@waitron/workforce";
import { OLD_BOX_DATA_WORDS } from "./i18n/old-box-data.js";
import { RESTRICTED_DOWNLOAD_WORDS } from "./i18n/restricted-page.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { escapeHtml } from "./html-page.js";
import type { Logger } from "./logger.js";
import { oldBoxDataRoute, type OldBoxDataDeps } from "./old-box-data-page.js";
import type { PasswordThrottle } from "./password-throttle.js";
import { restrictedDownloadDeps } from "./restricted-page.js";
import { enrolAuthenticator, TOTP_KEY_RING } from "./testing/authenticator.js";
import { row, sheetNamed } from "./testing/xlsx-rows.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const NODE_ID = "00000000-0000-4000-8000-0000000000cc";
const ORIGIN = "https://old-box.test";
const EMAIL = "Owner.Person@Example.test";
const RP_ID = "waitron.local";
const VENUE_ORIGIN = "https://waitron.local";
/** This box's own name, as `ownContactUrl` gives it for NODE_ID. */
const BOX_ORIGIN = "https://box-0000.waitron.local";
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
    managementOrigin?: string;
  } = {},
) {
  const app = new Hono();
  const page = {
    venue: suite.db,
    node: suite.node,
    nodeId: options.nodeId ?? NODE_ID,
    log,
    resetOrdered: options.resetOrdered,
  };
  oldBoxDataRoute({
    ...restrictedDownloadDeps(page),
    modules: options.modules ?? [fiscal],
    totpKeyRing: TOTP_KEY_RING,
    passkey: {
      rpId: RP_ID,
      managementOrigin: options.managementOrigin ?? VENUE_ORIGIN,
      nodeId: page.nodeId,
    },
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
    await seedVenue(suite.db, { timeZone: "Europe/Madrid" });
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
      OLD_BOX_DATA_WORDS.en.invoiceIntro.replace("{time}", "2026-11-23 09:15+01:00"),
    );
  });

  it("dates the file on the venue's calendar at the moment of download", async () => {
    await admin();
    await seedVenue(suite.db, { timeZone: "Europe/Madrid" });
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-23T23:30:00.000Z") });
    let response: Response;
    try {
      response = await post(appWith(), signIn);
    } finally {
      vi.useRealTimers();
    }
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="waitron-old-main-box-2026-11-24.xlsx"',
    );
    const sheet = strFromU8(
      unzipSync(new Uint8Array(await response.arrayBuffer()))["xl/worksheets/sheet1.xml"]!,
    );
    expect(sheet).toContain(
      OLD_BOX_DATA_WORDS.en.uncomparedIntro.replace("{time}", "2026-11-24 00:30+01:00"),
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

  it("refuses a form one byte over 16 KiB without judging it", async () => {
    await admin();
    const filler = 16 * 1024 + 1 - new URLSearchParams({ ...signIn, totp: "" }).toString().length;
    await expectPage(await post(appWith(), { ...signIn, totp: "1".repeat(filler) }), 400);
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
    await seedVenue(suite.db, { timeZone: "Europe/Madrid" });
    const response = await post(appWith({ mainCopy: () => ({ lastChangeAtMs: COPY_AT }) }), signIn);
    expect(response.status).toBe(200);
    const activity = sheetNamed(await files(response), OLD_BOX_DATA_WORDS.en.activitySheet);
    expect(activity).toBeDefined();
    expect(row(activity!, 1)).toEqual([
      OLD_BOX_DATA_WORDS.en.sinceCopyIntro.replace("{time}", "2026-11-20 10:50:00.000+01:00"),
    ]);
  });

  it("still gives the file when the copy time heard is not a date", async () => {
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

describe("signing in with a passkey on the old box", () => {
  async function passkeyFor(
    role: "admin" | "manager" = "admin",
    options: { status?: "active" | "suspended"; credentialId?: string } = {},
  ) {
    const personId = await seedPerson(suite.db, role, options.status ?? "active");
    const passkey = signingPasskey(RP_ID);
    await withTransaction(suite.db, (tx) =>
      tx.insert(webauthnCredentials).values({
        personId,
        credentialId: options.credentialId ?? passkey.credentialId,
        publicKey: passkey.publicKey,
        counter: 0,
      }),
    );
    return { personId, passkey };
  }

  function askOptions(
    app: Hono,
    options: { secure?: boolean; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    return Promise.resolve(
      app.request(
        `${ORIGIN}/old-box-data/passkey-options`,
        {
          method: "POST",
          headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", ...options.headers },
        },
        options.secure === false ? {} : { incoming: { socket } },
      ),
    );
  }

  async function challengeFrom(app: Hono): Promise<string> {
    const response = await askOptions(app);
    expect(response.status).toBe(200);
    return ((await response.json()) as { challenge: string }).challenge;
  }

  const words = RESTRICTED_DOWNLOAD_WORDS["en-GB"];

  /** Checks the page's one alert is `line`, drawn above the passkey button, and no field is marked. */
  function expectPasskeyLine(page: string, line: string): void {
    // The page's style names `[role="alert"]`, and its script the ids and marks it clears.
    const section = page.slice(page.indexOf("<section"));
    const html = section.replace(/<script>[\s\S]*?<\/script>/g, "");
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).toContain(
      `<p id="old-box-data-passkey-message" role="alert">${escapeHtml(line)}</p>\n<p><button type="button" class="secondary" id="old-box-data-passkey"`,
    );
    expect(html).not.toContain("old-box-data-message");
    expect(html).not.toMatch(/-error"|aria-invalid/);
  }

  /** Checks the page drew `refusal` with `status`, and the log names the code behind it. */
  async function expectRefused(
    response: Response,
    status: number,
    refusal: "passkeyRefused" | "notPermitted",
    errorCode: string,
  ): Promise<void> {
    await expectPage(response.clone(), status);
    expectPasskeyLine(await response.text(), words[refusal]);
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "old_box_data.refused",
        fields: expect.objectContaining({ errorCode }),
      }),
    );
  }

  it("gives options for this box's name that ask the person to verify, naming no passkey", async () => {
    const response = await askOptions(appWith());
    expect(response.status).toBe(200);
    const options = (await response.json()) as Record<string, unknown>;
    expect(options).toMatchObject({ rpId: RP_ID, userVerification: "required" });
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(typeof options.challenge).toBe("string");
  });

  it("downloads the workbook for a passkey made at the venue's name, answered at this box's own name", async () => {
    const { personId, passkey } = await passkeyFor();
    const app = appWith();
    const answer = passkey.assert(await challengeFrom(app), BOX_ORIGIN);
    const response = await post(app, { passkey: JSON.stringify(answer) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename=/);
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "old_box_data.downloaded",
        fields: expect.objectContaining({ personId }),
      }),
    );
  });

  it("downloads the workbook for an answer at the venue's name too", async () => {
    const { passkey } = await passkeyFor();
    const app = appWith();
    const answer = passkey.assert(await challengeFrom(app), VENUE_ORIGIN);
    expect((await post(app, { passkey: JSON.stringify(answer) })).status).toBe(200);
  });

  it("refuses an answer made at another origin", async () => {
    const { passkey } = await passkeyFor();
    const app = appWith();
    const answer = passkey.assert(await challengeFrom(app), "https://box-ffff.waitron.local");
    const response = await post(app, { passkey: JSON.stringify(answer) });
    await expectRefused(response, 401, "passkeyRefused", "passkey.verification_failed");
  });

  it("refuses an answer whose signature its passkey did not make", async () => {
    const { passkey } = await passkeyFor();
    const app = appWith();
    const answer = passkey.assert(await challengeFrom(app), BOX_ORIGIN);
    const forged = {
      ...answer,
      response: {
        ...answer.response,
        signature: signingPasskey(RP_ID).assert("eA", BOX_ORIGIN).response.signature,
      },
    };
    const response = await post(app, { passkey: JSON.stringify(forged) });
    await expectRefused(response, 401, "passkeyRefused", "passkey.verification_failed");
  });

  it("refuses a passkey this box has no record of", async () => {
    const app = appWith();
    const answer = signingPasskey(RP_ID).assert(await challengeFrom(app), BOX_ORIGIN);
    const response = await post(app, { passkey: JSON.stringify(answer) });
    await expectRefused(response, 401, "passkeyRefused", "passkey.not_registered");
  });

  it("refuses an answer whose passkey id is not text as naming no passkey", async () => {
    const { passkey } = await passkeyFor();
    const app = appWith();
    const answer = { ...passkey.assert(await challengeFrom(app), BOX_ORIGIN), id: 7 };
    const response = await post(app, { passkey: JSON.stringify(answer) });
    await expectRefused(response, 401, "passkeyRefused", "passkey.not_registered");
  });

  it("refuses a suspended person's passkey with the same words as one it has no record of", async () => {
    const { passkey } = await passkeyFor("admin", { status: "suspended" });
    const app = appWith();
    const answer = passkey.assert(await challengeFrom(app), BOX_ORIGIN);
    const response = await post(app, { passkey: JSON.stringify(answer) });
    await expectRefused(response, 401, "passkeyRefused", "passkey.verification_failed");
  });

  it("refuses an answer that is not a passkey's answer", async () => {
    const response = await post(appWith(), { passkey: "{not json" });
    await expectPage(response.clone(), 401);
    expectPasskeyLine(await response.text(), words.passkeyRefused);
  });

  it("refuses a challenge this box did not make, and one already used, as expired", async () => {
    const { passkey } = await passkeyFor();
    const app = appWith();
    const notMade = await post(app, {
      passkey: JSON.stringify(passkey.assert("bm90LW1hZGUtaGVyZQ", BOX_ORIGIN)),
    });
    await expectPage(notMade.clone(), 401);
    expectPasskeyLine(await notMade.text(), words.passkeyExpired);

    const answer = JSON.stringify(passkey.assert(await challengeFrom(app), BOX_ORIGIN));
    expect((await post(app, { passkey: answer })).status).toBe(200);
    const again = await post(app, { passkey: answer });
    await expectPage(again.clone(), 401);
    expectPasskeyLine(await again.text(), words.passkeyExpired);
  });

  it("refuses a passkey whose owner does not hold node.manage", async () => {
    const { passkey } = await passkeyFor("manager");
    const app = appWith();
    const answer = passkey.assert(await challengeFrom(app), BOX_ORIGIN);
    const response = await post(app, { passkey: JSON.stringify(answer) });
    await expectRefused(response, 403, "notPermitted", "authorization.not_permitted");
  });

  /**
   * An RS256 passkey on a 4096-bit key whose answers carry a user handle: with WebAuthn's longest
   * passkey id (1,023 bytes) and a long name, about the largest answer a browser sends.
   */
  function longestPasskey(credentialId: string) {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 4096 });
    const jwk = publicKey.export({ format: "jwk" });
    // COSE key {kty: RSA, alg: RS256, n, e}, CBOR-encoded by hand for a 512-byte n and a 3-byte e.
    const cose = Buffer.concat([
      Buffer.from([0xa4, 0x01, 0x03, 0x03, 0x39, 0x01, 0x00, 0x20, 0x59, 0x02, 0x00]),
      Buffer.from(jwk.n!, "base64url"),
      Buffer.from([0x21, 0x43]),
      Buffer.from(jwk.e!, "base64url"),
    ]);
    const assert = (challenge: string, origin: string) => {
      const clientData = Buffer.from(
        JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }),
      );
      const authData = Buffer.concat([
        createHash("sha256").update(RP_ID).digest(),
        Buffer.from([0x05, 0, 0, 0, 1]),
      ]);
      const signature = sign(
        "sha256",
        Buffer.concat([authData, createHash("sha256").update(clientData).digest()]),
        privateKey,
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData.toString("base64url"),
          authenticatorData: authData.toString("base64url"),
          signature: signature.toString("base64url"),
          userHandle: randomBytes(64).toString("base64url"),
        },
      };
    };
    return { publicKey: cose.toString("base64url"), assert };
  }

  it("judges an answer over 4 KiB: WebAuthn's longest passkey id, answered at a long name", async () => {
    const credentialId = randomBytes(1023).toString("base64url");
    const passkey = longestPasskey(credentialId);
    const personId = await seedPerson(suite.db, "admin");
    await withTransaction(suite.db, (tx) =>
      tx
        .insert(webauthnCredentials)
        .values({ personId, credentialId, publicKey: passkey.publicKey, counter: 0 }),
    );
    // 253 characters, the longest a host name may be.
    const managementOrigin = `https://${["a", "b", "c"].map((c) => c.repeat(63)).join(".")}.${"d".repeat(61)}`;
    const app = appWith({ managementOrigin });
    const fields = {
      passkey: JSON.stringify(passkey.assert(await challengeFrom(app), managementOrigin)),
    };
    expect(new URLSearchParams(fields).toString().length).toBeGreaterThan(4096);
    expect((await post(app, fields)).status).toBe(200);
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "old_box_data.downloaded",
        fields: expect.objectContaining({ personId }),
      }),
    );
  });

  it("judges a form of exactly 16 KiB", async () => {
    const fields = { passkey: "x".repeat(16 * 1024 - "passkey=".length) };
    const response = await post(appWith(), fields);
    await expectRefused(response, 401, "passkeyRefused", "passkey.verification_failed");
  });

  it("leaves the passkey's counter and last use as they were", async () => {
    const { passkey } = await passkeyFor();
    const app = appWith();
    const stored = () =>
      suite.db
        .select({
          counter: webauthnCredentials.counter,
          lastUsedAt: webauthnCredentials.lastUsedAt,
        })
        .from(webauthnCredentials);
    const before = await stored();
    const answer = passkey.assert(await challengeFrom(app), BOX_ORIGIN);
    expect((await post(app, { passkey: JSON.stringify(answer) })).status).toBe(200);
    expect(await stored()).toEqual(before);
    expect(before).toEqual([{ counter: 0, lastUsedAt: null }]);
  });

  it("refuses to give options over plain HTTP, from another page, or while the box is wiped", async () => {
    expect((await askOptions(appWith(), { secure: false })).status).toBe(403);
    expect(
      (
        await askOptions(appWith(), {
          headers: { origin: "https://elsewhere.test", "sec-fetch-site": "cross-site" },
        })
      ).status,
    ).toBe(403);
    expect((await askOptions(appWith({ resetOrdered: () => true }))).status).toBe(409);
  });
});
