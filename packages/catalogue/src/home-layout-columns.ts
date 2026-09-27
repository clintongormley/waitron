/**
 * A menu's home page columns on a handheld and on a till, unless a till layout's product grid card
 * sets its own count. The till's menu browser shows at most this many, fewer where a tile would be
 * too narrow; the dashboard's layout preview draws exactly this many. It imports nothing, so a
 * browser app deep-imports it rather than the catalogue barrel.
 */
export const HANDHELD_COLUMNS = 3;
export const TILL_COLUMNS = 6;
