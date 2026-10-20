import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createPublicKey, verify } from "node:crypto";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { chromium, type BrowserContext, type Page } from "playwright";
import { custodyRequest, custodyPassphrase } from "../testing/custodian-fixture.js";
import { paperBlockBytes, paperConsumptionBytes } from "../paper-protocol.js";
import type { PaperBlock, PaperConsumption, SignedPaperValue } from "../paper-protocol.js";

async function click(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}
async function selectJson(page: Page, label: string, value: unknown) {
  await page.getByLabel(label, { exact: true }).setInputFiles({
    name: "public.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
}
async function downloadJson(page: Page, name: string, dir: string, file: string): Promise<unknown> {
  const download = page.waitForEvent("download");
  await click(page, name);
  await (await download).saveAs(join(dir, file));
  return JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
}

it("runs the saved self-contained artifact offline, reopens its actual download, checks synthetic paper in a new context and exports Node-verifiable public signatures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "waitron-custody-tool-"));
  const out = join(dir, "custodian-tool.html");
  const contexts: BrowserContext[] = [];
  const result = spawnSync(process.execPath, ["scripts/build-custodian.mjs", "--out", out], {
    encoding: "utf8",
    timeout: 30_000,
  });
  try {
    expect(result.status, result.stderr).toBe(0);
    const emptyOutput = spawnSync(process.execPath, ["scripts/build-custodian.mjs", "--out", ""], {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(emptyOutput.status).toBe(1);
    expect(emptyOutput.stderr).toContain("Expected --out <file>");
    const artifact = readFileSync(out, "utf8");
    expect(artifact).not.toMatch(
      /<script[^>]+src=|<link[^>]+href=|@import\s|node:crypto|PRIVATE-SENTINEL/,
    );
    const expectedNotices = [readFileSync("../../LICENSE", "utf8")];
    const litRequire = createRequire(
      new URL("../../node_modules/lit/package.json", import.meta.url),
    );
    for (const name of ["lit", "lit-element", "lit-html", "@lit/reactive-element"]) {
      let directory = dirname(litRequire.resolve(name));
      while (!existsSync(join(directory, "package.json"))) directory = dirname(directory);
      expectedNotices.push(readFileSync(join(directory, "LICENSE"), "utf8"));
    }
    for (const notice of expectedNotices)
      expect(artifact).toContain(
        notice.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
      );
    const browser = await chromium.launch({ headless: true });
    const effects: string[] = [],
      consoleMessages: string[] = [];
    const open = async () => {
      const context = await browser.newContext({ offline: true, acceptDownloads: true });
      contexts.push(context);
      await context.route(/^https?:/, (route) => {
        effects.push(route.request().url());
        return route.abort();
      });
      await context.addInitScript(() => {
        const effects: string[] = [];
        Object.assign(window, { custodyEffects: effects });
        Storage.prototype.setItem = () => {
          effects.push("storage");
          throw new Error("storage forbidden");
        };
        window.fetch = async () => {
          effects.push("fetch");
          throw new Error("network forbidden");
        };
        XMLHttpRequest.prototype.open = () => {
          effects.push("xhr");
          throw new Error("network forbidden");
        };
        navigator.sendBeacon = () => {
          effects.push("beacon");
          return false;
        };
        Object.assign(window, {
          WebSocket: class {
            constructor() {
              effects.push("websocket");
              throw new Error("network forbidden");
            }
          },
          Worker: class {
            constructor() {
              effects.push("worker");
              throw new Error("worker forbidden");
            }
          },
          SharedWorker: class {
            constructor() {
              effects.push("sharedworker");
              throw new Error("worker forbidden");
            }
          },
        });
        indexedDB.open = () => {
          effects.push("indexeddb");
          throw new Error("storage forbidden");
        };
        if ("caches" in window)
          caches.open = async () => {
            effects.push("cache-storage");
            throw new Error("storage forbidden");
          };
        if ("serviceWorker" in navigator)
          navigator.serviceWorker.register = async () => {
            effects.push("service-worker");
            throw new Error("worker forbidden");
          };
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.on("console", (message) => consoleMessages.push(message.text()));
      page.on("pageerror", (error) => consoleMessages.push(error.message));
      await page.goto(pathToFileURL(out).href);
      await page.getByRole("heading", { name: "Outside custody", exact: true }).waitFor();
      return page;
    };
    try {
      const page = await open();
      await click(page, "New kit");
      const request = await custodyRequest();
      await selectJson(page, "Public setup request", request);
      await click(page, "Load setup request");
      await click(page, "No — create the first kit");
      await page.getByRole("textbox", { name: "Custodian", exact: false }).fill("Elena");
      await click(page, "Create key");
      const publicKit = (await downloadJson(
        page,
        "Save public check request",
        dir,
        "check.json",
      )) as { requestId: string; public: { fingerprint: string; publicKey: string } };
      await page.getByLabel("Passphrase", { exact: false }).first().fill(custodyPassphrase);
      await page.getByLabel("Repeat passphrase", { exact: false }).fill(custodyPassphrase);
      const download = page.waitForEvent("download");
      await click(page, "Save protected key");
      await (await download).saveAs(join(dir, "saved-key.json"));
      await page.evaluate(() => {
        window.print = () => {
          Object.assign(window, {
            syntheticPrintedText: document.querySelector("#custody-print pre")?.textContent ?? "",
          });
          window.dispatchEvent(new Event("afterprint"));
        };
      });
      await click(page, "Print secret recovery sheet");
      const paper = await page.evaluate(
        () => (window as unknown as { syntheticPrintedText: string }).syntheticPrintedText,
      );
      expect(paper).toContain("page 1/1");
      await click(page, "Print the one public original");
      await page
        .getByRole("textbox", { name: "Public record reference", exact: false })
        .fill("original kept");
      await click(page, "I checked and kept the one usable original");
      await click(page, "Check saved file");
      await page
        .getByLabel("Saved protected key file", { exact: true })
        .setInputFiles(join(dir, "saved-key.json"));
      await page.getByLabel("Passphrase", { exact: false }).first().fill(custodyPassphrase);
      await click(page, "Reopen selected file");
      await downloadJson(page, "Save check receipt", dir, "file-check.json");
      expect(
        await page.evaluate(
          () => (window as unknown as { custodyEffects: string[] }).custodyEffects,
        ),
      ).toEqual([]);
      await page.context().close();

      const recovery = await open();
      await click(recovery, "Check secret paper");
      await selectJson(recovery, "Public kit-check request", publicKit);
      await click(recovery, "Load check request");
      await recovery
        .getByRole("textbox", { name: "Transcribe the physical recovery sheet", exact: false })
        .fill(paper);
      await recovery
        .getByRole("textbox", { name: "Full public fingerprint", exact: false })
        .fill(publicKit.public.fingerprint);
      await click(recovery, "Check paper");
      const paperReceipt = await downloadJson(
        recovery,
        "Save check receipt",
        dir,
        "paper-check.json",
      );
      expect(
        await recovery.evaluate(
          () => (window as unknown as { custodyEffects: string[] }).custodyEffects,
        ),
      ).toEqual([]);
      await recovery.context().close();

      const resume = await open();
      await click(resume, "Reopen / existing kit");
      await selectJson(resume, "Public setup request", request);
      await click(resume, "Load setup request");
      await selectJson(resume, "Public kit-check request", publicKit);
      await click(resume, "Load check request");
      await click(resume, "Check saved file");
      await resume
        .getByLabel("Saved protected key file", { exact: true })
        .setInputFiles(join(dir, "saved-key.json"));
      await resume.getByLabel("Passphrase", { exact: false }).first().fill(custodyPassphrase);
      await click(resume, "Reopen selected file");
      const fileReceipt = await downloadJson(
        resume,
        "Save check receipt",
        dir,
        "fresh-file-check.json",
      );
      await selectJson(resume, "Saved-file receipt", fileReceipt);
      await selectJson(resume, "Secret-paper receipt", paperReceipt);
      await click(resume, "Verify both receipts");
      await resume
        .getByRole("textbox", { name: "Full public fingerprint", exact: false })
        .fill(publicKit.public.fingerprint);
      await resume.getByRole("switch", { name: /I checked the actual paper/ }).check();
      await click(resume, "Confirm custody");
      await resume
        .getByRole("textbox", { name: "Public record reference", exact: false })
        .fill("master page 1");
      await resume.getByRole("switch", { name: /I consulted the current original/ }).check();
      await resume.getByRole("switch", { name: /I confirm no former machine/ }).check();
      await click(resume, "Confirm reservation");
      await click(resume, "S000001");
      await resume.getByRole("switch", { name: /I marked this assignment consumed/ }).check();
      await click(resume, "Sign consumed assignment");
      const input = (await downloadJson(
        resume,
        "Save public allocation",
        dir,
        "public-input.json",
      )) as {
        allocation: {
          reservationEvidence: {
            block: SignedPaperValue<PaperBlock>;
            consumption: SignedPaperValue<PaperConsumption>;
          };
        };
      };
      const { block, consumption } = input.allocation.reservationEvidence;
      expect(await downloadJson(resume, "Save signed block", dir, "block.json")).toEqual(block);
      expect(block.payload.allocations).toEqual(request.candidates);
      const publicKey = createPublicKey(publicKit.public.publicKey);
      expect(
        verify(
          null,
          paperBlockBytes(block.payload),
          publicKey,
          Buffer.from(block.signature, "base64url"),
        ),
      ).toBe(true);
      expect(
        verify(
          null,
          paperConsumptionBytes(consumption.payload),
          publicKey,
          Buffer.from(consumption.signature, "base64url"),
        ),
      ).toBe(true);
      expect(JSON.stringify(input)).not.toMatch(/pkcs8|ciphertext|passphrase|secret-paper/);
      expect(
        await resume.evaluate(
          () => (window as unknown as { custodyEffects: string[] }).custodyEffects,
        ),
      ).toEqual([]);
      expect(effects).toEqual([]);
      expect(consoleMessages.filter((line) => !line.includes("Lit is in dev mode"))).toEqual([]);
      await click(resume, "Close and clear");
      expect(await resume.locator("#custody-print").count()).toBe(0);
    } finally {
      await browser.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("the saved tool's policy refuses native connections, external resources, workers, forms and base changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "waitron-custody-csp-")),
    out = join(dir, "tool.html");
  try {
    const result = spawnSync(process.execPath, ["scripts/build-custodian.mjs", "--out", out], {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const network: string[] = [];
      await page.route(/^https?:/, (route) => {
        network.push(route.request().url());
        return route.abort();
      });
      await page.goto(pathToFileURL(out).href);
      const controls = await page.evaluate(async () => {
        const violations: string[] = [];
        Object.assign(window, { violations });
        document.addEventListener("securitypolicyviolation", (event) => {
          violations.push(event.violatedDirective);
        });
        let fetchRefused = false;
        try {
          await fetch("https://example.invalid/native-probe");
        } catch {
          fetchRefused = true;
        }
        const workerRefused = await new Promise<boolean>((resolve) => {
          const url = URL.createObjectURL(
            new Blob(["postMessage('unexpected')"], { type: "text/javascript" }),
          );
          try {
            const worker = new Worker(url);
            worker.onerror = (event) => {
              event.preventDefault();
              worker.terminate();
              URL.revokeObjectURL(url);
              resolve(true);
            };
            worker.onmessage = () => {
              worker.terminate();
              URL.revokeObjectURL(url);
              resolve(false);
            };
          } catch {
            URL.revokeObjectURL(url);
            resolve(true);
          }
        });
        const base = document.createElement("base");
        base.href = "https://example.invalid/base/";
        document.head.append(base);
        const script = document.createElement("script");
        script.src = "https://example.invalid/remote.js";
        document.head.append(script);
        const style = document.createElement("link");
        style.rel = "stylesheet";
        style.href = "https://example.invalid/remote.css";
        document.head.append(style);
        const form = document.createElement("form");
        form.action = "https://example.invalid/form";
        document.body.append(form);
        form.submit();
        return { fetchRefused, workerRefused, base: document.baseURI };
      });
      await page.waitForFunction(() =>
        (window as unknown as { violations: string[] }).violations.includes("form-action"),
      );
      const violations = await page.evaluate(
        () => (window as unknown as { violations: string[] }).violations,
      );
      expect(controls).toEqual({
        fetchRefused: true,
        workerRefused: true,
        base: pathToFileURL(out).href,
      });
      expect(violations).toEqual(
        expect.arrayContaining([
          "connect-src",
          "worker-src",
          "base-uri",
          "script-src-elem",
          "style-src-elem",
          "form-action",
        ]),
      );
      expect(network).toEqual([]);
    } finally {
      await browser.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
