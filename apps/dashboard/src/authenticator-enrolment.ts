import { toDataURL } from "qrcode";
import type { DashboardApi } from "./api/client.js";

export async function beginAuthenticator(api: Pick<DashboardApi, "beginTotp">) {
  const setup = await api.beginTotp({});
  const qr = await toDataURL(setup.uri, { errorCorrectionLevel: "M", margin: 1, width: 240 });
  return { setup, qr };
}
