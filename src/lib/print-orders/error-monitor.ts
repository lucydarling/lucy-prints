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

export interface ErrorCheckDeps {
  client: DropboxClient;
  dest: Destination;
  /** Orders currently "sent" whose external_id is one of these. */
  findSent: (externalIds: string[]) => Promise<SentOrderRef[]>;
  /** Set status "error" ONLY if the order is still "sent". True when this call changed the row. */
  markError: (shopifyOrderId: string, reason: string, at: string) => Promise<boolean>;
  alert: (info: ErrorAlertInfo) => Promise<void>;
  now?: () => Date;
}

export interface ErrorCheckResult {
  /** Order folders seen in _error. */
  seen: string[];
  /** Orders moved to "error" (and alerted) by this run. */
  marked: string[];
  /** Folders with no matching sent order: already marked, or not ours. Logged, not acted on. */
  ignored: string[];
  alertFailures: string[];
}

export const MAX_REASON_CHARS = 2000;

/** A resend folder (<id>-resend-<timestamp>) belongs to the same order. */
export const externalIdFromFolder = (folder: string) => folder.replace(/-resend-\d{14}$/, "");

/**
 * Look in the hotfolder's _error folder. Every order folder there that matches
 * a "sent" print order becomes "error" with pfRouter's reason, and one alert
 * goes out — once per order: the status change only happens while the row is
 * still "sent", and only the run that changed it alerts. Read-only on Dropbox.
 */
export async function checkErrorFolder(deps: ErrorCheckDeps): Promise<ErrorCheckResult> {
  const result: ErrorCheckResult = { seen: [], marked: [], ignored: [], alertFailures: [] };
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
    let reason: string;
    try {
      reason = (await deps.client.download(joinPath(base, folder, "reason.txt"))).toString("utf8").trim() || "(reason.txt is empty)";
    } catch {
      reason = `(pfRouter left no reason.txt in ${ERROR_FOLDER}/${folder})`;
    }
    if (reason.length > MAX_REASON_CHARS) reason = `${reason.slice(0, MAX_REASON_CHARS)}…`;

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
  return result;
}
