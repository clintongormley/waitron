import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { venueFiscalSelection } from "./venue-fiscal.js";
import { parseFirstSetupSettings } from "./first-setup-settings.js";

const contribution = venueFiscalSelection(ALL_MODULES, "ES-common").contribution!;
const certificate = { pfxBase64: "c3ludGhldGlj", passphrase: "SYNTHETIC-cert", certKind: "sello" };
const email = {
  server: "smtp.example.test",
  port: 587,
  encryption: "starttls",
  from: "owner@example.test",
  user: "owner",
  password: "SYNTHETIC-smtp",
};

describe("first setup publication settings", () => {
  it("validates production settings without losing the certificate or SMTP authentication", () => {
    expect(
      parseFirstSetupSettings(contribution, "production", { aeatCert: certificate, email }),
    ).toMatchObject({
      required: true,
      aeatCert: certificate,
      email: {
        url: "smtp://owner:SYNTHETIC-smtp@smtp.example.test:587?requireTLS=true",
        from: "owner@example.test",
      },
    });
  });

  it.each([
    [{ email }, "setup.provisioning_secret_required"],
    [{ aeatCert: certificate }, "setup.email_required"],
    [{ aeatCert: { ...certificate, pfxBase64: "!" }, email }, "setup.request_invalid"],
    [{ aeatCert: certificate, email: { ...email, password: "" } }, "email.settings_invalid"],
    [{ aeatCert: certificate, email: null }, "setup.request_invalid"],
    [{ aeatCert: certificate, email: { ...email, extra: true } }, "setup.request_invalid"],
  ])("refuses invalid production settings %# before publication", (settings, code) => {
    expect(() => parseFirstSetupSettings(contribution, "production", settings)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("keeps certificate-free preproduction settings independent from production", () => {
    expect(parseFirstSetupSettings(contribution, "preproduction", {})).toMatchObject({
      required: false,
      email: undefined,
    });
    expect(() =>
      parseFirstSetupSettings(contribution, "preproduction", { aeatCert: certificate }),
    ).toThrowError(expect.objectContaining({ code: "setup.request_invalid" }));
  });
});

it.each([
  { aeatCert: certificate, email, extra: true },
  { aeatCert: certificate, email: { ...email, password: "x".repeat(65537) } },
])("rejects settings outside the publication envelope %#", (settings) => {
  expect(() => parseFirstSetupSettings(contribution, "production", settings)).toThrowError(
    expect.objectContaining({ code: "setup.request_invalid" }),
  );
});

it.each([
  "null",
  "[]",
  '"SYNTHETIC-secret"',
  "{broken",
  "{}".padEnd(131073, " "),
  "directory",
  "missing",
])("a settings file refuses invalid contents without returning them %#", async (content) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readFirstSetupSettings } = await import("./first-setup-settings.js");
  const root = await mkdtemp(join(tmpdir(), "publication-settings-"));
  try {
    const path = content === "directory" ? root : join(root, "settings.json");
    if (!["directory", "missing"].includes(content)) await writeFile(path, content);
    await expect(readFirstSetupSettings(path)).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "settings" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
