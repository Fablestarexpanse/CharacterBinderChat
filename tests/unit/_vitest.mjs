// A small vitest-compatible surface (describe / it / expect) over node:test and
// node:assert, so tests written for CharacterBinder run here unchanged apart from
// their import lines. Only the matchers those tests use are implemented; an
// unknown one throws rather than passing silently.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

function matchers(actual, negate) {
  const check = (pass, message) => assert.ok(negate ? !pass : pass, (negate ? "expected NOT: " : "expected: ") + message);
  return {
    toBe: (e) => check(Object.is(actual, e), `${JSON.stringify(actual)} to be ${JSON.stringify(e)}`),
    toEqual: (e) => {
      let eq = true;
      try { assert.deepStrictEqual(actual, e); } catch { eq = false; }
      check(eq, `${JSON.stringify(actual)} to equal ${JSON.stringify(e)}`);
    },
    toContain: (e) => check(
      typeof actual === "string" ? actual.includes(e) : Array.isArray(actual) && actual.includes(e),
      `${JSON.stringify(actual)} to contain ${JSON.stringify(e)}`),
    toMatch: (re) => check(re.test(actual), `${JSON.stringify(actual)} to match ${re}`),
    toBeTruthy: () => check(!!actual, `${JSON.stringify(actual)} to be truthy`),
    toBeFalsy: () => check(!actual, `${JSON.stringify(actual)} to be falsy`),
    toBeLessThan: (n) => check(actual < n, `${actual} < ${n}`),
    toBeGreaterThan: (n) => check(actual > n, `${actual} > ${n}`),
    toHaveLength: (n) => check(actual?.length === n, `length ${actual?.length} to be ${n}`),
    toHaveProperty: (k) => check(actual != null && Object.prototype.hasOwnProperty.call(actual, k), `to have property ${k}`),
    toBeUndefined: () => check(actual === undefined, `${JSON.stringify(actual)} to be undefined`),
    toThrow: (re) => {
      let threw = false, err;
      try { actual(); } catch (e) { threw = true; err = e; }
      check(threw && (re === undefined || (re instanceof RegExp ? re.test(String(err?.message)) : String(err?.message).includes(re))),
        `function to throw${re ? " " + re : ""}`);
    },
    toBeNull: () => check(actual === null, `${JSON.stringify(actual)} to be null`),
  };
}

export function expect(actual) {
  return { ...matchers(actual, false), not: matchers(actual, true) };
}

// vitest's it.each(cases)(name, fn): one test per case, %s filled from the case
const fmt = (name, c) => name.replace(/%s/g, () => String(Array.isArray(c) ? c[0] : c));
const eachOf = (base) => (cases) => (name, fn) =>
  cases.forEach((c) => base(fmt(name, c), () => fn(...(Array.isArray(c) ? c : [c]))));
const itWithEach = Object.assign((...a) => it(...a), it, { each: eachOf(it) });

export { describe, itWithEach as it };
export const test = itWithEach;
