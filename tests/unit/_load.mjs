// Shared loader for the unit tests.
//
// The modules under test are TypeScript with no runtime imports of their own,
// so Node's type stripping loads them directly — no build step, no test-only
// bundler, nothing that could pass while the app fails. Anything importing
// through the "@/" alias or a sibling module can't be loaded this way, which
// is the current limit of this suite.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const load = (relPath) =>
  import(pathToFileURL(path.join(APP_ROOT, relPath)).href);
