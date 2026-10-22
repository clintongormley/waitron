import { afterEach, expect, it, vi } from "vitest";
import { TillApi } from "./client.js";
import { codeMessage } from "../i18n/codes.js";
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
  const api = new TillApi("", fetchImpl);
  const error: unknown = await api
    .recordSale(
      [],
      { method: "cash", amount: "10.00" },
      "bill",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      null,
    )
    .catch((error: unknown) => error);
  expect(error).toMatchObject({ code: "fiscal.fingerprint_mismatch", status: 409 });
  const code = (error as { code: string }).code;
  const message = codeMessage(code, locale);
  expect(message).toBe(codeMessage("fiscal.fingerprint_mismatch", locale));
  expect(message).not.toBe(codeMessage("unknown.fingerprint_test", locale));
  expect(message).not.toContain("fiscal.");
});
