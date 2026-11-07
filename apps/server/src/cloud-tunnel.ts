import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import type { SavedCloudState } from "./cloud-client.js";
import "./errors.js";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const key = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9+/]{43}=$/.test(value) &&
  Buffer.from(value, "base64").toString("base64") === value;
const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

export async function writeTunnelConfiguration(
  directory: string | undefined,
  state?: SavedCloudState,
): Promise<void> {
  if (!directory) return;
  try {
    if (!(await lstat(directory)).isDirectory()) throw new Error();
  } catch (error) {
    if (missing(error)) return;
    throw new AppError("cloud.unavailable", {});
  }
  const path = join(directory, "peer.json");
  const service = state?.lifecycle?.view?.services.find((s) => s.service === "remote_access");
  if (
    !state?.view?.registration ||
    state.lifecycle?.revoked ||
    state.lifecycle?.pending?.action === "revoke" ||
    !service ||
    !["provisioning", "ready"].includes(service.state)
  ) {
    await rm(path, { force: true });
    return;
  }
  const temporary = join(directory, "peer." + randomUUID() + ".tmp");
  try {
    let publicKey: string;
    try {
      const publicPath = join(directory, "public-key"),
        info = await lstat(publicPath);
      if (!info.isFile() || info.size > 45) throw new Error();
      publicKey = (await readFile(publicPath, "utf8")).trim();
    } catch (error) {
      if (!missing(error)) throw error;
      await rm(path, { force: true });
      return;
    }
    const p: unknown = service.configuration;
    if (
      !object(p) ||
      p.version !== 1 ||
      p.installationId !== state.view.registration.installationId ||
      p.venueId !== state.view.registration.venueId ||
      !key(publicKey) ||
      p.peerPublicKey !== publicKey ||
      !key(p.gatewayPublicKey) ||
      p.port !== 443 ||
      typeof p.address !== "string" ||
      !/^10\.77\.(0|[1-9]\d{0,2})\.([1-9]\d{0,2})$/.test(p.address) ||
      Number(p.address.split(".")[2]) > 255 ||
      Number(p.address.split(".")[3]) < 2 ||
      Number(p.address.split(".")[3]) > 254 ||
      typeof p.endpoint !== "string" ||
      p.endpoint.length > 259 ||
      !p.endpoint.endsWith(":51820") ||
      !p.endpoint
        .slice(0, -6)
        .split(".")
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    )
      throw new Error();
    const file = await open(temporary, "wx", 0o644);
    try {
      await file.writeFile(
        JSON.stringify({
          address: p.address,
          gatewayPublicKey: p.gatewayPublicKey,
          endpoint: p.endpoint,
        }),
      );
      await file.chmod(0o644);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch {
    await rm(path, { force: true });
    throw new AppError("cloud.unavailable", {});
  } finally {
    await rm(temporary, { force: true });
  }
}
