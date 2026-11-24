import { generateKeyPairSync, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { withNodeTransaction, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { VERIFACTU_HANDOVER } from "@waitron/fiscal-verifactu";
import { webauthnCredentials } from "@waitron/identity";
import { seedManager } from "@waitron/identity/test/fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordHandoverRestrictionTx } from "@waitron/node-db";
import { boxHostnameFor, BOX_HOSTNAME } from "./box-name.js";
import { RESTRICTED_DOWNLOAD_WORDS } from "./i18n/restricted-page.js";
import type { Logger } from "./logger.js";
import { oldBoxDataRoute } from "./old-box-data-page.js";
import { restrictedDownloadDeps, restrictedPageRoute } from "./restricted-page.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { enrolAuthenticator, TOTP_KEY_RING } from "./testing/authenticator.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const NODE_ID = "5d950000-0000-4000-8000-0000000000cc";
const EMAIL = "owner@example.test";
const words = RESTRICTED_DOWNLOAD_WORDS["en-GB"];

let browser: Browser | undefined;
let listener: ReturnType<typeof serve> | undefined;
let app = new Hono();
let port = 0;
let context: BrowserContext;
let page: Page;
let wiping = false;
let personId = "";
let lines: { event: string; fields: unknown }[] = [];
const log: Logger = (_level, event, fields) => {
  lines.push({ event, fields });
};

beforeAll(async () => {
  const material = mintSelfSignedServerCert({
    hostnames: ["localhost"],
    ipAddresses: ["127.0.0.1"],
    now: new Date(),
  });
  listener = serve({
    createServer: createHttpsServer,
    serverOptions: { key: material.serverKeyPem, cert: material.serverCertPem },
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, env) => app.fetch(request, env),
  });
  if (!listener.listening) await once(listener, "listening");
  port = (listener.address() as AddressInfo).port;
  // WebAuthn refuses an IP address, so the box's names are mapped to this listener; the
  // self-signed certificate does not name them, hence `ignoreHTTPSErrors`.
  browser = await chromium.launch({
    headless: true,
    timeout: 15_000,
    args: [`--host-resolver-rules=MAP ${BOX_HOSTNAME} 127.0.0.1, MAP *.${BOX_HOSTNAME} 127.0.0.1`],
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  listener?.close();
  if (listener !== undefined) await once(listener, "close");
});

/** A P-256 key as the virtual authenticator takes it, and as the venue database stores it. */
function passkeyKey(): { privateKey: string; cose: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  // COSE key {kty: EC2, alg: ES256, crv: P-256, x, y}, CBOR-encoded by hand for 32-byte x and y.
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x!, "base64url"),
    Buffer.from([0x22, 0x58, 0x20]),
    Buffer.from(jwk.y!, "base64url"),
  ]);
  return {
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    cose: cose.toString("base64url"),
  };
}

beforeEach(async () => {
  lines = [];
  wiping = false;
  await withNodeTransaction(suite.node, (tx) =>
    recordHandoverRestrictionTx(tx, {
      nodeId: NODE_ID,
      operationId: null,
      kind: "superseded",
      successorNodeId: "00000000-0000-4000-8000-0000000000aa",
      membershipTerm: 1,
    }),
  );
  personId = await seedManager(suite.db, { email: EMAIL, role: "admin" });
  const credentialId = randomBytes(32);
  const key = passkeyKey();
  await withTransaction(suite.db, (tx) =>
    tx.insert(webauthnCredentials).values({
      personId,
      credentialId: credentialId.toString("base64url"),
      publicKey: key.cose,
      counter: 0,
    }),
  );
  const pageDeps = {
    venue: suite.db,
    node: suite.node,
    nodeId: NODE_ID,
    log,
    resetOrdered: () => wiping,
  };
  app = new Hono();
  oldBoxDataRoute({
    ...restrictedDownloadDeps(pageDeps),
    modules: [
      { name: "fiscal", version: "1.0.0", tier: "mandatory", handover: VERIFACTU_HANDOVER },
    ],
    totpKeyRing: TOTP_KEY_RING,
    passkey: {
      rpId: BOX_HOSTNAME,
      managementOrigin: `https://${BOX_HOSTNAME}:${port}`,
      nodeId: NODE_ID,
    },
  })(app);
  restrictedPageRoute(pageDeps)(app);

  context = await browser!.newContext({ ignoreHTTPSErrors: true, locale: "en-GB" });
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await cdp.send("WebAuthn.addCredential", {
    authenticatorId,
    credential: {
      credentialId: credentialId.toString("base64"),
      isResidentCredential: true,
      rpId: BOX_HOSTNAME,
      privateKey: key.privateKey,
      userHandle: Buffer.from(personId).toString("base64"),
      signCount: 0,
    },
  });
}, 30_000);

afterEach(async () => {
  await context?.close();
});

/** This box's own address, as a person reaches its page. */
const ownPage = () => `https://${boxHostnameFor(NODE_ID)}:${port}/`;

/** Submits the password form with a wrong password, so the page drawn carries a refusal line. */
async function drawRefusal(): Promise<void> {
  await page.goto(ownPage());
  await page.fill("#old-box-data-email", EMAIL);
  await page.fill("#old-box-data-password", "wrong horse");
  await Promise.all([page.waitForURL("**/old-box-data"), page.click("button[type=submit]")]);
  await expect
    .poll(() => page.locator("#old-box-data-message").textContent())
    .toBe(words.signInRefused);
}

it("downloads the workbook from the passkey button, at this box's own name", async () => {
  await page.goto(ownPage());
  const button = page.getByRole("button", { name: words.passkeyAction });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^waitron-old-main-box-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const bytes = await download.createReadStream().then(async (stream) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  });
  expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(lines.map((line) => line.event)).toContain("old_box_data.downloaded");
  // The page stays, and the button is offered again.
  await expect.poll(() => button.isEnabled()).toBe(true);
});

/** Submits the password form without the code an enrolled authenticator needs, marking its field. */
async function drawCodeRefusal(): Promise<void> {
  await enrolAuthenticator(suite.db, personId, TOTP_KEY_RING);
  await page.goto(ownPage());
  await page.fill("#old-box-data-email", EMAIL);
  await page.fill("#old-box-data-password", "correct horse");
  await Promise.all([page.waitForURL("**/old-box-data"), page.click("button[type=submit]")]);
  await expect
    .poll(() => page.locator("#old-box-data-totp-error").textContent())
    .toBe(words.totpRequired);
}

it("shows its one failure line above the button, in place of the page's refusal line and field marks", async () => {
  await drawCodeRefusal();
  await page.route("**/old-box-data/passkey-options", (route) => route.fulfill({ status: 500 }));
  await page.getByRole("button", { name: words.passkeyAction }).click();
  const line = page.locator("#old-box-data-passkey-message");
  await expect.poll(() => line.textContent()).toBe(words.passkeyCancelled);
  expect(await page.locator("[role=alert]").count()).toBe(1);
  expect(await page.locator("#old-box-data-message, [id$=-error], [aria-invalid]").count()).toBe(0);
  expect(
    await line.evaluate(
      (alert) => alert.nextElementSibling?.querySelector("#old-box-data-passkey") !== null,
    ),
  ).toBe(true);
  expect(await page.getByRole("button", { name: words.passkeyAction }).isEnabled()).toBe(true);
});

it("fetches the page again when a wipe began after it was drawn, without posting a form again", async () => {
  await drawRefusal();
  wiping = true;
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(new URL(request.url()).pathname);
  });
  await page.getByRole("button", { name: words.passkeyAction }).click();
  await expect.poll(() => page.getByText(words.wipeUnderWay).count()).toBe(1);
  expect(await page.locator("#old-box-data-passkey").count()).toBe(0);
  expect(posts).toEqual(["/old-box-data/passkey-options"]);
});
