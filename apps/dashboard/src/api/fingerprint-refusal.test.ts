import { afterEach, expect, it, vi } from "vitest";
import { DashboardApi } from "./client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";

afterEach(() => setLocale("en-GB"));

it.each(["en-GB", "es-ES"])("decodes a 409 into the selected refusal in %s", async (locale) => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        error: { code: "fiscal.fingerprint_mismatch", params: {} },
      }),
      { status: 409, headers: { "content-type": "application/json" } },
    ),
  );
  const api = new DashboardApi("", fetchImpl);
  const error: unknown = await api
    .resolveStuckBillPayment("payment")
    .catch((error: unknown) => error);
  expect(error).toMatchObject({ code: "fiscal.fingerprint_mismatch", status: 409 });
  const code = codeOf(error);
  const message = codeMessage(code, locale);
  expect(message).toBe(codeMessage("fiscal.fingerprint_mismatch", locale));
  expect(message).not.toBe(codeMessage("unknown.fingerprint_test", locale));
  expect(message).not.toContain("fiscal.");
});
