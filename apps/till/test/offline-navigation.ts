import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "playwright";
import type { BrowserCommand } from "vitest/node";

type Scenario = "reconnect" | "retire";

export const probeOfflineNavigation: BrowserCommand<
  [worker: string, retired: string, path: string, scenario: Scenario, locale?: string]
> = async (context, worker, retired, path, scenario, locale = "en-GB") => {
  let state = "live";
  let script = worker;
  const server = createServer((request, response) => {
    if (state === "offline") {
      request.socket.destroy();
      return;
    }
    const url = new URL(request.url!, "http://localhost");
    response.setHeader("Cache-Control", "no-cache");
    if (url.pathname === "/till/offline-worker.js") {
      response.writeHead(script ? 200 : 404, { "Content-Type": "text/javascript" });
      response.end(script);
      return;
    }
    if (url.pathname === "/till/tabs/redirect") {
      response.writeHead(302, { Location: "/primary" }).end();
      return;
    }
    response.writeHead(state === "upgrade" ? 503 : 200, { "Content-Type": "text/html" });
    response.end(
      `<h1>${state === "upgrade" ? "Upgrading" : url.pathname === "/primary" ? "Primary" : state}</h1>`,
    );
  });
  const runner = (context as unknown as { page: Page }).page;
  const browser = await runner.context().browser()!.newContext({ locale });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const subject = await browser.newPage();
    subject.setDefaultTimeout(8_000);
    subject.setDefaultNavigationTimeout(8_000);
    const entry = origin + path;
    await subject.goto(entry);
    await subject.evaluate(async () => {
      try {
        await navigator.serviceWorker.register("/till/offline-worker.js");
        await navigator.serviceWorker.ready;
      } catch {
        // A missing worker should reach the same offline navigation check.
      }
    });
    if (scenario === "retire") {
      await subject.reload();
      const controlled = await subject.evaluate(() => {
        document.body.dataset["original"] = "yes";
        return Boolean(navigator.serviceWorker.controller);
      });
      if (!controlled) return { controlled };
      script = retired;
      await subject.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration())?.update();
      });
      await subject.waitForFunction(async () => !(await navigator.serviceWorker.getRegistration()));
      const sameDocument = (await subject.locator("body").getAttribute("data-original")) === "yes";
      await subject.close();
      const reopened = await browser.newPage();
      await reopened.goto(entry);
      const registrations = await reopened.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      );
      return { controlled, sameDocument, registrations };
    }

    state = "offline";
    try {
      await subject.reload();
    } catch (error) {
      if (!String(error).includes("net::ERR_")) throw error;
      return { heading: null };
    }
    const heading = await subject.locator("h1").textContent();
    const paragraphs = await subject.locator("main > p").allTextContents();
    const link = subject.getByRole("link");
    const instructions = await link.getAttribute("href");
    const target = await link.getAttribute("target");
    const rel = await link.getAttribute("rel");
    const caches = await subject.evaluate(() => window.caches.keys());

    state = "upgrade";
    await subject.waitForResponse(
      (response) => response.url() === entry.split("#")[0] && response.status() === 503,
    );
    const duringUpgrade = await subject.locator("h1").textContent();
    state = "updated";
    await subject.getByRole("heading", { name: "updated" }).waitFor();
    const recovered = subject.url() === entry;

    state = "upgrade";
    const refused = (await subject.reload())?.status();
    state = "updated";
    await subject.goto(origin + "/till/tabs/redirect");
    return {
      heading,
      paragraphs,
      instructions,
      target,
      rel,
      caches,
      duringUpgrade,
      recovered,
      refused,
      redirect: subject.url().slice(origin.length),
    };
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
};
