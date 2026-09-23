import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { connectionPair, isReadOnlyRefusal, settle } from "./connections.js";

/**
 * Two connections with no file behind them.
 *
 * What is checked here is the rule itself: which of the two a statement is sent to, under nesting,
 * failure and detachment. Identity is the whole of the check — a handle is told apart from the
 * other because it is a different object.
 *
 * Two `:memory:` handles are also two separate DATABASES, which production's pair is not: there
 * both connections open one file. So nothing here can observe what a read SEES, only where it was
 * sent. `./index.test.ts` drives the routing through a real store, and that is where the seeing is
 * checked.
 */
const pair = () => {
  const write = new DatabaseSync(":memory:");
  const read = new DatabaseSync(":memory:");
  const connections = connectionPair(write, read);
  return {
    write,
    read,
    connections,
    /** Where a statement issued at this moment would go. */
    where: () => (connections.forStatement() === write ? "write" : "read"),
    close: () => {
      write.close();
      read.close();
    },
  };
};

describe("the connection pair", () => {
  it("sends a statement to the writer when no transaction body of its own is running", () => {
    const p = pair();
    try {
      expect(p.where()).toBe("write");
    } finally {
      p.close();
    }
  });

  it("sends a statement inside its own body to the writer", () => {
    const p = pair();
    try {
      expect(p.connections.asTransactionBody(() => p.where())).toBe("write");
    } finally {
      p.close();
    }
  });

  it("sends a statement outside a running body to the reader", async () => {
    const p = pair();
    try {
      // A synchronous body has already ended by the time it returns, so the reading has to happen
      // while a body is still suspended — which is what a transaction body awaiting anything is.
      const held = p.connections.asTransactionBody(
        () => new Promise<void>((resolve) => setImmediate(resolve)),
      );
      expect(p.where()).toBe("read");
      await held;
    } finally {
      p.close();
    }
  });

  it("stops sending to the reader once the body has finished", async () => {
    const p = pair();
    try {
      const held = p.connections.asTransactionBody(
        () => new Promise<void>((resolve) => setImmediate(resolve)),
      );
      expect(p.where()).toBe("read");
      await held;
      expect(p.where()).toBe("write");
    } finally {
      p.close();
    }
  });

  it("stops sending to the reader when a synchronous body throws", () => {
    const p = pair();
    try {
      expect(() =>
        p.connections.asTransactionBody(() => {
          throw new Error("deliberate");
        }),
      ).toThrow("deliberate");
      // The token has to leave the running set on the failing path too, or every later statement
      // in the process is routed to a reader on behalf of a body that is long gone.
      expect(p.where()).toBe("write");
    } finally {
      p.close();
    }
  });

  it("stops sending to the reader when a body's promise rejects", async () => {
    const p = pair();
    try {
      await expect(
        p.connections.asTransactionBody(() => Promise.reject(new Error("deliberate"))),
      ).rejects.toThrow("deliberate");
      expect(p.where()).toBe("write");
    } finally {
      p.close();
    }
  });

  it("keeps sending to the writer while an OUTER body is still running", async () => {
    const p = pair();
    try {
      await p.connections.asTransactionBody(async () => {
        p.connections.asTransactionBody(() => {
          expect(p.where()).toBe("write");
        });
        // The inner body has ended and the outer has not: a statement here is still inside a
        // running body of this pair's, so it stays on the writer. A flag that the inner body
        // cleared would send it to the reader.
        await Promise.resolve();
        expect(p.where()).toBe("write");
      });
      expect(p.where()).toBe("write");
    } finally {
      p.close();
    }
  });

  it("sends work detached from a finished body to the reader while another body runs", async () => {
    const p = pair();
    try {
      let resume!: () => void;
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      let detached!: Promise<string>;
      await p.connections.asTransactionBody(async () => {
        detached = gate.then(() => p.where());
      });

      let finish!: () => void;
      const later = p.connections.asTransactionBody(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      resume();
      // The detached callback carries the FIRST body's context, and that body ended long ago, so
      // it is an outsider to the one running now. Reading its inherited mark as "inside" would put
      // it on the writer, where it would see rows this later body may still undo.
      expect(await detached).toBe("read");
      finish();
      await later;
    } finally {
      p.close();
    }
  });
});

describe("settle", () => {
  it("runs the success side at once for a body that is already finished", () => {
    const seen: string[] = [];
    expect(
      settle(
        "value",
        () => seen.push("ok"),
        () => seen.push("fail"),
      ),
    ).toBe("value");
    expect(seen).toEqual(["ok"]);
  });

  it("waits for a pending body before running the success side", async () => {
    const seen: string[] = [];
    const result = settle(
      Promise.resolve("value"),
      () => seen.push("ok"),
      () => seen.push("fail"),
    );
    expect(seen).toEqual([]);
    expect(await result).toBe("value");
    expect(seen).toEqual(["ok"]);
  });

  it("runs the failure side and re-throws for a pending body that rejects", async () => {
    const seen: string[] = [];
    await expect(
      settle(
        Promise.reject(new Error("deliberate")),
        () => seen.push("ok"),
        () => seen.push("fail"),
      ),
    ).rejects.toThrow("deliberate");
    expect(seen).toEqual(["fail"]);
  });

  it("finishes before whatever the caller chains onto its result", async () => {
    const seen: string[] = [];
    // The ordering both call sites depend on: the transaction's `commit` and the pair's own
    // bookkeeping happen before anyone downstream is told the body is over.
    await settle(
      Promise.resolve("value"),
      () => seen.push("ok"),
      () => seen.push("fail"),
    ).then(() => seen.push("downstream"));
    expect(seen).toEqual(["ok", "downstream"]);
  });
});

describe("isReadOnlyRefusal", () => {
  it("recognises the engine's read-only refusal by its code", () => {
    expect(isReadOnlyRefusal(Object.assign(new Error("readonly"), { errcode: 8 }))).toBe(true);
  });

  it("does not recognise a refusal for any other reason", () => {
    expect(isReadOnlyRefusal(Object.assign(new Error("logic"), { errcode: 1 }))).toBe(false);
  });

  it("answers no rather than throwing for a value that is not an object", () => {
    // `null` and `undefined` are the two that would take a property read with them and replace
    // the failure the caller has to see with a TypeError — measured on Node v26.7.0, reading
    // `.errcode` off either throws one — and `typeof null` is `"object"`, which is why the null
    // check is written out. The string is here for a different reason: reading `.errcode` off it
    // gives plain `undefined` rather than a TypeError, and the value chosen is the engine's own
    // wording for a read-only refusal, so a classifier matching on the MESSAGE would answer yes.
    expect(isReadOnlyRefusal(null)).toBe(false);
    expect(isReadOnlyRefusal("attempt to write a readonly database")).toBe(false);
    expect(isReadOnlyRefusal(undefined)).toBe(false);
  });
});
