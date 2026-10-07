import { describe, expect, it } from "vitest";
import { sendSmtpTestMessage } from "./smtp-test-message.js";
import { smtpRig, smtpTestTls } from "./testing/smtp-settings-fixture.js";

describe("SMTP setup test message", () => {
  it("sends one short message to the operator and reports acceptance", async () => {
    const rig = await smtpRig("accepted");
    try {
      expect(await sendSmtpTestMessage(rig.config, "admin@example.test")).toEqual({
        accepted: true,
      });
      expect(rig.messages).toHaveLength(1);
      expect(rig.messages[0]).toContain("To: admin@example.test");
      expect(rig.messages[0]).toContain("From: venue@example.test");
      expect(rig.messages[0]).toContain("Subject: Waitron email test");
      expect(rig.messages[0]).not.toContain("Content-Disposition: attachment");
      await rig.connectionClosed;
    } finally {
      await rig.close();
    }
  });
  it.each(["recipient-refused", "data-refused", "lost-ack"] as const)(
    "reports %s as a code without SMTP details",
    async (reply) => {
      const rig = await smtpRig(reply);
      try {
        expect(await sendSmtpTestMessage(rig.config, "admin@example.test")).toEqual({
          accepted: false,
          code: "email.test_refused",
        });
      } finally {
        await rig.close();
      }
    },
  );
  it("closes an unanswered SMTP exchange at its deadline", async () => {
    const rig = await smtpRig("silent");
    try {
      expect(
        await sendSmtpTestMessage(rig.config, "admin@example.test", { timeoutMs: 100 }),
      ).toEqual({ accepted: false, code: "email.test_timeout" });
      await rig.connectionClosed;
      expect(rig.sockets.size).toBe(0);
    } finally {
      await rig.close();
    }
  });
  it("validates an implicit-TLS server certificate", async () => {
    const rig = await smtpRig("accepted", true);
    try {
      expect(
        await sendSmtpTestMessage(rig.config, "admin@example.test", { ca: smtpTestTls.caCertPem }),
      ).toEqual({ accepted: true });
      expect(rig.messages).toHaveLength(1);
    } finally {
      await rig.close();
    }
  });
  it("refuses an untrusted implicit-TLS server without weakening verification", async () => {
    const rig = await smtpRig("accepted", true);
    try {
      expect(await sendSmtpTestMessage(rig.config, "admin@example.test")).toEqual({
        accepted: false,
        code: "email.test_refused",
      });
      expect(rig.messages).toHaveLength(0);
    } finally {
      await rig.close();
    }
  });
  it("requires STARTTLS rather than sending credentials or mail to a plaintext-only server", async () => {
    const rig = await smtpRig("accepted");
    try {
      expect(
        await sendSmtpTestMessage(
          { ...rig.config, url: rig.config.url + "?requireTLS=true" },
          "admin@example.test",
        ),
      ).toEqual({ accepted: false, code: "email.test_refused" });
      expect(rig.messages).toHaveLength(0);
    } finally {
      await rig.close();
    }
  });
});
