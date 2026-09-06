// Resolve hook so the tests can import the app's modules exactly as the app
// writes them: extensionless relative imports ("./schema") and the "@/" alias.
//
// Next and tsc both resolve those; plain Node does not, which is why the first
// tests could only cover modules with no imports of their own. This is a
// resolver only — no transform, no bundle — so what the test loads is the same
// source the app ships.

import { register } from "node:module";

register("./loader-hooks.mjs", import.meta.url);
