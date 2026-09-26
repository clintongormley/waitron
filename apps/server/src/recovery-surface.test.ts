import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { AppError } from "@waitron/shared";
import { VENUE_HOLDER_KINDS } from "@waitron/db";
import { createErrorBoundary } from "@waitron/server-kit";
import "./errors.js";
import { createRotatingFileSink, tee } from "./log-file.js";
import { createLogger } from "./logger.js";
import { FRESH, afterFailure, type RecoveryState } from "./recovery-state.js";
import { GENERIC_TEXT, OPERATOR_TEXT, escapeHtml, recoveryApp } from "./recovery-surface.js";

const state = afterFailure(
  afterFailure(afterFailure(FRESH, "module.config_invalid", new Date()), "x", new Date()),
  "module.config_invalid",
  new Date(),
);

describe("recoveryApp", () => {
  it("states the count and the last error on the page", async () => {
    const app = recoveryApp({
      state,
      logDir: await mkdtemp(join(tmpdir(), "wt-log-")),
      onRetry: vi.fn(),
    });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("module.config_invalid");
    // NOT `toContain("3")`: the page also renders an ISO timestamp, which contains a 3 most of the
    // time, so that would pass with the count omitted entirely.
    expect(body).toMatch(/failed 3 times|3 consecutive/i);
  });

  it("serves exactly the same facts as JSON — no extra field leaks", async () => {
    const app = recoveryApp({
      state,
      logDir: await mkdtemp(join(tmpdir(), "wt-log-")),
      onRetry: vi.fn(),
    });
    const res = await app.request("/recovery-api/status");
    // toEqual, not toMatchObject: an unlisted key is never checked, and this unauthenticated
    // route must not leak a log path or a raw error message.
    expect(await res.json()).toEqual({
      failures: 3,
      level: "recovery",
      lastErrorCode: "module.config_invalid",
      lastFailureAt: state.lastFailureAt,
    });
  });

  it("retry resets the counter and asks for a normal boot", async () => {
    const onRetry = vi.fn(() => Promise.resolve());
    const app = recoveryApp({
      state,
      logDir: await mkdtemp(join(tmpdir(), "wt-log-")),
      onRetry,
    });
    expect((await app.request("/recovery-api/retry", { method: "POST" })).status).toBe(200);
    expect(onRetry).toHaveBeenCalledWith("normal");
  });

  it("shows the log tail, and tolerates no log at all", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "wt-log-"));
    await writeFile(join(logDir, "waitron.log"), "line-one\nline-two\n");
    const app = recoveryApp({ state, logDir, onRetry: vi.fn() });
    expect(await (await app.request("/")).text()).toContain("line-two");
    const empty = recoveryApp({
      state,
      logDir: await mkdtemp(join(tmpdir(), "wt-log-")),
      onRetry: vi.fn(),
    });
    expect((await empty.request("/")).status).toBe(200);
  });

  it("escapes an attacker-influenceable error code into the page — not raw HTML", async () => {
    const xssState: RecoveryState = {
      failures: 1,
      level: "normal",
      lastErrorCode: `<script>alert(1)</script>"'&`,
      lastFailureAt: new Date().toISOString(),
      clears: 0,
    };
    const app = recoveryApp({
      state: xssState,
      logDir: await mkdtemp(join(tmpdir(), "wt-log-")),
      onRetry: vi.fn(),
    });
    const body = await (await app.request("/")).text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;");
  });

  it("escapes an attacker-influenceable log line into the page — not raw HTML", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "wt-log-"));
    await writeFile(join(logDir, "waitron.log"), `<img src=x onerror="alert(1)">\n`);
    const app = recoveryApp({ state, logDir, onRetry: vi.fn() });
    const body = await (await app.request("/")).text();
    expect(body).not.toContain('<img src=x onerror="alert(1)">');
    expect(body).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

/**
 * The real error boundary, logger, sink and page. The boundary logs an `AppError`'s params into the
 * file the page tails, so what keeps a secret off this page is the convention that params never
 * carry one (`apps/server/src/errors.ts`), not the page.
 */
describe("the log tail as a second channel out of the image", () => {
  it("renders an AppError's params, escaped, after the real error boundary logs them", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "wt-log-"));
    const log = createLogger(
      createRotatingFileSink({ dir: logDir, maxBytes: 1_000_000, maxFiles: 2 }),
      () => new Date(),
    );
    const run = createErrorBoundary({ "server.config_invalid": 400 }, "probe.failed");
    const api = new Hono();
    api.get("/boom", (c) =>
      run(c, log, () => {
        // Not a secret: the point is the channel, which a secret param would travel too.
        throw new AppError("server.config_invalid", {
          variable: "WAITRON_PROBE",
          reason: "<param-from-outside-the-image>",
        });
      }),
    );
    expect((await api.request("/boom")).status).toBe(400);

    const body = await (await recoveryApp({ state, logDir, onRetry: vi.fn() }).request("/")).text();
    expect(body).toContain("WAITRON_PROBE");
    // Present on the page, and escaped — both halves matter. Escaped-only would pass with the tail
    // omitted entirely; present-only would pass with the tail rendered as raw HTML.
    expect(body).toContain("&lt;param-from-outside-the-image&gt;");
    expect(body).not.toContain("<param-from-outside-the-image>");

    // The control, in the other direction: the same state with no log to tail carries neither, so
    // the assertions above are reading the TAIL and not some other part of the page.
    const withoutLog = await (
      await recoveryApp({ state, logDir: "/nonexistent", onRetry: vi.fn() }).request("/")
    ).text();
    expect(withoutLog).not.toContain("WAITRON_PROBE");
  });
});

/**
 * One logger feeds both stdout and the `waitron.log` this page tails (`boot.ts`), so a caught
 * error's own words logged by any module reach the page. The file sink is what redacts.
 */
describe("the caught error's own words on the page", () => {
  it("masks a URL password logged by any module, and keeps the installer's stdout copy", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "wt-log-"));
    const stdout: string[] = [];
    // Wired exactly as `boot.ts` wires the process logger: one logger, tee'd to stdout and to the
    // real rotating file sink in a real directory.
    const log = createLogger(
      tee(
        (line) => stdout.push(line),
        createRotatingFileSink({ dir: logDir, maxBytes: 1_000_000, maxFiles: 2 }),
      ),
      () => new Date(),
    );
    log("warn", "mail.send_failed", {
      message: "connect ECONNREFUSED smtp://mailer:hunter2@smtp.example:587",
    });

    const body = await (await recoveryApp({ state, logDir, onRetry: vi.fn() }).request("/")).text();
    expect(body).not.toContain("hunter2");
    // The control, in the other direction: the line IS on the page, masked. Without it the
    // assertion above would pass against a page that renders no tail at all.
    expect(body).toContain("mail.send_failed");
    expect(body).toContain("smtp://mailer:***@smtp.example:587");
    // Stdout is the installer's channel and keeps the line whole: masked, a wrong password and no
    // password would look the same.
    expect(stdout.join("")).toContain("hunter2");
  });
});

// The Spanish twin of "never wipe".
const NEVER_WIPE_ES = /\bborra|\bborrar|\belimina|\brestablece|\bresetea|\bformatea|\bvacía/i;

/** The page as an operator sees it, for one recorded failure code. */
async function pageResponse(
  lastErrorCode: string | null,
  options: { holderKind?: RecoveryState["holderKind"]; acceptLanguage?: string } = {},
): Promise<Response> {
  const { holderKind, acceptLanguage } = options;
  const app = recoveryApp({
    state: {
      failures: 3,
      level: "recovery",
      lastErrorCode,
      lastFailureAt: new Date().toISOString(),
      clears: 0,
      ...(holderKind === undefined ? {} : { holderKind }),
    },
    logDir: "/nonexistent",
    onRetry: vi.fn(),
  });
  return await app.request(
    "/",
    acceptLanguage === undefined ? {} : { headers: { "Accept-Language": acceptLanguage } },
  );
}

async function pageFor(
  lastErrorCode: string | null,
  holderKind?: RecoveryState["holderKind"],
  acceptLanguage?: string,
): Promise<string> {
  return await (
    await pageResponse(lastErrorCode, {
      ...(holderKind === undefined ? {} : { holderKind }),
      ...(acceptLanguage === undefined ? {} : { acceptLanguage }),
    })
  ).text();
}

const SPANISH = "es-ES,es;q=0.9";
const LOCALES = [
  ["en-GB", "en-GB"],
  ["es-ES", SPANISH],
] as const;

// Fixed on purpose: a table read here would pass a page that renders the wrong row of it.
const ENGLISH_CHROME = [
  "<title>Waitron did not start</title>",
  "<h1>Waitron did not start</h1>",
  "Retry a normal boot",
  "For whoever installed this box",
  "Log tail",
  "Level: recovery. Failed 3 times.",
  "(no log yet)",
];
const SPANISH_CHROME = [
  "<title>Waitron no ha arrancado</title>",
  "<h1>Waitron no ha arrancado</h1>",
  "Reintentar un arranque normal",
  "Para quien instaló este equipo",
  "Final del registro",
  "Nivel: recovery. Intentos fallidos: 3.",
  "(aún no hay registro)",
];

describe("the page's language", () => {
  const code = "migrations.set_missing";
  const english = OPERATOR_TEXT[code]!["en-GB"];
  const spanish = OPERATOR_TEXT[code]!["es-ES"];

  it("is Spanish, and only Spanish, when the browser prefers Spanish", async () => {
    const res = await pageResponse(code, { acceptLanguage: SPANISH });
    const body = await res.text();
    expect(body).toContain('<html lang="es-ES">');
    for (const line of SPANISH_CHROME) expect(body).toContain(line);
    expect(body).toContain(escapeHtml(spanish.title));
    expect(body).toContain(escapeHtml(spanish.action));
    for (const line of ENGLISH_CHROME) expect(body).not.toContain(line);
    expect(body).not.toContain(escapeHtml(english.title));
    expect(body).not.toContain(escapeHtml(english.action));
    expect(res.headers.get("Vary")).toBe("Accept-Language");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  for (const [label, acceptLanguage] of [
    ["an English browser", "en-GB"],
    ["no Accept-Language header", undefined],
    ["a language the page does not have", "fr-FR"],
    ["a malformed header", ";;q=zz,"],
  ] as const) {
    it(`is English, and only English, for ${label}`, async () => {
      const res = await pageResponse(code, acceptLanguage === undefined ? {} : { acceptLanguage });
      const body = await res.text();
      expect(body).toContain('<html lang="en-GB">');
      for (const line of ENGLISH_CHROME) expect(body).toContain(line);
      expect(body).toContain(escapeHtml(english.title));
      expect(body).toContain(escapeHtml(english.action));
      for (const line of SPANISH_CHROME) expect(body).not.toContain(line);
      expect(body).not.toContain(escapeHtml(spanish.title));
      expect(body).not.toContain(escapeHtml(spanish.action));
      expect(res.headers.get("Vary")).toBe("Accept-Language");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });
  }

  it("says none and never in the page's language when nothing has failed yet", async () => {
    const app = (acceptLanguage: string) =>
      recoveryApp({ state: FRESH, logDir: "/nonexistent", onRetry: vi.fn() }).request("/", {
        headers: { "Accept-Language": acceptLanguage },
      });
    expect(await (await app("en-GB")).text()).toContain("Last error: none at never");
    expect(await (await app(SPANISH)).text()).toContain("Último error: ninguno, fecha: nunca");
  });

  // The three strings from outside the image are shown as they came, in either language.
  it("leaves the code, the time and the log tail untranslated and escaped, in both languages", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "wt-log-"));
    await writeFile(join(logDir, "waitron.log"), `<img src=x onerror="alert(1)">\n`);
    const at = `2026-09-25T10:00:00.000Z<b>`;
    const app = recoveryApp({
      state: {
        failures: 2,
        level: "normal",
        lastErrorCode: `<script>"'&`,
        lastFailureAt: at,
        clears: 0,
      },
      logDir,
      onRetry: vi.fn(),
    });
    for (const [lang, acceptLanguage] of LOCALES) {
      const body = await (
        await app.request("/", { headers: { "Accept-Language": acceptLanguage } })
      ).text();
      expect(body).toContain(`<html lang="${lang}">`);
      expect(body).toContain("&lt;script&gt;&quot;&#39;&amp;");
      expect(body).not.toContain(`<script>"'&`);
      expect(body).toContain("2026-09-25T10:00:00.000Z&lt;b&gt;");
      expect(body).not.toContain("<b>");
      expect(body).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
      expect(body).not.toContain('<img src=x onerror="alert(1)">');
    }
  });
});

describe("curated operator text", () => {
  // Through `escapeHtml`: curated strings are escaped too, so an apostrophe renders as `&#39;`.
  it("renders the title and action for every code in the table, in each language", async () => {
    for (const [code, text] of Object.entries(OPERATOR_TEXT)) {
      for (const [lang, acceptLanguage] of LOCALES) {
        const body = await pageFor(code, undefined, acceptLanguage);
        expect(body, `${code} in ${lang}`).toContain(escapeHtml(text[lang].title));
        expect(body, `${code} in ${lang}`).toContain(escapeHtml(text[lang].action));
      }
    }
  });

  // A Spanish half copied from the English would render and pass every other case.
  it("has a Spanish title and action for every entry that differ from the English", () => {
    for (const [code, text] of [
      ...Object.entries(OPERATOR_TEXT),
      ["generic", GENERIC_TEXT] as const,
    ]) {
      expect(text["es-ES"].title, code).not.toBe(text["en-GB"].title);
      expect(text["es-ES"].action, code).not.toBe(text["en-GB"].action);
    }
  });

  it("tells the operator of an ahead database to restore or reinstall — never to wipe", async () => {
    const body = await pageFor("provisioning.database_ahead");
    expect(body).toMatch(/restore it from a backup, or reinstall/i);
    expect(body).not.toMatch(/\bwipe\b|\berase\b|\bdelete the database\b/i);
    const spanish = await pageFor("provisioning.database_ahead", undefined, SPANISH);
    expect(spanish).toMatch(/restáurala desde una copia de seguridad, o reinstala/i);
    expect(spanish).not.toMatch(NEVER_WIPE_ES);
  });

  it("never suggests wiping anything, in either language", () => {
    for (const [code, text] of [
      ...Object.entries(OPERATOR_TEXT),
      ["generic", GENERIC_TEXT] as const,
    ]) {
      expect(text["en-GB"].action, code).not.toMatch(/\bwipe\b|\berase\b|\bdelete\b|\breset\b/i);
      expect(text["es-ES"].action, code).not.toMatch(NEVER_WIPE_ES);
    }
  });

  // The reader has no terminal and often no backup, so a restore action must name who can help.
  it("points an operator with no backup at whoever installed the box", () => {
    const restoreActions = Object.entries(OPERATOR_TEXT).filter(([, text]) =>
      /restore it from a backup, or reinstall/i.test(text["en-GB"].action),
    );
    expect(restoreActions.length).toBeGreaterThan(0);
    for (const [code, text] of restoreActions) {
      expect(text["en-GB"].action, `${code} offers a restore with no fallback`).toMatch(
        /ask whoever installed this box/i,
      );
    }
  });

  it("points an operator with no backup at whoever installed the box, in Spanish", () => {
    const restoreActions = Object.entries(OPERATOR_TEXT).filter(([, text]) =>
      /restáurala desde una copia de seguridad, o reinstala/i.test(text["es-ES"].action),
    );
    expect(restoreActions.map(([code]) => code).sort()).toEqual(
      Object.entries(OPERATOR_TEXT)
        .filter(([, text]) => /restore it from a backup, or reinstall/i.test(text["en-GB"].action))
        .map(([code]) => code)
        .sort(),
    );
    for (const [code, text] of restoreActions) {
      expect(text["es-ES"].action, `${code} offers a restore with no fallback`).toMatch(
        /quien instaló este equipo/i,
      );
    }
  });

  // A hand-kept list, and NOT every code that can reach the page: a code with no entry falls to the
  // generic line. `deployment.environment_mismatch` is listed because the generic line fails it
  // worst (CLAUDE.md §5); `restore.membership_invalid` because the page's Retry reads the same copy
  // again, which the generic line does not say.
  it("has an entry for every code classifyBootFailure produces and each persisted code listed here", () => {
    const classified = [
      "provisioning.database_unreachable",
      "provisioning.schema_mismatch",
      "unknown",
    ];
    const persistedByRunEntry = [
      "server.config_missing",
      "provisioning.database_ahead",
      "restore.database_set_aside",
      "migrations.set_missing",
      "migrations.incomplete",
      "server.boot_incomplete",
      "provisioning.database_holder_stalled",
    ];
    const fromBootByHand = ["deployment.environment_mismatch", "restore.membership_invalid"];
    const missing = [...classified, ...persistedByRunEntry, ...fromBootByHand].filter(
      (code) => code !== "unknown" && !(code in OPERATOR_TEXT),
    );
    expect(missing).toEqual([]);
  });

  // Fixed strings, not the table: a page rendering another row would pass a comparison with it.
  it("names a restored copy whose list of machines fails its signature check, in both languages", async () => {
    const english = await pageFor("restore.membership_invalid");
    expect(english).toContain(
      "The list of machines in the restored copy does not carry a valid signature, so it may have been changed after it was saved.",
    );
    expect(english).toContain(
      "The box will not start from this copy. Ask whoever installed this box to look at it before anything else.",
    );
    const spanish = await pageFor("restore.membership_invalid", undefined, SPANISH);
    expect(spanish).toContain(
      "La lista de equipos de la copia restaurada no tiene una firma válida, así que puede haberse cambiado después de guardarse.",
    );
    expect(spanish).toContain(
      "El equipo no arrancará con esta copia. Antes de nada, pide a quien instaló este equipo que lo revise.",
    );
  });

  // A retry or restart can fix a volume that did not come up; nothing else at the box can.
  it("offers a database_unreachable both a retry and the person a restart cannot replace", () => {
    const text = OPERATOR_TEXT["provisioning.database_unreachable"];
    expect(text).toBeDefined();
    expect(text!["en-GB"].action).toMatch(/retry/i);
    expect(text!["en-GB"].action).toMatch(/ask whoever installed this box/i);
    expect(text!["es-ES"].action).toContain("«Reintentar un arranque normal»");
    expect(text!["es-ES"].action).toMatch(/reinicia el equipo/i);
    expect(text!["es-ES"].action).toMatch(/quien instaló este equipo/i);
  });

  // The Spanish action names the button by the label the Spanish page gives it.
  it("names the Spanish button by its Spanish label wherever a Spanish action says to press it", () => {
    const pressing = Object.entries(OPERATOR_TEXT).filter(([, text]) =>
      /\bpulsa\b/i.test(text["es-ES"].action),
    );
    expect(pressing.length).toBeGreaterThan(0);
    for (const [code, text] of pressing) {
      expect(text["es-ES"].action, code).toMatch(/pulsa «Reintentar un arranque normal»/i);
      expect(text["es-ES"].action, code).not.toContain("Retry");
    }
  });

  // A cold restore runs the migrations itself, so it can raise `migrations.incomplete`.
  it("does not answer a partly-updated database with the restore that can raise it", () => {
    const text = OPERATOR_TEXT["migrations.incomplete"];
    expect(text).toBeDefined();
    expect(text!["en-GB"].action).not.toMatch(/restore it from a backup, or reinstall/i);
    expect(text!["en-GB"].action).toMatch(/ask whoever installed this box/i);
    expect(text!["es-ES"].action).not.toMatch(
      /restáurala desde una copia de seguridad, o reinstala/i,
    );
    expect(text!["es-ES"].action).toMatch(/quien instaló este equipo/i);
  });

  // A failure reading or counting the recovery state is logged with its code alone.
  it("does not promise the generic failure's reason was written down anywhere", () => {
    expect(GENERIC_TEXT["en-GB"].action).not.toMatch(/read the reason/i);
    expect(GENERIC_TEXT["en-GB"].action).toMatch(/ask whoever installed this box/i);
    expect(GENERIC_TEXT["es-ES"].action).not.toMatch(/registro|motivo/i);
    expect(GENERIC_TEXT["es-ES"].action).toMatch(/quien instaló este equipo/i);
  });

  it("renders the generic line for a code it does not know, without throwing", async () => {
    for (const [lang, acceptLanguage] of LOCALES) {
      const body = await pageFor("some.code.invented.later", undefined, acceptLanguage);
      expect(body).toContain(escapeHtml(GENERIC_TEXT[lang].title));
      expect(body).toContain(escapeHtml(GENERIC_TEXT[lang].action));
    }
  });

  it("renders the generic line when no failure has been recorded at all", async () => {
    for (const [lang, acceptLanguage] of LOCALES) {
      const body = await pageFor(null, undefined, acceptLanguage);
      expect(body).toContain(escapeHtml(GENERIC_TEXT[lang].title));
    }
  });

  // The code comes from a file on the box; a plain lookup of "toString" finds an inherited
  // function.
  it("renders the generic line for an inherited property name, not a prototype value", async () => {
    for (const code of ["toString", "constructor", "__proto__", "valueOf"]) {
      for (const [lang, acceptLanguage] of LOCALES) {
        const body = await pageFor(code, undefined, acceptLanguage);
        expect(body).toContain(escapeHtml(GENERIC_TEXT[lang].title));
        expect(body).not.toContain("undefined");
      }
    }
  });
});

describe("a start refused by a holder that stopped", () => {
  const code = "provisioning.database_holder_stalled";
  const names: Record<string, [string, string]> = {
    server: ["the Waitron server", "el servidor de Waitron"],
    restore: ["a restore from a backup", "una restauración desde una copia de seguridad"],
    rejoin: ["a rejoin of this box to its venue", "la reincorporación de este equipo a su local"],
    provisioning: ["the Waitron setup command", "el comando de configuración de Waitron"],
    script: ["another Waitron program", "otro programa de Waitron"],
  };

  it("names each kind of holder in English on an English page", async () => {
    expect(Object.keys(names).sort()).toEqual([...VENUE_HOLDER_KINDS].sort());
    for (const kind of VENUE_HOLDER_KINDS) {
      const body = await pageFor(code, kind);
      const [english] = names[kind]!;
      expect(body).toContain(escapeHtml(`The box's database is held by ${english},`));
      for (const [other, [otherEnglish]] of Object.entries(names)) {
        if (other !== kind) expect(body).not.toContain(`held by ${otherEnglish},`);
      }
    }
  });

  it("names each kind of holder in Spanish on a Spanish page", async () => {
    for (const kind of VENUE_HOLDER_KINDS) {
      const body = await pageFor(code, kind, SPANISH);
      const [, spanish] = names[kind]!;
      expect(body).toContain(
        escapeHtml(`La base de datos de este equipo está ocupada por ${spanish},`),
      );
      for (const [other, [, otherSpanish]] of Object.entries(names)) {
        if (other !== kind) expect(body).not.toContain(`ocupada por ${otherSpanish},`);
      }
    }
  });

  it("names no particular program when no kind was recorded", async () => {
    expect(await pageFor(code)).toContain("held by another Waitron program,");
    expect(await pageFor(code, undefined, SPANISH)).toContain(
      "ocupada por otro programa de Waitron,",
    );
  });

  it("shows one language per page: no Spanish line on the English page, no English on the Spanish", async () => {
    const english = await pageFor(code, "server");
    expect(english).not.toContain("está ocupada por");
    expect(english).not.toContain("Espera dos minutos");
    expect(english).not.toContain('lang="es');
    const spanish = await pageFor(code, "server", SPANISH);
    expect(spanish).not.toContain("held by");
    expect(spanish).not.toMatch(/wait two minutes/i);
    expect(spanish).not.toContain('lang="en');
  });

  it("tells the operator to wait for the holder to be ended, then retry, then ask for help", async () => {
    const body = await pageFor(code, "restore");
    expect(body).toMatch(/wait two minutes, then press retry/i);
    expect(body).toMatch(/ask whoever installed this box/i);
    expect(body).not.toMatch(/\bwipe\b|\berase\b|\bdelete the database\b/i);
    const spanish = await pageFor(code, "restore", SPANISH);
    expect(spanish).toMatch(/espera dos minutos y pulsa «Reintentar un arranque normal»/i);
    expect(spanish).toMatch(/quien instaló este equipo/i);
    expect(spanish).not.toMatch(NEVER_WIPE_ES);
  });

  it("puts the recorded kind in the status JSON, which is from a closed set", async () => {
    const app = recoveryApp({
      state: { ...state, lastErrorCode: code, holderKind: "rejoin" },
      logDir: "/nonexistent",
      onRetry: vi.fn(),
    });
    expect(await (await app.request("/recovery-api/status")).json()).toEqual({
      failures: 3,
      level: "recovery",
      lastErrorCode: code,
      lastFailureAt: state.lastFailureAt,
      holderKind: "rejoin",
    });
  });
});

describe("a restore whose database could not be put in place, if it is the last failure", () => {
  it("sends the operator to whoever installed the box, and not to the log on this page", async () => {
    const text = OPERATOR_TEXT["restore.placement_failed"];
    expect(text).toBeDefined();
    expect(text!["en-GB"].action).toMatch(/ask whoever installed this box/i);
    expect(text!["en-GB"].action).not.toMatch(/log below/i);
    expect(text!["es-ES"].action).toMatch(/quien instaló este equipo/i);
    expect(text!["es-ES"].action).not.toMatch(/registro de abajo/i);
    const body = await pageFor("restore.placement_failed");
    expect(body).toContain(escapeHtml(text!["en-GB"].action));
    const spanish = await pageFor("restore.placement_failed", undefined, SPANISH);
    expect(spanish).toContain(escapeHtml(text!["es-ES"].action));
  });
});

describe("a start refused because the only copy of the database may be in a set-aside folder", () => {
  it("says the database was moved aside by a restore and sends the operator to whoever installed the box", async () => {
    const text = OPERATOR_TEXT["restore.database_set_aside"];
    expect(text).toBeDefined();
    expect(text!["en-GB"].title).toMatch(/moved aside/i);
    expect(text!["en-GB"].action).toMatch(/ask whoever installed this box/i);
    expect(text!["es-ES"].title).toMatch(/apartada/i);
    expect(text!["es-ES"].action).toMatch(/quien instaló este equipo/i);
    const body = await pageFor("restore.database_set_aside");
    expect(body).toContain(escapeHtml(text!["en-GB"].title));
    const spanish = await pageFor("restore.database_set_aside", undefined, SPANISH);
    expect(spanish).toContain(escapeHtml(text!["es-ES"].title));
  });
});
