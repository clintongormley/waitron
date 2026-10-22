import dns, { Resolver } from "node:dns";
import { Socket } from "node:net";
import { expect, it, vi } from "vitest";
import { sendSmtpMessage } from "./smtp-send.js";
import { smtpRig } from "./testing/smtp-settings-fixture.js";

it("does not open a connection if DNS completes after the send deadline", async () => {
  const rig = await smtpRig("accepted");
  const release: (() => void)[] = [];
  const resolve4 = vi.spyOn(Resolver.prototype, "resolve4").mockImplementation(((
    _host: string,
    callback: (error: Error | null, addresses: string[]) => void,
  ) => {
    release.push(() => callback(null, ["127.0.0.1"]));
  }) as Resolver["resolve4"]);
  const resolve6 = vi.spyOn(Resolver.prototype, "resolve6").mockImplementation(((
    _host: string,
    callback: (error: Error | null, addresses: string[]) => void,
  ) => {
    release.push(() => callback(null, []));
  }) as Resolver["resolve6"]);
  const lookup = vi.spyOn(dns, "lookup").mockImplementation(((
    _host: string,
    options: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ) => {
    release.push(() =>
      callback(null, options.all ? [{ address: "127.0.0.1", family: 4 }] : "127.0.0.1", 4),
    );
  }) as typeof dns.lookup);
  const connect = vi.spyOn(Socket.prototype, "connect");
  try {
    const sending = sendSmtpMessage(
      { ...rig.config, url: rig.config.url.replace("127.0.0.1", "a987-late-dns.example.test") },
      { to: "admin@example.test", subject: "Test", text: "Test" },
      { timeoutMs: 100 },
    );
    await vi.waitFor(() => expect(release.length).toBeGreaterThan(0));
    expect(await sending).toEqual({ status: "unknown", reason: "email.test_timeout" });
    const dialsBeforeDeadline = connect.mock.calls.length;
    for (const answer of release) answer();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(connect).toHaveBeenCalledTimes(dialsBeforeDeadline);
    expect(rig.messages).toEqual([]);
  } finally {
    connect.mockRestore();
    resolve4.mockRestore();
    resolve6.mockRestore();
    lookup.mockRestore();
    await rig.close();
  }
});
