// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import { routeFromHash, hashFor, type RouteState } from "./routing";

const routes: Array<[string, RouteState["page"]]> = [
  ["", "landing"], ["#", "landing"], ["#/landing", "landing"],
  ["#architecture", "architecture"], ["#/architecture", "architecture"],
  ["#/dashboard", "dashboard"], ["#/demo/auction", "demo"],
  ["#/app/auction", "demo"], ["#/demo", "demo"],
  ["#/demo/unknown", "demo"], ["#/unknown", "landing"],
];
for (const [hash, page] of routes) {
  test(`routeFromHash resolves ${JSON.stringify(hash)}`, () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    try {
      Object.defineProperty(globalThis, "window", {
        configurable: true, value: { location: { hash } },
      });
      assert.deepEqual(routeFromHash(), { page, useCase: "auction" });
    } finally {
      if (original) Object.defineProperty(globalThis, "window", original);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
}

test("hashFor emits the canonical route for each page", () => {
  assert.equal(hashFor("landing"), "#/landing");
  assert.equal(hashFor("architecture"), "#/architecture");
  assert.equal(hashFor("dashboard"), "#/dashboard");
  assert.equal(hashFor("demo"), "#/demo/auction");
  assert.equal(hashFor("demo", "auction"), "#/demo/auction");
});
