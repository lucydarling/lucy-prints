import { resolveDestination } from "./config";
import { alertPrinterStalled, claimStalledAlert, findStalledCandidates } from "./delivery-deps";
import { readOnlyDropboxClient } from "./dropbox-destination";
import { checkStalledOrders } from "./stalled-monitor";

/** The "sent but not picked up" check with real dependencies (cron route and npm script share this). */
export function runStalledCheck() {
  const dest = resolveDestination();
  return checkStalledOrders({
    client: readOnlyDropboxClient(),
    dest,
    findCandidates: (before, since) => findStalledCandidates(dest.kind, before, since),
    claimAlert: claimStalledAlert,
    alert: alertPrinterStalled,
  });
}
