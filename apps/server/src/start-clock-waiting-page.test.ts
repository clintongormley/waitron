import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import type { ModuleClockSetAnswer, ModuleClockSetRequest } from "@waitron/module";
import { encodeRecoveryKey } from "@waitron/fiscal-verifactu/src/recovery-key-code.js";
import { START_CLOCK_WAITING_WORDS } from "./i18n/start-clock-waiting.js";
import { attachmentPath } from "./restore-flow.js";
import { createStartClockWaiting } from "./start-clock-waiting.js";

// The secret the printed key decodes to: what the restore page stages.
const KEY = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
let browser: Browser | undefined;
let stateDir: string;
beforeAll(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-start-clock-page-"));
  const path = attachmentPath(stateDir, "node-key");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, KEY);
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  await rm(stateDir, { recursive: true, force: true });
});

const DAY_MS = 86_400_000;
// Both clocks start from noon on a fixed day, so a run that crosses midnight shows the same dates.
const NOON_MS = Date.parse("2026-11-13T12:00:00.000Z");

/** Opens the waiting page, every request answered by the app; the box runs `aheadMs` fast. */
async function open(
  page: Page,
  aheadMs: number,
  options: { fromBox?: boolean; setAnswer?: ModuleClockSetAnswer; setMovesClock?: boolean } = {},
) {
  const started = Date.now();
  const sets: ModuleClockSetRequest[] = [];
  /** `finished`: the wait has ended and the full server answers. `stallLooks`: the page's looks at
   * `/` are never answered. */
  const control = { finished: false, stallLooks: false, stalled: 0 };
  let ahead = aheadMs;
  const subject = createStartClockWaiting({
    stateDir,
    clock: {
      wall: () => NOON_MS + ahead + (Date.now() - started),
      monotonic: () => performance.now(),
    },
    requestFromBox: () => options.fromBox ?? false,
    readBoot: () => ({ id: "boot-1", ms: 1_000 }),
    setBoxClock: (request) => {
      sets.push(request);
      const answer = options.setAnswer ?? { status: "set" };
      // As the host's clock service does: a set step moves the box's clock by the offset.
      if (answer.status === "set" && options.setMovesClock !== false) ahead += request.offsetMs;
      return Promise.resolve(answer);
    },
  });
  await page.route("http://waitron.local:8080/**", async (route) => {
    const request = route.request();
    if (control.finished)
      return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Trading</h1>" });
    if (control.stallLooks && !request.isNavigationRequest() && request.method() === "GET") {
      control.stalled += 1;
      return;
    }
    const res = await subject.app.request(request.url(), {
      method: request.method(),
      headers: request.headers(),
      ...(request.method() === "POST" ? { body: request.postData() ?? "" } : {}),
    });
    await route.fulfill({
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body: await res.text(),
    });
  });
  // What the key field held as the page was left, kept across the navigation.
  await page.addInitScript(() =>
    addEventListener("pagehide", () => {
      const field = document.getElementById("clock-key-field") as HTMLInputElement | null;
      if (field !== null) sessionStorage.setItem("key-at-leaving", field.value);
    }),
  );
  await page.clock.install({ time: NOON_MS });
  await page.goto("http://waitron.local:8080/till/");
  return { ...subject, sets, control };
}

async function enterKey(page: Page, key: string) {
  await page.getByLabel(words.keyLabel).fill(key);
  await page.getByRole("button", { name: words.keyContinue }).click();
}

/** The date as the page writes it, in the page's language and this machine's time zone. */
const dateIn = (locale: string, ms: number) =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(ms);

const words = START_CLOCK_WAITING_WORDS["en-GB"];

async function withPage(locale: string, run: (page: Page) => Promise<void>) {
  const page = await browser!.newPage({ locale });
  try {
    await run(page);
  } finally {
    await page.close();
  }
}

it("shows nothing of the clock until the key is entered, and refuses a wrong key beside its field", () =>
  withPage("en-GB", async (page) => {
    await open(page, 0);
    expect(await page.locator("#clock-step").isVisible()).toBe(false);
    expect(await page.locator("#clock-key-error").isVisible()).toBe(false);
    await enterKey(page, "not-the-key");
    await expect.poll(() => page.locator("#clock-key-error").isVisible()).toBe(true);
    expect(await page.locator("#clock-key-error").innerText()).toBe(words.keyRefused);
    expect(await page.getByLabel(words.keyLabel).getAttribute("aria-invalid")).toBe("");
    expect(await page.locator("#clock-step").isVisible()).toBe(false);
  }));

it("with the key, shows the done screen's step with both times and their dates", () =>
  withPage("en-GB", async (page) => {
    await open(page, 0);
    await enterKey(page, "not-the-key");
    await expect.poll(() => page.locator("#clock-key-error").isVisible()).toBe(true);
    await enterKey(page, KEY);
    await expect.poll(() => page.locator("#clock-step").isVisible()).toBe(true);
    expect(await page.locator("#clock-key-error").isVisible()).toBe(false);
    expect(await page.getByLabel(words.keyLabel).getAttribute("aria-invalid")).toBeNull();
    expect(await page.locator("#clock-step").innerText()).toContain(words.waitingForClock);
    const today = dateIn("en-GB", NOON_MS);
    await expect.poll(() => page.locator("#clock-device").innerText()).toContain(today);
    expect(await page.locator("#clock-server").innerText()).toMatch(
      new RegExp(`${today}.*\\d\\d:\\d\\d:\\d\\d$`),
    );
    expect(await page.getByRole("button", { name: words.confirm }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: words.thisDevice }).isVisible()).toBe(true);
  }));

it("takes the server key as printed on the recovery pack, typed in lower case", () =>
  withPage("en-GB", async (page) => {
    await open(page, 0);
    await enterKey(page, encodeRecoveryKey(KEY).toLowerCase());
    await expect.poll(() => page.locator("#clock-step").isVisible()).toBe(true);
    expect(await page.locator("#clock-key-error").isVisible()).toBe(false);
  }));

it("shows the dates with the times, so a box a day out shows a day apart, in Spanish", () =>
  withPage("es-ES", async (page) => {
    await open(page, DAY_MS);
    await page.getByLabel(START_CLOCK_WAITING_WORDS["es-ES"].keyLabel).fill(KEY);
    await page
      .getByRole("button", { name: START_CLOCK_WAITING_WORDS["es-ES"].keyContinue })
      .click();
    await expect
      .poll(() => page.locator("#clock-server").innerText())
      .toContain(dateIn("es-ES", NOON_MS + DAY_MS));
    expect(await page.locator("#clock-device").innerText()).toContain(dateIn("es-ES", NOON_MS));
  }));

it("Confirm the time keeps an agreeing time and says so", () =>
  withPage("en-GB", async (page) => {
    const box = await open(page, 0);
    await enterKey(page, KEY);
    await expect.poll(() => page.locator("#clock-step").isVisible()).toBe(true);
    await page.getByRole("button", { name: words.confirm }).click();
    await expect.poll(() => page.locator("#clock-confirmed").isVisible()).toBe(true);
    expect(await page.locator('[role="status"] #clock-confirmed').count()).toBe(1);
    expect(await page.locator('[role="status"] #clock-device').count()).toBe(0);
    expect(box.confirmation()?.boot.bootId).toBe("boot-1");
  }));

it("asks again once the server no longer holds the confirmation, as after a refused try", () =>
  withPage("en-GB", async (page) => {
    const box = await open(page, 0);
    await enterKey(page, KEY);
    await expect.poll(() => page.locator("#clock-step").isVisible()).toBe(true);
    await page.getByRole("button", { name: words.confirm }).click();
    await expect.poll(() => page.locator("#clock-confirmed").isVisible()).toBe(true);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    for (const look of [1, 2]) {
      const reply = page.waitForResponse((response) => new URL(response.url()).pathname === "/");
      await page.clock.runFor(5_000);
      await (await reply).finished();
      await expect.poll(() => requests.filter((path) => path === "/").length).toBe(look);
    }
    expect(await page.locator("#clock-confirmed").isVisible()).toBe(true);
    expect(requests.filter((path) => path.endsWith("/compare"))).toEqual([]);
    box.dropConfirmation(box.confirmation()!);
    await page.clock.runFor(5_000);
    await expect.poll(() => page.locator("#clock-confirmed").isVisible()).toBe(false);
    await expect.poll(() => requests.filter((path) => path.endsWith("/compare")).length).toBe(1);
    expect(await page.locator("#clock-step").isVisible()).toBe(true);
  }));

it("Confirm the time keeps nothing while the times differ (control)", () =>
  withPage("en-GB", async (page) => {
    const box = await open(page, DAY_MS);
    await enterKey(page, KEY);
    await expect.poll(() => page.locator("#clock-step").isVisible()).toBe(true);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.getByRole("button", { name: words.confirm }).click();
    await expect.poll(() => requests.filter((path) => path.endsWith("/compare")).length).toBe(1);
    expect(await page.locator("#clock-confirmed").isVisible()).toBe(false);
    expect(box.confirmation()).toBeNull();
  }));

it("This device sends this device's time to the setter, then confirms the time it set", () =>
  withPage("en-GB", async (page) => {
    const box = await open(page, DAY_MS);
    await enterKey(page, KEY);
    await expect.poll(() => page.locator("#clock-step").isVisible()).toBe(true);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.getByRole("button", { name: words.thisDevice }).click();
    await expect.poll(() => page.locator("#clock-confirmed").isVisible()).toBe(true);
    expect(box.sets).toHaveLength(1);
    expect(Math.abs(box.sets[0]!.offsetMs + DAY_MS)).toBeLessThan(5_000);
    expect(requests.filter((path) => path.startsWith("/restore-clock/"))).toEqual([
      "/restore-clock/challenge",
      "/restore-clock/set",
      "/restore-clock/challenge",
      "/restore-clock/confirm",
    ]);
    expect(box.confirmation()?.boot.bootId).toBe("boot-1");
    expect(await page.locator("#clock-set-refused").isVisible()).toBe(false);
  }));

it("This device keeps nothing when the clock it set still differs (control)", () =>
  withPage("en-GB", async (page) => {
    const box = await open(page, DAY_MS, { setMovesClock: false });
    await enterKey(page, KEY);
    await expect.poll(() => page.locator("#clock-step").isVisible()).toBe(true);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.getByRole("button", { name: words.thisDevice }).click();
    await expect.poll(() => requests.filter((path) => path.endsWith("/compare")).length).toBe(1);
    expect(requests).toContain("/restore-clock/confirm");
    expect(await page.locator("#clock-confirmed").isVisible()).toBe(false);
    expect(await page.locator("#clock-set-refused").isVisible()).toBe(false);
    expect(box.confirmation()).toBeNull();
  }));

it("says so when the server could not set its clock from this device", () =>
  withPage("en-GB", async (page) => {
    await open(page, DAY_MS, { setAnswer: { status: "refused", reason: "later" } });
    await enterKey(page, KEY);
    await expect.poll(() => page.locator("#clock-step").isVisible()).toBe(true);
    await page.getByRole("button", { name: words.thisDevice }).click();
    await expect.poll(() => page.locator("#clock-set-refused").isVisible()).toBe(true);
    expect(await page.locator("#clock-set-refused").innerText()).toBe(words.setRefused);
  }));

it("on the box's own screen says its time does not count", () =>
  withPage("es-ES", async (page) => {
    await open(page, 0, { fromBox: true });
    const es = START_CLOCK_WAITING_WORDS["es-ES"];
    await page.getByLabel(es.keyLabel).fill(KEY);
    await page.getByRole("button", { name: es.keyContinue }).click();
    await expect.poll(() => page.locator("#clock-same_machine").isVisible()).toBe(true);
    expect(await page.locator("#clock-same_machine").innerText()).toBe(es.onBox);
    expect(await page.locator("#clock-device").innerText()).toBe("");
  }));

/** The page has left for the server's `/`, its key field emptied first. */
async function leftWithKeyCleared(page: Page) {
  await expect.poll(() => page.locator("h1").innerText()).toBe("Trading");
  expect(new URL(page.url()).pathname).toBe("/");
  expect(await page.evaluate(() => sessionStorage.getItem("key-at-leaving"))).toBe("");
}

it("leaves for the server once the wait ends without a confirmation, as when its time service synchronises", () =>
  withPage("en-GB", async (page) => {
    const box = await open(page, 0);
    await enterKey(page, KEY);
    await expect.poll(() => page.locator("#clock-step").isVisible()).toBe(true);
    const looks: string[] = [];
    page.on("request", (request) => looks.push(new URL(request.url()).pathname));
    await page.clock.runFor(5_000);
    await expect.poll(() => looks.filter((path) => path === "/").length).toBe(1);
    expect(await page.locator("#clock-step").isVisible()).toBe(true);
    box.control.finished = true;
    await page.clock.runFor(5_000);
    await leftWithKeyCleared(page);
  }));

it("leaves for the server once the wait ends after a confirmation", () =>
  withPage("en-GB", async (page) => {
    const box = await open(page, 0);
    await enterKey(page, KEY);
    await expect.poll(() => page.locator("#clock-step").isVisible()).toBe(true);
    await page.getByRole("button", { name: words.confirm }).click();
    await expect.poll(() => page.locator("#clock-confirmed").isVisible()).toBe(true);
    box.control.finished = true;
    await page.clock.runFor(5_000);
    await leftWithKeyCleared(page);
  }));

it("gives up on a look that stalls and looks again, so a request hung across the restart ends nothing", () =>
  withPage("en-GB", async (page) => {
    const box = await open(page, 0);
    box.control.stallLooks = true;
    await page.clock.runFor(5_000);
    await expect.poll(() => box.control.stalled).toBe(1);
    box.control.stallLooks = false;
    box.control.finished = true;
    // The stalled look's deadline, then the next look.
    await page.clock.runFor(5_000);
    await page.clock.runFor(5_000);
    await expect.poll(() => page.locator("h1").innerText()).toBe("Trading");
  }));
