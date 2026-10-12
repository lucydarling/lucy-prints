import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { DELETE } from "@/app/api/photos/delete/route";
import { emptyPrinted, lockDecision } from "@/lib/print-orders/printed";
import { removeFromCloud } from "@/lib/remove-from-cloud";
import { useSaveStore } from "@/store/save-store";

const call = (body: unknown) =>
  DELETE(new NextRequest("http://x/api/photos/delete", {
    method: "DELETE",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }));

test("delete route rejects malformed requests before touching the database", async () => {
  assert.equal((await call("not json")).status, 400);
  assert.equal((await call({})).status, 400);
  assert.equal((await call({ sessionToken: "t" })).status, 400); // no key
  assert.equal((await call({ sessionToken: "t", slotKey: "a", extraId: "extra_b" })).status, 400); // both keys
  assert.equal((await call({ sessionToken: "t", slotKey: "../x" })).status, 400); // path traversal
  assert.equal((await call({ sessionToken: "t", slotKey: "Month 3" })).status, 400);
  assert.equal((await call({ sessionToken: "t", extraId: "not_extra_1" })).status, 400); // wrong namespace
});

test("per-slot lock: a printed slot or extra refuses edits (409), everything else is open", () => {
  const printed = { slots: new Map([["month_3", 1]]), extras: new Set(["extra_1_a"]) };
  assert.equal(lockDecision(emptyPrinted(), { isExtra: false, key: "month_3" }), null);
  assert.equal(lockDecision(printed, { isExtra: false, key: "month_4" }), null, "an unprinted slot stays editable");
  assert.equal(lockDecision(printed, { isExtra: true, key: "extra_2_b" }), null, "an extra added after an order is allowed");
  const slot = lockDecision(printed, { isExtra: false, key: "month_3" })!;
  assert.equal(slot.status, 409);
  assert.match(String(slot.body.error), /paid reprint/);
  assert.equal(slot.body.canReprint, true);
  const extra = lockDecision(printed, { isExtra: true, key: "extra_1_a" })!;
  assert.equal(extra.status, 409);
  assert.match(String(extra.body.error), /extra print has already been printed/);
});

test("reprint mode is only for a printed book slot", () => {
  const printed = { slots: new Map([["month_3", 1]]), extras: new Set(["extra_1_a"]) };
  assert.equal(lockDecision(printed, { isExtra: false, key: "month_3", reprint: true }), null);
  assert.equal(lockDecision(printed, { isExtra: false, key: "month_4", reprint: true })!.status, 400);
  assert.equal(lockDecision(printed, { isExtra: true, key: "extra_1_a", reprint: true })!.status, 400);
});

test("removeFromCloud: drops queued/uploaded state, deletes on the server, surfaces server errors", async () => {
  const realFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown; method?: string }> = [];
  let status = 200;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)), method: init?.method });
    return new Response(JSON.stringify(status === 200 ? { success: true } : { error: "This book has been sent to print" }), { status });
  }) as typeof fetch;
  try {
    // Never saved (no session yet): nothing to delete on the server.
    useSaveStore.setState({ sessionToken: null, uploadedSlots: ["month_3"], uploadQueue: ["month_3"] });
    await removeFromCloud("month_3", false);
    assert.equal(calls.length, 0);
    assert.deepEqual(useSaveStore.getState().uploadedSlots, []);
    assert.deepEqual(useSaveStore.getState().uploadQueue, []);

    // Saved photo and extra.
    useSaveStore.setState({ sessionToken: "tok", uploadedSlots: ["month_3", "extra_1_a"] });
    await removeFromCloud("month_3", false);
    await removeFromCloud("extra_1_a", true);
    assert.deepEqual(calls.map((c) => [c.url, c.method, c.body]), [
      ["/api/photos/delete", "DELETE", { sessionToken: "tok", slotKey: "month_3" }],
      ["/api/photos/delete", "DELETE", { sessionToken: "tok", extraId: "extra_1_a" }],
    ]);

    // The server says no: the error reaches the caller so it can keep the photo.
    status = 409;
    await assert.rejects(removeFromCloud("month_4", false), /sent to print/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
