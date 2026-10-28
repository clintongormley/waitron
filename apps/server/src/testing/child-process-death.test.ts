import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expectChildKilled } from "./child-process-death.js";

const run = (source: string) => promisify(execFile)(process.execPath, ["-e", source]);

describe("expectChildKilled", () => {
  it("accepts a child killed by the expected signal after the expected output", async () => {
    await expectChildKilled(
      run(`process.stdout.write("reached\\n"); process.kill(process.pid, "SIGKILL");`),
      { signal: "SIGKILL", stdout: "reached\n" },
    );
  });

  it("names the exit code, stdout and stderr of a child that exited instead", async () => {
    const failure = await expectChildKilled(
      run(
        `process.stdout.write("partial"); process.stderr.write("the real refusal"); process.exit(3);`,
      ),
      { signal: "SIGKILL", stdout: "reached\n" },
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain("exit code 3");
    expect(message).toContain("signal null");
    expect(message).toContain("partial");
    expect(message).toContain("the real refusal");
  });

  it("compares only the signal when no stdout is expected", async () => {
    await expectChildKilled(
      run(`process.stdout.write("anything"); process.kill(process.pid, "SIGKILL");`),
      { signal: "SIGKILL" },
    );
    await expect(
      expectChildKilled(run(`process.stderr.write("refused"); process.exit(1);`), {
        signal: "SIGKILL",
      }),
    ).rejects.toThrow(/exit code 1[\s\S]*refused/);
  });

  it("refuses a child that finished successfully", async () => {
    await expect(
      expectChildKilled(run(`process.stdout.write("reached\\n");`), {
        signal: "SIGKILL",
        stdout: "reached\n",
      }),
    ).rejects.toThrow(/exit code 0[\s\S]*reached/);
  });
});
