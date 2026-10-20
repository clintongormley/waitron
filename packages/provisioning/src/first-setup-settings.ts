import { open, type FileHandle } from "node:fs/promises";
import type { DeploymentEnvironment } from "@waitron/db";
import type { FiscalContribution } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import { parseEmailSettings } from "./email-settings.js";
import "./errors.js";

export function parseFirstSetupSettings(
  contribution: FiscalContribution,
  environment: DeploymentEnvironment,
  body: Record<string, unknown>,
) {
  if (Object.keys(body).some((key) => !["aeatCert", "email"].includes(key)))
    throw new AppError("setup.request_invalid", { field: "body" });
  const secret = contribution.provisioningSecret;
  const required = secret?.required(environment) ?? false;
  if (required) {
    if (body.aeatCert === undefined)
      throw new AppError("setup.provisioning_secret_required", { module: contribution.id });
    secret!.validate(body.aeatCert);
  } else if (body.aeatCert !== undefined)
    throw new AppError("setup.request_invalid", { field: "aeatCert" });
  if (
    body.email !== undefined &&
    (typeof body.email !== "object" ||
      body.email === null ||
      Array.isArray(body.email) ||
      Object.keys(body.email).some(
        (key) => !["server", "port", "encryption", "user", "password", "from"].includes(key),
      ))
  )
    throw new AppError("setup.request_invalid", { field: "email" });
  for (const value of [body.aeatCert, body.email])
    if (value !== undefined && Buffer.byteLength(JSON.stringify(value)) > 65536)
      throw new AppError("setup.request_invalid", { field: "body" });
  const email =
    body.email === undefined
      ? undefined
      : parseEmailSettings(body.email as Record<string, unknown>);
  if (environment === "production" && email === undefined)
    throw new AppError("setup.email_required", { field: "email" });
  return { secret, required, aeatCert: body.aeatCert, email };
}

export async function readFirstSetupSettings(path: string): Promise<Record<string, unknown>> {
  let file: FileHandle | undefined;
  try {
    file = await open(path, "r");
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 131072) throw new Error();
    const buffer = Buffer.alloc(131073);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, null);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    if (count > 131072) throw new Error();
    const body: unknown = JSON.parse(buffer.subarray(0, count).toString("utf8"));
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new AppError("setup.request_invalid", { field: "settings" });
  } finally {
    await file?.close();
  }
}
