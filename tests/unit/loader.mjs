// Resolve hook so the tests can import the app's modules exactly as the app
// writes them: extensionless relative imports ("./schema") and the "@/" alias.
//
// Next and tsc both resolve those; plain Node does not. This is a resolver
// only — no transform, no bundle — so what a test loads is the same source the
// app ships. Registered by the `test` script, which is why test files can use
// a bare `await import("../../lib/...")`.

import { register } from "node:module";

register("./loader-hooks.mjs", import.meta.url);
