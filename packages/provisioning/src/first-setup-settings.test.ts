import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { ALL_MODULES } from "@waitron/composition";
import { venueFiscalSelection } from "./venue-fiscal.js";
import { parseFirstSetupSettings } from "./first-setup-settings.js";
import { makeAuthority } from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";

const contribution = venueFiscalSelection(ALL_MODULES, "ES-common").contribution!;
const candidate = makeAuthority().issue({ passphrase: "SYNTHETIC-cert" });
const certificate = {
  pfxBase64: candidate.pfx.toString("base64"),
  passphrase: candidate.passphrase,
  certKind: "sello",
};
const email = {
  server: "smtp.example.test",
  port: 587,
  encryption: "starttls",
  from: "owner@example.test",
  user: "owner",
  password: "SYNTHETIC-smtp",
};

describe("first setup publication settings", () => {
  it("validates production settings without losing the certificate or SMTP authentication", async () => {
    expect(
      await parseFirstSetupSettings(contribution, "production", { aeatCert: certificate, email }),
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
  ])("refuses invalid production settings %# before publication", async (settings, code) => {
    await expect(
      parseFirstSetupSettings(contribution, "production", settings),
    ).rejects.toThrowError(expect.objectContaining({ code }));
  });

  it("keeps certificate-free preproduction settings independent from production", async () => {
    expect(await parseFirstSetupSettings(contribution, "preproduction", {})).toMatchObject({
      required: false,
      email: undefined,
    });
    await expect(
      parseFirstSetupSettings(contribution, "preproduction", { aeatCert: certificate }),
    ).rejects.toThrowError(expect.objectContaining({ code: "setup.request_invalid" }));
  });
});

it.each([
  { aeatCert: certificate, email, extra: true },
  { aeatCert: certificate, email: { ...email, password: "x".repeat(65537) } },
])("rejects settings outside the publication envelope %#", async (settings) => {
  await expect(parseFirstSetupSettings(contribution, "production", settings)).rejects.toThrowError(
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

it("waits for a refused asynchronous secret check before returning publication settings", async () => {
  const refusal = Promise.reject(
    new AppError("setup.certificate_refused", { field: "pfxBase64", reason: "unreadable" }),
  );
  void refusal.catch(async () => {});
  const asynchronous = {
    ...contribution,
    provisioningSecret: { ...contribution.provisioningSecret!, validate: () => refusal },
  };
  await expect(
    Promise.resolve().then(() =>
      parseFirstSetupSettings(asynchronous, "production", { aeatCert: certificate, email }),
    ),
  ).rejects.toMatchObject({ code: "setup.certificate_refused" });
});
