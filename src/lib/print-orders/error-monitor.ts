import type { Destination } from "./config";
import type { DropboxClient } from "./dropbox";
import { ERROR_FOLDER, errorPath } from "./dropbox-destination";
import { joinPath } from "./dropbox";

export interface SentOrderRef {
  shopifyOrderId: string;
  shopifyOrderName?: string | null;
  externalId: string;
}

export interface ErrorAlertInfo {
  shopifyOrderId: string;
  shopifyOrderName?: string;
  externalId: string;
  folder: string;
  reason: string;
}

/** A folder in _error that matches no print_orders row at all (any status). */
export interface UnknownFolderAlertInfo {
  /** "demo" or "live". */
  destination: string;
  folder: string;
  reason: string;
}

export interface ErrorCheckDeps {
  client: DropboxClient;
  dest: Destination;
  /** Orders currently "sent" whose external_id is one of these. */
  findSent: (externalIds: string[]) => Promise<SentOrderRef[]>;
  /** Set status "error" ONLY if the order is still "sent". True when this call changed the row. */
  markError: (shopifyOrderId: string, reason: string, at: string) => Promise<boolean>;
  alert: (info: ErrorAlertInfo) => Promise<void>;
  /** external_ids that exist in print_orders in ANY status (an already-"error" order is known, not unknown). */
  findKnown: (externalIds: string[]) => Promise<string[]>;
  /** Record that this folder was alerted on. True only for the first call per (destination, folder). */
  claimUnknown: (destination: string, folder: string, reason: string, at: string) => Promise<boolean>;
  alertUnknown: (info: UnknownFolderAlertInfo) => Promise<void>;
  now?: () => Date;
}

export interface ErrorCheckResult {
  /** Order folders seen in _error. */
  seen: string[];
  /** Orders moved to "error" (and alerted) by this run. */
  marked: string[];
  /** Folders with no matching sent order: already marked, or unknown. Logged; unknown ones are also below. */
  ignored: string[];
  alertFailures: string[];
  /** Folders matching no print_orders row, alerted for the first time by this run. */
  unknownAlerted: string[];
  /** The unknown-folder part failed (e.g. its table is missing). The sent-order part above still ran. */
  unknownError?: string;
}

export const MAX_REASON_CHARS = 2000;

/** A resend folder (<id>-resend-<timestamp>) belongs to the same order. */
export const externalIdFromFolder = (folder: string) => folder.replace(/-resend-\d{14}$/, "");

/**
 * Look in the hotfolder's _error folder. Every order folder there that matches
 * a "sent" print order becomes "error" with pfRouter's reason, and one alert
 * goes out — once per order: the status change only happens while the row is
 * still "sent", and only the run that changed it alerts. A folder that matches no
 * print_orders row at all gets one "unknown order in _error" alert instead (once per
 * folder, recorded in print_error_unknown_folders). Read-only on Dropbox.
 */
export async function checkErrorFolder(deps: ErrorCheckDeps): Promise<ErrorCheckResult> {
  const result: ErrorCheckResult = { seen: [], marked: [], ignored: [], alertFailures: [], unknownAlerted: [] };
  const base = errorPath(deps.client, deps.dest);
  const folders = (await deps.client.listFolder(base)).filter((e) => e[".tag"] === "folder").map((e) => e.name);
  result.seen = folders;
  if (folders.length === 0) return result;

  const sent = await deps.findSent([...new Set(folders.map(externalIdFromFolder))]);
  const byId = new Map(sent.map((s) => [s.externalId.toLowerCase(), s]));
  const at = (deps.now ?? (() => new Date()))().toISOString();

  for (const folder of folders) {
    const order = byId.get(externalIdFromFolder(folder).toLowerCase());
    if (!order) {
      result.ignored.push(folder);
      continue;
    }
    const reason = await readReason(deps.client, base, folder);
    if (!(await deps.markError(order.shopifyOrderId, reason, at))) {
      result.ignored.push(folder);
      continue;
    }
    result.marked.push(folder);
    try {
      await deps.alert({
        shopifyOrderId: order.shopifyOrderId,
        shopifyOrderName: order.shopifyOrderName ?? undefined,
        externalId: order.externalId,
        folder,
        reason,
      });
    } catch (err) {
      // The order is already "error" (visible in print_orders); never re-alert.
      console.error(`print order error alert failed for ${order.shopifyOrderId}:`, err);
      result.alertFailures.push(folder);
    }
  }

  // Folders that match no print_orders row at all (e.g. a folder dropped in by hand that pfRouter
  // rejected): one "unknown order in _error" alert per folder, ever. Found on the 2026-11-12
  // cloud-PC test, where such a folder produced no alert at all.
  if (result.ignored.length > 0) {
    try {
      const known = new Set((await deps.findKnown([...new Set(result.ignored.map(externalIdFromFolder))])).map((id) => id.toLowerCase()));
      for (const folder of result.ignored) {
        if (known.has(externalIdFromFolder(folder).toLowerCase())) continue;
        const reason = await readReason(deps.client, base, folder);
        if (!(await deps.claimUnknown(deps.dest.kind, folder, reason, at))) continue;
        result.unknownAlerted.push(folder);
        try {
          await deps.alertUnknown({ destination: deps.dest.kind, folder, reason });
        } catch (err) {
          // Already recorded as alerted; never re-alert (same rule as above).
          console.error(`unknown _error folder alert failed for ${folder}:`, err);
          result.alertFailures.push(folder);
        }
      }
    } catch (err) {
      console.error("unknown _error folder check failed:", err);
      result.unknownError = (err as Error).message ?? String(err);
    }
  }
  return result;
}

async function readReason(client: DropboxClient, base: string, folder: string): Promise<string> {
  let reason: string;
  try {
    reason = (await client.download(joinPath(base, folder, "reason.txt"))).toString("utf8").trim() || "(reason.txt is empty)";
  } catch {
    reason = `(pfRouter left no reason.txt in ${ERROR_FOLDER}/${folder})`;
  }
  return reason.length > MAX_REASON_CHARS ? `${reason.slice(0, MAX_REASON_CHARS)}…` : reason;
}
