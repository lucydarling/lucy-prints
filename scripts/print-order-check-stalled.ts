/**
 * Run the "sent but not picked up by pfRouter" check once (the same check as the cron route).
 *
 *   npm run print-order:check-stalled
 */
import { runStalledCheck } from "@/lib/print-orders/run-stalled-check";

runStalledCheck()
  .then((r) => {
    console.log(`still in the hotfolder past the threshold: ${r.stalled.length}`);
    for (const f of r.alerted) console.log(`alerted: ${f}`);
    if (r.alertFailed) console.log("ALERT FAILED (orders are already marked alerted)");
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
