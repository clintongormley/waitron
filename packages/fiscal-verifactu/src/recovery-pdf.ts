import monoUrl from "./assets/register-noto-sans-mono.ttf?url";
import fontUrl from "./assets/register-noto-sans.ttf?url";
import { refuseRecovery } from "./recovery-document.js";

export async function loadRecoveryFont(): Promise<Uint8Array> {
  const response = await fetch(fontUrl);
  if (!response.ok) refuseRecovery();
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadRecoveryPackFonts() {
  const response = await fetch(monoUrl);
  if (!response.ok) refuseRecovery();
  return { regular: await loadRecoveryFont(), mono: new Uint8Array(await response.arrayBuffer()) };
}
