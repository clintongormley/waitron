import "./recovery-font.js";
import { readFile } from "node:fs/promises";

export async function loadRecoveryFont(): Promise<Uint8Array> {
  const { default: fontAsset } = await import("./assets/register-noto-sans.ttf?inline", {
    with: { type: "bytes" },
  }).catch(async () => ({
    default: await readFile(new URL("./assets/register-noto-sans.ttf", import.meta.url)),
  }));
  return typeof fontAsset === "string"
    ? new Uint8Array(Buffer.from(fontAsset.slice(fontAsset.indexOf(",") + 1), "base64"))
    : new Uint8Array(fontAsset);
}

export async function loadRecoveryPackFonts() {
  const { default: fontAsset } = await import("./assets/register-noto-sans-mono.ttf?inline", {
    with: { type: "bytes" },
  }).catch(async () => ({
    default: await readFile(new URL("./assets/register-noto-sans-mono.ttf", import.meta.url)),
  }));
  const mono =
    typeof fontAsset === "string"
      ? new Uint8Array(Buffer.from(fontAsset.slice(fontAsset.indexOf(",") + 1), "base64"))
      : new Uint8Array(fontAsset);
  return { regular: await loadRecoveryFont(), mono };
}
