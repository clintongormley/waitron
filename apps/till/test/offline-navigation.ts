import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright";
import type { BrowserCommand } from "vitest/node";

const waitPageHeaders = {
  "clock confirmation": "X-Waitron-Waiting",
  "standing down": "X-Waitron-Standing-Down",
} as const;
export type WaitPage = keyof typeof waitPageHeaders | "Primary";
type Scenario = "reconnect" | "retire" | WaitPage;

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
    if (state === "Primary" && url.pathname !== "/primary") {
      const port = (server.address() as AddressInfo).port;
      response.writeHead(302, { Location: `http://localhost:${port}/primary` }).end();
      return;
    }
    if (url.pathname === "/till/tabs/redirect") {
      response.writeHead(302, { Location: "/primary" }).end();
      return;
    }
    if (state === "recovery") {
      response.writeHead(404, { "Content-Type": "text/plain" }).end("404 Not Found");
      return;
    }
    if (state === "clock confirmation" || state === "standing down") {
      response.setHeader(waitPageHeaders[state], "1");
    }
    const status =
      state === "upgrade" || state === "clock confirmation" || state === "standing down"
        ? 503
        : 200;
    response.writeHead(status, { "Content-Type": "text/html" });
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
      const deadline = performance.now() + 8_000;
      while (
        await subject.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()))
      ) {
        if (performance.now() >= deadline) throw new Error("The retired worker stayed registered");
        await delay(50);
      }
      const sameDocument = (await subject.locator("body").getAttribute("data-original")) === "yes";
      await subject.close();
      const reopened = await browser.newPage();
      await reopened.goto(entry, { timeout: 8_000 });
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
    if (scenario !== "reconnect") {
      state = scenario;
      await subject.getByRole("heading", { name: scenario }).waitFor();
      return { path: new URL(subject.url()).pathname, hostname: new URL(subject.url()).hostname };
    }
    const heading = await subject.locator("h1").textContent();
    const paragraphs = await subject.locator("main > p").allTextContents();
    const link = await subject.getByRole("link").evaluate((element) => {
      const anchor = element as HTMLAnchorElement;
      return { instructions: anchor.href, target: anchor.target, rel: anchor.rel };
    });
    const caches = await subject.evaluate(() => window.caches.keys());

    const waitForReply = (status: number) =>
      subject.waitForResponse(
        (response) => response.url() === entry.split("#")[0] && response.status() === status,
      );
    state = "recovery";
    await waitForReply(404);
    state = "upgrade";
    await waitForReply(503);
    const duringUpgrade = await subject.locator("h1").textContent();
    state = "updated";
    await subject.getByRole("heading", { name: "updated" }).waitFor();
    const recovered = subject.url() === entry;
    await subject.goto(origin + "/primary");
    state = "new build";
    await subject.goBack();
    const history = await subject.locator("h1").textContent();

    state = "upgrade";
    const refused = (await subject.reload())?.status();
    state = "updated";
    await subject.goto(origin + "/till/tabs/redirect");
    return {
      heading,
      paragraphs,
      ...link,
      caches,
      duringUpgrade,
      recovered,
      history,
      refused,
      redirect: subject.url().slice(origin.length),
    };
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
};
