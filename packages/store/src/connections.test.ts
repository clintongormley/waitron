import { mkdtempSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { connectionPair, isReadOnlyRefusal, sameWal, settle, walMark } from "./connections.js";

/**
 * Two `:memory:` handles are two separate databases, unlike production's pair over one file, so
 * this suite checks only where a statement is sent, never what a read sees. `./index.test.ts`
 * checks that through a real store.
 */
const pair = () => {
  const write = new DatabaseSync(":memory:");
  const read = new DatabaseSync(":memory:");
  const connections = connectionPair(write, read);
  return {
    write,
    read,
    connections,
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
      // A synchronous body has already ended when it returns, so the reading is taken while a body
      // is suspended.
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
        // The inner body has ended and the outer has not.
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
      // The callback carries the FIRST body's context, which has ended, so it is an outsider to
      // the body running now and must not see rows that body may still undo.
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
    // Both call sites depend on this: the `commit` and the pair's bookkeeping happen before anyone
    // downstream is told the body is over.
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
    // Reading `.errcode` off `null` or `undefined` throws a TypeError, which would replace the
    // caller's failure. The string is the engine's own wording for a read-only refusal, so a
    // classifier matching on the MESSAGE would answer yes.
    expect(isReadOnlyRefusal(null)).toBe(false);
    expect(isReadOnlyRefusal("attempt to write a readonly database")).toBe(false);
    expect(isReadOnlyRefusal(undefined)).toBe(false);
  });
});

describe("the side file's mark", () => {
  const directory = () => mkdtempSync(join(tmpdir(), "waitron-wal-mark-"));

  it("reads a missing side file as absent, and two absent readings as the same", () => {
    const path = join(directory(), "venue.db-wal");
    expect(walMark(path)).toBe("absent");
    expect(sameWal(walMark(path), walMark(path))).toBe(true);
  });

  it("reads a side file that appeared, or changed size, as changed", () => {
    const path = join(directory(), "venue.db-wal");
    const absent = walMark(path);
    writeFileSync(path, "a");
    const first = walMark(path);
    expect(sameWal(absent, first)).toBe(false);
    expect(sameWal(first, absent)).toBe(false);
    expect(sameWal(first, walMark(path))).toBe(true);
    writeFileSync(path, "ab");
    expect(sameWal(first, walMark(path))).toBe(false);
  });

  // A reading that failed says nothing, so the commit is reported rather than lost.
  it("never reads a side file it could not examine as unchanged", () => {
    // Longer than a file name may be, so the lookup is refused rather than answered "missing".
    const path = join(directory(), `${"x".repeat(300)}-wal`);
    expect(walMark(path)).toBe("unreadable");
    expect(sameWal(walMark(path), walMark(path))).toBe(false);
  });

  it("tells listeners on a pair with no file behind it without looking for a side file", () => {
    const write = new DatabaseSync(":memory:");
    write.exec("create table t (id integer primary key)");
    const connections = connectionPair(write, write);
    let heard = 0;
    connections.onCommit(() => {
      heard += 1;
    });
    let mark = connections.changeMark();
    write.exec("insert into t default values");
    connections.reportIfChanged(mark);
    connections.sideFileReset();
    mark = connections.changeMark();
    write.exec("insert into t default values");
    connections.reportIfChanged(mark);
    expect(heard).toBe(2);
    write.close();
  });

  it("reads no count of changed rows while nobody listens", () => {
    const write = new DatabaseSync(":memory:");
    write.exec("create table t (id integer primary key)");
    const connections = connectionPair(write, write);
    const prepare = vi.spyOn(write, "prepare");
    const mark = connections.changeMark();
    write.exec("insert into t default values");
    connections.reportIfChanged(mark);
    expect(mark).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
    // The control: with a listener the count is read, through the same spied method.
    connections.onCommit(() => {});
    expect(connections.changeMark()).toBe(1);
    expect(prepare).toHaveBeenCalledOnce();
    write.close();
  });
});
