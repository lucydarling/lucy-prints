/**
 * TESTING ONLY — reads LIVE session data (the customer's current photos), not
 * what was frozen at payment, and uses placeholder ship-to details. Do NOT use
 * it to prepare a real order: use `npm run print-order:build` for that.
 * Builds a Photo Finale order folder (+ ZIP) locally. Sends nothing anywhere.
 *
 *   npm run print-order:sample -- <session-token> [--expect N] [--out DIR]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildOrder } from "@/lib/print-orders/build-order";
import { LocalFolderDestination, orderToZip, writeOrderFolder } from "@/lib/print-orders/destination";
import { loadSessionForPrint } from "@/lib/print-orders/load-session";

function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const token = args[0];
  if (!token || token.startsWith("--")) {
    throw new Error("usage (TESTING ONLY, reads live session data): print-order:sample <session-token> [--expect N] [--out DIR]");
  }
  const outDir = path.resolve(flag("--out") ?? "print-orders-out");
  const expect = flag("--expect");

  return (async () => {
    const { session, photoRows, extraRows, fetchImage } = await loadSessionForPrint(token);
    const order = await buildOrder({
      bookTheme: session.book_theme,
      photoRows,
      extraRows,
      fetchImage,
      // Placeholder ship-to — this is a test order and is never delivered.
      externalId: `SAMPLE-${Date.now().toString(36)}`,
      customer: { fname: "Test", lname: "Customer" },
      shipTo: {
        fname: "Test", lname: "Customer", address1: "123 Placeholder St",
        city: "Salt Lake City", state: "UT", zip: "84116", country: "US",
      },
      expectedPrintCount: expect ? Number(expect) : undefined,
    });

    const { location } = await writeOrderFolder(order, new LocalFolderDestination(outDir));
    const zipPath = path.join(outDir, `${order.folderName}.zip`);
    await fs.writeFile(zipPath, await orderToZip(order));

    console.log(`Order folder: ${location}`);
    console.log(`ZIP:          ${zipPath}`);
    console.log(`Prints: ${order.printCount}`, order.countBySize);
    console.log(`Destination (not used yet): ${order.destination.kind} dealer ${order.destination.dealer}`);
    for (const w of order.warnings) console.log(`WARNING: ${w}`);
  })();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
