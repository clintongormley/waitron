export const GUIDE_THEME_KEY = "waitron-theme";

export const PAGE_THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(GUIDE_THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export const PAGE_THEME_STYLE = `:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }`;
