// The sync loop must keep running through React's development double-invoke
// (mount, cleanup, mount in one task) and still stop on a real unmount. When this
// went wrong the app silently stopped saving and never polled, in development only.

import { test } from "node:test";
import assert from "node:assert/strict";

const { createLifecycle } = await import("../../lib/sync/lifecycle.ts");

function harness() {
  const log = { started: 0, stopped: 0 };
  const life = createLifecycle(() => { log.started++; return () => { log.stopped++; }; });
  return { log, life };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("a plain mount starts it once", () => {
  const { log, life } = harness();
  life.mount();
  assert.deepEqual(log, { started: 1, stopped: 0 });
});

test("StrictMode's mount, cleanup, mount in one task keeps ONE service running and never stops it", async () => {
  const { log, life } = harness();
  life.mount();
  life.unmount();       // React's immediate cleanup
  life.mount();         // React's re-run
  await tick();
  assert.deepEqual(log, { started: 1, stopped: 0 }, "not started twice, not stopped");
});

test("a real unmount stops it, after the microtask", async () => {
  const { log, life } = harness();
  life.mount();
  life.unmount();
  assert.equal(log.stopped, 0, "not synchronously: the double-invoke has to be given its chance");
  await tick();
  assert.deepEqual(log, { started: 1, stopped: 1 });
});

test("after a real unmount it can be mounted again and starts fresh", async () => {
  const { log, life } = harness();
  life.mount(); life.unmount(); await tick();
  life.mount();
  assert.deepEqual(log, { started: 2, stopped: 1 });
});

test("repeated mounts without an unmount do not start extra copies", () => {
  const { log, life } = harness();
  life.mount(); life.mount(); life.mount();
  assert.equal(log.started, 1);
});

test("two double-invokes in a row still leave exactly one running service", async () => {
  const { log, life } = harness();
  for (let i = 0; i < 2; i++) { life.mount(); life.unmount(); life.mount(); await tick(); }
  assert.deepEqual(log, { started: 1, stopped: 0 });
});
