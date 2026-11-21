import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModuleClockSetAnswer, ModuleClockSetRequest } from "@waitron/module";
import { encodeRecoveryKey } from "@waitron/fiscal-verifactu/src/recovery-key-code.js";
import { escapeHtml } from "./html-page.js";
import { START_CLOCK_WAITING_WORDS } from "./i18n/start-clock-waiting.js";
import { attachmentPath } from "./restore-flow.js";
import type { SetupClockPerson } from "./setup-clock-set.js";
import { createStartClockWaiting, type StartClockWaitingOptions } from "./start-clock-waiting.js";

const BOX_MS = Date.parse("2026-11-13T10:00:00.000Z");
// The secret the printed key decodes to: what the restore page stages.
const KEY = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A state folder holding `key` as the staged node recovery key, or none when `key` is null. */
async function stateWith(key: string | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-start-clock-waiting-"));
  dirs.push(dir);
  if (key !== null) {
    const path = attachmentPath(dir, "node-key");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, key);
  }
  return dir;
}

interface SetCall {
  request: ModuleClockSetRequest;
  person: SetupClockPerson;
}

async function waiting(
  options: Partial<StartClockWaitingOptions> & {
    fromBox?: boolean;
    staged?: string | null;
    setAnswer?: ModuleClockSetAnswer;
  } = {},
) {
  const clock = { wall: BOX_MS, monotonic: 1_000 };
  const sets: SetCall[] = [];
  const { fromBox = false, staged = KEY, setAnswer = { status: "set" }, ...rest } = options;
  const subject = createStartClockWaiting({
    stateDir: await stateWith(staged),
    clock: { wall: () => clock.wall, monotonic: () => clock.monotonic },
    requestFromBox: () => fromBox,
    readBoot: () => ({ id: "boot-1", ms: 40_000 }),
    setBoxClock: async (request, person) => {
      sets.push({ request, person: await person() });
      return setAnswer;
    },
    ...rest,
  });
  const post = (path: string, body: unknown) =>
    subject.app.request(`/restore-clock/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const challenge = async (key: unknown = KEY): Promise<string> => {
    const res = await post("challenge", { key });
    expect(res.status).toBe(200);
    return ((await res.json()) as { id: string }).id;
  };
  /** Sends this device's time against `challengeId` to `path`, with the key. */
  const send = (path: string, challengeId: unknown, instantMs: unknown, key: unknown = KEY) =>
    post(path, { key, challengeId, instantMs });
  /** Moves both of the box's clocks on together, as time passing does. */
  const pass = (ms: number) => {
    clock.wall += ms;
    clock.monotonic += ms;
  };
  return { ...subject, clock, sets, post, challenge, send, pass };
}

const html = { accept: "text/html,application/xhtml+xml" };
const refused = { error: { code: "promotion.break_glass_invalid", params: {} } };

describe("the restore's waiting app: pages", () => {
  it.each(["/", "/devices", "/till/anything"])(
    "answers %s with the waiting page in English, asking for the key",
    async (path) => {
      const { app } = await waiting();
      const res = await app.request(path, { headers: { ...html, "accept-language": "en-GB" } });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("60");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-type")).toMatch(/^text\/html/);
      const body = await res.text();
      expect(body).toContain(`<html lang="en-GB">`);
      expect(body).toContain(
        "<h1>The server is restoring your backup and is waiting to confirm its time.</h1>",
      );
      expect(body).toContain(
        escapeHtml(
          "So that no invoice series is ever repeated, it creates its new series only once its time is confirmed. It carries on by itself once it can check its time over the internet, or once its time is confirmed on the page where the restore was started. If that page is closed, enter the backup's server key below to confirm the time from this device.",
        ),
      );
      expect(body).toContain(escapeHtml("Selected backup’s server key"));
      expect(body).toMatch(/<input [^>]*type="password"[^>]*name="node-recovery-key"/);
    },
  );

  it("answers in Spanish to a Spanish browser", async () => {
    const { app } = await waiting();
    const res = await app.request("/", { headers: { ...html, "accept-language": "es" } });
    expect(res.status).toBe(503);
    expect(res.headers.get("vary")).toContain("Accept-Language");
    const body = await res.text();
    expect(body).toContain(`<html lang="es-ES">`);
    const words = START_CLOCK_WAITING_WORDS["es-ES"];
    expect(body).toContain(`<h1>${escapeHtml(words.title)}</h1>`);
    expect(body).toContain(escapeHtml(words.why));
    expect(body).toContain(escapeHtml(words.keyLabel));
    expect(body).toContain(escapeHtml(words.confirm));
  });

  it.each([
    ["GET", "/api/device/equipment", html],
    ["GET", "/setup-api/status", {}],
    ["POST", "/api/payments", html],
    ["GET", "/", { accept: "application/json" }],
    ["POST", "/restore-clock/reading", {}],
  ] as const)("answers %s %s with server.waiting_for_clock", async (method, path, headers) => {
    const log = vi.fn();
    const { app } = await waiting({ log });
    const res = await app.request(path, { method, headers });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.json()).toEqual({
      error: { code: "server.waiting_for_clock", params: { confirmed: false } },
    });
    expect(log).toHaveBeenCalledWith(
      "warn",
      "http.request",
      expect.objectContaining({
        errorCode: "server.waiting_for_clock",
        requestId: res.headers.get("x-request-id"),
      }),
    );
  });

  it("says whether it holds a kept confirmation: none, kept, then dropped", async () => {
    const w = await waiting();
    const confirmed = async () => {
      const res = await w.app.request("/api/device/equipment");
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { params: { confirmed: boolean } } };
      return body.error.params.confirmed;
    };
    expect(await confirmed()).toBe(false);
    await w.send("confirm", await w.challenge(), BOX_MS);
    expect(await confirmed()).toBe(true);
    w.dropConfirmation(w.confirmation()!);
    expect(await confirmed()).toBe(false);
  });
});

describe("the restore's waiting app: the node recovery key", () => {
  it.each(["challenge", "compare", "confirm", "set"])(
    "/restore-clock/%s refuses a missing or wrong key, keeping and setting nothing",
    async (path) => {
      const log = vi.fn();
      const w = await waiting({ log });
      const id = await w.challenge();
      for (const key of [
        undefined,
        "",
        "   ",
        "not-the-key",
        `${KEY}x`,
        KEY.slice(0, -1),
        42,
        null,
      ]) {
        const res = await w.post(path, { key, challengeId: id, instantMs: BOX_MS });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual(refused);
      }
      expect(log).toHaveBeenLastCalledWith(
        "warn",
        "http.request",
        expect.objectContaining({
          errorCode: "promotion.break_glass_invalid",
        }),
      );
      expect(w.confirmation()).toBeNull();
      expect(w.sets).toEqual([]);
    },
  );

  const origin = "http://localhost";
  it.each([
    ["challenge", { origin: "https://elsewhere.example" }],
    ["compare", { origin: "https://elsewhere.example" }],
    ["confirm", { "sec-fetch-site": "cross-site" }],
    ["set", { "sec-fetch-site": "same-site" }],
    ["set", { origin: "null" }],
    ["challenge", { origin: "" }],
  ])(
    "/restore-clock/%s refuses the right key from another site's page (%o)",
    async (path, headers) => {
      const log = vi.fn();
      const w = await waiting({ log });
      const id = await w.challenge();
      const res = await w.app.request(`/restore-clock/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ key: KEY, challengeId: id, instantMs: BOX_MS }),
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: { code: "restore.clock_origin_refused", params: {} },
      });
      expect(log).toHaveBeenLastCalledWith(
        "warn",
        "http.request",
        expect.objectContaining({
          errorCode: "restore.clock_origin_refused",
        }),
      );
      expect(w.confirmation()).toBeNull();
      expect(w.sets).toEqual([]);
    },
  );

  it.each([
    ["this page's origin", { origin, "sec-fetch-site": "same-origin" }],
    ["no Origin or Sec-Fetch-Site, as a request no browser page sent", {}],
    ["a request the person typed", { "sec-fetch-site": "none" }],
  ])("serves the right key from %s (control)", async (_name, headers) => {
    const w = await waiting();
    const res = await w.app.request(`${origin}/restore-clock/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ key: KEY }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: expect.any(String) });
  });

  it("refuses the right key when no key is staged", async () => {
    const w = await waiting({ staged: null });
    expect((await w.post("challenge", { key: KEY })).status).toBe(403);
  });

  it("refuses the right key when the staged key cannot be read", async () => {
    const stateDir = await stateWith(null);
    // A folder where the key file should be: opened, but not a file.
    await mkdir(attachmentPath(stateDir, "node-key"), { recursive: true });
    const w = await waiting({ stateDir });
    expect((await w.post("challenge", { key: KEY })).status).toBe(403);
  });

  it("refuses a body that is not JSON", async () => {
    const w = await waiting();
    const res = await w.app.request("/restore-clock/challenge", { method: "POST", body: "{" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(refused);
  });

  it.each(["challenge", "compare", "confirm", "set"])(
    "/restore-clock/%s refuses a body over a kilobyte",
    async (path) => {
      const w = await waiting();
      const res = await w.post(path, { key: KEY, padding: "x".repeat(1_024) });
      expect(res.status).toBe(413);
      expect(w.sets).toEqual([]);
    },
  );
});

describe("the restore's waiting app: the key as printed on the recovery pack", () => {
  const PRINTED = encodeRecoveryKey(KEY);

  it.each([
    ["as printed", PRINTED],
    ["in lower case", PRINTED.toLowerCase()],
    ["without spaces", PRINTED.replaceAll(" ", "")],
    ["with extra spaces", `  ${PRINTED.replaceAll(" ", "   ")} `],
    ["as the decoded secret the done screen sends", KEY],
  ])("/restore-clock/challenge serves the staged key typed %s", async (_name, key) => {
    const w = await waiting();
    const res = await w.post("challenge", { key });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: expect.any(String) });
  });

  it("refuses another venue's printed key and a mistyped one", async () => {
    const w = await waiting();
    const symbols = PRINTED.replaceAll(" ", "");
    const swapped = symbols[0] === "Z" ? "Y" : "Z";
    for (const key of [
      encodeRecoveryKey("ZyXwVuTsRqPoNmLkJiHgFeDcBa987654"),
      swapped + symbols.slice(1),
      symbols.slice(0, -1),
    ]) {
      const res = await w.post("challenge", { key });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(refused);
    }
  });
});

describe("the restore's waiting app: with the key", () => {
  it("a challenge answers only its id, never the box's time", async () => {
    const w = await waiting();
    const res = await w.post("challenge", { key: KEY });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["id"]);
    expect(body.id).toEqual(expect.any(String));
  });

  it("compare answers both times and keeps nothing", async () => {
    const w = await waiting();
    const id = await w.challenge();
    w.pass(2_000);
    const res = await w.send("compare", id, BOX_MS - 120_000);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      result: "differs",
      deviceMs: BOX_MS - 120_000,
      serverMs: BOX_MS + 2_000,
    });
    expect(w.confirmation()).toBeNull();
  });

  it("confirm within 5 seconds that agrees is kept with the box's boot reading", async () => {
    const w = await waiting();
    const id = await w.challenge();
    w.pass(2_000);
    const res = await w.send("confirm", id, BOX_MS + 12_000);
    expect(await res.json()).toEqual({
      result: "confirmed",
      deviceMs: BOX_MS + 12_000,
      serverMs: BOX_MS + 2_000,
    });
    expect(w.confirmation()).toEqual({
      reading: {
        result: "usable",
        instantMs: BOX_MS + 12_000,
        uncertaintyMs: 1_000,
        wallStartedMs: BOX_MS,
        wallFinishedMs: BOX_MS + 2_000,
        monotonicStartedMs: 1_000,
        monotonicFinishedMs: 3_000,
      },
      boot: { bootId: "boot-1", uptimeMs: 40_000, wallMs: BOX_MS + 2_000 },
    });
  });

  it("keeps the confirmation however long the start takes to ask for it", async () => {
    const w = await waiting();
    await w.send("confirm", await w.challenge(), BOX_MS);
    w.pass(3_600_000);
    expect(w.confirmation()).toMatchObject({ reading: { instantMs: BOX_MS } });
  });

  it("judges agreement as the series check does: the device's time at the middle of the round trip", async () => {
    // Sent 2 s after the challenge, so the device's time stood for the box's time 1 s earlier.
    const at = async (instantMs: number) => {
      const w = await waiting();
      const id = await w.challenge();
      w.pass(2_000);
      return ((await (await w.send("confirm", id, instantMs)).json()) as { result: string }).result;
    };
    expect(await at(BOX_MS + 1_000 + 30_000)).toBe("confirmed");
    expect(await at(BOX_MS + 1_000 + 30_001)).toBe("differs");
    expect(await at(BOX_MS + 1_000 - 30_000)).toBe("confirmed");
    expect(await at(BOX_MS + 1_000 - 30_001)).toBe("differs");
  });

  it("a confirm that differs keeps nothing and says differs, leaving an earlier one kept", async () => {
    const w = await waiting();
    await w.send("confirm", await w.challenge(), BOX_MS);
    const kept = w.confirmation();
    const res = await w.send("confirm", await w.challenge(), BOX_MS - 120_000);
    expect(await res.json()).toEqual({
      result: "differs",
      deviceMs: BOX_MS - 120_000,
      serverMs: BOX_MS,
    });
    expect(w.confirmation()).toBe(kept);
  });

  it("a confirm that differs, with nothing kept before, keeps nothing", async () => {
    const w = await waiting();
    await w.send("confirm", await w.challenge(), BOX_MS - 120_000);
    expect(w.confirmation()).toBeNull();
  });

  it("keeps nothing for a confirm sent more than 5 seconds after its challenge", async () => {
    const w = await waiting();
    const id = await w.challenge();
    w.pass(5_001);
    const res = await w.send("confirm", id, BOX_MS + 5_001);
    expect(await res.json()).toEqual({ result: "challenge" });
    expect(w.confirmation()).toBeNull();
  });

  it("keeps a confirm sent 5 seconds after its challenge (control)", async () => {
    const w = await waiting();
    const id = await w.challenge();
    w.pass(5_000);
    await w.send("confirm", id, BOX_MS + 5_000);
    expect(w.confirmation()).not.toBeNull();
  });

  it("keeps nothing for a confirm from the box's own screen", async () => {
    const w = await waiting({ fromBox: true });
    const res = await w.send("confirm", await w.challenge(), BOX_MS);
    expect(await res.json()).toEqual({ result: "same_machine" });
    expect(w.confirmation()).toBeNull();
  });

  it("a challenge answers one time only", async () => {
    const w = await waiting();
    const id = await w.challenge();
    await w.send("compare", id, BOX_MS);
    expect(await (await w.send("confirm", id, BOX_MS)).json()).toEqual({ result: "challenge" });
    expect(w.confirmation()).toBeNull();
  });

  it.each([
    ["no challenge", undefined, BOX_MS],
    ["an unknown challenge", "not-a-challenge", BOX_MS],
    ["a fractional time", "own", BOX_MS + 0.5],
    ["a time that is not a number", "own", "soon"],
  ])("keeps nothing for %s", async (_, challengeId, instantMs) => {
    const w = await waiting();
    const id = await w.challenge();
    const res = await w.send("confirm", challengeId === "own" ? id : challengeId, instantMs);
    expect(await res.json()).toEqual({ result: "challenge" });
    expect(w.confirmation()).toBeNull();
  });

  it("holds at most 64 challenges: a 65th drops the first", async () => {
    const w = await waiting();
    const first = await w.challenge();
    const second = await w.challenge();
    for (let i = 0; i < 63; i += 1) await w.challenge();
    expect(await (await w.send("compare", first, BOX_MS)).json()).toEqual({ result: "challenge" });
    expect(await (await w.send("compare", second, BOX_MS)).json()).toMatchObject({
      result: "agrees",
    });
  });

  it("set hands the setter the measured offset, for nobody, and answers its answer", async () => {
    const w = await waiting({ setAnswer: { status: "refused", reason: "later" } });
    const id = await w.challenge();
    w.pass(2_000);
    const res = await w.send("set", id, BOX_MS + 1_000 + 600_000);
    expect(await res.json()).toEqual({ status: "refused", reason: "later" });
    expect(w.sets).toEqual([
      {
        request: {
          offsetMs: 600_000,
          agreesWithinMs: 30_000,
          measuredAt: { wallMs: BOX_MS + 1_000, monoMs: 2_000 },
          reading: {
            boxAt: new Date(BOX_MS + 1_000).toISOString(),
            witnessAt: new Date(BOX_MS + 601_000).toISOString(),
            uncertaintyMs: 1_000,
          },
        },
        person: null,
      },
    ]);
    expect(w.confirmation()).toBeNull();
  });

  it("a set that steps the box's clock, then a confirm against a fresh challenge, keeps a confirmation", async () => {
    const log = vi.fn();
    const w = await waiting({
      log,
      setBoxClock: (request) => {
        w.clock.wall += request.offsetMs;
        w.clock.monotonic += 7;
        return Promise.resolve({ status: "set" });
      },
    });
    const deviceMs = BOX_MS + 600_000;
    expect(await (await w.send("set", await w.challenge(), deviceMs)).json()).toEqual({
      status: "set",
    });
    expect(log).toHaveBeenLastCalledWith(
      "debug",
      "http.request",
      expect.objectContaining({
        routePath: "/restore-clock/set",
        durationMs: 7,
      }),
    );
    expect(w.confirmation()).toBeNull();
    const res = await w.send("confirm", await w.challenge(), deviceMs);
    expect(await res.json()).toMatchObject({ result: "confirmed" });
    expect(w.confirmation()).toMatchObject({
      reading: { instantMs: deviceMs },
      boot: { bootId: "boot-1", wallMs: deviceMs },
    });
  });

  it("set refuses a device time earlier than the chosen minute, as the restore page does, reaching no setter", async () => {
    const chosenMs = BOX_MS + 60_000;
    const w = await waiting({ earliestMs: () => chosenMs });
    const res = await w.send("set", await w.challenge(), chosenMs - 1);
    expect(await res.json()).toEqual({ status: "refused", reason: "later" });
    expect(w.sets).toEqual([]);
    const atChosen = await w.send("set", await w.challenge(), chosenMs);
    expect(await atChosen.json()).toEqual({ status: "set" });
    expect(w.sets).toHaveLength(1);
  });

  it("set reaches the setter for any device time while no minute is chosen", async () => {
    const w = await waiting({ earliestMs: () => undefined });
    await w.send("set", await w.challenge(), BOX_MS - 600_000);
    expect(w.sets).toHaveLength(1);
  });

  it("set answers the setter's success", async () => {
    const w = await waiting();
    const res = await w.send("set", await w.challenge(), BOX_MS);
    expect(await res.json()).toEqual({ status: "set" });
    expect(w.sets).toHaveLength(1);
  });

  it.each([
    ["the box's own screen", true, 0, "same_machine"],
    ["a time sent past 5 seconds", false, 5_001, "challenge"],
  ] as const)("set from %s reaches no setter", async (_, fromBox, late, reason) => {
    const w = await waiting({ fromBox });
    const id = await w.challenge();
    w.pass(late);
    const res = await w.send("set", id, BOX_MS);
    expect(await res.json()).toEqual({ status: "refused", reason });
    expect(w.sets).toEqual([]);
  });

  it("measures by the process's own clocks and boot when none is given", async () => {
    const subject = createStartClockWaiting({
      stateDir: await stateWith(KEY),
      requestFromBox: () => false,
      setBoxClock: () => Promise.resolve({ status: "set" }),
    });
    const post = (path: string, body: unknown) =>
      subject.app.request(`/restore-clock/${path}`, { method: "POST", body: JSON.stringify(body) });
    const { id } = (await (await post("challenge", { key: KEY })).json()) as { id: string };
    const answer = await post("confirm", { key: KEY, challengeId: id, instantMs: Date.now() });
    expect(await answer.json()).toMatchObject({ result: "confirmed" });
    const kept = subject.confirmation();
    expect(kept?.reading.result).toBe("usable");
    if (kept?.reading.result === "usable")
      expect(Math.abs(kept.reading.monotonicFinishedMs - performance.now())).toBeLessThan(1_000);
    expect(Math.abs(kept!.boot.wallMs - Date.now())).toBeLessThan(1_000);
  });

  it("takes the request's source from requestFromBox when no check is given", async () => {
    // `app.request` has no socket, which requestFromBox counts as the box's own.
    const subject = createStartClockWaiting({
      stateDir: await stateWith(KEY),
      setBoxClock: () => Promise.resolve({ status: "set" }),
    });
    const post = (path: string, body: unknown) =>
      subject.app.request(`/restore-clock/${path}`, { method: "POST", body: JSON.stringify(body) });
    const { id } = (await (await post("challenge", { key: KEY })).json()) as { id: string };
    const answer = await post("confirm", { key: KEY, challengeId: id, instantMs: Date.now() });
    expect(await answer.json()).toEqual({ result: "same_machine" });
  });
});
