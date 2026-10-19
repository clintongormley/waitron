import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { openVenueDatabase } from "@waitron/db";
import { emptyDrainResult } from "@waitron/fiscal";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chromium } from "playwright";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { startServer, type StartedServer } from "./boot.js";
import { withRecoveryKeyAuthority } from "./operation-authentication.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";

// External clock, email and AEAT readiness are synthetic; local setup and key verification stay real.
vi.mock("@waitron/composition", async (original) => {
  const actual = await original<typeof import("@waitron/composition")>();
  return {
    ...actual,
    ALL_MODULES: actual.ALL_MODULES.map((module) =>
      module.name !== "fiscal-verifactu"
        ? module
        : {
            ...module,
            fiscal: {
              ...module.fiscal!,
              provisioningSecret: {
                required: () => true,
                validate: () => {},
                seal: async () => {},
              },
              drain: async () => ({ ...emptyDrainResult(), recordsAccepted: 1 }),
            },
          },
    ),
  };
});
vi.mock("./smtp-test-message.js", () => ({
  sendSmtpTestMessage: async () => ({ accepted: true }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => {
    const now = Date.now(),
      mono = performance.now();
    return {
      source: "internet",
      result: "usable",
      instantMs: now,
      uncertaintyMs: 500,
      wallStartedMs: now,
      wallFinishedMs: now,
      monotonicStartedMs: mono,
      monotonicFinishedMs: mono,
    };
  },
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));

let buildRoot: string | undefined;
let setupDist: string;
beforeAll(async () => {
  buildRoot = await mkdtemp(join(tmpdir(), "waitron-download-build-"));
  setupDist = join(buildRoot, "setup");
  execFileSync(
    "pnpm",
    ["--filter", "@waitron/setup", "exec", "vite", "build", "--outDir", setupDist],
    { timeout: 90_000, stdio: "pipe" },
  );
});
afterAll(async () => {
  if (buildRoot) await rm(buildRoot, { recursive: true, force: true });
});

it.each(["en", "es"] as const)(
  "the built %s wizard downloads a recoverable PDF and its saved key authenticates the matching backup",
  async (locale) => {
    const root = await mkdtemp(join(tmpdir(), "waitron-document-download-"));
    const receipt = root;
    let server: StartedServer | undefined,
      browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    const realKill = process.kill.bind(process);
    const killed = vi
      .spyOn(process, "kill")
      .mockImplementation((pid, signal) =>
        pid === process.pid && signal === "SIGTERM" ? true : realKill(pid, signal),
      );
    const errors: string[] = [];
    try {
      const stateDir = join(root, "state"),
        venueDir = join(root, "venue"),
        migrations = join(root, "migrations");
      await copyMigrationsRoot(migrations);
      const [port] = await freePorts(1);
      const url = `https://127.0.0.1:${port}`;
      const env = {
        WAITRON_ENV: "production",
        WAITRON_STATE_DIR: stateDir,
        WAITRON_VENUE_DIR: venueDir,
        WAITRON_MIGRATIONS_DIR: migrations,
        WAITRON_HTTP_HOST: "127.0.0.1",
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_MANAGEMENT_RP_ID: "localhost",
        WAITRON_MANAGEMENT_ORIGIN: url,
        WAITRON_SETUP_APP_DIR: setupDist,
        WAITRON_DASHBOARD_APP_DIR: setupDist,
      };
      server = await startServer(env);
      const leaf = new X509Certificate(await readFile(join(stateDir, "tls/server.crt")));
      const pin = createHash("sha256")
        .update(leaf.publicKey.export({ type: "spki", format: "der" }))
        .digest("base64");
      browser = await chromium.launch({
        headless: true,
        args: [`--ignore-certificate-errors-spki-list=${pin}`],
      });
      const context = await browser.newContext({
        locale: locale === "en" ? "en-GB" : "es-ES",
        acceptDownloads: true,
      });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === url ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on("pageerror", (error) => errors.push(error.message));
      const click = async (selector: string) => {
        const el = page.locator(selector);
        const tag = await el.evaluate((e) => e.tagName);
        if (tag === "WT-SWITCH") await el.locator("input").check();
        else if (tag === "WT-BUTTON" || tag === "WT-CHOICE-ROW") await el.locator("button").click();
        else await el.click();
      };
      const fill = async (selector: string, value: string) =>
        page.locator(selector + " input").fill(value);
      const prove = async () => {
        await fill(
          "setup-initial-setup-screen [data-test=owner-password]",
          "SYNTHETIC-owner-password",
        );
        await click("setup-initial-setup-screen [data-test=reconfirm]");
      };
      await page.goto(url);
      if (await page.locator("setup-connection-screen").count())
        await click("setup-connection-screen [data-test=continue]");
      await click("setup-mode-screen [data-test=choose-live]");
      await click("setup-mode-screen [data-test=understand]");
      await click("setup-mode-screen [data-test=confirm-live]");
      await click("setup-live-source-screen [data-test=empty]");
      await page.waitForFunction(() => {
        const a = document.querySelector("setup-app")!;
        return (
          a.shadowRoot!.querySelector("setup-admin-screen") ||
          (a.shadowRoot!.querySelector("wt-unsaved-changes") as HTMLElement & { open: boolean })
            ?.open
        );
      });
      if (
        await page
          .getByRole("button", { name: /Discard changes|Descartar cambios/, exact: true })
          .count()
      )
        await page
          .getByRole("button", { name: /Discard changes|Descartar cambios/, exact: true })
          .click();
      for (const [key, value] of Object.entries({
        firstNames: "Elena",
        lastNames: "Example",
        displayName: "Elena",
        email: "elena@example.test",
        password: "SYNTHETIC-owner-password",
        pin: "4826",
      }))
        await fill(`setup-admin-screen [data-test=${key}]`, value);
      await click("setup-admin-screen [data-test=next]");
      for (const [key, value] of Object.entries({
        taxId: "50000000R",
        legalName: "Olivo SL",
        taxpayerDomicile: "Mayor 1, Madrid",
        name: "Olivo",
        addressLine1: "Mayor 1",
        postalCode: "28001",
        city: "Madrid",
      }))
        await fill(`setup-venue-screen [data-test=${key}]`, value);
      await page.locator("setup-venue-screen [data-test=province] button.trigger").click();
      await page.locator("setup-venue-screen [data-test=province] input").fill("Madrid");
      await page.getByRole("option", { name: "Madrid", exact: true }).click();
      await click("setup-venue-screen [data-test=next]");
      await page.locator("setup-cert-screen [data-test=pfx]").setInputFiles({
        name: "synthetic.p12",
        mimeType: "application/x-pkcs12",
        buffer: Buffer.from("synthetic"),
      });
      await fill("setup-cert-screen [data-test=passphrase]", "synthetic");
      await click("setup-cert-screen [data-test=next]");
      await click("setup-fiscal-test-screen [data-test=run]");
      await click("setup-fiscal-test-screen [data-test=continue]");
      for (const [key, value] of Object.entries({
        server: "smtp.example.test",
        port: "465",
        user: "test",
        password: "test",
        from: "owner@example.test",
      }))
        await fill(`setup-email-screen [data-test=${key}]`, value);
      await click("setup-email-screen [data-test=test]");
      await click("setup-email-screen [data-test=next]");
      const vf = "vf-first-setup-hour";
      await page.locator(`${vf} [data-test=clock-readings]`).waitFor();
      await page.locator(`${vf} input[name=setup-details-confirmed]`).check();
      await page.locator(`${vf} input[name=taxpayer-hour][value=no]`).check();
      await click(`${vf} [data-test=select]`);
      await prove();
      await page.locator(`${vf} [data-test=selected-hour]`).waitFor();
      const registeredPromise = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname === "/setup-api/first-setup/recovery-document" &&
          request.method() === "POST",
      );
      await click(`${vf} [data-test=prepare-pdf]`);
      await prove();
      await page.locator(`${vf} [data-test=download-pdf]`).waitFor();
      const downloadPromise = page.waitForEvent("download");
      await click(`${vf} [data-test=download-pdf]`);
      const download = await downloadPromise;
      await download.saveAs(join(receipt, "wizard-original.pdf"));
      expect(await page.locator(`${vf} [data-test=download-pdf]`).getAttribute("href")).toBe(
        await page.locator(`${vf} [data-test=print-pdf]`).getAttribute("href"),
      );
      await page.locator(`${vf} input[name=setup-pdf-kept]`).check();
      await click(`${vf} [data-test=kept]`);
      await prove();
      await click("setup-initial-setup-screen [data-test=next]");
      await page.locator("setup-review-screen").waitFor();
      await click("setup-review-screen [data-test=provision]");
      await page.locator("setup-done-screen").waitFor();
      const original = await readFile(join(receipt, "wizard-original.pdf"));
      expect((await registeredPromise).postDataJSON()).toMatchObject({
        module: "fiscal-verifactu",
        documentDigest: createHash("sha256").update(original).digest("hex"),
      });
      expect(original.subarray(0, 5).toString()).toBe("%PDF-");
      const task = getDocument({
        data: new Uint8Array(original),
        useSystemFonts: false,
        disableFontFace: true,
        useWorkerFetch: false,
        useWasm: false,
      });
      let attachment: Uint8Array;
      let decoded: {
        nodeKey: { nodeId: string; name: string; secret: string };
        scope: { taxpayerNif: string; environment: string };
      };
      let keyText: string;
      let pagePng: Buffer;
      try {
        const pdf = await task.promise;
        attachment = (await pdf.getAttachmentContent("waitron-recovery-key-v1.json"))!;
        expect(attachment).toBeInstanceOf(Uint8Array);
        decoded = JSON.parse(new TextDecoder().decode(attachment));
        expect(decoded.scope).toMatchObject({
          taxpayerNif: "50000000R",
          environment: "production",
        });
        const sheet = await pdf.getPage(1);
        const text = (await sheet.getTextContent()).items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
        keyText = text
          .match(/(?:Key|Clave): ([0-9A-Z]{4}(?: [0-9A-Z]{4}){9} [0-9A-Z])/)![1]!
          .trim();
        const viewport = sheet.getViewport({ scale: 1.5 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await sheet.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
        pagePng = await canvas.encode("png");
      } finally {
        await task.destroy();
      }
      await page.evaluate(
        ({ selection, locale }) => {
          const el = document.createElement("vf-recovery-key") as HTMLElement & {
            selection: unknown;
            locale: string;
          };
          el.selection = selection;
          el.locale = locale;
          el.addEventListener("recovery-key-change", (event) => {
            (window as unknown as { recovered?: string }).recovered = (
              event as CustomEvent<{ secret?: string }>
            ).detail.secret;
          });
          document.querySelector("setup-app")!.remove();
          document.body.append(el);
        },
        {
          selection: {
            taxId: decoded.scope.taxpayerNif,
            environment: decoded.scope.environment,
            nodeId: decoded.nodeKey.nodeId,
            keyName: decoded.nodeKey.name,
          },
          locale,
        },
      );
      const picker = page.locator('vf-recovery-key input[name="recovery-pdf"]');
      const recovered = () =>
        page.evaluate(() => (window as unknown as { recovered?: string }).recovered);
      await picker.setInputFiles(join(receipt, "wizard-original.pdf"));
      await expect.poll(recovered).toBe(decoded.nodeKey.secret);
      const reprint = await PDFDocument.load(original);
      reprint.getPages()[0]!.drawText("SYNTHETIC ANNOTATION", { x: 42, y: 24, size: 8 });
      const annotated = await reprint.save();
      expect(createHash("sha256").update(annotated).digest("hex")).not.toBe(
        createHash("sha256").update(original).digest("hex"),
      );
      const annotatedPath = join(receipt, "wizard-annotated.pdf");
      await writeFile(annotatedPath, annotated);
      const annotatedTask = getDocument({
        data: annotated.slice(),
        useSystemFonts: false,
        disableFontFace: true,
        useWorkerFetch: false,
        useWasm: false,
      });
      try {
        expect(
          await (await annotatedTask.promise).getAttachmentContent("waitron-recovery-key-v1.json"),
        ).toEqual(attachment);
      } finally {
        await annotatedTask.destroy();
      }
      await picker.setInputFiles(annotatedPath);
      await expect.poll(recovered).toBe(decoded.nodeKey.secret);
      const printPage = await context.newPage();
      await printPage.setContent(
        `<img src="data:image/png;base64,${pagePng.toString("base64")}" style="width:100%">`,
      );
      await printPage.locator("img").evaluate(async (img) => {
        await (img as HTMLImageElement).decode();
      });
      const printedPath = join(receipt, "wizard-printed.pdf");
      await printPage.pdf({ path: printedPath, format: "A4" });
      await printPage.close();
      await picker.setInputFiles(printedPath);
      await expect
        .poll(() => page.locator("vf-recovery-key #pdf-error").textContent())
        .toBe(
          locale === "en"
            ? "Enter the key from the sheet below."
            : "Introduce abajo la clave de la hoja.",
        );
      expect(await recovered()).toBeUndefined();
      await fill(
        'vf-recovery-key [name="printed-recovery-key"]',
        keyText.toLowerCase().replaceAll("0", "o").replaceAll("1", "l"),
      );
      await expect.poll(recovered).toBe(decoded.nodeKey.secret);
      await server.close();
      server = undefined;
      const source = await openVenueDatabase(venueDir);
      const backupDir = join(root, "selected-backup");
      try {
        await mkdir(backupDir);
        await source.venue.archiveTo(join(backupDir, "venue.db"));
      } finally {
        await source.close();
      }
      const selected = await openVenueDatabase(backupDir);
      try {
        const binding = {
          module: "fiscal-verifactu",
          action: "restore",
          eventId: crypto.randomUUID(),
          sourceId: "exact-saved-backup",
          targetNodeId: decoded.nodeKey.nodeId,
        };
        await expect(
          withRecoveryKeyAuthority(
            { db: selected.venue, nodeId: decoded.nodeKey.nodeId },
            binding,
            "wrong-key",
            async () => true,
          ),
        ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
        await expect(
          withRecoveryKeyAuthority(
            { db: selected.venue, nodeId: decoded.nodeKey.nodeId },
            binding,
            await recovered(),
            async (_authority, commit) =>
              commit(
                async (tx) =>
                  (await tx.execute<{ n: number }>("select count(*) as n from fiscal_allocations"))
                    .rows[0]!.n,
              ),
          ),
        ).resolves.toBe(1);
        expect(
          (
            await selected.venue.execute<{ n: number }>(
              "select count(*) as n from registros_facturacion",
            )
          ).rows[0]!.n,
        ).toBe(0);
      } finally {
        await selected.close();
      }
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await server?.close();
      killed.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  },
);
