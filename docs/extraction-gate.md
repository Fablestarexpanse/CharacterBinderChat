# Extraction gate: what was tried and why it is this small

Every finished exchange costs two to four model calls (fact extraction, Core
Memory rewrite, and an episode card or reflection on a cadence). The question
was whether a cheap pre-check could skip the ones that would find nothing.

## What the recorded soaks say

`npm run eval:gate` replays the three 200-exchange soak transcripts (499
exchanges after the first turn of each run) with no model and no cost. An
exchange counts as **productive** if it added a net live fact or moved a bond
stat by 0.5 or more.

- **63% productive, 37% not.** So there is a ceiling of about a third of the
  calls — but only if "will this find anything" can be predicted from the text.
- **It mostly cannot.** A novelty heuristic (how many content words in this
  exchange were absent from the previous six) was tried at several thresholds.
  Its skip decisions were right only 48–62% of the time, against a 37% base rate:
  at 15% of turns skipped, 23 of 74 skipped exchanges had actually added a fact.
  That would degrade memory silently, which is the failure this project's memory
  design exists to avoid, so it was not built.

## What shipped

**Settings → Memory → Skip empty exchanges** (off by default). It skips only
exchanges too short to hold anything — under 8 content words, no digits, no
mid-sentence capitalised word — and never more than three in a row.

It is safe for a structural reason, not a statistical one: extraction sends the
last 16 messages, so a skipped exchange is read by the next extraction that
runs. Skipping delays; it does not drop.

## What is not known

Every recorded exchange is 45+ content words of narrative roleplay, so the gate
never fires on this data. `eval:gate` therefore proves it does not skip anything
productive *here*, not that it saves money elsewhere. The saving, if any, is on
short-form chat, and it is off by default until someone with that usage has
confirmed it does not cost recall. The live harness (`npm run eval:long`) is the
right check for that and needs a model key.

## Better places to look for savings

Ideas that do not depend on predicting content, untested: combine extraction and
the Core Memory rewrite into one call; run the Core Memory rewrite every other
exchange (mood moves slowly, but this changes behaviour and needs the live harness);
use a smaller model for extraction than for the reply.
