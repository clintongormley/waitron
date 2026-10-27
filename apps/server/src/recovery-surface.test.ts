import { mkdtemp, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { AppError } from "@waitron/shared";
import { VENUE_HOLDER_KINDS } from "@waitron/db";
import { createErrorBoundary } from "@waitron/server-kit";
import "./errors.js";
import { createRotatingFileSink, tee } from "./log-file.js";
import { createLogger } from "./logger.js";
import {
  FRESH,
  afterFailure,
  refusedAtStart,
  refusedWhileRunning,
  type RecoveryState,
} from "./recovery-state.js";
import {
  GENERIC_TEXT,
  OPERATOR_TEXT,
  escapeHtml,
  recoveryApp,
  type RecoveryDeps,
} from "./recovery-surface.js";
import { START_AGAIN_PAGE_TEXT } from "./recovery-start-again.js";

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
      refused: false,
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

describe("the producer the build does not yet name", () => {
  const code = "sif.producer_unset";

  it("names the missing producer, in each language", async () => {
    const english = await pageFor(code, undefined, "en-GB");
    expect(english).toContain(
      escapeHtml(
        "This version of Waitron does not yet name its producer, so it cannot be used for real sales.",
      ),
    );
    expect(english).toContain(
      escapeHtml("Ask whoever installed this box to install a version that names its producer."),
    );
    const spanish = await pageFor(code, undefined, SPANISH);
    expect(spanish).toContain(
      escapeHtml(
        "Esta versión de Waitron todavía no indica quién la produce, así que no puede usarse para ventas reales.",
      ),
    );
    expect(spanish).toContain(
      escapeHtml(
        "Pide a quien instaló este equipo que instale una versión que indique quién la produce.",
      ),
    );
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
  // again, which the generic line does not say; `append_only.triggers_changed` because a box that
  // stopped itself reaches the page at once, and the generic line says only that Waitron could not
  // start; `sif.producer_unset` because a retry of the same version and settings refuses again,
  // and the generic line does not say what to change.
  it("has an entry for every code classifyBootFailure produces and each persisted code listed here", () => {
    const classified = [
      "provisioning.database_unreachable",
      "provisioning.schema_mismatch",
      "storage.disk_full",
      "unknown",
    ];
    const persistedByRunEntry = [
      "server.config_missing",
      "migrations.apply_failed",
      "provisioning.database_ahead",
      "restore.database_set_aside",
      "migrations.set_missing",
      "migrations.incomplete",
      "server.boot_incomplete",
      "provisioning.database_holder_stalled",
    ];
    const fromBootByHand = [
      "deployment.environment_mismatch",
      "restore.membership_invalid",
      "append_only.triggers_changed",
      "sif.producer_unset",
    ];
    const missing = [...classified, ...persistedByRunEntry, ...fromBootByHand].filter(
      (code) => code !== "unknown" && !(code in OPERATOR_TEXT),
    );
    expect(missing).toEqual([]);
  });

  // Fixed strings, not the table: a page rendering another row would pass a comparison with it.
  it("names a restored copy whose list of machines is damaged or fails its signature check, in both languages", async () => {
    const english = await pageFor("restore.membership_invalid");
    expect(english).toContain(
      "The list of machines in the restored copy is damaged or does not carry a valid signature, so it may have been changed after it was saved.",
    );
    expect(english).toContain(
      "The box will not start from this copy. Ask whoever installed this box to look at it before anything else.",
    );
    const spanish = await pageFor("restore.membership_invalid", undefined, SPANISH);
    expect(spanish).toContain(
      "La lista de equipos de la copia restaurada está dañada o no tiene una firma válida, así que puede haberse cambiado después de guardarse.",
    );
    expect(spanish).toContain(
      "El equipo no arrancará con esta copia. Antes de nada, pide a quien instaló este equipo que lo revise.",
    );
  });

  it("names a full disk in both languages", async () => {
    const english = await pageFor("storage.disk_full");
    expect(english).toContain(
      escapeHtml("The box's disk is full, so Waitron cannot save anything."),
    );
    expect(english).toContain(
      escapeHtml(
        "Ask whoever installed this box to free some space (old backups, earlier versions of Waitron) or fit a bigger disk. Your sales are not touched.",
      ),
    );
    const spanish = await pageFor("storage.disk_full", undefined, SPANISH);
    expect(spanish).toContain(
      escapeHtml("El disco del equipo está lleno, así que Waitron no puede guardar nada."),
    );
    expect(spanish).toContain(
      escapeHtml(
        "Pide a quien instaló este equipo que libere espacio (copias antiguas, versiones anteriores de Waitron) o ponga un disco mayor. Tus ventas no se tocan.",
      ),
    );
  });

  it("says the box has already deleted what it could, in both languages", async () => {
    const english = await pageFor("storage.disk_full");
    expect(english).toContain(
      escapeHtml("The box has deleted what it could make again, and that was not enough."),
    );
    const spanish = await pageFor("storage.disk_full", undefined, SPANISH);
    expect(spanish).toContain(
      escapeHtml("El equipo ha quitado lo que podía volver a crear, y no ha bastado."),
    );
    expect(spanish).toContain(escapeHtml("Pide a quien instaló este equipo"));
  });

  it("names a removed or changed safeguard on the permanent records, in both languages", async () => {
    const english = await pageFor("append_only.triggers_changed");
    expect(english).toContain(
      escapeHtml("A safeguard on the box's permanent records was removed or changed."),
    );
    expect(english).toContain("Ask whoever installed this box to look at it before anything else.");
    const spanish = await pageFor("append_only.triggers_changed", undefined, SPANISH);
    expect(spanish).toContain(
      "Se ha quitado o cambiado una protección de los registros permanentes del equipo.",
    );
    expect(spanish).toContain("Antes de nada, pide a quien instaló este equipo que lo revise.");
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
      refused: false,
    });
  });
});

describe("a restore whose database could not be put in place, if it is the last failure", () => {
  it("sends the operator to whoever installed the box, and to the failed start's details on this page", async () => {
    const text = OPERATOR_TEXT["restore.placement_failed"];
    expect(text).toBeDefined();
    expect(text!["en-GB"].action).toMatch(/ask whoever installed this box/i);
    expect(text!["en-GB"].action).toContain("Why the last start failed");
    expect(text!["es-ES"].action).toMatch(/quien instaló este equipo/i);
    expect(text!["es-ES"].action).toContain("Por qué falló el último arranque");
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
    expect(text!["en-GB"].action).toContain("Why the last start failed");
    expect(text!["es-ES"].title).toMatch(/apartada/i);
    expect(text!["es-ES"].action).toMatch(/quien instaló este equipo/i);
    expect(text!["es-ES"].action).toContain("Por qué falló el último arranque");
    const body = await pageFor("restore.database_set_aside");
    expect(body).toContain(escapeHtml(text!["en-GB"].title));
    const spanish = await pageFor("restore.database_set_aside", undefined, SPANISH);
    expect(spanish).toContain(escapeHtml(text!["es-ES"].title));
  });
});

/** One line as the entrypoint writes it (`node-entry.ts`), through the real logger. */
const line = (
  event: string,
  fields: Record<string, unknown> = {},
  at = "2026-09-26T12:55:42.275Z",
) => JSON.stringify({ ...fields, at, level: "info", event });

async function logWith(lines: readonly string[]): Promise<string> {
  const logDir = await mkdtemp(join(tmpdir(), "wt-log-"));
  await writeFile(join(logDir, "waitron.log"), `${lines.join("\n")}\n`);
  return logDir;
}

const bodyFor = async (logDir: string, acceptLanguage = "en-GB") =>
  await (
    await recoveryApp({ state, logDir, onRetry: vi.fn() }).request("/", {
      headers: { "Accept-Language": acceptLanguage },
    })
  ).text();

const DETAIL = [
  "DrizzleError: Failed to run the query 'ALTER TABLE `devices` DROP COLUMN `has_cash_drawer`;'",
  "    at runMigrations (file:///app/server.js:1:1)",
  "caused by: Error: no such column: new.has_cash_drawer",
].join("\n");

describe("the last failed start's detail", () => {
  it("is shown in full, line by line, under its own heading in the page's language", async () => {
    const logDir = await logWith([
      line("server.stopped", {}, "2026-09-26T12:54:09.000Z"),
      line("server.boot_started"),
      line("server.boot_failed", { errorCode: "unknown", detail: DETAIL }),
    ]);
    const english = await bodyFor(logDir);
    expect(english).toContain("Why the last start failed (2026-09-26T12:55:42.275Z)");
    expect(english).toContain(escapeHtml(DETAIL));
    const spanish = await bodyFor(logDir, SPANISH);
    expect(spanish).toContain("Por qué falló el último arranque (2026-09-26T12:55:42.275Z)");
    expect(spanish).toContain(escapeHtml(DETAIL));
  });

  it("is shown however many lines follow it, though the tail no longer reaches it", async () => {
    const after = Array.from({ length: 250 }, (_, index) => line("probe.later", { index }));
    const logDir = await logWith([
      line("server.boot_started"),
      line("server.boot_failed", { errorCode: "unknown", detail: DETAIL }),
      ...after,
    ]);
    const body = await bodyFor(logDir);
    expect(body).toContain(escapeHtml(DETAIL));
    // The control: the failure's own line is outside the tail.
    expect(body).not.toContain("&quot;event&quot;:&quot;server.boot_failed&quot;");
  });

  // A start that hung or was killed records no failure; an older one would describe another start.
  it("is not shown when a later start began and recorded no failure", async () => {
    const logDir = await logWith([
      line("server.boot_started"),
      line("server.boot_failed", { errorCode: "unknown", detail: "an older failure" }),
      line("server.boot_started"),
    ]);
    const body = await bodyFor(logDir);
    expect(body).not.toContain("Why the last start failed");
    // The control: the older failure is still in the tail.
    expect(body).toContain("an older failure");
  });

  it("is escaped, not rendered as HTML", async () => {
    const logDir = await logWith([
      line("server.boot_failed", {
        errorCode: "unknown",
        detail: `<img src=x onerror="alert(1)">`,
      }),
    ]);
    const body = await bodyFor(logDir);
    expect(body).toContain("Why the last start failed");
    expect(body).not.toContain('<img src=x onerror="alert(1)">');
  });

  it("skips a torn line and a failure line with no detail, without throwing", async () => {
    const logDir = await logWith([
      line("server.boot_failed", { errorCode: "unknown", detail: "the real one" }),
      line("server.boot_failed", { errorCode: "unknown" }),
      '{"event":"server.boot_failed","detail":"torn',
    ]);
    const body = await bodyFor(logDir);
    expect(body).toContain("Why the last start failed");
    expect(body).toMatch(/Why the last start failed[^<]*<\/h2>\s*<pre>the real one<\/pre>/);
  });

  // One JSON line with its line breaks escaped is unreadable in the tail.
  it("is laid out line by line in the tail too, for every failed start in it", async () => {
    const logDir = await logWith([
      line("server.boot_started"),
      line("server.boot_failed", { errorCode: "unknown", detail: "first attempt\ncaused by: A" }),
      line("server.boot_started"),
      line("server.boot_failed", { errorCode: "unknown", detail: DETAIL }),
    ]);
    const tail = (await bodyFor(logDir)).split("Log tail</h2>")[1]!;
    expect(tail).toContain("first attempt\ncaused by: A");
    expect(tail).toContain(escapeHtml(DETAIL));
    expect(tail).toContain(
      escapeHtml(
        JSON.stringify({
          errorCode: "unknown",
          at: "2026-09-26T12:55:42.275Z",
          level: "info",
          event: "server.boot_failed",
        }),
      ),
    );
    expect(tail).not.toContain("\\n");
  });

  it("is absent with no log at all", async () => {
    const body = await (
      await recoveryApp({ state, logDir: "/nonexistent", onRetry: vi.fn() }).request("/")
    ).text();
    expect(body).not.toContain("Why the last start failed");
  });
});

describe("a migration the engine refused", () => {
  const text = OPERATOR_TEXT["migrations.apply_failed"];

  it("says the database could not be updated, and sends the operator to whoever installed the box", () => {
    expect(text).toBeDefined();
    expect(text!["en-GB"].title).toBe(
      "The box's database could not be updated for the installed version of Waitron.",
    );
    expect(text!["en-GB"].action).toMatch(/ask whoever installed this box/i);
    expect(text!["es-ES"].action).toMatch(/quien instaló este equipo/i);
  });

  // A restore runs the same update, so it cannot be offered as the fix.
  it("does not offer a restore as the fix", () => {
    expect(text!["en-GB"].action).not.toMatch(/restore it from a backup, or reinstall/i);
    expect(text!["es-ES"].action).not.toMatch(
      /restáurala desde una copia de seguridad, o reinstala/i,
    );
  });
});

describe("a box the running server stopped", () => {
  const refused = refusedWhileRunning(
    afterFailure(FRESH, "x", new Date()),
    "append_only.triggers_changed",
    new Date("2026-10-11T10:00:00Z"),
    { missing: ["sales_append_only_update"], altered: ["x<y"] },
  );
  const appFor = (current: RecoveryState) =>
    recoveryApp({ state: current, logDir: "/nonexistent", onRetry: vi.fn() });

  it.each([
    ["en-GB", "Level: recovery. Stopped while running.", /Failed \d+ times/],
    [SPANISH, "Nivel: recovery. Se detuvo mientras funcionaba.", /Intentos fallidos/],
  ])("says it stopped while running, in place of the count (%s)", async (language, line, count) => {
    const body = await (
      await appFor(refused).request("/", { headers: { "Accept-Language": language } })
    ).text();
    expect(body).toContain(`<p>${escapeHtml(line)}</p>`);
    expect(body).not.toMatch(count);
  });

  async function bodyOf(current: RecoveryState, language = "en-GB"): Promise<string> {
    return await (
      await appFor(current).request("/", { headers: { "Accept-Language": language } })
    ).text();
  }

  it.each([
    ["en-GB", "Waitron stopped", "Waitron did not start"],
    [SPANISH, "Waitron se ha detenido", "Waitron no ha arrancado"],
  ])("is headed as stopped, not as a failed start (%s)", async (language, heading, failed) => {
    const body = await bodyOf(refused, language);
    expect(body).toContain(`<title>${heading}</title>`);
    expect(body).toContain(`<h1>${heading}</h1>`);
    expect(body).not.toContain(failed);
  });

  it.each([
    [
      "en-GB",
      "<p>Missing triggers: sales_append_only_update</p>",
      "<p>Changed triggers: x&lt;y</p>",
    ],
    [
      SPANISH,
      "<p>Disparadores que faltan: sales_append_only_update</p>",
      "<p>Disparadores cambiados: x&lt;y</p>",
    ],
  ])(
    "names the triggers that stopped it, under the status line (%s)",
    async (language, missing, changed) => {
      const body = await bodyOf(refused, language);
      expect(body).toContain(missing);
      expect(body).toContain(changed);
      expect(body.indexOf(missing)).toBeGreaterThan(body.indexOf("<h2>"));
    },
  );

  it("joins several names, and shows no line for an empty list", async () => {
    const body = await bodyOf({
      ...refused,
      refusedTriggers: { missing: ["a", "b"], altered: [] },
    });
    expect(body).toContain("<p>Missing triggers: a, b</p>");
    expect(body).not.toContain("Changed triggers");
  });

  it("shows no names line for a refusal that recorded none", async () => {
    const body = await bodyOf({ ...refused, refusedTriggers: undefined });
    expect(body).toContain("<h1>Waitron stopped</h1>");
    expect(body).not.toContain("Missing triggers");
    expect(body).not.toContain("Changed triggers");
  });

  it("masks a password in a name", async () => {
    const body = await bodyOf({
      ...refused,
      refusedTriggers: { missing: ["postgres://u:secret@h/db"], altered: [] },
    });
    expect(body).toContain("<p>Missing triggers: postgres://u:***@h/db</p>");
    expect(body).not.toContain("secret");
  });

  it("masks a password in one name without swallowing the next", async () => {
    const body = await bodyOf({
      ...refused,
      refusedTriggers: {
        missing: ["https://h/db?password=s", "sales_append_only_update"],
        altered: [],
      },
    });
    expect(body).toContain(
      "<p>Missing triggers: https://h/db?password=***, sales_append_only_update</p>",
    );
    expect(body).not.toContain("password=s");
  });

  it("gives paragraphs, as well as pre, overflow-wrap: anywhere", async () => {
    const body = await bodyOf({
      ...refused,
      refusedTriggers: { missing: ["t".repeat(512)], altered: [] },
    });
    expect(body).toContain(
      "<style>pre { white-space: pre-wrap; } pre, p { overflow-wrap: anywhere; }</style>",
    );
  });

  it("shows no names for a box that failed to start", async () => {
    const body = await bodyOf({
      ...state,
      refusedTriggers: { missing: ["a"], altered: ["b"] },
    });
    expect(body).not.toContain("Missing triggers");
    expect(body).not.toContain("Changed triggers");
  });

  it("still shows the count for a box that failed to start", async () => {
    const body = await (await appFor(state).request("/")).text();
    expect(body).toContain("Level: recovery. Failed 3 times.");
    expect(body).not.toContain("Stopped while running.");
  });

  it("reports the refusal in the status JSON", async () => {
    expect(await (await appFor(refused).request("/recovery-api/status")).json()).toEqual({
      failures: 1,
      level: "recovery",
      lastErrorCode: "append_only.triggers_changed",
      lastFailureAt: "2026-10-11T10:00:00.000Z",
      refused: true,
    });
  });
});

describe("the full-disk page's free space and uncounted start", () => {
  const diskFull: RecoveryState = {
    ...FRESH,
    level: "recovery",
    lastErrorCode: "storage.disk_full",
  };

  function appWith(extra: Partial<Parameters<typeof recoveryApp>[0]>, base = diskFull) {
    return recoveryApp({ state: base, logDir: "/nonexistent", onRetry: vi.fn(), ...extra });
  }

  async function bodyOf(app: Hono, acceptLanguage = "en-GB"): Promise<string> {
    return await (
      await app.request("/", { headers: { "Accept-Language": acceptLanguage } })
    ).text();
  }

  it("shows the free space on the box's disk in each language", async () => {
    const some = appWith({ freeSpace: async () => 1_228_800 });
    expect(await bodyOf(some)).toContain(
      `<p>${escapeHtml("Free space on the box's disk: 1.2 MB.")}</p>`,
    );
    expect(await bodyOf(some)).toContain(
      `<p>${escapeHtml("Level: recovery. Failed 0 times.")}</p>\n<p>${escapeHtml("Free space on the box's disk: 1.2 MB.")}</p>`,
    );
    expect(await bodyOf(some, SPANISH)).toContain(
      `<p>${escapeHtml("Espacio libre en el disco del equipo: 1,2 MB.")}</p>`,
    );
    expect(await bodyOf(appWith({ freeSpace: async () => 0 }))).toContain(
      `<p>${escapeHtml("Free space on the box's disk: 0 MB.")}</p>`,
    );
    expect(await bodyOf(appWith({ freeSpace: async () => 300_000_000 }))).toContain(
      `<p>${escapeHtml("Free space on the box's disk: 300 MB.")}</p>`,
    );
    const unknown = appWith({ freeSpace: async () => null });
    expect(await bodyOf(unknown)).toContain(
      `<p>${escapeHtml("Free space on the box's disk: unknown.")}</p>`,
    );
    expect(await bodyOf(unknown, SPANISH)).toContain(
      `<p>${escapeHtml("Espacio libre en el disco del equipo: desconocido.")}</p>`,
    );
  });

  it("reads free space again on every request", async () => {
    const freeSpace = vi
      .fn<() => Promise<number | null>>()
      .mockResolvedValueOnce(5_000_000)
      .mockResolvedValueOnce(9_000_000);
    const app = appWith({ freeSpace });
    expect(await bodyOf(app)).toContain(escapeHtml("Free space on the box's disk: 5 MB."));
    expect(await bodyOf(app)).toContain(escapeHtml("Free space on the box's disk: 9 MB."));
    expect(freeSpace).toHaveBeenCalledTimes(2);
  });

  it("still serves the page when reading free space fails", async () => {
    const app = appWith({ freeSpace: () => Promise.reject(new Error("statfs failed")) });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(escapeHtml("Free space on the box's disk: unknown."));
  });

  it("logs a free-space read that fails or finds nothing, and serves the same page", async () => {
    const quiet = await bodyOf(appWith({ freeSpace: async () => null }));
    const log = vi.fn();
    const failing = appWith({
      freeSpace: () => Promise.reject(Object.assign(new Error("statfs failed"), { code: "EIO" })),
      log,
    });
    const res = await failing.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(quiet);
    expect(log).toHaveBeenCalledWith("warn", "recovery.free_space_unreadable", { errno: "EIO" });

    const nothing = vi.fn();
    expect(await bodyOf(appWith({ freeSpace: async () => null, log: nothing }))).toBe(quiet);
    expect(nothing).toHaveBeenCalledWith("warn", "recovery.free_space_unreadable", {
      errno: null,
    });

    const read = vi.fn();
    await bodyOf(appWith({ freeSpace: async () => 0, log: read }));
    expect(read).not.toHaveBeenCalled();
  });

  it("shows no free-space line when none is given", async () => {
    const english = await pageFor("storage.disk_full");
    const spanish = await pageFor("storage.disk_full", undefined, SPANISH);
    for (const body of [english, spanish]) {
      expect(body).not.toContain("Free space");
      expect(body).not.toContain("Espacio libre");
    }
  });

  it("keeps /recovery-api/status to its named fields", async () => {
    const app = appWith(
      { freeSpace: async () => 1_228_800 },
      { ...diskFull, holderKind: "server" },
    );
    const json = (await (await app.request("/recovery-api/status")).json()) as object;
    expect(Object.keys(json).sort()).toEqual([
      "failures",
      "holderKind",
      "lastErrorCode",
      "lastFailureAt",
      "level",
      "refused",
    ]);
  });

  it("says a start that could not be counted was not counted, in both languages", async () => {
    const app = appWith({ uncounted: true });
    const english = await bodyOf(app);
    expect(english).toContain(
      `<p>${escapeHtml("Level: recovery. This start was not counted: the disk is full.")}</p>`,
    );
    expect(english).not.toContain("Failed 0 times");
    const spanish = await bodyOf(app, SPANISH);
    expect(spanish).toContain(
      `<p>${escapeHtml("Nivel: recovery. Este arranque no se ha contado: el disco está lleno.")}</p>`,
    );
    expect(spanish).not.toContain("Intentos fallidos: 0");
    const refused = appWith({ uncounted: true }, { ...diskFull, refused: true });
    const stopped = await bodyOf(refused);
    expect(stopped).toContain("Stopped while running.");
    expect(stopped).not.toContain("This start was not counted");
  });
});

describe("a start refused before it began", () => {
  const ROWS = [
    {
      code: "setup.workspace_unsupported",
      "en-GB": {
        title:
          "This box holds a setup from an older version of Waitron that this version cannot use.",
        action: "Reinstall Waitron on this box to start fresh.",
      },
      "es-ES": {
        title:
          "Este equipo tiene una configuración de una versión anterior de Waitron que esta versión no puede usar.",
        action: "Reinstala Waitron en este equipo para empezar de cero.",
      },
    },
    {
      code: "setup.start_again_incomplete",
      "en-GB": {
        title:
          "Start again did not finish: the box found files it did not expect, or could not read or delete one.",
        action:
          "The box has not changed files it did not expect, because they may be a venue restored from a backup. If you reinstall Waitron, the box starts fresh, but everything on it is lost.",
      },
      "es-ES": {
        title:
          "«Empezar de nuevo» no terminó: el equipo encontró archivos que no esperaba, o no pudo leer o borrar uno.",
        action:
          "El equipo no ha cambiado los archivos que no esperaba, porque pueden ser un local recuperado desde una copia de seguridad. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que hay en él.",
      },
    },
    {
      code: "setup.start_again_files_found",
      "en-GB": {
        title: "Start again did not finish, and the box found files it did not expect.",
        action:
          "An earlier Start again was cut off. Since then, files have appeared on this box that Start again did not create. They may be a venue restored from a backup. The box has not changed them.",
      },
      "es-ES": {
        title: "«Empezar de nuevo» no terminó y el equipo encontró archivos que no esperaba.",
        action:
          "Un «Empezar de nuevo» anterior se interrumpió. Desde entonces han aparecido en este equipo archivos que «Empezar de nuevo» no creó. Pueden ser un local recuperado desde una copia de seguridad. El equipo no los ha cambiado.",
      },
    },
    {
      code: "setup.start_again_kept",
      "en-GB": {
        title: "Start again did not finish, and everything on this box was kept.",
        action:
          "Nothing was moved. This page stays until Waitron is reinstalled on this box. If Waitron is reinstalled, everything on this box is lost, the kept files included.",
      },
      "es-ES": {
        title: "«Empezar de nuevo» no terminó y se ha conservado todo lo que hay en este equipo.",
        action:
          "No se ha movido nada. Esta página sigue hasta que se reinstale Waitron en este equipo. Si se reinstala Waitron, se pierde todo lo que hay en el equipo, también los archivos conservados.",
      },
    },
    {
      code: "setup.start_again_move_unfinished",
      "en-GB": {
        title: "Start again was moving files aside and has not finished.",
        action:
          "Some of the files may already be in the set-aside folder; none has been deleted. Press Retry a normal boot to finish moving them, and the box then starts a new first setup. If you reinstall Waitron instead, the box starts fresh, but everything on it is lost, including the files moved aside.",
      },
      "es-ES": {
        title: "«Empezar de nuevo» estaba apartando archivos y no ha terminado.",
        action:
          "Puede que algunos archivos ya estén en la carpeta apartada; todos siguen en el equipo. Pulsa «Reintentar un arranque normal» para terminar de moverlos, y después el equipo empieza una configuración inicial nueva. Si en cambio reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, también los archivos apartados.",
      },
    },
  ] as const;

  async function refusedPage(code: string, acceptLanguage: string): Promise<string> {
    const app = recoveryApp({
      state: { ...FRESH, level: "recovery", lastErrorCode: code },
      logDir: "/nonexistent",
      onRetry: vi.fn(),
      refusedAtStart: true,
    });
    return await (
      await app.request("/", { headers: { "Accept-Language": acceptLanguage } })
    ).text();
  }

  it.each(ROWS)("names $code in both languages", async (row) => {
    for (const [lang, acceptLanguage] of LOCALES) {
      const body = await pageFor(row.code, undefined, acceptLanguage);
      expect(body, lang).toContain(escapeHtml(row[lang].title));
      expect(body, lang).toContain(escapeHtml(row[lang].action));
    }
  });

  it.each(ROWS)(
    "says a refused $code start was not counted, and never mentions the disk",
    async (row) => {
      const english = await refusedPage(row.code, "en-GB");
      expect(english).toContain(
        `<p>${escapeHtml("Level: recovery. This start was refused before it began, and was not counted.")}</p>`,
      );
      expect(english).not.toContain("Failed 0 times");
      expect(english).not.toMatch(/disk/i);
      const spanish = await refusedPage(row.code, SPANISH);
      expect(spanish).toContain(
        `<p>${escapeHtml("Nivel: recovery. Este arranque se rechazó antes de empezar y no se ha contado.")}</p>`,
      );
      expect(spanish).not.toContain("Intentos fallidos: 0");
      expect(spanish).not.toMatch(/disco/i);
    },
  );
  it("neither refused start sends the person to someone else, in either language", () => {
    for (const row of ROWS) {
      for (const lang of ["en-GB", "es-ES"] as const) {
        const action = OPERATOR_TEXT[row.code]![lang].action;
        expect(action, `${row.code} ${lang}`).not.toMatch(/whoever installed/i);
        expect(action, `${row.code} ${lang}`).not.toMatch(/quien instaló/i);
      }
    }
  });

  it("never suggests deleting in the Start again choices, except the one owner-approved sentence", () => {
    const NEVER_DELETE_EN = /\bwipe\b|\berase\b|\bdelet|\breset\b|\bremov/i;
    const NEVER_DELETE_ES = new RegExp(`${NEVER_WIPE_ES.source}|\\bquit|\\bquít|\\bsuprim`, "i");
    expect(NEVER_DELETE_EN.test("The files were deleted.")).toBe(true);
    expect(NEVER_DELETE_ES.test("Quítalo.")).toBe(true);
    expect(NEVER_DELETE_EN.test("Delete these files.")).toBe(true);
    expect(NEVER_DELETE_ES.test("Borra estos archivos.")).toBe(true);
    const strings = (text: (typeof START_AGAIN_PAGE_TEXT)[keyof typeof START_AGAIN_PAGE_TEXT]) =>
      Object.entries({
        ...text,
        more: text.more(3),
        moveFloor: text.moveFloor("2026-10-27 10:00 UTC"),
        throttled: `${text.throttled(1)} ${text.throttled(5)}`,
        moved: text.moved("state/first-setup-set-aside/2026-10-27T10-00-00Z"),
      });
    const checked = { "en-GB": NEVER_DELETE_EN, "es-ES": NEVER_DELETE_ES } as const;
    for (const lang of ["en-GB", "es-ES"] as const) {
      const entries = strings(START_AGAIN_PAGE_TEXT[lang]);
      expect(entries.length, lang).toBe(28);
      for (const [key, value] of entries) {
        expect(typeof value, `${lang} ${key}`).toBe("string");
        if (key === "moveDetail") continue;
        expect(value, `${lang} ${key}`).not.toMatch(checked[lang]);
      }
      expect(START_AGAIN_PAGE_TEXT[lang].moveDetail, lang).toMatch(checked[lang]);
    }
    expect(START_AGAIN_PAGE_TEXT["en-GB"].moveDetail).toBe(
      "The files are moved, unchanged, into a new folder on the box, and the rest of the interrupted setup is removed. The box then starts a new first setup, where you can recover from a backup or set up again. Its invoice series names are never used again.",
    );
    expect(START_AGAIN_PAGE_TEXT["es-ES"].moveDetail).toBe(
      "Los archivos se mueven, sin cambios, a una carpeta nueva del equipo, y se quita el resto de la configuración interrumpida. Después el equipo empieza una configuración inicial nueva, donde puedes recuperar desde una copia de seguridad o configurar de nuevo. Sus nombres de serie de facturas no se vuelven a usar.",
    );
  });

  it("the unfinished Move names the Retry button the page draws, never tells the person to reinstall, and says reinstalling loses the moved files", async () => {
    const text = OPERATOR_TEXT["setup.start_again_move_unfinished"]!;
    for (const [lang, retry, moved] of [
      ["en-GB", "Retry a normal boot", "the files moved aside"],
      ["es-ES", "«Reintentar un arranque normal»", "los archivos apartados"],
    ] as const) {
      const button = retry.replace(/[«»]/g, "");
      expect(await refusedPage("setup.start_again_move_unfinished", lang)).toContain(
        `<button type="submit">${escapeHtml(button)}</button>`,
      );
      expect(text[lang].action, lang).toContain(retry);
      expect(text[lang].action, lang).toContain(moved);
      expect(text[lang].action, lang).not.toMatch(/(^|[.!?;]\s+)(Reinstall|Reinstala)\b/);
    }
  });

  it("the unfinished Start again line never tells the person to reinstall, and says what reinstalling loses", () => {
    const text = OPERATOR_TEXT["setup.start_again_incomplete"]!;
    expect(text["en-GB"].action).not.toMatch(/(^|[.!?]\s+)Reinstall\b/);
    expect(text["en-GB"].action).toContain("lost");
    expect(text["es-ES"].action).not.toMatch(/(^|[.!?]\s+)Reinstala\b/);
    expect(text["es-ES"].action).toContain("pierde");
  });
});

describe("recoveryApp's Start again choice", () => {
  const sockets: TLSSocket[] = [];
  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.destroy();
  });
  const tls = () => {
    const socket = new TLSSocket(new Socket());
    sockets.push(socket);
    return { incoming: { socket } };
  };
  type StartAgain = NonNullable<RecoveryDeps["startAgain"]>;
  const SURVEY: StartAgain["survey"] = {
    kind: "choice",
    attemptId: "attempt",
    frozenDigest: "frozen",
    markerSha256: "marker",
    units: [
      {
        root: "venue",
        path: "venue.db",
        why: "not-created",
        pieces: ["venue.db"],
        entries: [{ path: "venue.db", type: "file", ino: "1", size: "10", mtimeNs: "1" }],
      },
    ],
    digest: "d".repeat(64),
    noteFloorMs: null,
  };
  const FOUND = OPERATOR_TEXT["setup.start_again_files_found"]!["en-GB"];
  const KEPT = OPERATOR_TEXT["setup.start_again_kept"]!["en-GB"];
  const WORDS = START_AGAIN_PAGE_TEXT["en-GB"];
  const FORM_ACTION = 'action="/recovery-api/start-again"';
  const RETRY_ACTION = 'action="/recovery-api/retry"';

  function app(choose?: StartAgain["choose"]) {
    const onFinished = vi.fn(() => Promise.resolve());
    const startAgain: StartAgain = {
      roots: { stateDir: "/box/state", venueDir: "/box/venue" },
      survey: SURVEY,
      onFinished,
      choose: choose ?? (() => Promise.resolve({ choice: "keep" as const })),
      now: () => new Date("2026-10-27T10:00:00.000Z"),
    };
    return {
      onFinished,
      app: recoveryApp({
        state: refusedAtStart(FRESH, "setup.start_again_files_found", new Date()),
        refusedAtStart: true,
        logDir: "/nonexistent",
        onRetry: vi.fn(),
        startAgain,
      }),
    };
  }
  const choose = (target: ReturnType<typeof app>["app"], choice: "keep" | "move") =>
    target.request(
      "/recovery-api/start-again",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password: "pw", choice, listed: SURVEY.digest }).toString(),
      },
      tls(),
    );

  it("recoveryApp with startAgain draws the section between the action and Retry, and mounts the route", async () => {
    const { app: surface } = app();
    const body = await (await surface.request("/", {}, tls())).text();
    const action = body.indexOf(escapeHtml(FOUND.action));
    const found = body.indexOf(escapeHtml(WORDS.filesFound));
    const form = body.indexOf(FORM_ACTION);
    const retry = body.indexOf(RETRY_ACTION);
    expect(action).toBeGreaterThan(-1);
    expect(found).toBeGreaterThan(action);
    expect(form).toBeGreaterThan(found);
    expect(retry).toBeGreaterThan(form);
    expect(body).toContain("<li>venue/venue.db</li>");

    const plain = await (await surface.request("/")).text();
    expect(plain).toContain(escapeHtml(WORDS.insecureForm));
    expect(plain).not.toContain(FORM_ACTION);
    expect(plain).not.toContain('type="password"');

    const refused = app(() => Promise.reject(new AppError("setup.owner_required", {})));
    const answer = await choose(refused.app, "keep");
    expect(answer.status).toBe(403);
    const page = await answer.text();
    expect(page).toContain(escapeHtml(FOUND.title));
    expect(page).toContain(escapeHtml(WORDS.wrongPassword));
    expect(page.indexOf(FORM_ACTION)).toBeLessThan(page.indexOf(RETRY_ACTION));
  });

  it("recoveryApp without startAgain answers the route 404 and draws no section", async () => {
    const surface = recoveryApp({
      state: refusedAtStart(FRESH, "setup.start_again_files_found", new Date()),
      refusedAtStart: true,
      logDir: "/nonexistent",
      onRetry: vi.fn(),
    });
    expect((await choose(surface, "keep")).status).toBe(404);
    const body = await (await surface.request("/", {}, tls())).text();
    expect(body).not.toContain(escapeHtml(WORDS.filesFound));
    expect(body).not.toContain(FORM_ACTION);
  });

  it("after Keep, GET / shows the kept page and no form", async () => {
    const { app: surface, onFinished } = app();
    const answer = await choose(surface, "keep");
    expect(answer.status).toBe(200);
    for (const page of [
      await answer.text(),
      await (await surface.request("/", {}, tls())).text(),
    ]) {
      expect(page).toContain(escapeHtml(KEPT.title));
      expect(page).toContain(escapeHtml(KEPT.action));
      expect(page).not.toContain(escapeHtml(FOUND.title));
      expect(page).not.toContain(escapeHtml(WORDS.filesFound));
      expect(page).not.toContain(FORM_ACTION);
      expect(page).not.toContain('type="password"');
    }
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("after Move, the answer names the folder and draws no form", async () => {
    const { app: surface, onFinished } = app(() =>
      Promise.resolve({
        choice: "move" as const,
        setAside: {
          state: "first-setup-set-aside/s1/state",
          venue: "first-setup-set-aside/s1/venue",
        },
      }),
    );
    const answer = await choose(surface, "move");
    expect(answer.status).toBe(200);
    const page = await answer.text();
    expect(page).toContain(escapeHtml(WORDS.moved("state/first-setup-set-aside/s1")));
    expect(page).not.toContain(FORM_ACTION);
    expect(onFinished).toHaveBeenCalledOnce();
  });
});
