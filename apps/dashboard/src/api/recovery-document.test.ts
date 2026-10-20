import { expect, it, vi } from "vitest";
import { DashboardApi } from "./client.js";

it.each(["en", "es"] as const)(
  "requests the %s PDF with the session and preserves its bytes",
  async (locale) => {
    const fetcher = vi.fn(
      async () =>
        new Response(new Uint8Array([37, 80, 68, 70, 0, 255]), {
          headers: { "Content-Type": "application/pdf" },
        }),
    );
    const observed = vi.fn();
    const api = new DashboardApi("", fetcher, undefined, observed);
    const pdf = await api.reissueRecoveryDocument(locale);
    expect(Array.from(new Uint8Array(await pdf.arrayBuffer()))).toEqual([37, 80, 68, 70, 0, 255]);
    expect(pdf.type).toBe("application/pdf");
    expect(fetcher).toHaveBeenCalledWith("/api/box/recovery-document/reissue", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    expect(observed).toHaveBeenCalledWith("/api/box/recovery-document/reissue");
  },
);

it.each([401, 403, 409])(
  "preserves a real HTTP %s refusal instead of downloading it",
  async (status) => {
    const onError = vi.fn();
    const api = new DashboardApi(
      "",
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "authorization.not_permitted",
              params: { permission: "system.manage" },
            },
          }),
          { status },
        ),
      onError,
    );
    await expect(api.reissueRecoveryDocument("en")).rejects.toEqual({
      code: "authorization.not_permitted",
      status,
      params: { permission: "system.manage" },
    });
    expect(onError).toHaveBeenCalledWith("authorization.not_permitted", status);
  },
);

it.each([
  ["text/html", "<html>sign in</html>"],
  ["application/json", "{}"],
  ["application/pdf", ""],
] as const)("refuses an unusable %s response", async (type, body) => {
  const api = new DashboardApi(
    "",
    async () => new Response(body, { headers: { "Content-Type": type } }),
  );
  await expect(api.reissueRecoveryDocument("en")).rejects.toMatchObject({
    code: "recovery.pack_invalid",
  });
});

it("refuses an oversized document", async () => {
  const api = new DashboardApi(
    "",
    async () =>
      new Response(new Uint8Array(8 * 1024 * 1024 + 1), {
        headers: { "Content-Type": "application/pdf" },
      }),
  );
  await expect(api.reissueRecoveryDocument("en")).rejects.toMatchObject({
    code: "recovery.pack_invalid",
  });
});
