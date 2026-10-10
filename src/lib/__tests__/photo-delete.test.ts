import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { DELETE } from "@/app/api/photos/delete/route";
import { lockFromStatuses } from "@/lib/print-orders/freeze";
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

test("print lock: ready/refused are frozen, held stays editable, none is unlocked", () => {
  assert.equal(lockFromStatuses([]), null);
  assert.equal(lockFromStatuses(["held"]), "held");
  assert.equal(lockFromStatuses(["ready"]), "frozen");
  assert.equal(lockFromStatuses(["refused"]), "frozen");
  assert.equal(lockFromStatuses(["held", "ready"]), "frozen");
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
