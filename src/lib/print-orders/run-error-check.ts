import { resolveDestination } from "./config";
import { alertPrinterError, findSentByExternalIds, markError } from "./delivery-deps";
import { readOnlyDropboxClient } from "./dropbox-destination";
import { checkErrorFolder } from "./error-monitor";

/** The _error check with real dependencies (cron route and npm script share this). */
export function runErrorCheck() {
  return checkErrorFolder({
    client: readOnlyDropboxClient(),
    dest: resolveDestination(),
    findSent: findSentByExternalIds,
    markError,
    alert: alertPrinterError,
  });
}
