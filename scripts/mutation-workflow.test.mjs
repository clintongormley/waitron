import { describe, expect, it } from "vitest";

const fixture = () =>
  "name: mutation\njobs:\n  select:\n    runs-on: x\n  mutation-db:\n    needs: select\n    if: needs.select.outputs.db == 'true'\n    uses: ./.github/workflows/mutation-sharded.yml\n    with:\n      package: db\n      shards: '[1, 2, 3]'\n      browser: false\n      minutes: 25\n";
const read = async (text) => (await import("./mutation-workflow.mjs")).mutationCallers(text);

describe("mutation workflow callers", () => {
  it("reads the shard list and bounded setup of each local caller", async () => {
    const callers = await read(fixture());
    expect(callers).toHaveLength(1);
    expect(callers[0]).toMatchObject({
      id: "mutation-db",
      package: "db",
      shards: [1, 2, 3],
      browser: false,
      minutes: 25,
    });
    expect(callers[0].body).toContain("    needs: select");
    expect(callers[0].body).toContain("    if: needs.select.outputs.db == 'true'");
    const browser = await read(
      fixture()
        .replace("package: db", "package: ui")
        .replace("browser: false", "browser: true")
        .replace("minutes: 25", "minutes: 50"),
    );
    expect(browser[0]).toMatchObject({ package: "ui", browser: true, minutes: 50 });
  });

  it("reads the double-quoted shard input written by the formatter", async () => {
    const text = fixture().replace("shards: '[1, 2, 3]'", 'shards: "[1, 2, 3]"');
    expect((await read(text))[0].shards).toEqual([1, 2, 3]);
  });

  it("leaves unrelated jobs out so membership can be checked independently", async () => {
    expect(await read("name: x\njobs:\n  a:\n    uses: ./.github/workflows/other.yml\n")).toEqual(
      [],
    );
  });

  it.each([
    ["package: db", "package: ../db"],
    ["package: db", "# package absent"],
    ["shards: '[1, 2, 3]'", "# shards absent"],
    ["shards: '[1, 2, 3]'", "shards: [1, 2, 3]"],
    ["shards: '[1, 2, 3]'", "shards: invalid"],
    ["shards: '[1, 2, 3]'", "shards: '{}'"],
    ["shards: '[1, 2, 3]'", "shards: '[]'"],
    ["shards: '[1, 2, 3]'", "shards: '[1, 3]'"],
    ["browser: false", "browser: yes"],
    ["minutes: 25", "minutes: 0"],
    ["minutes: 25", "minutes: 2.5"],
    ["minutes: 25", "minutes: -1"],
    ["minutes: 25", "minutes: $" + "{{ inputs.minutes }}"],
    ["minutes: 25", "# minutes absent"],
  ])("refuses a caller with %s changed to %s", async (before, after) => {
    await expect(read(fixture().replace(before, after))).rejects.toThrow(/mutation-db/);
  });
});
