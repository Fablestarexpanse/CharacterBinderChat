// Path helper for the unit tests.
//
// `load()` resolves a repo-relative path; the alias and extensionless imports
// are handled by the resolve hook in loader.mjs, which the `test` script
// registers. Either idiom works — this one when a test also needs APP_ROOT for
// a file path, a bare `await import("../../lib/...")` otherwise.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const load = (relPath) =>
  import(pathToFileURL(path.join(APP_ROOT, relPath)).href);
