import { afterEach, describe, expect, it, vi } from "vitest";
import type { PasskeySignals } from "./api/client.js";
import { signalAcceptedPasskeys, signalUnknownPasskey } from "./passkey-signals.js";

const SIGNALS: PasskeySignals = {
  rpId: "waitron.local",
  userId: "cGVyc29uLTE",
  credentialIds: ["cred-1", "cred-2"],
  name: "ana@example.com",
  displayName: "Ana",
};

function stubBrowser(methods: Record<string, unknown>) {
  vi.stubGlobal("PublicKeyCredential", methods);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("telling the password manager which passkeys Waitron still accepts", () => {
  it("sends the accepted list and the current names, with the relying party and user handle", async () => {
    const all = vi.fn().mockResolvedValue(undefined);
    const details = vi.fn().mockResolvedValue(undefined);
    stubBrowser({ signalAllAcceptedCredentials: all, signalCurrentUserDetails: details });
    await signalAcceptedPasskeys({ passkeySignals: () => Promise.resolve(SIGNALS) });
    expect(all).toHaveBeenCalledExactlyOnceWith({
      rpId: "waitron.local",
      userId: "cGVyc29uLTE",
      allAcceptedCredentialIds: ["cred-1", "cred-2"],
    });
    expect(details).toHaveBeenCalledExactlyOnceWith({
      rpId: "waitron.local",
      userId: "cGVyc29uLTE",
      name: "ana@example.com",
      displayName: "Ana",
    });
  });

  it("asks the server for nothing when the browser has neither method", async () => {
    stubBrowser({});
    const read = vi.fn();
    await expect(signalAcceptedPasskeys({ passkeySignals: read })).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("asks the server for nothing when the browser has no passkey support at all", async () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    const read = vi.fn();
    await expect(signalAcceptedPasskeys({ passkeySignals: read })).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("calls whichever one method the browser has", async () => {
    const details = vi.fn().mockResolvedValue(undefined);
    stubBrowser({ signalCurrentUserDetails: details });
    await signalAcceptedPasskeys({ passkeySignals: () => Promise.resolve(SIGNALS) });
    expect(details).toHaveBeenCalledOnce();
  });

  it("still sends the names when the browser refuses the accepted list, and never throws", async () => {
    const all = vi.fn().mockRejectedValue(new DOMException("rpId", "SecurityError"));
    const details = vi.fn().mockResolvedValue(undefined);
    stubBrowser({ signalAllAcceptedCredentials: all, signalCurrentUserDetails: details });
    await expect(
      signalAcceptedPasskeys({ passkeySignals: () => Promise.resolve(SIGNALS) }),
    ).resolves.toBeUndefined();
    expect(details).toHaveBeenCalledOnce();
  });

  it("sends the names without waiting for the browser to answer the accepted list", async () => {
    let answerAll!: () => void;
    const all = vi.fn(() => new Promise<void>((resolve) => (answerAll = resolve)));
    const details = vi.fn().mockResolvedValue(undefined);
    stubBrowser({ signalAllAcceptedCredentials: all, signalCurrentUserDetails: details });
    const sent = signalAcceptedPasskeys({ passkeySignals: () => Promise.resolve(SIGNALS) });
    await vi.waitFor(() => expect(all).toHaveBeenCalledOnce());
    expect(details).toHaveBeenCalledOnce();
    answerAll();
    await expect(sent).resolves.toBeUndefined();
  });

  it("still sends the names when the accepted-list call throws before returning a promise", async () => {
    const all = vi.fn(() => {
      throw new TypeError("not base64url");
    });
    const details = vi.fn().mockResolvedValue(undefined);
    stubBrowser({ signalAllAcceptedCredentials: all, signalCurrentUserDetails: details });
    await expect(
      signalAcceptedPasskeys({ passkeySignals: () => Promise.resolve(SIGNALS) }),
    ).resolves.toBeUndefined();
    expect(details).toHaveBeenCalledOnce();
  });

  it("calls nothing and never throws when the server refuses the read", async () => {
    const all = vi.fn();
    stubBrowser({ signalAllAcceptedCredentials: all });
    await expect(
      signalAcceptedPasskeys({
        passkeySignals: () => Promise.reject({ code: "management_session.expired" }),
      }),
    ).resolves.toBeUndefined();
    expect(all).not.toHaveBeenCalled();
  });
});

describe("telling the password manager to forget a passkey Waitron does not hold", () => {
  it("names the relying party and the presented credential, and reports that it asked", async () => {
    const unknown = vi.fn().mockResolvedValue(undefined);
    stubBrowser({ signalUnknownCredential: unknown });
    expect(await signalUnknownPasskey("waitron.local", "cred-gone")).toBe(true);
    expect(unknown).toHaveBeenCalledExactlyOnceWith({
      rpId: "waitron.local",
      credentialId: "cred-gone",
    });
  });

  it("reports that it could not ask when the browser has no such method", async () => {
    stubBrowser({});
    expect(await signalUnknownPasskey("waitron.local", "cred-gone")).toBe(false);
  });

  it("reports that it could not ask when the browser refuses", async () => {
    stubBrowser({
      signalUnknownCredential: vi.fn().mockRejectedValue(new TypeError("not base64url")),
    });
    expect(await signalUnknownPasskey("waitron.local", "cred-gone")).toBe(false);
  });

  it("asks nothing without a relying party to name", async () => {
    const unknown = vi.fn();
    stubBrowser({ signalUnknownCredential: unknown });
    expect(await signalUnknownPasskey(undefined, "cred-gone")).toBe(false);
    expect(unknown).not.toHaveBeenCalled();
  });
});
