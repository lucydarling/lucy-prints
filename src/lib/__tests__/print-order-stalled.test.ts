import { test } from "node:test";
import assert from "node:assert/strict";
import type { DropboxClient } from "@/lib/print-orders/dropbox";
import { resolveDestination } from "@/lib/print-orders/config";
import { checkStalledOrders, PARTNER_MARKER, type StalledCandidate, type StalledOrderInfo } from "@/lib/print-orders/stalled-monitor";

const ROOT = "/LucyDarling-PrintOrders";
const DEMO = resolveDestination("demo", true);
const T0 = new Date("2026-10-27T19:00:00Z");
const minsAgo = (m: number) => new Date(T0.getTime() - m * 60_000).toISOString();

/** Only what the check touches: root and getMetadata. `present` holds the paths that exist. */
function fakeClient(present: string[]) {
  const set = new Set(present.map((p) => p.toLowerCase()));
  const reads: string[] = [];
  const client = {
    root: ROOT,
    getMetadata: async (p: string) => {
      reads.push(p);
      return set.has(p.toLowerCase()) ? ({ ".tag": "folder", name: p, path_display: p } as never) : null;
    },
  } as unknown as DropboxClient;
  return { client, reads };
}

/** An in-memory print_orders: sent rows with sent_at and an alerted flag, same filters as the real queries. */
function harness(rows: Array<{ id: string; ext: string; sentMinsAgo: number; status?: string; alerted?: boolean }>, present: string[]) {
  const state = rows.map((r) => ({ ...r, status: r.status ?? "sent", alerted: r.alerted ?? false }));
  const alerts: StalledOrderInfo[][] = [];
  const { client, reads } = fakeClient(present);
  const run = (now = T0) =>
    checkStalledOrders({
      client,
      dest: DEMO,
      now: () => now,
      findCandidates: async (before, since): Promise<StalledCandidate[]> =>
        state
          .filter((r) => r.status === "sent" && !r.alerted && minsAgo(r.sentMinsAgo) < before && minsAgo(r.sentMinsAgo) >= since)
          .map((r) => ({ shopifyOrderId: r.id, externalId: r.ext, sentAt: minsAgo(r.sentMinsAgo) })),
      claimAlert: async (id) => {
        const r = state.find((x) => x.id === id)!;
        if (r.status !== "sent" || r.alerted) return false;
        r.alerted = true;
        return true;
      },
      alert: async (o) => { alerts.push(o); },
    });
  return { run, alerts, state, reads };
}

test("stalled check: an order still in the hotfolder is not stalled under 30 minutes", async () => {
  const h = harness([{ id: "1", ext: "TEST-1", sentMinsAgo: 29 }], [`${ROOT}/demo/TEST-1`]);
  const r = await h.run();
  assert.deepEqual(r.stalled, []);
  assert.equal(h.alerts.length, 0);
  assert.deepEqual(h.reads, [], "under the threshold nothing is even looked up in Dropbox");
});

test("stalled check: over 30 minutes it alerts once, saying whether pfRouter ever saw the folder; the next run is silent", async () => {
  const h = harness([{ id: "1", ext: "TEST-1", sentMinsAgo: 50 }], [`${ROOT}/demo/TEST-1`]);
  const r1 = await h.run();
  assert.deepEqual(r1.alerted, ["TEST-1"]);
  assert.equal(h.alerts.length, 1);
  assert.equal(h.alerts[0].length, 1);
  assert.equal(h.alerts[0][0].pfRouterSawIt, false, "no .pfrouter-partner.json");
  assert.equal(h.alerts[0][0].minutesWaiting, 50);

  const r2 = await h.run(new Date(T0.getTime() + 15 * 60_000));
  assert.deepEqual(r2.alerted, []);
  assert.equal(h.alerts.length, 1, "no second alert");
});

test("stalled check: the marker file is reported when pfRouter has seen the folder", async () => {
  const h = harness([{ id: "1", ext: "TEST-1", sentMinsAgo: 40 }], [`${ROOT}/demo/TEST-1`, `${ROOT}/demo/TEST-1/${PARTNER_MARKER}`]);
  await h.run();
  assert.equal(h.alerts[0][0].pfRouterSawIt, true);
});

test("stalled check: an order that reached processed/ or _error never alerts", async () => {
  const h = harness(
    [
      { id: "1", ext: "TEST-1", sentMinsAgo: 90 },
      { id: "2", ext: "TEST-2", sentMinsAgo: 90 },
    ],
    [`${ROOT}/processed/demo/TEST-1`, `${ROOT}/demo/_error/TEST-2`]
  );
  const r = await h.run();
  assert.deepEqual(r.stalled, []);
  assert.equal(h.alerts.length, 0);
});

test("stalled check: 2+ stalled at once send ONE combined alert; each is alerted only once", async () => {
  const h = harness(
    [
      { id: "1", ext: "TEST-1", sentMinsAgo: 45 },
      { id: "2", ext: "TEST-2", sentMinsAgo: 60 },
      { id: "3", ext: "TEST-3", sentMinsAgo: 60 }, // already picked up
    ],
    [`${ROOT}/demo/TEST-1`, `${ROOT}/demo/TEST-2`, `${ROOT}/processed/demo/TEST-3`]
  );
  const r = await h.run();
  assert.deepEqual(r.alerted.sort(), ["TEST-1", "TEST-2"]);
  assert.equal(h.alerts.length, 1, "one alert, not two");
  assert.equal(h.alerts[0].length, 2);
  await h.run();
  assert.equal(h.alerts.length, 1);
});

test("stalled check: orders past the lookback, or no longer sent, are ignored; a failed alert is not retried; Dropbox is only read", async () => {
  const h = harness(
    [
      { id: "1", ext: "TEST-1", sentMinsAgo: 100 * 60 }, // older than 72h
      { id: "2", ext: "TEST-2", sentMinsAgo: 60, status: "error" },
    ],
    [`${ROOT}/demo/TEST-1`, `${ROOT}/demo/TEST-2`]
  );
  assert.deepEqual((await h.run()).stalled, []);

  const rows = [{ id: "9", ext: "TEST-9", sentMinsAgo: 60, alerted: false }];
  let claimed = 0;
  const { client, reads } = fakeClient([`${ROOT}/demo/TEST-9`]);
  const deps = {
    client, dest: DEMO, now: () => T0,
    findCandidates: async () => rows.filter((r) => !r.alerted).map((r) => ({ shopifyOrderId: r.id, externalId: r.ext, sentAt: minsAgo(r.sentMinsAgo) })),
    claimAlert: async () => { claimed++; rows[0].alerted = true; return true; },
    alert: async () => { throw new Error("resend down"); },
  };
  const r = await checkStalledOrders(deps);
  assert.equal(r.alertFailed, true);
  await checkStalledOrders(deps);
  assert.equal(claimed, 1, "claimed once, never re-alerted");
  assert.ok(reads.every((p) => p.startsWith(ROOT)), "only paths inside the root were read");
});
