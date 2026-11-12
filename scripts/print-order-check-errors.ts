/**
 * Run the print hotfolder _error check once (the same check as the cron route).
 *
 *   npm run print-order:check-errors
 */
import { runErrorCheck } from "@/lib/print-orders/run-error-check";

runErrorCheck()
  .then((r) => {
    console.log(`_error folders seen: ${r.seen.length}`);
    for (const f of r.marked) console.log(`marked error + alerted: ${f}`);
    for (const f of r.ignored) console.log(`ignored (no sent order): ${f}`);
    for (const f of r.unknownAlerted) console.log(`unknown order (no print_orders row), alerted: ${f}`);
    for (const f of r.alertFailures) console.log(`ALERT FAILED (not retried): ${f}`);
    if (r.unknownError) {
      console.error(`unknown-folder check FAILED: ${r.unknownError}`);
      process.exitCode = 1;
    }
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
