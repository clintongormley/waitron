import { describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { createMailpitClient } from "./mailpit-client.js";

const address = (Name: string, Address: string) => ({ Name, Address });

describe("createMailpitClient", () => {
  it("lists the newest captured messages in a browser-safe shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        messages: [
          {
            ID: "message-1",
            From: address("Waitron", "no-reply@waitron.test"),
            To: [address("Alex", "alex@example.test")],
            Subject: "Set up your account",
            Snippet: "Use this link",
            Created: "2026-09-09T18:00:00Z",
            Read: false,
          },
        ],
        messages_count: 1,
      }),
    );

    const result = await createMailpitClient("http://127.0.0.1:8025", fetchImpl).list();

    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8025/api/v1/messages?limit=50");
    expect(result).toEqual({
      count: 1,
      messages: [
        {
          id: "message-1",
          from: { name: "Waitron", address: "no-reply@waitron.test" },
          to: [{ name: "Alex", address: "alex@example.test" }],
          subject: "Set up your account",
          snippet: "Use this link",
          createdAt: "2026-09-09T18:00:00Z",
          read: false,
        },
      ],
    });
  });

  it("reads a captured message as text and never returns Mailpit's HTML", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        ID: "message/1",
        From: address("Waitron", "no-reply@waitron.test"),
        To: [address("", "alex@example.test")],
        Subject: "Reset your password",
        Date: "2026-09-09T18:00:00Z",
        Text: "Open https://waitron.local/manage/account?token=secret",
        HTML: '<script>throw new Error("must not escape")</script>',
      }),
    );

    const result = await createMailpitClient("http://127.0.0.1:8025/", fetchImpl).read("message/1");

    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8025/api/v1/message/message%2F1");
    expect(result).toEqual({
      id: "message/1",
      from: { name: "Waitron", address: "no-reply@waitron.test" },
      to: [{ name: "", address: "alex@example.test" }],
      subject: "Reset your password",
      date: "2026-09-09T18:00:00Z",
      text: "Open https://waitron.local/manage/account?token=secret",
    });
    expect(result).not.toHaveProperty("html");
  });

  it("refuses a failed Mailpit response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));

    await expect(createMailpitClient("http://127.0.0.1:8025", fetchImpl).list()).rejects.toThrow(
      "Mailpit request failed with 503",
    );
  });

  it("refuses an unknown message id as a missing message", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("404 page not found", { status: 404 }));

    const read = createMailpitClient("http://127.0.0.1:8025", fetchImpl).read("no-such-message");

    await expect(read).rejects.toBeInstanceOf(AppError);
    await expect(read).rejects.toMatchObject({ code: "email.message_not_found" });
  });

  it("keeps any other failed message read a plain failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("broken", { status: 500 }));

    const read = createMailpitClient("http://127.0.0.1:8025", fetchImpl).read("message-1");

    await expect(read).rejects.toThrow("Mailpit request failed with 500");
    await expect(read).rejects.not.toBeInstanceOf(AppError);
  });
});
