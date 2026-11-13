// Offline check of the extraction gate against the recorded 200-exchange soaks.
//
//   node --import ./tests/unit/loader.mjs tests/memory-eval/gate-offline.mjs
//
// No model, no key, no cost: docs/transcript-*.md already record, per exchange,
// the live-fact count and the relationship stats after the real pipeline ran. An
// exchange is "productive" if it added a net fact or moved a bond stat by 0.5+.
// The gate must not skip productive exchanges. It reports the base rate too,
// because the headline number that matters is how much better than chance a
// skip decision is.
//
// What this CANNOT show: savings on short-form chat. Every recorded exchange is
// 70+ words of narrative roleplay, so the gate (correctly) never fires here.
// That is a statement about the data, not evidence the gate is useless.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { isTrivialExchange, contentWords } = await import("../../lib/chat/extractionGate.ts");

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs");
const BLOCK = /\*\*([^*]+):\*\* (.*?)\n\n\*\*([^*]+):\*\* (.*?)\n\n<sub>turn (\d+) · live facts (\d+) · injected \d+ · mood [^·]*· trust (\S+) affection (\S+) connection ([^ <]+)<\/sub>/gs;
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

const turns = [];
for (const file of fs.readdirSync(docs).filter((f) => /^transcript-.*\.md$/.test(f)).sort()) {
  let prev = null;
  // A Windows checkout stores these with CRLF; the pattern is written for LF
  for (const m of fs.readFileSync(path.join(docs, file), "utf8").replace(/\r\n/g, "\n").matchAll(BLOCK)) {
    const [, , user, , asst, , facts, trust, aff, conn] = m;
    const cur = { user: user.trim(), asst: asst.trim(), facts: +facts, stats: [num(trust), num(aff), num(conn)] };
    if (prev) {
      cur.productive =
        cur.facts - prev.facts > 0 ||
        Math.max(...cur.stats.map((v, i) => Math.abs(v - prev.stats[i]))) >= 0.5;
      turns.push(cur);
    }
    prev = cur;
  }
}

// Finding nothing is a failure, not a pass: an unreadable transcript once made this report "0 exchanges" and exit 0
if (turns.length === 0) {
  console.error("FAIL: no recorded exchanges found in docs/transcript-*.md");
  process.exit(1);
}
const productive = turns.filter((t) => t.productive).length;
const skipped = turns.filter((t) => isTrivialExchange(t.user, t.asst));
const lost = skipped.filter((t) => t.productive);
const minWords = Math.min(...turns.map((t) => contentWords(`${t.user} ${t.asst}`).length));

console.log(`exchanges: ${turns.length}  productive: ${productive} (${Math.round(100 * productive / turns.length)}%)`);
console.log(`gate would skip: ${skipped.length}  of which productive (would delay a real fact): ${lost.length}`);
console.log(`fewest content words in any recorded exchange: ${minWords} (gate threshold is under 8)`);
if (lost.length > 0) {
  console.error("FAIL: the gate skips exchanges that produced memory");
  process.exit(1);
}
