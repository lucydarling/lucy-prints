/**
 * One-time Dropbox setup: get a refresh token (offline access) and save it to
 * .env.local without ever printing it, then check the connection and create
 * the folders under DROPBOX_ROOT_PATH (staging/ and demo/).
 *
 *   npm run dropbox:connect
 *
 * Needs DROPBOX_APP_KEY, DROPBOX_APP_SECRET and DROPBOX_ROOT_PATH in .env.local.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { resolveDestination } from "@/lib/print-orders/config";
import { DropboxClient, joinPath, normalizeRoot, TOKEN_URL } from "@/lib/print-orders/dropbox";
import { STAGING } from "@/lib/print-orders/dropbox-destination";

const ENV_FILE = path.resolve(".env.local");

/** Replace or add KEY=value in the env file text. */
function setEnvLine(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) return text.replace(re, line);
  return `${text.replace(/\n*$/, "\n")}${line}\n`;
}

async function main() {
  const appKey = process.env.DROPBOX_APP_KEY ?? "";
  const appSecret = process.env.DROPBOX_APP_SECRET ?? "";
  if (!appKey || !appSecret) throw new Error("Add DROPBOX_APP_KEY and DROPBOX_APP_SECRET to .env.local first.");
  const root = normalizeRoot(process.env.DROPBOX_ROOT_PATH);
  const dest = resolveDestination();

  const url = new URL("https://www.dropbox.com/oauth2/authorize");
  url.search = new URLSearchParams({ client_id: appKey, response_type: "code", token_access_type: "offline" }).toString();
  console.log("1. Sign in to the DEDICATED Lucy Darling print Dropbox account in your browser.");
  console.log("2. Open this link, click Allow, and copy the code it shows:\n");
  console.log(`   ${url.toString()}\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question("3. Paste the code here and press Return: ")).trim();
  rl.close();
  if (!code) throw new Error("No code entered.");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${appKey}:${appSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ code, grant_type: "authorization_code" }).toString(),
  });
  if (!res.ok) throw new Error(`Dropbox refused the code (${res.status}). Codes expire after a few minutes — run this again.`);
  const j = (await res.json()) as { refresh_token?: string; scope?: string };
  if (!j.refresh_token) throw new Error("Dropbox returned no refresh token (was token_access_type=offline dropped?).");
  const scopes = (j.scope ?? "").split(" ");
  const missing = ["files.metadata.read", "files.content.read", "files.content.write"].filter((s) => !scopes.includes(s));
  if (missing.length > 0) throw new Error(`The app is missing scopes: ${missing.join(", ")}. Tick them on the Permissions tab, Submit, then run this again.`);

  // Write via a temp file + rename; keep the file private.
  const before = await fs.readFile(ENV_FILE, "utf8");
  const tmp = `${ENV_FILE}.tmp-${process.pid}`;
  await fs.writeFile(tmp, setEnvLine(before, "DROPBOX_REFRESH_TOKEN", j.refresh_token), { mode: 0o600 });
  await fs.rename(tmp, ENV_FILE);
  console.log("\nSaved DROPBOX_REFRESH_TOKEN to .env.local (not shown).");

  const client = new DropboxClient({
    root,
    writable: [STAGING, dest.hotfolder],
    credentials: { appKey, appSecret, refreshToken: j.refresh_token },
  });
  // Dropbox creates missing parents, so this also creates the root folder.
  await client.ensureFolder(joinPath(root, STAGING));
  await client.ensureFolder(joinPath(root, dest.hotfolder));
  const listed = await client.listFolder(root);
  console.log(`Connected. ${root} contains: ${listed.map((e) => e.name).join(", ") || "(empty)"}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
