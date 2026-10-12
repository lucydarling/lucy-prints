/**
 * Sends SAMPLE versions of the three customer print-order emails to ONE
 * @lucydarling.com address (default kevin@lucydarling.com) so they can be
 * read in a real inbox. Subjects are prefixed "[TEST]". Sample data only.
 *
 *   npm run print-order:email-test -- [address@lucydarling.com] [received|held|shipped]   (default: all three)
 */
import { printOrderHeldEmail, printOrderReceivedEmail, printOrderShippedEmail, sendCustomerEmail } from "../src/lib/email";

const to = (process.argv[2] ?? "kevin@lucydarling.com").trim();
if (!/@lucydarling\.com$/i.test(to)) {
  console.error("refusing: test emails go only to @lucydarling.com addresses");
  process.exit(1);
}

const kinds = ["received", "held", "shipped"];
const only = process.argv[3];
if (only && !kinds.includes(only)) {
  console.error(`unknown kind "${only}" (received|held|shipped)`);
  process.exit(1);
}

const all = [
  printOrderReceivedEmail({
    bookName: "Little Artist", babyName: "Ada", bookPrints: 14, extraPrints: 3, orderName: "#TEST-1001",
    shipTo: { fname: "Sample", lname: "Customer", address1: "123 Sample St", address2: "Apt 4", city: "Springfield", state: "IL", zip: "62701", country: "US" },
  }),
  printOrderHeldEmail({ resumeUrl: "https://memories.lucydarling.com/resume/sample-token", orderName: "#TEST-1001" }),
  printOrderShippedEmail({ bookName: "Little Artist", babyName: "Ada", carrier: "USPS", trackingNumber: "9400 0000 0000 0000 0000 00", trackingUrl: "https://tools.usps.com/", orderName: "#TEST-1001" }),
];
const sample = only ? [all[kinds.indexOf(only)]] : all;

async function main() {
  for (const m of sample) {
    const r = await sendCustomerEmail({ to, subject: `[TEST] ${m.subject}`, html: m.html });
    console.log(`${r}: [TEST] ${m.subject}`);
  }
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
