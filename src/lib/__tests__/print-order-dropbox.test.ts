import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { NextRequest } from "next/server";
import {
  DropboxClient,
  DropboxPathRefused,
  apiArgHeader,
  assertInRoot,
  joinPath,
  normalizeRoot,
} from "@/lib/print-orders/dropbox";
import { DropboxDestination, assertDestinationWritable, dropboxClientFor } from "@/lib/print-orders/dropbox-destination";
import { RESEND_DISABLED_MESSAGE, deliverPrintOrder, type DeliverDeps } from "@/lib/print-orders/deliver";
import { checkErrorFolder, externalIdFromFolder } from "@/lib/print-orders/error-monitor";
import { RESEND_ENABLED, LIVE_DELIVERY_ALLOWED, resolveDestination, type Destination } from "@/lib/print-orders/config";
import type { RecordedOrderRow } from "@/lib/print-orders/build-from-snapshot";
import type { PrintSnapshot } from "@/lib/print-orders/paid-order";
import { GET as cronGET } from "@/app/api/cron/print-order-errors/route";
import { POST as webhookPOST } from "@/app/api/webhooks/shopify/orders-paid/route";

const ROOT = "/LucyDarling-PrintOrders";
const DEMO: Destination = resolveDestination("demo", true);
const LIVE: Destination = resolveDestination("live", false);
const CREDS = { appKey: "k", appSecret: "s", refreshToken: "r" };

type Node = { folder: boolean; name: string; path: string; data?: Buffer };

/**
 * An in-memory Dropbox speaking the real HTTP API, so the real client code
 * (headers, endpoints, error summaries) is what is tested.
 */
class FakeDropbox {
  nodes = new Map<string, Node>();
  /** Every path argument that reached the "server". */
  seenPaths: string[] = [];
  uploads: string[] = [];
  failUpload: ((path: string) => boolean) | null = null;
  tokenCalls = 0;

  constructor() {
    this.addFolder("/");
  }
  private key = (p: string) => (p === "/" ? "/" : p.toLowerCase().replace(/\/+$/, ""));
  private parent = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
  addFolder(p: string) {
    if (p !== "/" && !this.nodes.has(this.key(this.parent(p)))) this.addFolder(this.parent(p));
    if (!this.nodes.has(this.key(p))) this.nodes.set(this.key(p), { folder: true, name: p.split("/").pop() || "", path: p });
  }
  addFile(p: string, data: Buffer) {
    this.addFolder(this.parent(p));
    this.nodes.set(this.key(p), { folder: false, name: p.split("/").pop()!, path: p, data });
  }
  has(p: string) {
    return this.nodes.has(this.key(p));
  }
  children(p: string) {
    const k = this.key(p);
    return [...this.nodes.entries()].filter(([c]) => c !== "/" && this.key(this.parent(c)) === k).map(([, n]) => n);
  }
  meta(n: Node) {
    return { ".tag": n.folder ? "folder" : "file", name: n.name, path_display: n.path, ...(n.folder ? {} : { size: n.data!.length }) };
  }
  private err(summary: string) {
    return new Response(JSON.stringify({ error_summary: summary }), { status: 409 });
  }

  fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/oauth2/token")) {
      this.tokenCalls += 1;
      return Response.json({ access_token: "AT", expires_in: 14400 });
    }
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer AT");
    const endpoint = u.replace(/^https:\/\/(api|content)\.dropboxapi\.com\/2\//, "");
    const argHeader = (init?.headers as Record<string, string>)["Dropbox-API-Arg"];
    const arg = argHeader ? JSON.parse(argHeader) : init?.body ? JSON.parse(String(init.body)) : {};
    for (const k of ["path", "from_path", "to_path"]) if (arg[k]) this.seenPaths.push(arg[k]);

    switch (endpoint) {
      case "files/get_metadata":
        return this.has(arg.path) ? Response.json(this.meta(this.nodes.get(this.key(arg.path))!)) : this.err("path/not_found/..");
      case "files/list_folder":
        if (!this.has(arg.path)) return this.err("path/not_found/..");
        return Response.json({ entries: this.children(arg.path).map((n) => this.meta(n)), cursor: "c", has_more: false });
      case "files/create_folder_v2":
        if (this.has(arg.path)) return this.err("path/conflict/folder/..");
        this.addFolder(arg.path);
        return Response.json({ metadata: {} });
      case "files/upload": {
        if (this.has(arg.path)) return this.err("path/conflict/file/..");
        if (this.failUpload?.(arg.path)) return new Response("boom", { status: 400 });
        const data = Buffer.from(init!.body as Uint8Array);
        this.addFile(arg.path, data);
        this.uploads.push(arg.path);
        return Response.json(this.meta(this.nodes.get(this.key(arg.path))!));
      }
      case "files/download": {
        const n = this.nodes.get(this.key(arg.path));
        return n && !n.folder ? new Response(new Uint8Array(n.data!)) : this.err("path/not_found/..");
      }
      case "files/move_v2": {
        if (!this.has(arg.from_path)) return this.err("from_lookup/not_found/..");
        if (this.has(arg.to_path)) return this.err("to/conflict/folder/..");
        const from = this.key(arg.from_path);
        for (const [k, n] of [...this.nodes.entries()]) {
          if (k === from || k.startsWith(`${from}/`)) {
            this.nodes.delete(k);
            const np = arg.to_path + n.path.slice(arg.from_path.length);
            this.nodes.set(this.key(np), { ...n, path: np, name: np.split("/").pop()! });
          }
        }
        return Response.json({ metadata: {} });
      }
      case "files/delete_v2": {
        if (!this.has(arg.path)) return this.err("path_lookup/not_found/..");
        const k0 = this.key(arg.path);
        for (const k of [...this.nodes.keys()]) if (k === k0 || k.startsWith(`${k0}/`)) this.nodes.delete(k);
        return Response.json({ metadata: {} });
      }
      default:
        throw new Error(`fake dropbox: unexpected ${endpoint}`);
    }
  }) as typeof fetch;
}

const client = (fake: FakeDropbox, writable = ["staging", "demo"]) =>
  new DropboxClient({ root: ROOT, writable, credentials: CREDS, fetch: fake.fetch });

// ---------- path guard ----------

test("root guard: only clean absolute paths inside DROPBOX_ROOT_PATH, case-insensitive, whole segments", () => {
  assert.throws(() => normalizeRoot(undefined), /not set/);
  assert.throws(() => normalizeRoot("/"), /not set/); // the whole account is never a root
  assert.throws(() => normalizeRoot("relative/x"), /absolute/);
  assert.equal(normalizeRoot("/LucyDarling-PrintOrders/"), "/LucyDarling-PrintOrders");

  assert.equal(assertInRoot(ROOT, `${ROOT}/demo/x.jpg`), `${ROOT}/demo/x.jpg`);
  assert.equal(assertInRoot(ROOT, "/lucydarling-printorders/DEMO/x.jpg"), "/lucydarling-printorders/DEMO/x.jpg");
  for (const bad of [
    "/Other/x.jpg",
    "/",
    "/LucyDarling-PrintOrdersX/demo/x.jpg", // same prefix, different folder
    `${ROOT}/demo/../../Other/x.jpg`,
    `${ROOT}/./demo`,
    `${ROOT}//demo`,
    `${ROOT}/demo\\x`,
    "LucyDarling-PrintOrders/demo",
  ]) {
    assert.throws(() => assertInRoot(ROOT, bad), DropboxPathRefused, bad);
  }
  assert.throws(() => joinPath(ROOT, ".."), DropboxPathRefused);
  assert.throws(() => joinPath(ROOT, "demo/../live"), DropboxPathRefused);
  assert.equal(apiArgHeader({ path: "/a/Zürich" }), '{"path":"/a/Z\\u00fcrich"}');
});

test("the client refuses outside paths and non-writable writes BEFORE any request is made", async () => {
  const fake = new FakeDropbox();
  const c = client(fake);
  const data = Buffer.from("x");
  await assert.rejects(c.upload("/Other/x.jpg", data), DropboxPathRefused);
  await assert.rejects(c.upload("/LucyDarling-PrintOrdersX/demo/x.jpg", data), DropboxPathRefused);
  await assert.rejects(c.download("/Other/secret.txt"), DropboxPathRefused);
  await assert.rejects(c.listFolder("/"), DropboxPathRefused);
  await assert.rejects(c.delete(`${ROOT}/demo/../../Other`), DropboxPathRefused);
  await assert.rejects(c.move(`${ROOT}/staging/a`, "/Other/a"), DropboxPathRefused);
  // Inside the root but not writable: live/, the root itself, a sibling folder.
  await assert.rejects(c.upload(`${ROOT}/live/x.jpg`, data), /not inside/);
  await assert.rejects(c.delete(ROOT), /not inside/);
  await assert.rejects(c.ensureFolder(`${ROOT}/other`), /not inside/);
  await assert.rejects(c.move(`${ROOT}/staging/a`, `${ROOT}/live/a`), /not inside/);
  // A read-only client writes nothing anywhere.
  await assert.rejects(client(fake, []).upload(`${ROOT}/demo/x.jpg`, data), /read-only/);
  assert.deepEqual(fake.seenPaths, [], "nothing reached Dropbox");
  assert.equal(fake.tokenCalls, 0);

  // Allowed writes work, in any letter case.
  await c.upload(`${ROOT.toUpperCase()}/DEMO/ok.jpg`, data);
  assert.ok(fake.has(`${ROOT}/demo/ok.jpg`));
});

test("a demo client can never write to live/, and a live client is refused while live delivery is off", () => {
  assert.equal(LIVE_DELIVERY_ALLOWED, false);
  assert.throws(() => assertDestinationWritable(LIVE), /live dealer is disabled/);
  assert.throws(() => dropboxClientFor(LIVE, { DROPBOX_ROOT_PATH: ROOT, DROPBOX_APP_KEY: "k", DROPBOX_APP_SECRET: "s", DROPBOX_REFRESH_TOKEN: "r" }), /disabled/);
  assert.doesNotThrow(() => assertDestinationWritable(LIVE, true));
  assert.throws(() => dropboxClientFor(DEMO, { DROPBOX_ROOT_PATH: ROOT }), /credentials are incomplete/);
});

// ---------- destination ----------

async function img(w: number, h: number) {
  const noise = Buffer.alloc(w * h * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
  return sharp(noise, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 70 }).toBuffer();
}

const ORDER_ID = "5550001";
const SIZES: Record<string, [number, number, string]> = {
  ultrasound: [1200, 900, "4x3"],
  baby_bump: [900, 900, "3x3"],
  baby_photo: [1200, 1200, "4x4"],
};
function snapshot(): PrintSnapshot {
  return {
    frozenAt: "2026-10-10T00:00:00Z",
    photoRows: Object.entries(SIZES).map(([k, [, , size]]) => ({
      slot_key: k, storage_path: `print-orders/${ORDER_ID}/${k}`, print_size: size, status: "cropped",
    })),
    extraRows: [],
    order: {
      bookTheme: "little_artist",
      shipTo: { fname: "Pat", lname: "Smith", address1: "12 Main St", city: "Springfield", state: "IL", zip: "62701", country: "US" },
      customer: { fname: "Pat", lname: "Smith" },
    },
  };
}
const download = async (p: string) => {
  const [w, h] = SIZES[p.split("/").pop()!];
  return img(w, h);
};

function deliverDeps(fake: FakeDropbox, row: RecordedOrderRow | null, over: Partial<DeliverDeps> = {}) {
  const marks: Array<[string, string]> = [];
  const warnings: string[] = [];
  let run = 0;
  const deps: DeliverDeps = {
    loadRow: async () => row,
    download,
    destinationFor: (dest, folderName) => new DropboxDestination(client(fake), dest, { runId: `r${++run}`, folderName }),
    markSent: async (id, from) => { marks.push([id, from]); return true; },
    warn: (m) => warnings.push(m),
    destination: DEMO,
    now: () => new Date("2026-10-10T12:34:56Z"),
    ...over,
  };
  return { deps, marks, warnings };
}
const readyRow = (): RecordedOrderRow => ({ status: "ready", snapshot: snapshot(), external_id: `TEST-${ORDER_ID}`, print_count: 3 });

test("deliver: images then XML into staging, one move into demo/, then marked sent", async () => {
  const fake = new FakeDropbox();
  const { deps, marks } = deliverDeps(fake, readyRow());
  const r = await deliverPrintOrder(ORDER_ID, {}, deps);

  assert.equal(r.location, `${ROOT}/demo/TEST-${ORDER_ID}`);
  assert.equal(r.destination.kind, "demo");
  assert.deepEqual(marks, [[ORDER_ID, "ready"]]);
  // Every upload went to staging (never straight into the hotfolder), XML last.
  assert.ok(fake.uploads.every((p) => p.startsWith(`${ROOT}/staging/TEST-${ORDER_ID}-run-`)));
  assert.match(fake.uploads.at(-1)!, /TEST-5550001\.xml$/);
  assert.equal(fake.uploads.length, 4);
  // The hotfolder has exactly one order folder: one XML plus every image; staging is empty.
  const files = fake.children(`${ROOT}/demo/TEST-${ORDER_ID}`).map((n) => n.name).sort();
  assert.equal(files.filter((f) => f.endsWith(".xml")).length, 1);
  assert.equal(files.length, 4);
  assert.deepEqual(fake.children(`${ROOT}/staging`), []);
  assert.ok(fake.seenPaths.every((p) => p.toLowerCase().startsWith(ROOT.toLowerCase())), "nothing outside the root");
  assert.ok(!fake.seenPaths.some((p) => p.toLowerCase().includes("/live")), "nothing touched live/");
});

test("deliver: an upload failing part-way leaves the order ready, the hotfolder untouched, and a retry starts clean", async () => {
  const fake = new FakeDropbox();
  // A crash from an earlier run left a half-written staging folder behind.
  fake.addFile(`${ROOT}/staging/TEST-${ORDER_ID}-run-old/0001_x.jpg`, Buffer.from("half"));
  // Another order's staging folder with a longer id must not be touched.
  fake.addFile(`${ROOT}/staging/TEST-${ORDER_ID}9-run-x/keep.jpg`, Buffer.from("other"));

  let n = 0;
  fake.failUpload = () => ++n === 2;
  const first = deliverDeps(fake, readyRow());
  await assert.rejects(deliverPrintOrder(ORDER_ID, {}, first.deps), /files\/upload failed/);
  assert.deepEqual(first.marks, [], "not marked sent");
  assert.equal(fake.has(`${ROOT}/demo/TEST-${ORDER_ID}`), false);
  assert.deepEqual(fake.children(`${ROOT}/staging`).map((x) => x.name).sort(), [`TEST-${ORDER_ID}9-run-x`]);

  fake.failUpload = null;
  const second = deliverDeps(fake, readyRow());
  await deliverPrintOrder(ORDER_ID, {}, second.deps);
  assert.deepEqual(second.marks, [[ORDER_ID, "ready"]]);
  assert.equal(fake.children(`${ROOT}/demo/TEST-${ORDER_ID}`).length, 4);
  assert.ok(fake.has(`${ROOT}/staging/TEST-${ORDER_ID}9-run-x/keep.jpg`));
});

test("deliver: refuses when the folder is already in the hotfolder or in _error (exactly once)", async () => {
  const fake = new FakeDropbox();
  fake.addFile(`${ROOT}/demo/TEST-${ORDER_ID}/TEST-${ORDER_ID}.xml`, Buffer.from("<x/>"));
  const a = deliverDeps(fake, readyRow());
  await assert.rejects(deliverPrintOrder(ORDER_ID, {}, a.deps), /already exists in the hotfolder/);
  assert.deepEqual(a.marks, []);

  const fake2 = new FakeDropbox();
  fake2.addFile(`${ROOT}/demo/_error/TEST-${ORDER_ID}/reason.txt`, Buffer.from("bad"));
  await assert.rejects(deliverPrintOrder(ORDER_ID, {}, deliverDeps(fake2, readyRow()).deps), /already in _error/);
  assert.deepEqual(fake2.uploads, []);
});

test("deliver: once pfRouter has moved the order to processed/, a re-run is refused", async () => {
  const fake = new FakeDropbox();
  const first = deliverDeps(fake, readyRow());
  await deliverPrintOrder(ORDER_ID, {}, first.deps);
  assert.deepEqual(first.marks, [[ORDER_ID, "ready"]]);
  // pfRouter's postAction "move": demo/<order> -> demo/processed/<order>
  const files = fake.children(`${ROOT}/demo/TEST-${ORDER_ID}`);
  for (const f of files) fake.addFile(`${ROOT}/demo/processed/TEST-${ORDER_ID}/${f.name}`, Buffer.from("x"));
  const gone = `${ROOT}/demo/TEST-${ORDER_ID}`.toLowerCase();
  for (const k of [...fake.nodes.keys()]) if (k === gone || k.startsWith(`${gone}/`)) fake.nodes.delete(k);
  assert.equal(fake.has(`${ROOT}/demo/TEST-${ORDER_ID}`), false);

  // Even with the DB row wrongly back at "ready" (the "marking sent failed" case), the order is not sent twice.
  const again = deliverDeps(fake, readyRow());
  await assert.rejects(deliverPrintOrder(ORDER_ID, {}, again.deps), /already in processed/);
  assert.deepEqual(again.marks, []);
  assert.equal(fake.has(`${ROOT}/demo/TEST-${ORDER_ID}`), false);
});

test("deliver: refuses anything not ready; a sent order needs --force, and resend stays disabled", async () => {
  const fake = new FakeDropbox();
  for (const status of ["held", "refused", "error"]) {
    await assert.rejects(deliverPrintOrder(ORDER_ID, {}, deliverDeps(fake, { ...readyRow(), status }).deps), new RegExp(`"${status}", not ready`));
  }
  await assert.rejects(deliverPrintOrder(ORDER_ID, {}, deliverDeps(fake, null).deps), /no print order recorded/);
  await assert.rejects(deliverPrintOrder("abc", {}, deliverDeps(fake, readyRow()).deps), /not a numeric/);

  const sent = { ...readyRow(), status: "sent" };
  await assert.rejects(deliverPrintOrder(ORDER_ID, {}, deliverDeps(fake, sent).deps), /already sent — refusing \(use --force/);

  assert.equal(RESEND_ENABLED, false);
  const forced = deliverDeps(fake, sent);
  await assert.rejects(deliverPrintOrder(ORDER_ID, { force: true }, forced.deps), new RegExp(RESEND_DISABLED_MESSAGE));
  assert.match(forced.warnings[0], /WARNING: --force on an order that was already sent/);
  assert.deepEqual(fake.uploads, [], "nothing uploaded");

  // The resend path itself (flag on): a new folder name, same external_id, sent → sent.
  const on = deliverDeps(fake, sent, { resendEnabled: true });
  const r = await deliverPrintOrder(ORDER_ID, { force: true }, on.deps);
  assert.equal(r.folderName, `TEST-${ORDER_ID}-resend-20261010123456`);
  assert.equal(r.resend, true);
  assert.deepEqual(on.marks, [[ORDER_ID, "sent"]]);
  const xml = fake.nodes.get(`${ROOT}/demo/TEST-${ORDER_ID}-resend-20261010123456/TEST-${ORDER_ID}.xml`.toLowerCase())!.data!.toString();
  assert.match(xml, /external_id="TEST-5550001"/);
});

test("deliver: if the database refuses the sent update after delivery, it says so loudly and does not resend", async () => {
  const fake = new FakeDropbox();
  const lost = deliverDeps(fake, readyRow(), { markSent: async () => false });
  await assert.rejects(deliverPrintOrder(ORDER_ID, {}, lost.deps), /was delivered to .* do not re-run/);
  const fake2 = new FakeDropbox();
  const down = deliverDeps(fake2, readyRow(), { markSent: async () => { throw new Error("db down"); } });
  await assert.rejects(deliverPrintOrder(ORDER_ID, {}, down.deps), /marking 5550001 sent failed \(db down\)/);
  // A re-run now refuses because the folder is in the hotfolder.
  await assert.rejects(deliverPrintOrder(ORDER_ID, {}, deliverDeps(fake2, readyRow()).deps), /already exists in the hotfolder/);
});

// ---------- _error monitoring ----------

test("_error check: each sent order found there becomes error with pfRouter's reason, alerted once, never again", async () => {
  const fake = new FakeDropbox();
  fake.addFile(`${ROOT}/demo/_error/TEST-1/reason.txt`, Buffer.from("Unknown product TBD-4X4\n"));
  fake.addFile(`${ROOT}/demo/_error/TEST-2/TEST-2.xml`, Buffer.from("<x/>")); // no reason.txt
  fake.addFile(`${ROOT}/demo/_error/TEST-3-resend-20261010123456/reason.txt`, Buffer.from("bad xml"));
  fake.addFolder(`${ROOT}/demo/_error/SOMEONE-ELSE`);
  fake.addFile(`${ROOT}/demo/_error/stray.txt`, Buffer.from("not a folder"));

  const status: Record<string, string> = { "1": "sent", "2": "sent", "3": "sent" };
  const alerts: Array<{ shopifyOrderId: string; reason: string }> = [];
  const run = () =>
    checkErrorFolder({
      client: client(fake, []),
      dest: DEMO,
      findSent: async (ids) =>
        ids.filter((id) => /^TEST-\d$/.test(id) && status[id.slice(5)] === "sent").map((id) => ({ shopifyOrderId: id.slice(5), externalId: id })),
      markError: async (id) => {
        if (status[id] !== "sent") return false;
        status[id] = "error";
        return true;
      },
      alert: async (i) => { alerts.push(i); },
    });

  const r1 = await run();
  assert.deepEqual(r1.marked.sort(), ["TEST-1", "TEST-2", "TEST-3-resend-20261010123456"]);
  assert.deepEqual(r1.ignored, ["SOMEONE-ELSE"]);
  assert.deepEqual(status, { "1": "error", "2": "error", "3": "error" });
  assert.equal(alerts.length, 3);
  assert.equal(alerts.find((a) => a.shopifyOrderId === "1")!.reason, "Unknown product TBD-4X4");
  assert.match(alerts.find((a) => a.shopifyOrderId === "2")!.reason, /left no reason\.txt/);

  const r2 = await run();
  assert.deepEqual(r2.marked, []);
  assert.equal(alerts.length, 3, "no repeat alerts");
  assert.deepEqual(fake.uploads, [], "the check never writes to Dropbox");
  assert.equal(externalIdFromFolder("TEST-9-resend-20261010123456"), "TEST-9");
});

test("_error check: no _error folder yet is fine; a failed alert still leaves the order marked (no retry storm)", async () => {
  const empty = await checkErrorFolder({
    client: client(new FakeDropbox(), []), dest: DEMO,
    findSent: async () => { throw new Error("not called"); }, markError: async () => true, alert: async () => {},
  });
  assert.deepEqual(empty.seen, []);

  const fake = new FakeDropbox();
  fake.addFile(`${ROOT}/demo/_error/TEST-1/reason.txt`, Buffer.from("x"));
  const r = await checkErrorFolder({
    client: client(fake, []), dest: DEMO,
    findSent: async () => [{ shopifyOrderId: "1", externalId: "TEST-1" }],
    markError: async () => true,
    alert: async () => { throw new Error("resend down"); },
  });
  assert.deepEqual(r.marked, ["TEST-1"]);
  assert.deepEqual(r.alertFailures, ["TEST-1"]);
});

test("cron route: refuses without CRON_SECRET configured, and without the right bearer token", async () => {
  const saved = process.env.CRON_SECRET;
  const req = (auth?: string) => new NextRequest("http://x/api/cron/print-order-errors", { headers: auth ? { authorization: auth } : {} });
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await cronGET(req("Bearer anything"))).status, 500);
    process.env.CRON_SECRET = "s3cret-value";
    assert.equal((await cronGET(req())).status, 401);
    assert.equal((await cronGET(req("Bearer wrong"))).status, 401);
    assert.equal((await cronGET(req("s3cret-value"))).status, 401);
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
});

test("webhook route: no signature is 401 whether or not the secret is set; a signed request with no secret is 500", async () => {
  const saved = process.env.SHOPIFY_WEBHOOK_SECRET;
  const req = (hmac?: string) =>
    new NextRequest("http://x/api/webhooks/shopify/orders-paid", { method: "POST", body: "{}", headers: hmac ? { "x-shopify-hmac-sha256": hmac } : {} });
  try {
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
    assert.equal((await webhookPOST(req())).status, 401);
    assert.equal((await webhookPOST(req("abc"))).status, 500);
    process.env.SHOPIFY_WEBHOOK_SECRET = "whsec";
    assert.equal((await webhookPOST(req())).status, 401);
    assert.equal((await webhookPOST(req("bad"))).status, 401);
  } finally {
    if (saved === undefined) delete process.env.SHOPIFY_WEBHOOK_SECRET;
    else process.env.SHOPIFY_WEBHOOK_SECRET = saved;
  }
});
