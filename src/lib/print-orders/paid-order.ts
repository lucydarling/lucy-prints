import { MAX_EXTRAS_PER_ORDER, MIN_PRINTS_PER_ORDER } from "./config";
import { validatePrintRequest } from "./print-request";
import { buildFromSnapshot } from "./build-from-snapshot";
import { PrintOrderHeld, type SessionExtraRow, type SessionPhotoRow } from "./build-order";
import { quantityMismatches, type ReprintRow, type RoundItems } from "./round";
import type { PrintedState } from "./printed";
import type { ShipTo } from "./order-xml";

/** The parts of a Shopify order (webhook body or Admin REST order) that we read. */
export interface ShopifyPaidOrder {
  id: number | string;
  name?: string;
  financial_status?: string;
  /** When the order was placed — compared with the round's expiry. */
  created_at?: string;
  line_items?: Array<{ variant_id?: number | string | null; quantity?: number }>;
  /** Cart attributes (set by buildCheckoutUrl) arrive here. */
  note_attributes?: Array<{ name?: string; value?: string }>;
  shipping_address?: {
    first_name?: string | null; last_name?: string | null; company?: string | null;
    address1?: string | null; address2?: string | null; city?: string | null;
    province_code?: string | null; province?: string | null; zip?: string | null;
    country_code?: string | null; phone?: string | null;
  } | null;
  customer?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
  /** The customer's email on the order (either field may be set). */
  email?: string | null;
  contact_email?: string | null;
}

export type PaidOrderStatus = "ignored" | "ready" | "held" | "refused" | "sent" | "error";

/**
 * The exact rows a paid order prints, frozen at payment: only that round's
 * rows. A reprint's new crop sits in `photoRows` under its slot_key (the
 * printed slot itself is not in the snapshot), with the bookkeeping in `reprints`.
 * Builds and retries read ONLY this.
 */
export interface PrintSnapshot {
  frozenAt: string;
  photoRows: SessionPhotoRow[];
  extraRows: SessionExtraRow[];
  /** Which photoRows are reprints (print_reprints ids), so the commit can mark them included. */
  reprints?: Array<{ reprint_id: string; slot_key: string }>;
  /** What the order was for, taken from the Shopify order at payment — so a build needs nothing live. */
  order?: SnapshotOrderInfo;
}

export interface SnapshotOrderInfo {
  bookTheme: string;
  roundId?: string;
  shipTo: ShipTo;
  customer: { fname?: string; lname?: string };
  /** Where the customer emails go (the Shopify order's email). */
  email?: string;
}

export interface PaidOrderResult {
  status: PaidOrderStatus;
  reasons: string[];
  warnings: string[];
  externalId?: string;
  printCount?: number;
  sessionId?: string;
  roundId?: string;
  paidQuantity?: number;
  /** Progress after a ready order: distinct book slots printed, out of the book's slots. */
  printedSoFar?: number;
  bookSlots?: number;
  snapshot?: PrintSnapshot;
  customerEmail?: string;
}

/** What a customer email needs. Only ever "received" (ready) or "held"; a refused order sends none. */
export interface CustomerNotice {
  kind: "received" | "held";
  shopifyOrderId: string;
  shopifyOrderName?: string;
  to: string;
  sessionToken: string;
  bookTheme: string;
  babyName?: string | null;
  /** This round's counts. */
  newPhotos: number;
  extraPrints: number;
  reprints: number;
  /** Progress after this order: distinct book slots printed, out of the book's slots. */
  printedSoFar: number;
  bookSlots: number;
  shipTo: ShipTo;
}

export interface AlertInfo {
  status: "held" | "refused";
  shopifyOrderId: string;
  shopifyOrderName?: string;
  sessionToken: string;
  reasons: string[];
}

/** A round as recorded at the checkout click. */
export interface RoundRecord {
  id: string;
  session_id: string;
  items: RoundItems;
  quantities: Record<string, number>;
  total_prints: number;
  status: string;
  expires_at: string;
}

export type CommitResult = { ok: true; printedSoFar: number; bookSlots: number } | { ok: false; reason: string };

export interface PaidOrderDeps {
  /** Every variant id that sells prints. */
  printVariantIds: string[];
  loadSession: (token: string) => Promise<{
    session: { id: string; book_theme: string; baby_name?: string | null };
    photoRows: SessionPhotoRow[];
    extraRows: SessionExtraRow[];
    fetchImage: (path: string) => Promise<Buffer>;
  }>;
  loadRound: (roundId: string) => Promise<RoundRecord | null>;
  /** Pending reprints for the session (print_reprints.status = 'pending'). */
  loadReprints: (sessionId: string) => Promise<ReprintRow[]>;
  loadPrinted: (sessionId: string) => Promise<PrintedState>;
  /** True when a DIFFERENT Shopify order already has a ready/sent/error print order for this round. */
  roundUsedByOtherOrder: (roundId: string, shopifyOrderId: string) => Promise<boolean>;
  /** What we already recorded for this Shopify order (webhook retries, manual retries). */
  loadExisting: (shopifyOrderId: string) => Promise<{ status: string; snapshot?: PrintSnapshot } | null>;
  /**
   * Freeze the rows: copy each stored image to a path nobody else writes to
   * (e.g. print-orders/<order id>/…) and return rows pointing at the copies.
   */
  freeze: (
    shopifyOrderId: string,
    photoRows: SessionPhotoRow[],
    extraRows: SessionExtraRow[]
  ) => Promise<{ frozenAt: string; photoRows: SessionPhotoRow[]; extraRows: SessionExtraRow[] }>;
  /**
   * Make the order's items count as printed: write print_order_items, mark the
   * round paid, mark reprints included and move each reprinted slot's live
   * pointer to its new photo. Idempotent for the same order; a collision with
   * ANOTHER order's items returns { ok: false } (the order is then held).
   */
  commitRound: (args: {
    shopifyOrderId: string;
    sessionId: string;
    roundId: string;
    snapshot: PrintSnapshot;
  }) => Promise<CommitResult>;
  /** Email Kevin about a refused or held order. Failures here must never fail the order. */
  alert: (info: AlertInfo) => Promise<void>;
  /**
   * Email the customer "order received" (ready) or "we need photos" (held). Optional;
   * the real one sends at most once per order and failures never fail the order.
   */
  notify?: (n: CustomerNotice) => Promise<void>;
  record: (r: PaidOrderResult & { shopifyOrderId: string; shopifyOrderName?: string }) => Promise<void>;
}

const attr = (o: ShopifyPaidOrder, name: string) =>
  o.note_attributes?.find((a) => a.name === name)?.value?.trim() || "";

export interface HandleOptions {
  /**
   * Take a fresh snapshot of the round instead of reusing the saved one,
   * even for a refused order (never for a ready one). A HELD order always
   * re-freezes on retry: its customer may have fixed what was missing.
   */
  refreeze?: boolean;
}

/**
 * Decide what a paid Shopify order means for printing, and (if it is a print
 * order) freeze, build and validate it. NOTHING is written to Photo Finale;
 * the only side effects are `deps.freeze`, `deps.record`, `deps.commitRound`
 * and `deps.alert`. Orders with no print line item are ignored.
 *
 * What is printed is exactly the round the checkout recorded (`round_id` cart
 * attribute): its new slots, its extras and its reprints. Photos added after
 * the click are not in it and wait for the next round. Paid quantities per
 * variant must equal the round's. Anything off (an item deleted since the
 * click, quantities that differ, an expired round, a collision) is HELD with
 * an alert and locks nothing; a round that names an already-printed slot is
 * refused.
 */
export async function handlePaidOrder(
  order: ShopifyPaidOrder,
  deps: PaidOrderDeps,
  opts: HandleOptions = {}
): Promise<PaidOrderResult> {
  const orderId = String(order.id);
  const token = attr(order, "session_token");
  const lines = order.line_items ?? [];
  const printLines = lines.filter((l) => deps.printVariantIds.includes(String(l.variant_id)));
  if (printLines.length === 0) return { status: "ignored", reasons: ["no print line item"], warnings: [] };

  const existing = await deps.loadExisting(orderId);
  // Sent to the printer (or failed there): never re-checked, re-frozen or overwritten here.
  if (existing?.status === "sent" || existing?.status === "error") {
    if (opts.refreeze) throw new Error(`order is already ${existing.status} — refusing to re-freeze it`);
    return { status: existing.status, reasons: [], warnings: [], snapshot: existing.snapshot };
  }
  if (opts.refreeze && existing?.status === "ready") {
    throw new Error("order is already ready — refusing to re-freeze it");
  }

  const seen: { babyName?: string | null; roundId?: string; paidQuantity?: number } = {};
  const customerEmail = (order.email || order.contact_email || order.customer?.email || "").trim() || undefined;
  const paid: Record<string, number> = {};
  for (const l of printLines) paid[String(l.variant_id)] = (paid[String(l.variant_id)] ?? 0) + (l.quantity ?? 0);
  seen.paidQuantity = Object.values(paid).reduce((n, q) => n + q, 0);

  const a = order.shipping_address;
  const shipTo: ShipTo = {
    fname: a?.first_name ?? "", lname: a?.last_name ?? "", address1: a?.address1 ?? "",
    address2: a?.address2 ?? undefined, city: a?.city ?? "", state: a?.province_code || a?.province || "",
    zip: a?.zip ?? "", country: a?.country_code ?? "", company: a?.company ?? undefined, phone: a?.phone ?? undefined,
  };
  const customer = {
    fname: order.customer?.first_name ?? a?.first_name ?? undefined,
    lname: order.customer?.last_name ?? a?.last_name ?? undefined,
  };


  const recordNow = (r: PaidOrderResult) =>
    deps.record({
      ...r,
      customerEmail: r.customerEmail ?? customerEmail,
      roundId: r.roundId ?? seen.roundId,
      paidQuantity: seen.paidQuantity,
      shopifyOrderId: orderId,
      shopifyOrderName: order.name,
    });
  const done = async (r: PaidOrderResult) => {
    await recordNow(r);
    if ((r.status === "ready" || r.status === "held") && existing?.status !== r.status && deps.notify && customerEmail) {
      try {
        // A hold can happen before anything was frozen, so it needs nothing from the snapshot.
        const snap = r.status === "ready" ? r.snapshot : undefined;
        await deps.notify({
          kind: r.status === "ready" ? "received" : "held",
          shopifyOrderId: orderId,
          shopifyOrderName: order.name,
          to: customerEmail,
          sessionToken: token,
          bookTheme: attr(order, "book_theme"),
          babyName: seen.babyName,
          newPhotos: snap ? snap.photoRows.filter((x) => x.status !== "empty").length - (snap.reprints?.length ?? 0) : 0,
          extraPrints: snap ? snap.extraRows.filter((x) => x.storage_path).reduce((n, x) => n + (x.quantity ?? 0), 0) : 0,
          reprints: snap?.reprints?.length ?? 0,
          printedSoFar: r.printedSoFar ?? 0,
          bookSlots: r.bookSlots ?? 0,
          shipTo,
        });
      } catch (err) {
        console.error("print order customer email failed:", err);
      }
    }
    if ((r.status === "held" || r.status === "refused") && existing?.status !== r.status) {
      try {
        await deps.alert({ status: r.status, shopifyOrderId: orderId, shopifyOrderName: order.name, sessionToken: token, reasons: r.reasons });
      } catch (err) {
        console.error("print order alert failed:", err);
      }
    }
    return r;
  };
  const refuse = (...reasons: string[]) => done({ status: "refused", reasons, warnings: [] });

  const theme = attr(order, "book_theme");
  const roundId = attr(order, "round_id");
  seen.roundId = roundId || undefined;
  if (!token) return refuse("order has no session_token attribute");
  if (!roundId) return refuse("order has no round_id attribute — handle this order by hand");

  // Checks that need no session first (unknown / unsupported book).
  const early = validatePrintRequest({ bookTheme: theme, newPhotos: MIN_PRINTS_PER_ORDER, extraPrints: 0, reprints: 0 });
  if (early.errors.length > 0) return refuse(...early.errors);

  let loaded;
  try {
    loaded = await deps.loadSession(token);
  } catch (err) {
    return refuse((err as Error).message);
  }
  seen.babyName = loaded.session.baby_name;
  if (loaded.session.book_theme !== theme) {
    return refuse(`order says ${theme || "(no book_theme)"} but the session is ${loaded.session.book_theme}`);
  }

  const round = await deps.loadRound(roundId);
  if (!round) return refuse(`round ${roundId} was not found`);
  if (round.session_id !== loaded.session.id) return refuse("the round belongs to a different session");
  if (await deps.roundUsedByOtherOrder(roundId, orderId)) return refuse("this round was already paid by another order");

  const sessionId = loaded.session.id;
  const hold = (...reasons: string[]) => done({ status: "held", reasons, warnings: [], sessionId, roundId });

  // The round is what the customer was shown and charged for; the paid lines must match it exactly.
  const mismatches = quantityMismatches(paid, round.quantities);
  if (mismatches.length > 0) return hold(`paid quantities do not match the recorded round (${mismatches.join("; ")})`);
  const roundExtras = round.items.extras.reduce((n, e) => n + e.quantity, 0);
  const roundCheck = validatePrintRequest({ bookTheme: theme, newPhotos: round.items.slots.length, extraPrints: roundExtras, reprints: round.items.reprints.length });
  if (roundCheck.errors.length > 0) return hold(`the recorded round is not printable: ${roundCheck.errors.join("; ")}`);
  const placed = order.created_at ? Date.parse(order.created_at) : Date.now();
  if (existing?.status !== "ready" && Date.parse(round.expires_at) < placed) {
    return hold("the round had expired (24 hours) before this order was placed");
  }

  // Already-printed slots are never printed again unless a pending reprint replaces them.
  const printed = await deps.loadPrinted(sessionId);
  const pending = await deps.loadReprints(sessionId);
  const pendingById = new Map(pending.map((p) => [p.id, p]));
  const printedAgain = round.items.slots.filter((s) => printed.slots.has(s.slot_key)).map((s) => s.slot_key);
  if (printedAgain.length > 0 && existing?.status !== "ready") {
    return refuse(`already printed (no paid reprint): ${printedAgain.join(", ")}`);
  }
  const printedExtras = round.items.extras.filter((e) => printed.extras.has(e.extra_id)).map((e) => e.extra_id);
  if (printedExtras.length > 0 && existing?.status !== "ready") {
    return refuse(`extras already printed: ${printedExtras.join(", ")}`);
  }

  // Find the round's rows now. Anything missing or changed since the click holds the order.
  const livePhoto = new Map(loaded.photoRows.map((r) => [r.slot_key, r]));
  const liveExtra = new Map(loaded.extraRows.map((r) => [r.extra_id, r]));
  const missing: string[] = [];
  const photoRows: SessionPhotoRow[] = [];
  for (const s of round.items.slots) {
    const row = livePhoto.get(s.slot_key);
    if (!row || !row.storage_path || row.status === "empty") missing.push(`photo ${s.slot_key} was removed`);
    else photoRows.push(row);
  }
  const extraRows: SessionExtraRow[] = [];
  for (const e of round.items.extras) {
    const row = liveExtra.get(e.extra_id);
    if (!row || !row.storage_path) missing.push(`extra ${e.extra_id} was removed`);
    else if (row.quantity !== e.quantity) missing.push(`extra ${e.extra_id} changed from ${e.quantity} to ${row.quantity}`);
    else extraRows.push(row);
  }
  const reprints: Array<{ reprint_id: string; slot_key: string }> = [];
  for (const rp of round.items.reprints) {
    const row = pendingById.get(rp.reprint_id);
    if (!row) missing.push(`the replacement photo for ${rp.slot_key} was removed`);
    else {
      reprints.push({ reprint_id: rp.reprint_id, slot_key: rp.slot_key });
      photoRows.push({ slot_key: row.slot_key, storage_path: row.storage_path, print_size: row.print_size, status: "cropped" });
    }
  }
  if (missing.length > 0 && existing?.status !== "ready") return hold(`changed since checkout: ${missing.join("; ")}`);

  // Freeze at payment (first sight), or reuse what was frozen. Never live rows after that.
  const reuse = existing?.snapshot && existing.status !== "held" && !opts.refreeze;
  const frozen = reuse
    ? existing!.snapshot!
    : { ...(await deps.freeze(orderId, photoRows, extraRows)), reprints };
  const snapshot: PrintSnapshot = { ...frozen, reprints: frozen.reprints ?? reprints, order: { bookTheme: theme, roundId, shipTo, customer, email: customerEmail } };
  const finish = (r: PaidOrderResult) => done({ ...r, sessionId, snapshot, roundId });

  const extraCount = snapshot.extraRows.filter((r) => r.storage_path).reduce((n, r) => n + (r.quantity ?? 0), 0);
  if (extraCount > MAX_EXTRAS_PER_ORDER) {
    return finish({ status: "refused", reasons: [`${extraCount} extra prints in one order is over the sanity limit of ${MAX_EXTRAS_PER_ORDER}`], warnings: [] });
  }

  let built;
  try {
    built = await buildFromSnapshot(orderId, snapshot, loaded.fetchImage, round.total_prints);
  } catch (err) {
    if (err instanceof PrintOrderHeld) return finish({ status: "held", reasons: [err.message], warnings: [] });
    return finish({ status: "refused", reasons: [(err as Error).message], warnings: [] });
  }

  // The order row must exist before its items (they reference it). If we stop after this
  // and before the commit, a retry of the webhook finds a ready order and commits again.
  await recordNow({ status: "ready", reasons: [], warnings: built.warnings, externalId: built.folderName, printCount: built.printCount, sessionId, roundId, snapshot });
  // Make the items count as printed. A collision with another order's items holds this one.
  const commit = await deps.commitRound({ shopifyOrderId: orderId, sessionId, roundId, snapshot });
  if (!commit.ok) return finish({ status: "held", reasons: [commit.reason], warnings: [] });
  return finish({
    status: "ready", reasons: [], warnings: built.warnings, externalId: built.folderName, printCount: built.printCount,
    printedSoFar: commit.printedSoFar, bookSlots: commit.bookSlots,
  });
}
