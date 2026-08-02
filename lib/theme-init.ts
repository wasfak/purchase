// Theme constants shared by the SERVER root layout (which renders the no-flash
// script) and the CLIENT ThemeProvider. This must stay a plain (non-"use
// client") module: exports from a client module become client *references* when
// imported into a server component, so the layout couldn't read the script
// string as a real value.

/** localStorage key holding the user's chosen theme ("light" | "dark" | "system"). */
export const THEME_STORAGE_KEY = "theme";

/**
 * The no-flash script. The root layout renders this once, before any body
 * content, so the correct theme class is on <html> before the first paint.
 * Because the layout is a server component, React 19 doesn't warn about this
 * inline script (the warning only fires for scripts rendered by client
 * components).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var e=localStorage.getItem('${THEME_STORAGE_KEY}')||'system';var d=e==='dark'||(e!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
