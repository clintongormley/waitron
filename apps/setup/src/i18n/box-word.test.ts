import { describe, expect, it } from "vitest";
import { initialOwnerStrings } from "../screens/initial-owner-strings.js";
import { initialSetupStrings } from "../screens/initial-setup-strings.js";
import { en, es } from "./strings.js";

// Setup calls the Waitron machine "the box" in English and "servidor" in Spanish, never "equipo"
// (owner, 2026-11-22). The dashboard page kept its name "Servers", so a sentence names it as a page
// or by its menu path. Weaker than its name: only the string tables below are read, not English
// written inline in screens nor the guide pages.
const ALLOWED_EN = [/\bmail servers?\b/gi, /\bServers page\b/g, /\bSystem(, then | → )Servers\b/g];

function namesTheBoxAServer(text: string): boolean {
  return /\bservers?\b/i.test(ALLOWED_EN.reduce((left, phrase) => left.replace(phrase, ""), text));
}

function table(prefix: string, words: Record<string, string>): [string, string][] {
  return Object.entries(words).map(([key, text]) => [`${prefix}.${key}`, text]);
}

function english(): [string, string][] {
  return [
    ...table("strings", en),
    ...table("initialOwner", initialOwnerStrings.en),
    ...table("initialSetup", initialSetupStrings.en),
  ];
}

function spanish(): [string, string][] {
  return [
    ...table("strings", es),
    ...table("initialOwner", initialOwnerStrings.es),
    ...table("initialSetup", initialSetupStrings.es),
  ];
}

describe("setup's word for the Waitron machine", () => {
  it("reads every table it claims to", () => {
    const paths = [...english(), ...spanish()].map(([path]) => path);
    expect(paths).toContain("strings.reset.heading");
    expect(paths).toContain("initialOwner.heading");
    expect(paths).toContain("initialSetup.heading");
  });

  it("calls it the box in English, never the server", () => {
    const offending = english().filter(([, text]) => namesTheBoxAServer(text));
    expect(offending).toEqual([]);
  });

  it("still sees the machine named beside an allowed phrase", () => {
    expect(namesTheBoxAServer("Open Servers on the main box")).toBe(true);
    expect(namesTheBoxAServer("Check its address in Servers before trying again.")).toBe(true);
    expect(namesTheBoxAServer("leave the server, sender email, username and password blank")).toBe(
      true,
    );
    expect(namesTheBoxAServer("Open the Servers page on the main server")).toBe(true);
    expect(namesTheBoxAServer("Open System → Servers; check the mail server")).toBe(false);
  });

  it("calls it servidor in Spanish, never equipo", () => {
    const offending = spanish().filter(([, text]) => /\bequipos?\b/i.test(text));
    expect(offending).toEqual([]);
  });
});
