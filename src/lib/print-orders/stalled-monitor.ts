import { STALLED_AFTER_MINUTES, STALLED_LOOKBACK_HOURS, type Destination } from "./config";
import type { DropboxClient } from "./dropbox";
import { joinPath } from "./dropbox";
import { orderPath } from "./dropbox-destination";

/** pfRouter writes this into an order folder the first time it sees it. */
export const PARTNER_MARKER = ".pfrouter-partner.json";

export interface StalledCandidate {
  shopifyOrderId: string;
  shopifyOrderName?: string | null;
  externalId: string;
  sentAt: string;
}

export interface StalledOrderInfo {
  shopifyOrderId: string;
  shopifyOrderName?: string;
  externalId: string;
  sentAt: string;
  minutesWaiting: number;
  /** False = pfRouter never saw the folder (likely not running or not syncing). */
  pfRouterSawIt: boolean;
}

export interface StalledCheckDeps {
  client: DropboxClient;
  dest: Destination;
  /** "sent" orders for this destination with sent_at in [sinceIso, beforeIso) and no stalled alert yet. */
  findCandidates: (beforeIso: string, sinceIso: string) => Promise<StalledCandidate[]>;
  /** Set stalled_alerted_at ONLY if still "sent" and not yet alerted. True when this call changed the row. */
  claimAlert: (shopifyOrderId: string, at: string) => Promise<boolean>;
  /** One order → that order's alert; 2+ → one combined "pfRouter may be down" alert. */
  alert: (orders: StalledOrderInfo[]) => Promise<void>;
  now?: () => Date;
  thresholdMinutes?: number;
  lookbackHours?: number;
}

export interface StalledCheckResult {
  /** Candidates whose folder is still in the hotfolder. */
  stalled: string[];
  /** Orders claimed (alerted for) by this run. */
  alerted: string[];
  alertFailed: boolean;
}

/**
 * Find "sent" orders whose folder is STILL in the hotfolder past the threshold.
 * pfRouter moves an order to processed/<dest>/ (accepted) or <hotfolder>/_error/
 * (rejected), so a folder still at <hotfolder>/<external_id> was not picked up.
 * One alert per order (the claim is a guarded update); 2+ stalled in one run
 * send a single combined alert. Read-only on Dropbox.
 */
export async function checkStalledOrders(deps: StalledCheckDeps): Promise<StalledCheckResult> {
  const result: StalledCheckResult = { stalled: [], alerted: [], alertFailed: false };
  const now = (deps.now ?? (() => new Date()))();
  const before = new Date(now.getTime() - (deps.thresholdMinutes ?? STALLED_AFTER_MINUTES) * 60_000);
  const since = new Date(now.getTime() - (deps.lookbackHours ?? STALLED_LOOKBACK_HOURS) * 3_600_000);

  const candidates = await deps.findCandidates(before.toISOString(), since.toISOString());
  const infos: StalledOrderInfo[] = [];
  for (const c of candidates) {
    const folder = orderPath(deps.client, deps.dest, c.externalId);
    if (!(await deps.client.getMetadata(folder))) continue; // processed, in _error, or not there: not stalled
    result.stalled.push(c.externalId);
    const marker = await deps.client.getMetadata(joinPath(folder, PARTNER_MARKER));
    if (!(await deps.claimAlert(c.shopifyOrderId, now.toISOString()))) continue; // another run got it
    infos.push({
      shopifyOrderId: c.shopifyOrderId,
      shopifyOrderName: c.shopifyOrderName ?? undefined,
      externalId: c.externalId,
      sentAt: c.sentAt,
      minutesWaiting: Math.floor((now.getTime() - new Date(c.sentAt).getTime()) / 60_000),
      pfRouterSawIt: marker !== null,
    });
    result.alerted.push(c.externalId);
  }
  if (infos.length === 0) return result;
  try {
    await deps.alert(infos);
  } catch (err) {
    // The rows are already claimed; never re-alert (same as the _error check).
    console.error("print order stalled alert failed:", err);
    result.alertFailed = true;
  }
  return result;
}
