export const FIXTURE_LIGHT_BG = "#edf6f0";
export const WAITRON_LIGHT_BG = "#f7f7f8";
export const FIXTURE_DARK_BG = "#0b110d";

export const FIXTURE_ANSWER: { hash: string; css: string; logo: null } = {
  hash: "startup-fixture-hash",
  css:
    "@media screen {\n" +
    `  [data-wt-theme-root] {\n    --wt-color-bg: ${FIXTURE_LIGHT_BG};\n  }\n` +
    "  @media (prefers-color-scheme: dark) {\n" +
    `    [data-wt-theme-root]:not([data-theme="light"]) {\n      --wt-color-bg: ${FIXTURE_DARK_BG};\n    }\n` +
    "  }\n" +
    `  [data-wt-theme-root][data-theme="dark"] {\n    --wt-color-bg: ${FIXTURE_DARK_BG};\n  }\n` +
    "}\n",
  logo: null,
};
