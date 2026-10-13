// Obsidian's renderer has `window` and defines `activeWindow` (the window the
// user is working in) as a global. Under Node the tests supply both names so
// code that scopes timers to them runs unchanged.
const g = globalThis as Record<string, unknown>;
if (typeof g.window === "undefined") g.window = globalThis;
g.activeWindow = globalThis;
