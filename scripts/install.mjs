#!/usr/bin/env node
// ─── FableChat: install ───────────────────────────────────────────────────────
// Installs the dependencies (a clean `npm ci`) and builds the app. Always does
// both: run it the first time, or when something seems broken. To get a new
// version, use update; to run the app, use start.
//
// Used by install.bat / install.sh; also fine to run directly: node scripts/install.mjs
// --if-needed  only redo what is out of date (what update uses after fetching)

import { build, buildCurrent, checkNode, depsCurrent, installDeps, refuseWhileRunning, say, script } from "./setup-steps.mjs";

const ifNeeded = process.argv.includes("--if-needed");

checkNode();
await refuseWhileRunning();

if (!ifNeeded || !depsCurrent()) installDeps();
else say("Dependencies are up to date.");

if (!ifNeeded || !buildCurrent()) build();
else say("The build is up to date.");

say("");
say(`  FableChat is ready. Run ${script("start")} to open it.`);
say("");
