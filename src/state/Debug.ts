/**
 * Lightweight debug logger for the browser console. Prefixed `[VOXL]` so it's
 * easy to filter. Off by default; enable at runtime with
 *   localStorage.setItem("voxl.debug", "1")
 *   (then reload). Disable again by setting it to anything other than "1".
 */
const enabled: boolean = (() => {
  try {
    return localStorage.getItem("voxl.debug") === "1";
  } catch {
    return false;
  }
})();

export function dbg(...args: unknown[]): void {
  if (enabled) console.log("%c[VOXL]", "color:#37c46a;font-weight:bold", ...args);
}

export function dbgWarn(...args: unknown[]): void {
  if (enabled) console.warn("%c[VOXL]", "color:#f5a524;font-weight:bold", ...args);
}

export function dbgErr(...args: unknown[]): void {
  if (enabled) console.error("[VOXL]", ...args);
}

export const DEBUG_ENABLED = enabled;
