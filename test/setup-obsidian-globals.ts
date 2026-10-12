// Obsidian defines `activeWindow` (the window the user is working in) as a
// global in the renderer. Under Node the tests supply the same name so code
// that scopes timers to it runs unchanged.
(globalThis as Record<string, unknown>).activeWindow = globalThis;
