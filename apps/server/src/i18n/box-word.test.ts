import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { CONNECTION_DEVICE_ES, CONNECTION_TEXT } from "../connection-bootstrap-strings.js";
import { SETUP_PLACEHOLDER_HTML } from "../setup-api.js";
import { renderTrustPage } from "../trust-page.js";
import { holderStalledText } from "./recovery-page.js";

// The Waitron machine is "the box" in English and "servidor" in Spanish, never "equipo" (owner,
// 2026-11-22). Weaker than its name: it reads every export of the tables in this folder (calling a
// function export with placeholder arguments, and skipping one that throws), the connection page's
// tables, the trust page's and the setup placeholder's visible text; not other pages written
// inline, nor log lines and command-line output.
const OTHER_SERVERS = [
  /\b(mail|SMTP|time)[- ]servers?\b/gi,
  /\bthe Servers page\b/g,
  // The guide frame's link to the Servers guide, named as the dashboard page is.
  /^Servers$/g,
];
// "Equipo" meaning another computer: a Windows PC a certificate is installed on.
const OTHER_EQUIPOS = [/\btodo el equipo\b/g];

const tables: Record<string, Record<string, unknown>> = {};

beforeAll(async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const file of readdirSync(here).sort())
    if (file.endsWith(".ts") && !file.endsWith(".test.ts"))
      tables[`./${file}`] = (await import(`./${file.replace(/\.ts$/, ".js")}`)) as Record<
        string,
        unknown
      >;
});

function collect(value: unknown, path: string, out: [string, string][], depth = 0): void {
  if (depth > 6) return;
  // An error code such as `server.boot_incomplete` is a name, not words.
  if (typeof value === "string") {
    if (!/^[a-z_]+(\.[a-z_]+)+$/.test(value)) out.push([path, value]);
  } else if (typeof value === "function") {
    try {
      const args = Array.from({ length: Math.max(value.length, 1) }, () => "X");
      collect((value as (...a: unknown[]) => unknown)(...args), `${path}()`, out, depth + 1);
    } catch {
      // A function that needs a real argument is not read; the header says so.
    }
  } else if (Array.isArray(value))
    value.forEach((v, i) => collect(v, `${path}[${i}]`, out, depth + 1));
  else if (value !== null && typeof value === "object")
    for (const [key, v] of Object.entries(value)) collect(v, `${path}.${key}`, out, depth + 1);
}

function visibleText(html: string): string {
  return html
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trustPages(): [string, string][] {
  const base = {
    reachUrls: ["https://waitron.local"],
    caDownloadPath: "/ca.crt",
    httpsUrl: "https://waitron.local/",
    device: "unknown" as const,
  };
  return [true, false].flatMap((caAvailable) =>
    [undefined, "https://192.168.1.2"].flatMap((ownAddress) =>
      [false, true].map((notSetUp): [string, string] => [
        `trustPage(${caAvailable},${ownAddress},${notSetUp})`,
        visibleText(renderTrustPage({ ...base, caAvailable, ownAddress, notSetUp })),
      ]),
    ),
  );
}

function allTexts(): [string, string][] {
  const out: [string, string][] = [];
  for (const [file, exports] of Object.entries(tables))
    for (const [name, value] of Object.entries(exports)) collect(value, `${file}:${name}`, out);
  for (const kind of ["server", "restore", "rejoin", "provisioning", "script"] as const)
    collect(holderStalledText(kind), `holderStalledText(${kind})`, out);
  collect(CONNECTION_TEXT, "connection:CONNECTION_TEXT", out);
  collect(CONNECTION_DEVICE_ES, "connection:CONNECTION_DEVICE_ES", out);
  out.push(["setup:SETUP_PLACEHOLDER_HTML", visibleText(SETUP_PLACEHOLDER_HTML)]);
  return [...out, ...trustPages()];
}

function namesTheBoxAServer(text: string): boolean {
  return /\bservers?\b/i.test(
    OTHER_SERVERS.reduce((rest, phrase) => rest.replace(phrase, ""), text),
  );
}

function namesTheBoxAnEquipo(text: string): boolean {
  return /\bequipos?\b/i.test(
    OTHER_EQUIPOS.reduce((rest, phrase) => rest.replace(phrase, ""), text),
  );
}

describe("the server's pages' word for the Waitron machine", () => {
  it("reads every table it claims to", () => {
    const paths = allTexts().map(([path]) => path);
    for (const expected of [
      "./recovery-page.ts:OPERATOR_WORDS",
      "./waiting-page.ts:WAITING_PAGE_WORDS",
      "./restricted-page.ts:RESTRICTED_PAGE_WORDS",
      "./start-again-page.ts:START_AGAIN_PAGE_WORDS",
      "./start-clock-waiting.ts:START_CLOCK_WAITING_WORDS",
      "./box-emails.ts:BOX_EMAIL_WORDS",
      "./trust-page.ts:NOT_SET_UP_WORDS",
      "connection:CONNECTION_TEXT",
      "setup:SETUP_PLACEHOLDER_HTML",
      "trustPage(false,undefined,false)",
      "holderStalledText(server)",
    ])
      expect(paths.some((path) => path.startsWith(expected))).toBe(true);
  });

  it("calls it the box in English, never the server", () => {
    const offending = allTexts().filter(([, text]) => namesTheBoxAServer(text));
    expect(offending).toEqual([]);
  });

  it("calls it servidor in Spanish, never equipo", () => {
    const offending = allTexts().filter(([, text]) => namesTheBoxAnEquipo(text));
    expect(offending).toEqual([]);
  });

  it("still sees the machine named beside an allowed phrase", () => {
    expect(namesTheBoxAServer("Ask the mail server, then the main server")).toBe(true);
    expect(namesTheBoxAServer("Open the Servers page; ask the time server")).toBe(false);
    expect(namesTheBoxAnEquipo("Instalada para todo el equipo de este equipo")).toBe(true);
    expect(namesTheBoxAnEquipo("Instalada para todo el equipo")).toBe(false);
  });
});
