// Builds the A783 boards (sixteen calendar colours, and the colour chooser as four columns) and
// renders them with the workspace's playwright Chromium.
// Run from the worktree root: node docs/backlog/mockups/a783-sixteen-colours/shoot.mjs
// Every contrast is computed here with the formula and the pairs of
// packages/ui-core/src/tokens/colors.test.ts, and printed; a failing check stops the run.
// The chooser shots are the real wt-modal, wt-input and wt-colour-chooser, bundled by vite from
// packages/ui; the only change made to them is the column count, set on the panel's grid.
/* global console, document, getComputedStyle */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../../..");
const require = createRequire(join(repo, "packages/ui/package.json"));
const { chromium } = require("playwright");
const { build } = await import(require.resolve("vite"));

// palette: [fill, text on it]; station: [pale fill, dot]. Values not marked new are copied from
// packages/ui-core/src/tokens/colors.css. Grey has no station tokens: see stationOf.
const COLOURS = [
  { key: "red", en: "Red", es: "Rojo", period: "Dinner", station: "Grill", palette: { light: ["#c62828", "#ffffff"], dark: ["#ff7a70", "#2a0705"] }, pale: { light: ["#fde2e1", "#d64545"], dark: ["#592222", "#e15656"] } },
  { key: "orange", en: "Orange", es: "Naranja", period: "Brunch", station: "Fryer", palette: { light: ["#ef7a1e", "#2a1000"], dark: ["#ff8a3d", "#2a1000"] }, pale: { light: ["#fde6cf", "#c26a1f"], dark: ["#55301a", "#e09452"] } },
  { key: "amber", en: "Amber", es: "Ámbar", period: "Lunch", station: "Bakery", palette: { light: ["#f5a623", "#241500"], dark: ["#f5b34a", "#241500"] }, pale: { light: ["#fcefc0", "#a67a00"], dark: ["#44391a", "#e0ba52"] } },
  { key: "yellow", en: "Yellow", es: "Amarillo", isNew: true, period: "Pool bar", station: "Plancha", palette: { light: ["#fbdf1d", "#231c00"], dark: ["#f6e04a", "#221c00"] }, pale: { light: ["#f7f2a8", "#827800"], dark: ["#3e3c0c", "#dcd43c"] } },
  { key: "lime", en: "Lime", es: "Lima", period: "Terrace", station: "Salad", palette: { light: ["#84cc16", "#121d00"], dark: ["#a6dc4a", "#142000"] }, pale: { light: ["#e9f4c9", "#688c19"], dark: ["#323f18", "#b1e052"] } },
  { key: "green", en: "Green", es: "Verde", period: "Breakfast", station: "Cold", palette: { light: ["#1e7a4f", "#ffffff"], dark: ["#4ac08d", "#06190f"] }, pale: { light: ["#d6f0dc", "#2d934b"], dark: ["#194325", "#52e07a"] } },
  { key: "teal", en: "Teal", es: "Turquesa", period: "Afternoon", station: "Sushi", palette: { light: ["#0c7480", "#ffffff"], dark: ["#1fa596", "#03201c"] }, pale: { light: ["#d0eeea", "#1e9085"], dark: ["#19413d", "#52e0d2"] } },
  { key: "cyan", en: "Cyan", es: "Cian", period: "Tapas", station: "Drinks", palette: { light: ["#22b8d8", "#04161c"], dark: ["#8be0f2", "#04181e"] }, pale: { light: ["#d3ecf7", "#1a8abb"], dark: ["#1d3f4e", "#52b6e0"] } },
  { key: "sky", en: "Sky", es: "Celeste", isNew: true, period: "Rooftop", station: "Coffee", palette: { light: ["#0a8fd6", "#04121f"], dark: ["#3cb4f2", "#041422"] }, pale: { light: ["#cce6fe", "#1f77cf"], dark: ["#0a2c43", "#3a9fe8"] } },
  { key: "blue", en: "Blue", es: "Azul", period: "Evening", station: "Pass", palette: { light: ["#2f55d4", "#ffffff"], dark: ["#7aa2ff", "#06101f"] }, pale: { light: ["#dce6fb", "#2f66d6"], dark: ["#223459", "#5483e1"] } },
  { key: "indigo", en: "Indigo", es: "Índigo", period: "Late", station: "Wok", palette: { light: ["#3730a3", "#ffffff"], dark: ["#8b7bff", "#120c3a"] }, pale: { light: ["#e1e0f8", "#5b55d0"], dark: ["#242259", "#7e79e7"] } },
  { key: "purple", en: "Purple", es: "Morado", period: "Events", station: "Pastry", palette: { light: ["#7e3fb8", "#ffffff"], dark: ["#c39bf0", "#1d0b33"] }, pale: { light: ["#ecdff8", "#8d4fcf"], dark: ["#3d2259", "#a667e4"] } },
  { key: "magenta", en: "Magenta", es: "Magenta", isNew: true, period: "Cocktails", station: "Dessert", palette: { light: ["#c0139f", "#ffffff"], dark: ["#ec6ae6", "#2a0628"] }, pale: { light: ["#fcd7fa", "#b8259f"], dark: ["#4d1d4b", "#dc5ad6"] } },
  { key: "pink", en: "Pink", es: "Rosa", period: "Happy hour", station: "Pizza", palette: { light: ["#c2185b", "#ffffff"], dark: ["#ff8cc6", "#2e0619"] }, pale: { light: ["#fbdfec", "#d2468c"], dark: ["#59223d", "#e05299"] } },
  { key: "brown", en: "Brown", es: "Marrón", period: "Morning", station: "Oven", palette: { light: ["#7a4b2a", "#ffffff"], dark: ["#c9976e", "#1f1006"] }, pale: { light: ["#eee2d6", "#8a5a3c"], dark: ["#42362c", "#c29170"] } },
  { key: "grey", en: "Grey", es: "Gris", period: "Staff meal", station: "Prep", palette: { light: ["#6b6e78", "#ffffff"], dark: ["#8b8d98", "#101216"] } },
];
// From colors.css: what colors.test.ts measures the calendar and station colours against.
const THEME = {
  light: { bg: "#f7f7f8", surface: "#ffffff", lifted: "#e3ebfb", text: "#16181d", muted: "#5c626e", warning: "#8a5300", danger: "#b3261e", focus: "#1f6feb", border: "#d6d9e0", standard: "#dff3e8", closed: "#3a3b42" },
  dark: { bg: "#101216", surface: "#191c22", lifted: "#2f3a4d", text: "#eceef2", muted: "#a1a7b3", warning: "#f2b24c", danger: "#ff7f73", focus: "#4c8dff", border: "#333945", standard: "#183626", closed: "#d5d7de" },
};
const THEMES = ["light", "dark"];

const hexChannels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// station-colour-styles.ts draws a colour with no station tokens (grey, today) as
// color-mix(in srgb, <palette fill> 15%, var(--wt-color-surface)) with the palette fill as its dot.
const mixed = (fill, surface) =>
  `#${hexChannels(fill)
    .map((c, i) => Math.round(0.15 * c + 0.85 * hexChannels(surface)[i]).toString(16).padStart(2, "0"))
    .join("")}`;
const stationOf = (c, theme) => c.pale?.[theme] ?? [mixed(c.palette[theme][0], THEME[theme].surface), c.palette[theme][0]];

const luminance = (hex) => {
  const [r, g, b] = hexChannels(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const fmt = (n) => `${n.toFixed(2)}:1`;

// CIELAB and CIEDE2000, as colors.test.ts computes them for its station-fill spacing check.
const lab = (hex) => {
  const [r, g, b] = hexChannels(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const deltaE = (one, two) => {
  const [[l1, a1, b1], [l2, a2, b2]] = [lab(one), lab(two)];
  const rad = Math.PI / 180;
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const [ap1, ap2] = [(1 + g) * a1, (1 + g) * a2];
  const [cp1, cp2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)];
  const hue = (b, a) => (Math.atan2(b, a) / rad + 360) % 360;
  const [hp1, hp2] = [hue(b1, ap1), hue(b2, ap2)];
  let dh = hp2 - hp1;
  if (cp1 * cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dL = l2 - l1;
  const dC = cp2 - cp1;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh / 2) * rad);
  const lBar = (l1 + l2) / 2;
  const cpBar = (cp1 + cp2) / 2;
  const hBar =
    cp1 * cp2 === 0
      ? hp1 + hp2
      : Math.abs(hp1 - hp2) <= 180
        ? (hp1 + hp2) / 2
        : (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2;
  const t =
    1 -
    0.17 * Math.cos((hBar - 30) * rad) +
    0.24 * Math.cos(2 * hBar * rad) +
    0.32 * Math.cos((3 * hBar + 6) * rad) -
    0.2 * Math.cos((4 * hBar - 63) * rad);
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cpBar;
  const sH = 1 + 0.015 * cpBar * t;
  const rT = -2 * Math.sqrt(cpBar ** 7 / (cpBar ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hBar - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2 + rT * (dC / sC) * (dH / sH));
};

// The checks colors.test.ts makes, over the sixteen. Its station list leaves grey out, so grey's
// mixed station drawing is measured and printed but does not stop the run.
const failures = [];
const check = (ok, what) => ok || failures.push(what);
const STATIONED = COLOURS.filter((c) => c.pale);
const measured = Object.fromEntries(
  THEMES.map((theme) => {
    const t = THEME[theme];
    const fills = STATIONED.map((c) => c.pale[theme][0]);
    const rows = COLOURS.map((c) => {
      const [fill, on] = c.palette[theme];
      const [pale, dot] = stationOf(c, theme);
      const text = Math.min(...[t.text, t.muted, t.warning, t.danger].map((x) => ratio(x, pale)));
      const dotLow = Math.min(...[...fills, t.surface].map((ground) => ratio(dot, ground)));
      return { c, fill, on, pale, dot, onRatio: ratio(fill, on), text, dotLow, focus: ratio(t.focus, pale) };
    });
    for (const r of rows) {
      check(r.onRatio >= 4.5, `${theme} ${r.c.key}: text on fill ${fmt(r.onRatio)}`);
      check(![t.standard, t.closed].includes(r.fill), `${theme} ${r.c.key}: fill is a day colour`);
      if (!r.c.pale) continue;
      check(r.text >= 4.5, `${theme} ${r.c.key}: text on station fill ${fmt(r.text)}`);
      check(r.dotLow >= 3, `${theme} ${r.c.key}: dot ${fmt(r.dotLow)}`);
      check(r.focus >= 3, `${theme} ${r.c.key}: focus ring on station fill ${fmt(r.focus)}`);
    }
    check(ratio(t.focus, t.lifted) >= 3, `${theme}: focus on the hover tint`);
    check(new Set(rows.map((r) => r.fill)).size === COLOURS.length, `${theme}: two palette fills alike`);
    check(new Set(fills).size === fills.length, `${theme}: two station fills alike`);
    check(new Set(STATIONED.map((c) => c.pale[theme][1])).size === fills.length, `${theme}: two dots alike`);
    return [theme, rows];
  }),
);
const pairs = (theme) =>
  STATIONED.flatMap((one, i) =>
    STATIONED.slice(i + 1).map((two) => ({ names: `${one.key}/${two.key}`, apart: deltaE(one.pale[theme][0], two.pale[theme][0]) })),
  ).sort((a, b) => a.apart - b.apart);
const closestLight = pairs("light")[0].apart;
check(closestLight > 4, `closest light station fills only ${closestLight.toFixed(2)} apart`);
for (const pair of pairs("dark")) check(pair.apart >= closestLight, `dark ${pair.names} ${pair.apart.toFixed(2)} < ${closestLight.toFixed(2)}`);

for (const theme of THEMES) {
  console.log(`\n${theme}: colour   | fill/text         | text    | station fill/dot  | weakest text | dot (min) | focus`);
  for (const r of measured[theme])
    console.log(
      `${theme.padEnd(5)}  ${(r.c.key + (r.c.isNew ? "*" : "")).padEnd(8)} | ${r.fill}/${r.on} | ${fmt(r.onRatio).padEnd(7)} | ${r.pale}/${r.dot} | ${fmt(r.text).padEnd(12)} | ${fmt(r.dotLow).padEnd(9)} | ${fmt(r.focus)}${r.c.pale ? "" : "  (mixed, not in the test's list)"}`,
    );
}
console.log("\n* new. Closest station fills, light:", pairs("light").slice(0, 3).map((p) => `${p.names} ${p.apart.toFixed(2)}`).join(", "));
console.log("Closest station fills, dark:", pairs("dark").slice(0, 3).map((p) => `${p.names} ${p.apart.toFixed(2)}`).join(", "));
const byKey = Object.fromEntries(COLOURS.map((c) => [c.key, c]));
const RISKY = [
  ["magenta", "pink", "purple"],
  ["sky", "cyan", "blue"],
  ["yellow", "amber", "lime"],
];
console.log("Colour difference (CIEDE2000) of each new colour from its risky neighbours:");
for (const theme of THEMES)
  for (const [mine, ...others] of RISKY)
    console.log(
      `  ${theme} ${mine}: ${others
        .map((o) => `${o} fill ${deltaE(byKey[mine].palette[theme][0], byKey[o].palette[theme][0]).toFixed(1)}, station ${deltaE(stationOf(byKey[mine], theme)[0], stationOf(byKey[o], theme)[0]).toFixed(1)}, dot ${deltaE(stationOf(byKey[mine], theme)[1], stationOf(byKey[o], theme)[1]).toFixed(1)}`)
        .join("; ")}`,
    );
const closestPalette = (theme) =>
  COLOURS.flatMap((one, i) =>
    COLOURS.slice(i + 1).map((two) => ({ names: `${one.key}/${two.key}`, apart: deltaE(one.palette[theme][0], two.palette[theme][0]) })),
  ).sort((a, b) => a.apart - b.apart)[0];
for (const theme of THEMES) {
  const p = closestPalette(theme);
  console.log(`Closest pair of strong fills, ${theme}: ${p.names} ${p.apart.toFixed(1)}`);
}
if (failures.length) throw new Error(`checks failed:\n${failures.join("\n")}`);
console.log("Every check colors.test.ts makes passes for the sixteen, in both themes.");

const page = (theme, title, body, width = 640) => {
  const t = THEME[theme];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>
  body { margin: 0; background: ${t.bg}; color: ${t.text}; font: 14px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: ${width}px; box-sizing: border-box; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 18px 0 8px; }
  p { margin: 0 0 8px; color: ${t.muted}; font-size: 13px; }
  .card { background: ${t.surface}; border: 1px solid ${t.border}; border-radius: 8px; padding: 4px 8px; }
  .row { display: grid; grid-template-columns: 112px 112px 1fr 76px 132px; align-items: center; gap: 10px; padding: 5px 0; }
  .row + .row { border-top: 1px solid ${t.border}; }
  .head { font-size: 11px; color: ${t.muted}; padding-bottom: 0; }
  .chip { border-radius: 6px; padding: 7px 8px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .station { border-radius: 6px; padding: 7px 8px; font-weight: 600; color: ${t.text}; white-space: nowrap; display: flex; align-items: center; gap: 4px; }
  .dot { flex: none; width: 8px; height: 8px; border-radius: 9999px; }
  .name b { display: block; }
  .name span { color: ${t.muted}; font-size: 12px; }
  .ratio { font-variant-numeric: tabular-nums; font-weight: 600; text-align: right; }
  .ratio small { display: block; font-weight: 400; color: ${t.muted}; font-size: 11px; }
  .tag { display: inline-block; font-size: 11px; font-weight: 600; border: 1px solid ${t.text}; border-radius: 4px; padding: 0 4px; margin-left: 4px; }
  .bar { display: flex; gap: 0; height: 36px; border-radius: 6px; overflow: hidden; margin: 6px 0; }
  .bar > div { flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px; font-weight: 600; font-size: 12.5px; }
  .label { font-size: 12px; color: ${t.muted}; margin-top: 10px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
</style></head><body data-theme="${theme}"><main>${body}</main></body></html>`;
};

const tag = (c) => (c.isNew ? '<span class="tag">new</span>' : "");
const chip = (c, theme, text = c.period) =>
  `<div class="chip" style="background:${c.palette[theme][0]};color:${c.palette[theme][1]}">${text}</div>`;
const station = (c, theme, text = c.station) => {
  const [fill, dot] = stationOf(c, theme);
  return `<div class="station" style="background:${fill}"><span class="dot" style="background:${dot}"></span>${text}</div>`;
};
const swatchBoard = (theme) => {
  const rows = measured[theme]
    .map(
      (r) =>
        `<div class="row">${chip(r.c, theme)}${station(r.c, theme)}<div class="name"><b>${r.c.en}${tag(r.c)}</b><span>${r.c.es} · ${r.fill} · ${r.pale}${r.c.pale ? "" : " (mixed)"}</span></div><div class="ratio">${fmt(r.onRatio)}<small>name on fill</small></div><div class="ratio">${fmt(r.text)} · ${fmt(r.dotLow)}<small>text · dot (weakest)</small></div></div>`,
    )
    .join("");
  return page(
    theme,
    `A783 sixteen colours, ${theme}`,
    `<h1>Sixteen calendar colours — ${theme} theme</h1>
<p>Left: drawn as a period or staff role is, a strong fill with the name written on it. Middle: drawn as a prep station is, a pale fill with a dot. The three marked new are yellow, sky and magenta; the other thirteen are today's, unchanged.</p>
<p>Numbers: contrast of the name on the strong fill (4.5:1 is the readable minimum); on the pale fill, the weakest of the text, muted, warning and danger colours, and the dot against every station fill and the page (3:1 minimum). Grey has no pale fill of its own today; it is mixed from the grey, 15% into the page colour.</p>
<div class="card"><div class="row head"><div>Period</div><div>Station</div><div>Colour</div><div class="ratio">Name</div><div class="ratio">Station</div></div>${rows}</div>`,
  );
};

const chipBar = (keys, theme) => `<div class="bar">${keys.map((k) => `<div style="background:${byKey[k].palette[theme][0]};color:${byKey[k].palette[theme][1]}">${byKey[k].en}</div>`).join("")}</div>`;
const stationBar = (keys, theme) =>
  `<div class="bar">${keys
    .map((k) => {
      const [fill, dot] = stationOf(byKey[k], theme);
      return `<div style="background:${fill};color:${THEME[theme].text}"><span class="dot" style="background:${dot}"></span>${byKey[k].en}</div>`;
    })
    .join("")}</div>`;
const ROWS = [0, 4, 8, 12].map((i) => COLOURS.slice(i, i + 4).map((c) => c.key));
const neighbourBoard = (theme) =>
  page(
    theme,
    `A783 neighbouring colours, ${theme}`,
    `<h1>Each new colour beside its closest neighbours — ${theme}</h1>
<p>Left, the strong fills of periods and staff roles; right, the pale fills of prep stations. Periods sit side by side in a day, so the closest colours are shown touching.</p>
${RISKY.map(([mine, ...others]) => {
  const keys = [others[0], mine, others[1]];
  return `<div class="label">${byKey[mine].en} between ${byKey[others[0]].en.toLowerCase()} and ${byKey[others[1]].en.toLowerCase()}</div><div class="pair"><div>${chipBar(keys, theme)}</div><div>${stationBar(keys, theme)}</div></div>`;
}).join("")}
<div class="label">All sixteen, in the chooser's order: four rows of four</div>
<div class="pair"><div>${ROWS.map((keys) => chipBar(keys, theme)).join("")}</div><div>${ROWS.map((keys) => stationBar(keys, theme)).join("")}</div></div>`,
  );

// The chooser: one page, set by its query string (theme, lang, cols).
const tmp = mkdtempSync(join(tmpdir(), "a783-"));
let bundle;
try {
  const entry = join(tmp, "entry.js");
  writeFileSync(
    entry,
    ["ui-core/src/tokens/index.ts", "ui/src/components/wt-modal.ts", "ui/src/components/wt-input.ts", "ui/src/components/wt-colour-chooser.ts"]
      .map((file, i) => (i ? `import ${JSON.stringify(join(repo, "packages", file))};` : `export { applyTokens } from ${JSON.stringify(join(repo, "packages", file))};`))
      .join("\n"),
  );
  const out = await build({
    root: join(repo, "packages/ui"),
    configFile: false,
    logLevel: "warn",
    build: { write: false, minify: true, lib: { entry, formats: ["iife"], name: "wt", fileName: "bundle" } },
  });
  bundle = (Array.isArray(out) ? out : [out])[0].output[0].code;
} finally {
  rmSync(tmp, { recursive: true });
}
const CHOOSER_STRINGS = {
  en: { heading: "Edit period · Restaurant", name: "Name", period: "Afternoon", colour: "Colour", usedBy: { amber: ["Lunch", "Bar"], red: ["Dinner"] } },
  es: { heading: "Editar periodo · Restaurante", name: "Nombre", period: "Tarde", colour: "Color", usedBy: { amber: ["Comida", "Bar"], red: ["Cena"] } },
};
const chooserPage = `<!doctype html><html><head><meta charset="utf-8"><title>A783 colour chooser</title>
<style>body { margin: 0; } #root { min-height: 100vh; background: var(--wt-color-bg); }</style></head>
<body><div id="root"></div>
<script>${bundle.replace(/<\/script/g, "<\\/script")}</script>
<script>
const COLOURS = ${JSON.stringify(COLOURS.map(({ key, en, es, palette }) => ({ key, en, es, palette })))};
const STRINGS = ${JSON.stringify(CHOOSER_STRINGS)};
const params = new URLSearchParams(location.search);
const theme = params.get("theme") || "light";
const lang = params.get("lang") || "en";
const cols = Number(params.get("cols") || 4);
const s = STRINGS[lang];
const root = document.getElementById("root");
document.documentElement.lang = lang;
root.dataset.theme = theme;
wt.applyTokens(root);
const modal = document.createElement("wt-modal");
modal.size = "compact";
modal.heading = s.heading;
const form = document.createElement("div");
form.style.cssText = "display:flex;flex-direction:column;gap:var(--wt-space-4)";
const input = document.createElement("wt-input");
input.label = s.name;
input.required = true;
input.value = s.period;
const chooser = document.createElement("wt-colour-chooser");
chooser.label = s.colour;
chooser.required = true;
chooser.value = "teal";
chooser.choices = COLOURS.map((c) => ({ value: c.key, label: c[lang], fill: c.palette[theme][0], usedBy: s.usedBy[c.key] }));
form.append(input, chooser);
modal.append(form);
root.append(modal);
(async () => {
  await customElements.whenDefined("wt-colour-chooser");
  modal.open = true;
  await modal.updateComplete;
  await chooser.updateComplete;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('[role="radiogroup"] { grid-template-columns: repeat(' + cols + ', minmax(0, 1fr)); }');
  chooser.shadowRoot.adoptedStyleSheets = [...chooser.shadowRoot.adoptedStyleSheets, sheet];
  chooser.show();
  document.body.dataset.ready = "true";
})();
</script></body></html>`;

const files = {
  "1-colours-light": swatchBoard("light"),
  "2-colours-dark": swatchBoard("dark"),
  "3-neighbours-light": neighbourBoard("light"),
  "4-neighbours-dark": neighbourBoard("dark"),
};
const CHOOSER_SHOTS = [
  ["5-chooser-desktop-light-en", 1280, "light", "en", 4],
  ["6-chooser-desktop-light-es", 1280, "light", "es", 4],
  ["7-chooser-desktop-dark-en", 1280, "dark", "en", 4],
  ["8-chooser-desktop-dark-es", 1280, "dark", "es", 4],
  ["9-chooser-phone-4x4-en", 390, "light", "en", 4],
  ["10-chooser-phone-4x4-es", 390, "light", "es", 4],
  ["11-chooser-phone-2x8-en", 390, "light", "en", 2],
  ["12-chooser-phone-2x8-es", 390, "light", "es", 2],
];

// Runs in the page: the panel's and trigger's widths, and for each tile how many lines its
// colour name takes and whether any text runs past its box.
const measurePanel = () => {
  const chooser = document.querySelector("wt-colour-chooser");
  const shadow = chooser.shadowRoot;
  const panel = shadow.querySelector("[popover]");
  const lines = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  };
  const tiles = [...shadow.querySelectorAll(".tile")].map((tile) => {
    const name = tile.querySelector(".colour-name");
    const usedBy = tile.querySelector(".used-by");
    return {
      value: tile.dataset.value,
      label: name.textContent,
      tileWidth: Math.round(tile.getBoundingClientRect().width),
      nameLines: lines(name),
      usedByLines: usedBy ? lines(usedBy) : 0,
      overflow: [name, usedBy].filter(Boolean).some((el) => el.scrollWidth > el.clientWidth),
    };
  });
  return {
    open: panel.matches(":popover-open"),
    panelWidth: Math.round(panel.getBoundingClientRect().width),
    triggerWidth: Math.round(shadow.querySelector("button.trigger").getBoundingClientRect().width),
    columns: getComputedStyle(shadow.querySelector('[role="radiogroup"]')).gridTemplateColumns,
    tiles,
  };
};

const browser = await chromium.launch();
try {
  for (const [name, html] of Object.entries(files)) {
    const context = await browser.newContext({ viewport: { width: 640, height: 800 }, deviceScaleFactor: 2 });
    const tab = await context.newPage();
    const file = join(here, `${name}.html`);
    writeFileSync(file, html);
    await tab.goto(`file://${file}`);
    await tab.locator("main").screenshot({ path: join(here, `${name}.png`) });
    await context.close();
  }
  const chooserFile = join(here, "chooser.html");
  writeFileSync(chooserFile, chooserPage);
  for (const [name, width, theme, lang, cols] of CHOOSER_SHOTS) {
    const context = await browser.newContext({ viewport: { width, height: width > 600 ? 800 : 844 }, deviceScaleFactor: 2, colorScheme: theme });
    const tab = await context.newPage();
    const errors = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    await tab.goto(`file://${chooserFile}?theme=${theme}&lang=${lang}&cols=${cols}`);
    await tab.waitForSelector("body[data-ready]", { timeout: 10000 }).catch(() => {
      throw new Error(`${name}: chooser did not open. ${errors.join("; ")}`);
    });
    await tab.mouse.move(0, 0);
    const result = await tab.evaluate(measurePanel);
    if (!result.open) throw new Error(`${name}: panel not open`);
    const wrapped = result.tiles.filter((tile) => tile.nameLines > 1 || tile.overflow);
    console.log(
      `\n${name}: panel ${result.panelWidth}px, field ${result.triggerWidth}px, columns ${result.columns}; tiles ${[...new Set(result.tiles.map((tile) => tile.tileWidth))].join("/")}px wide`,
    );
    console.log(
      wrapped.length
        ? `  names that do not fit on one line: ${wrapped.map((tile) => `${tile.label} (${tile.nameLines} lines${tile.overflow ? ", overflows" : ""})`).join(", ")}`
        : "  every colour name fits on one line",
    );
    const usedBy = result.tiles.filter((tile) => tile.usedByLines);
    console.log(`  used-by lines: ${usedBy.map((tile) => `${tile.label} ${tile.usedByLines} line(s)`).join(", ")}`);
    if (width > 600) {
      const box = await tab.evaluate(() => {
        const dialog = document.querySelector("wt-modal").shadowRoot.querySelector("dialog").getBoundingClientRect();
        const panel = document.querySelector("wt-colour-chooser").shadowRoot.querySelector("[popover]").getBoundingClientRect();
        return { x: Math.min(dialog.left, panel.left), y: Math.min(dialog.top, panel.top), right: Math.max(dialog.right, panel.right), bottom: Math.max(dialog.bottom, panel.bottom) };
      });
      const pad = 24;
      await tab.screenshot({
        path: join(here, `${name}.png`),
        clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(width, box.right + pad) - Math.max(0, box.x - pad), height: Math.min(800, box.bottom + pad) - Math.max(0, box.y - pad) },
      });
    } else await tab.screenshot({ path: join(here, `${name}.png`) });
    await context.close();
  }
} finally {
  await browser.close();
}
