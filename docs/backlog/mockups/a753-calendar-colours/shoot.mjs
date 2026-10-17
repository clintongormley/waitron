// Builds the A753 swatch boards and renders them with the workspace's playwright Chromium.
// Run from the worktree root: node docs/backlog/mockups/a753-calendar-colours/shoot.mjs
// Every contrast ratio on the boards is computed here (WCAG 2 relative luminance, the same formula
// as packages/ui-core/src/tokens/colors.test.ts) and printed as a table; a pair under 4.5:1
// in either theme stops the run.
/* global console */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../../../packages/ui-core/package.json"));
const { chromium } = require("playwright");

// [fill, text on it]. "today" values are copied from packages/ui-core/src/tokens/colors.css.
const COLOURS = [
  { key: "red", en: "Red", es: "Rojo", set: "today", period: "Dinner", light: ["#c62828", "#ffffff"], dark: ["#ff7a70", "#2a0705"] },
  { key: "orange", en: "Orange", es: "Naranja", set: "add", period: "Brunch", light: ["#ef7a1e", "#2a1000"], dark: ["#ff8a3d", "#2a1000"] },
  { key: "amber", en: "Amber", es: "Ámbar", set: "today", period: "Lunch", light: ["#f5a623", "#241500"], dark: ["#f5b34a", "#241500"] },
  { key: "lime", en: "Lime", es: "Lima", set: "add", period: "Terrace", light: ["#84cc16", "#121d00"], dark: ["#a6dc4a", "#142000"] },
  { key: "green", en: "Green", es: "Verde", set: "today", period: "Breakfast", light: ["#1e7a4f", "#ffffff"], dark: ["#4ac08d", "#06190f"] },
  { key: "teal", en: "Teal", es: "Turquesa", set: "add", period: "Afternoon", light: ["#0c7480", "#ffffff"], dark: ["#1fa596", "#03201c"] },
  { key: "cyan", en: "Cyan", es: "Cian", set: "add", period: "Tapas", light: ["#22b8d8", "#04161c"], dark: ["#8be0f2", "#04181e"] },
  { key: "blue", en: "Blue", es: "Azul", set: "today", period: "Evening", light: ["#2f55d4", "#ffffff"], dark: ["#7aa2ff", "#06101f"] },
  { key: "indigo", en: "Indigo", es: "Índigo", set: "add", period: "Late", light: ["#3730a3", "#ffffff"], dark: ["#8b7bff", "#120c3a"] },
  { key: "purple", en: "Purple", es: "Morado", set: "today", period: "Events", light: ["#7e3fb8", "#ffffff"], dark: ["#c39bf0", "#1d0b33"] },
  { key: "pink", en: "Pink", es: "Rosa", set: "add", period: "Happy hour", light: ["#c2185b", "#ffffff"], dark: ["#ff8cc6", "#2e0619"] },
  { key: "brown", en: "Brown", es: "Marrón", set: "add", period: "Morning", light: ["#7a4b2a", "#ffffff"], dark: ["#c9976e", "#1f1006"] },
  { key: "grey", en: "Grey", es: "Gris", set: "today", period: "Staff meal", light: ["#6b6e78", "#ffffff"], dark: ["#8b8d98", "#101216"] },
];
// The two day colours no period can take, from the same file, shown so a new colour can be checked
// against them.
const RESERVED = [
  { en: "Standard day", light: ["#dff3e8", "#16181d"], dark: ["#183626", "#eceef2"] },
  { en: "Closed day", light: ["#3a3b42", "#ffffff"], dark: ["#d5d7de", "#101216"] },
];
const THEME = {
  light: { bg: "#f7f7f8", surface: "#ffffff", text: "#16181d", muted: "#5b6070", border: "#d6d9e0" },
  dark: { bg: "#101216", surface: "#191c22", text: "#eceef2", muted: "#a3a8b5", border: "#333945" },
};

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const fmt = (n) => `${n.toFixed(2)}:1`;

const rows = COLOURS.map((c) => ({
  ...c,
  lightRatio: ratio(c.light[0], c.light[1]),
  darkRatio: ratio(c.dark[0], c.dark[1]),
}));
console.log("colour  | set   | light fill/text   | ratio   | dark fill/text    | ratio");
for (const r of rows)
  console.log(
    `${r.key.padEnd(7)} | ${r.set.padEnd(5)} | ${r.light.join("/")} | ${fmt(r.lightRatio).padEnd(7)} | ${r.dark.join("/")} | ${fmt(r.darkRatio)}`,
  );
for (const r of RESERVED)
  console.log(`${r.en} | light ${fmt(ratio(...r.light))} | dark ${fmt(ratio(...r.dark))}`);
const short = rows.filter((r) => r.lightRatio < 4.5 || r.darkRatio < 4.5);
if (short.length) throw new Error(`under 4.5:1: ${short.map((r) => r.key).join(", ")}`);

const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

const page = (theme, title, body) => {
  const t = THEME[theme];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>
  body { margin: 0; background: ${t.bg}; color: ${t.text}; font: 14px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: 390px; box-sizing: border-box; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 18px 0 8px; }
  p { margin: 0 0 8px; color: ${t.muted}; font-size: 13px; }
  .card { background: ${t.surface}; border: 1px solid ${t.border}; border-radius: 8px; padding: 8px; }
  .row { display: grid; grid-template-columns: 118px 1fr auto; align-items: center; gap: 10px; padding: 5px 0; }
  .row + .row { border-top: 1px solid ${t.border}; }
  .chip { border-radius: 6px; padding: 7px 8px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name b { display: block; }
  .name span { color: ${t.muted}; font-size: 12px; }
  .ratio { font-variant-numeric: tabular-nums; font-weight: 600; text-align: right; }
  .ratio small { display: block; font-weight: 400; color: ${t.muted}; font-size: 11px; }
  .tag { display: inline-block; font-size: 11px; font-weight: 600; border: 1px solid ${t.border}; border-radius: 4px; padding: 0 4px; margin-left: 4px; color: ${t.muted}; }
  .bar { display: flex; height: 34px; border-radius: 6px; overflow: hidden; margin: 6px 0; }
  .bar div { flex: 1; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 12px; }
  .label { font-size: 12px; color: ${t.muted}; margin-top: 8px; }
  .dept b { display: block; font-size: 12px; margin-top: 4px; }
  .dept .bar { margin: 2px 0 4px; }
  .dept .bar div { font-size: 11.5px; }
  .darkpane { background: ${THEME.dark.bg}; color: ${THEME.dark.text}; margin: 16px -16px -16px; padding: 1px 16px 16px; }
  .darkpane .card { background: ${THEME.dark.surface}; border-color: ${THEME.dark.border}; }
  .darkpane .label { color: ${THEME.dark.muted}; }
  .dup { outline: 2px dashed ${t.text}; outline-offset: -4px; }
</style></head><body data-theme="${theme}"><main>${body}</main></body></html>`;
};

const chip = (c, theme, text = c.period) =>
  `<div class="chip" style="background:${c[theme][0]};color:${c[theme][1]}">${text}</div>`;
const row = (c, theme) => {
  const r = theme === "light" ? c.lightRatio : c.darkRatio;
  const tag = c.set !== "add" ? "" : c.key === "lime" ? '<span class="tag">new, not in (b)</span>' : '<span class="tag">new</span>';
  return `<div class="row">${chip(c, theme)}<div class="name"><b>${c.en}${tag}</b><span>${c.es} · ${c[theme][0]} on ${c[theme][1]}</span></div><div class="ratio">${fmt(r)}<small>text contrast</small></div></div>`;
};

const swatchBoard = (theme) => {
  const today = rows.filter((r) => r.set === "today");
  const reserved = RESERVED.map(
    (r) =>
      `<div class="row"><div class="chip" style="background:${r[theme][0]};color:${r[theme][1]}">${r.en}</div><div class="name"><b>Not choosable</b><span>${r[theme][0]} on ${r[theme][1]}</span></div><div class="ratio">${fmt(ratio(...r[theme]))}<small>text contrast</small></div></div>`,
  );
  return page(
    theme,
    `A753 calendar colours, ${theme}`,
    `<h1>Calendar colours — ${theme} theme</h1>
<p>Each chip is drawn the way a period, staff role, menu or special date is drawn: a strong fill with its name written on it. The number is the contrast between the text and the fill; 4.5:1 is the readable minimum for small text.</p>
<h2>Today: six colours</h2><div class="card">${today.map((c) => row(c, theme)).join("")}</div>
<h2>(a) Default: thirteen colours, in rainbow order</h2><p>Option (b) is the same list without lime.</p><div class="card">${rows.map((c) => row(c, theme)).join("")}</div>
<h2>Already reserved for whole days</h2><div class="card">${reserved.join("")}</div>`,
  );
};

const bar = (keys, theme) =>
  `<div class="bar">${keys.map((k) => `<div style="background:${byKey[k][theme][0]};color:${byKey[k][theme][1]}">${byKey[k].en}</div>`).join("")}</div>`;
const NEIGHBOURS = [
  ["Reds and oranges", ["red", "orange", "amber"]],
  ["Greens and blues", ["lime", "green", "teal", "cyan"]],
  ["Blues and purples", ["blue", "indigo", "purple"]],
  ["Pinks", ["red", "pink", "purple"]],
  ["Quiet colours", ["brown", "grey", "amber"]],
];
const neighbourBoard = (theme) =>
  page(
    theme,
    `A753 neighbouring colours, ${theme}`,
    `<h1>Close colours side by side — ${theme}</h1>
<p>Periods sit next to each other in a day, so the colours that are closest in hue are shown touching, the way the week view draws them.</p>
${NEIGHBOURS.map(([label, keys]) => `<div class="label">${label}</div>${bar(keys, theme)}`).join("")}
<div class="label">All thirteen of the default, in order</div>
${bar(["red", "orange", "amber", "lime", "green"], theme)}${bar(["teal", "cyan", "blue", "indigo"], theme)}${bar(["purple", "pink", "brown", "grey"], theme)}`,
  );

// Eight periods across two departments: with six colours two must repeat.
const RESTAURANT = [["Breakfast", "green"], ["Lunch", "amber"], ["Afternoon", "teal"], ["Dinner", "red"], ["Late", "indigo"]];
const BAR = [["Morning", "brown"], ["Tapas", "cyan"], ["Evening", "blue"]];
const SIX = { teal: "green", indigo: "purple" };
const SIX_BAR = { Morning: "grey", Tapas: "purple", Evening: "blue" };
const deptBar = (periods, theme, map, dupes) =>
  `<div class="bar">${periods
    .map(([name, k]) => {
      const c = byKey[map(name, k)];
      return `<div class="${dupes.includes(name) ? "dup" : ""}" style="background:${c[theme][0]};color:${c[theme][1]}">${name}</div>`;
    })
    .join("")}</div>`;
const exampleSection = (theme) => {
  const today = (name, k) => SIX_BAR[name] ?? SIX[k] ?? k;
  const twelve = (_name, k) => k;
  return `<h2>${theme === "light" ? "Light" : "Dark"} theme</h2>
<div class="label">Today, six colours: the dashed periods share a colour</div>
<div class="card"><div class="dept"><b>Restaurant</b>${deptBar(RESTAURANT, theme, today, ["Breakfast", "Afternoon", "Late"])}</div>
<div class="dept"><b>Bar</b>${deptBar(BAR, theme, today, ["Tapas"])}</div></div>
<div class="label">With the new colours: every period its own</div>
<div class="card"><div class="dept"><b>Restaurant</b>${deptBar(RESTAURANT, theme, twelve, [])}</div>
<div class="dept"><b>Bar</b>${deptBar(BAR, theme, twelve, [])}</div></div>`;
};
const exampleBoard = () =>
  page(
    "light",
    "A753 eight periods",
    `<h1>A venue with eight periods</h1>
<p>Five restaurant periods and three bar periods. With six colours two pairs have to share: Breakfast and Afternoon both green, Late and Tapas both purple.</p>
${exampleSection("light")}<div class="darkpane">${exampleSection("dark")}</div>`,
  );

const files = {
  "1-colours-light": swatchBoard("light"),
  "2-colours-dark": swatchBoard("dark"),
  "3-neighbours-light": neighbourBoard("light"),
  "4-neighbours-dark": neighbourBoard("dark"),
  "5-eight-periods": exampleBoard(),
};

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
  const tab = await context.newPage();
  for (const [name, html] of Object.entries(files)) {
    const file = join(here, `${name}.html`);
    writeFileSync(file, html);
    await tab.goto(`file://${file}`);
    await tab.locator("main").screenshot({ path: join(here, `${name}.png`) });
  }
} finally {
  await browser.close();
}
