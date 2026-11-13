#!/usr/bin/env node
// ─── FableChat: update ────────────────────────────────────────────────────────
// Fetches the new version (git pull) and then redoes only what changed: the
// dependencies when the lockfile changed, the build when the code changed.
// Your data (the data folder) is not in git and is not touched.
//
// Used by update.bat / update.sh; also fine to run directly: node scripts/update.mjs
// --no-pull  skip fetching (just bring the install and build up to date)

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkNode, fail, refuseWhileRunning, root, say } from "./setup-steps.mjs";

checkNode();
await refuseWhileRunning();

if (!process.argv.includes("--no-pull")) {
  if (!fs.existsSync(path.join(root, ".git"))) {
    fail("This copy of FableChat was not downloaded with git, so it cannot update itself.\n" +
         "Download the new version from GitHub, put your data folder into it, and run install there.");
  }
  say("Fetching the new version.");
  // git directly, no shell; --ff-only so an update never makes a merge
  const r = spawnSync("git", ["pull", "--ff-only"], { cwd: root, stdio: "inherit" });
  if (r.error) fail("Git is not installed (or not on PATH), so FableChat cannot fetch the new version.");
  if (r.status !== 0) fail("Fetching the new version failed. The messages above say why: usually a file here was changed by hand.");
}

// A fresh process, so the install step runs the code that was just fetched
const r = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), "--if-needed"], { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
