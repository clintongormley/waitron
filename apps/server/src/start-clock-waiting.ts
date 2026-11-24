import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  AGREEMENT_MS,
  measureDeviceReading,
  type ClockMoment,
  type KeptClockConfirmation,
} from "@waitron/module";
import { createTurns } from "./backup-turns.js";
import { bootReader, type BootReading } from "./boot-reader.js";
import { MAX_PACK_PDF, RecoveryPackFileError } from "@waitron/recovery-pack/src/pack-file.js";
import { AppError, FALLBACK_LOCALE, type SupportedLocale } from "@waitron/shared";
import "./errors.js";
import { pageReturnPath } from "./waiting-page.js";
import { escapeHtml, renderDocument } from "./html-page.js";
import { START_CLOCK_WAITING_WORDS } from "./i18n/start-clock-waiting.js";
import { resolveLoginLocale } from "./login-locale.js";
import { sentFromThisOrigin } from "./own-page.js";
import { requestFromBox } from "./request-from-box.js";
import { wrongMasterKey } from "./operation-authentication.js";
import { matchesStagedNodeKey, readStagedMasterKeyName } from "./restore-request.js";
import { requestIdMiddleware } from "./request-id.js";
import type { Logger } from "./logger.js";
import type { SetupClockSetter } from "./setup-clock-set.js";

const CHALLENGES = 64;
const RETRY_AFTER_SECONDS = "60";

export interface StartClockWaitingOptions {
  /** The state folder holding the staged authority key every clock route's master key is checked
   * against. */
  stateDir: string;
  /** The restore page's setter (`createSetupClockSet`), so a step is noted and alerted as there. */
  setBoxClock: SetupClockSetter;
  log?: Logger;
  /** The box's clocks; the steady one must be the one the series check reads (`performance.now`). */
  clock?: { wall: () => number; monotonic: () => number };
  requestFromBox?: (c: Context) => boolean;
  /** Absent, the box's own boot reading. */
  readBoot?: () => BootReading;
  /** When the minute the restore chose was issued; a device earlier than it sets nothing, as on
   * the restore page, since the series step would then refuse `minute_not_later`. */
  earliestMs?: () => number | undefined;
}

export interface StartClockWaiting {
  app: Hono;
  /** The latest agreeing time a key holder confirmed, with the box's boot reading then. */
  confirmation(): KeptClockConfirmation | null;
  /** Forgets `kept` if it is still the latest confirmation; a later one stays. */
  dropConfirmation(kept: KeptClockConfirmation): void;
}

/**
 * What the box's usual address answers while a restore's start waits to confirm its time: the
 * waiting page for every page, `server.waiting_for_clock` for everything else, and the clock
 * routes, which take nothing from a request without the master key whose authority key is staged
 * (a chosen recovery pack PDF is answered with its master key only when it is that key).
 */
export function createStartClockWaiting(options: StartClockWaitingOptions): StartClockWaiting {
  const wall = options.clock?.wall ?? Date.now;
  const monotonic = options.clock?.monotonic ?? (() => performance.now());
  const fromBox = options.requestFromBox ?? ((c: Context) => requestFromBox(c));
  const readBoot = options.readBoot ?? bootReader().readBoot;
  const challenges = new Map<string, ClockMoment>();
  let confirmation: KeptClockConfirmation | null = null;

  const app = new Hono();
  if (options.log) app.use("*", requestIdMiddleware(options.log, monotonic));
  const waitingAnswer = (c: Context) => {
    const err = new AppError("server.waiting_for_clock", { confirmed: confirmation !== null });
    c.set("refusalCode", err.code);
    return c.json({ error: { code: err.code, params: err.params } }, 503, {
      "Cache-Control": "no-store",
      "Retry-After": RETRY_AFTER_SECONDS,
    });
  };

  const refuse = (c: Context, err: AppError) => {
    c.set("refusalCode", err.code);
    return c.json({ error: { code: err.code, params: err.params } }, 403);
  };
  const refuseOrigin = (c: Context) => refuse(c, new AppError("restore.clock_origin_refused", {}));
  /** A wrong key, naming the key staging recorded for the backup when it recorded one. */
  const refuseKey = async (c: Context) =>
    refuse(c, wrongMasterKey(await readStagedMasterKeyName(options.stateDir)));
  /** Each clock route: refused from another site's page or without the key, otherwise `answer`
   * with the body and its time. */
  const keyed = (
    path: string,
    answer: (c: Context, sent: Record<string, unknown>, received: ClockMoment) => Promise<Response>,
  ) =>
    app.post(path, bodyLimit({ maxSize: 1024 }), async (c) => {
      const received = { wall: wall(), monotonic: monotonic() };
      const body: unknown = await c.req.json().catch(() => null);
      const sent =
        typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
      c.header("Cache-Control", "no-store");
      if (!sentFromThisOrigin(c)) return refuseOrigin(c);
      if (!(await matchesStagedNodeKey(options.stateDir, sent.key))) return refuseKey(c);
      return answer(c, sent, received);
    });

  /** The recovery pack PDF the page's person chose: its master key when it is the staged one, so
   * the page fills the field with it, or what is wrong with the file. One PDF is taken and read at
   * a time; a waiting sender's body stays unread until its turn. */
  const packTurns = createTurns();
  app.post("/restore-clock/pack", async (c) => {
    c.header("Cache-Control", "no-store");
    if (!sentFromThisOrigin(c)) return refuseOrigin(c);
    const tooLarge = () => c.json({ result: "not_a_pack" }, 413);
    if (Number(c.req.header("content-length") ?? 0) > MAX_PACK_PDF) return tooLarge();
    const read = packTurns(async () => {
      const bytes = await readUpTo(c.req.raw.body, MAX_PACK_PDF);
      if (bytes === null) return null;
      const { readRecoveryPackPdf } = await packReader();
      return readRecoveryPackPdf(bytes);
    });
    let masterKey: string | null;
    let heldBy: number | null;
    try {
      const pack = await read;
      if (pack === null) return tooLarge();
      ({ masterKey, masterKeyHeldBy: heldBy } = pack);
    } catch (error) {
      const notAPack =
        error instanceof RecoveryPackFileError &&
        (error.reason === "not_a_pack" || error.reason === "size");
      return c.json({ result: notAPack ? "not_a_pack" : "damaged" });
    }
    if (masterKey === null) return c.json({ result: "elsewhere", heldBy });
    if (!(await matchesStagedNodeKey(options.stateDir, masterKey))) return refuseKey(c);
    return c.json({ key: masterKey });
  });

  /** This device's time against the challenge it names, which answers once. */
  const measure = (c: Context, sent: Record<string, unknown>, received: ClockMoment) => {
    const id = typeof sent.challengeId === "string" ? sent.challengeId : undefined;
    const issued = id === undefined ? undefined : challenges.get(id);
    if (issued !== undefined) challenges.delete(id!);
    const instantMs = typeof sent.instantMs === "number" ? sent.instantMs : NaN;
    const reading = measureDeviceReading(issued, instantMs, received, fromBox(c));
    if (reading.result === "unavailable") return { reading, reason: reading.reason } as const;
    // As the series check judges it: the device's time stood for the middle of the round trip.
    const midpointMs = reading.wallFinishedMs - reading.uncertaintyMs;
    const offsetMs = reading.instantMs - midpointMs;
    const times = { deviceMs: reading.instantMs, serverMs: received.wall };
    return { reading, midpointMs, offsetMs, times, agrees: Math.abs(offsetMs) <= AGREEMENT_MS };
  };

  keyed("/restore-clock/challenge", async (c, _sent, received) => {
    if (challenges.size === CHALLENGES) challenges.delete(challenges.keys().next().value!);
    const id = randomUUID();
    challenges.set(id, received);
    return c.json({ id });
  });
  keyed("/restore-clock/compare", async (c, sent, received) => {
    const m = measure(c, sent, received);
    if ("reason" in m) return c.json({ result: m.reason });
    return c.json({ result: m.agrees ? "agrees" : "differs", ...m.times });
  });
  keyed("/restore-clock/confirm", async (c, sent, received) => {
    const m = measure(c, sent, received);
    if ("reason" in m) return c.json({ result: m.reason });
    if (!m.agrees) return c.json({ result: "differs", ...m.times });
    const boot = readBoot();
    confirmation = {
      reading: m.reading,
      boot: { bootId: boot.id, uptimeMs: boot.ms, wallMs: received.wall },
    };
    return c.json({ result: "confirmed", ...m.times });
  });
  keyed("/restore-clock/set", async (c, sent, received) => {
    const m = measure(c, sent, received);
    if ("reason" in m) return c.json({ status: "refused", reason: m.reason });
    const { reading, midpointMs } = m;
    const earliestMs = options.earliestMs?.();
    if (earliestMs !== undefined && reading.instantMs < earliestMs)
      return c.json({ status: "refused", reason: "later" });
    const request = {
      offsetMs: Math.round(m.offsetMs),
      agreesWithinMs: AGREEMENT_MS,
      measuredAt: {
        wallMs: midpointMs,
        monoMs: reading.monotonicFinishedMs - reading.uncertaintyMs,
      },
      reading: {
        boxAt: new Date(Math.round(midpointMs)).toISOString(),
        witnessAt: new Date(reading.instantMs).toISOString(),
        uncertaintyMs: Math.ceil(reading.uncertaintyMs),
      },
    };
    // The restore page's person: nobody, its key standing for the administrator.
    return c.json(await options.setBoxClock(request, () => Promise.resolve(null)));
  });

  app.all("*", (c) => {
    const page =
      (c.req.method === "GET" || c.req.method === "HEAD") &&
      !c.req.path.startsWith("/api/") &&
      (c.req.header("Accept") ?? "").includes("text/html");
    if (!page) return waitingAnswer(c);
    const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
    return c.html(
      renderWaitingPage(
        locale,
        pageReturnPath(new URL(c.req.url).pathname + new URL(c.req.url).search),
      ),
      503,
      {
        "Cache-Control": "no-store",
        "Retry-After": RETRY_AFTER_SECONDS,
        Vary: "Accept-Language",
      },
    );
  });

  return {
    app,
    confirmation: () => confirmation,
    dropConfirmation: (kept) => {
      if (confirmation === kept) confirmation = null;
    },
  };
}

let packReaderLoad:
  Promise<typeof import("@waitron/recovery-pack/src/read-pack-pdf.js")> | undefined;
/** The pack reader, loaded on first use: pdf-lib is needed only while a restore waits for its
 * time. */
function packReader() {
  packReaderLoad ??= import("@waitron/recovery-pack/src/read-pack-pdf.js");
  return packReaderLoad;
}

/** The whole body, or null once it passes `limit` bytes, read no further. */
async function readUpTo(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array | null> {
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const pieces: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    pieces.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const piece of pieces) {
    bytes.set(piece, offset);
    offset += piece.byteLength;
  }
  return bytes;
}

function renderWaitingPage(locale: SupportedLocale, destination: string): string {
  const words = START_CLOCK_WAITING_WORDS[locale];
  const packLines = {
    notPack: words.notPack,
    damaged: words.damaged,
    failed: words.packFailed,
    elsewhere: words.elsewhere,
    elsewhereOn: words.elsewhereOn,
    keyRefused: words.keyRefused,
    wrongKey: words.wrongKey,
  };
  const say = (id: string, text: string) => `<p id="${id}" data-say hidden>${escapeHtml(text)}</p>`;
  return renderDocument(
    locale,
    words.title,
    `<p>${escapeHtml(words.why)}</p>
<form id="clock-key">
<p><label for="clock-key-field">${escapeHtml(words.keyLabel)} *</label></p>
<p><input type="password" id="clock-key-field" name="master-key" autocomplete="off" required aria-describedby="clock-key-error"></p>
<p id="clock-key-error" hidden>${escapeHtml(words.keyRefused)}</p>
<p><label for="clock-pack">${escapeHtml(words.packButton)}</label></p>
<p><input type="file" id="clock-pack" accept="application/pdf,.pdf" aria-describedby="clock-pack-error"></p>
<p id="clock-pack-error" hidden></p>
<p><button type="submit">${escapeHtml(words.keyContinue)}</button></p>
</form>
<div id="clock-step" hidden>
<p>${escapeHtml(words.waitingForClock)}</p>
<p>${escapeHtml(words.deviceTime)} <strong id="clock-device"></strong><br>
${escapeHtml(words.serverTime)} <strong id="clock-server"></strong></p>
<p><button type="button" id="clock-confirm">${escapeHtml(words.confirm)}</button>
<button type="button" id="clock-this-device">${escapeHtml(words.thisDevice)}</button></p>
<div role="status">${say("clock-confirmed", words.confirmed)}${say("clock-same_machine", words.onBox)}${say("clock-set-refused", words.setRefused)}</div>
</div>
<script>
(() => {
  const destination = ${JSON.stringify(destination).replaceAll("<", "\\u003c")};
  const packLines = ${JSON.stringify(packLines).replaceAll("<", "\\u003c")};
  const $ = (id) => document.getElementById(id);
  const field = $("clock-key-field");
  const show = (id) => {
    for (const line of document.querySelectorAll("[data-say]")) line.hidden = line.id !== id;
  };
  const when = (ms) =>
    new Date(ms).toLocaleString(document.documentElement.lang, {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  const post = async (path, body) =>
    (
      await fetch("/restore-clock/" + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: field.value, ...body }),
      })
    ).json();
  // A refusal names the backup's master key when the box staged its name.
  const keyLine = (refusal) => {
    const keyName = refusal?.error?.params?.keyName;
    $("clock-key-error").textContent =
      typeof keyName === "string"
        ? packLines.wrongKey.replace("{keyName}", keyName)
        : packLines.keyRefused;
    $("clock-key-error").hidden = refusal === null;
    field.toggleAttribute("aria-invalid", refusal !== null);
  };
  // This device's time against a fresh challenge; a refused key shows the key's refusal.
  const timed = async (path) => {
    const challenge = await post("challenge", {});
    const refused = typeof challenge.id !== "string";
    keyLine(refused ? challenge : null);
    if (refused) return null;
    return post(path, { challengeId: challenge.id, instantMs: Date.now() });
  };
  const compare = async () => {
    const answer = await timed("compare");
    if (answer === null) return;
    $("clock-step").hidden = false;
    if (answer.result === "same_machine") show("clock-same_machine");
    if (answer.deviceMs === undefined) return;
    $("clock-device").textContent = when(answer.deviceMs);
    $("clock-server").textContent = when(answer.serverMs);
  };
  const quietly = (run) => () => run().catch(() => {});
  const pack = $("clock-pack");
  const packLine = (text) => {
    $("clock-pack-error").textContent = text ?? "";
    $("clock-pack-error").hidden = text === null;
    pack.toggleAttribute("aria-invalid", text !== null);
  };
  // Each PDF chosen and each key typed or sent is a new attempt; a PDF's answer is used only while
  // its choice is still the latest attempt.
  let attempt = 0;
  field.addEventListener("input", () => (attempt += 1));
  // The chosen PDF is read on the box; the master key it answers is used as if typed.
  pack.addEventListener("change", quietly(async () => {
    const file = pack.files[0];
    if (file === undefined) return;
    const mine = (attempt += 1);
    let answer;
    try {
      const response = await fetch("/restore-clock/pack", {
        method: "POST",
        headers: { "content-type": "application/pdf" },
        body: file,
      });
      answer = await response.json();
    } catch {
      answer = { result: "failed" };
    } finally {
      pack.value = "";
    }
    if (mine !== attempt) return;
    if (typeof answer.key === "string") {
      packLine(null);
      field.value = answer.key;
      return compare();
    }
    if (answer.error !== undefined) {
      packLine(null);
      field.value = "";
      return keyLine(answer);
    }
    packLine(
      answer.result === "elsewhere"
        ? answer.heldBy === null
          ? packLines.elsewhere
          : packLines.elsewhereOn.replace("{heldBy}", String(answer.heldBy))
        : answer.result === "damaged"
          ? packLines.damaged
          : answer.result === "failed"
            ? packLines.failed
            : packLines.notPack,
    );
  }));
  $("clock-key").addEventListener("submit", (event) => {
    event.preventDefault();
    attempt += 1;
    packLine(null);
    void quietly(compare)();
  });
  const confirm = async () => {
    const answer = await timed("confirm");
    if (answer?.result === "confirmed") return show("clock-confirmed");
    show(null);
    await compare();
  };
  $("clock-confirm").addEventListener("click", quietly(confirm));
  // Choosing this device's time is the confirmation, measured against the clock just set.
  $("clock-this-device").addEventListener("click", quietly(async () => {
    const answer = await timed("set");
    if (answer?.status === "set") return confirm();
    show(answer === null ? null : "clock-set-refused");
    await compare();
  }));
  // Any answer but the waiting one means the wait is over. A look that fails, or stalls past its
  // deadline, is tried again at the next turn. A refused try drops the confirmation, which the
  // waiting answer says: ask again then.
  const look = async () => {
    const stop = new AbortController();
    const deadline = setTimeout(() => stop.abort(), 5000);
    try {
      const response = await fetch(destination, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: stop.signal,
      });
      const text = await response.text();
      let answer = null;
      try {
        answer = JSON.parse(text);
      } catch {}
      if (answer?.error?.code !== "server.waiting_for_clock") {
        field.value = "";
        return location.replace(destination);
      }
      if (answer.error.params?.confirmed === false && !$("clock-confirmed").hidden) {
        show(null);
        void quietly(compare)();
      }
    } catch {
    } finally {
      clearTimeout(deadline);
    }
    setTimeout(look, 5000);
  };
  setTimeout(look, 5000);
})();
</script>
`,
  );
}
