import type { BuiltOrder } from "./build-order";
import { LIVE_DELIVERY_ALLOWED, type Destination } from "./config";
import type { OrderDestination } from "./destination";
import { DropboxApiError, DropboxClient, dropboxCredentialsFromEnv, joinPath, type Env } from "./dropbox";

/**
 * Layout under DROPBOX_ROOT_PATH:
 *   staging/<folder>-run-<id>/   built here first (never shared, never watched)
 *   demo/<folder>/               the demo dealer's hotfolder (pfRouter: one subfolder = one order)
 *   demo/_error/<folder>/        where pfRouter moves a rejected order, with reason.txt
 *   live/…                       the real dealer — nothing writes here until LIVE_DELIVERY_ALLOWED
 */
export const STAGING = "staging";
export const ERROR_FOLDER = "_error";

/** A Dropbox client for this destination: writes only to staging/ and this destination's hotfolder. */
export function dropboxClientFor(dest: Destination, env: Env = process.env, fetchFn?: typeof fetch) {
  assertDestinationWritable(dest);
  return new DropboxClient({
    root: env.DROPBOX_ROOT_PATH ?? "",
    writable: [STAGING, dest.hotfolder],
    credentials: dropboxCredentialsFromEnv(env),
    fetch: fetchFn,
  });
}

/** A read-only client (the _error check). */
export function readOnlyDropboxClient(env: Env = process.env, fetchFn?: typeof fetch) {
  return new DropboxClient({ root: env.DROPBOX_ROOT_PATH ?? "", writable: [], credentials: dropboxCredentialsFromEnv(env), fetch: fetchFn });
}

export function assertDestinationWritable(dest: Destination, liveAllowed = LIVE_DELIVERY_ALLOWED) {
  if (dest.kind === "live" && !liveAllowed) {
    throw new Error("delivery to the live dealer is disabled (LIVE_DELIVERY_ALLOWED is false) — nothing written");
  }
}

export const hotfolderPath = (c: DropboxClient, dest: Destination) => joinPath(c.root, dest.hotfolder);
export const orderPath = (c: DropboxClient, dest: Destination, folder: string) => joinPath(c.root, dest.hotfolder, folder);
export const errorPath = (c: DropboxClient, dest: Destination, folder?: string) =>
  folder ? joinPath(c.root, dest.hotfolder, ERROR_FOLDER, folder) : joinPath(c.root, dest.hotfolder, ERROR_FOLDER);
const runPrefix = (folder: string) => `${folder}-run-`;

/**
 * Upload an order into staging (every image, then the XML, each appearing only
 * once complete), check what landed, then move the whole folder into the
 * hotfolder in one server-side move. The move never overwrites: if the order
 * folder already exists there, it fails. If anything fails before the move,
 * the hotfolder is untouched and this run's staging folder is removed.
 */
export class DropboxDestination implements OrderDestination {
  constructor(
    private readonly client: DropboxClient,
    private readonly dest: Destination,
    private readonly opts: { runId: string; folderName?: string }
  ) {
    assertDestinationWritable(dest);
  }

  /** Remove leftovers of earlier failed runs of this order from staging (our own copies only). */
  async cleanStaging(folder: string): Promise<string[]> {
    const staging = joinPath(this.client.root, STAGING);
    const prefix = runPrefix(folder).toLowerCase();
    const stale = (await this.client.listFolder(staging)).filter((e) => e.name.toLowerCase().startsWith(prefix));
    for (const e of stale) await this.client.delete(joinPath(staging, e.name));
    return stale.map((e) => e.name);
  }

  async writeOrder(order: BuiltOrder): Promise<{ location: string }> {
    const folder = this.opts.folderName ?? order.folderName;
    const target = orderPath(this.client, this.dest, folder);
    const stagingDir = joinPath(this.client.root, STAGING, `${runPrefix(folder)}${this.opts.runId}`);

    await this.client.ensureFolder(joinPath(this.client.root, STAGING));
    await this.client.ensureFolder(hotfolderPath(this.client, this.dest));
    await this.cleanStaging(folder);
    if (await this.client.getMetadata(target)) {
      throw new Error(`${target} already exists in the hotfolder — refusing to send it again`);
    }
    if (await this.client.getMetadata(errorPath(this.client, this.dest, folder))) {
      throw new Error(`${folder} is already in ${ERROR_FOLDER} — refusing to send it again`);
    }

    try {
      await this.client.ensureFolder(stagingDir);
      for (const img of order.images) await this.client.upload(joinPath(stagingDir, img.name), img.data);
      await this.client.upload(joinPath(stagingDir, order.xml.name), order.xml.data);

      // Check every file landed whole before anything reaches the hotfolder.
      const expected = new Map([...order.images, order.xml].map((f) => [f.name.toLowerCase(), f.data.length]));
      const landed = (await this.client.listFolder(stagingDir)).filter((e) => e[".tag"] === "file");
      const problems = [...expected].filter(([name, size]) => landed.find((e) => e.name.toLowerCase() === name)?.size !== size);
      if (problems.length > 0 || landed.length !== expected.size) {
        throw new Error(`staging check failed: ${problems.map(([n]) => n).join(", ") || `${landed.length} files, expected ${expected.size}`}`);
      }
    } catch (err) {
      await this.client.delete(stagingDir).catch(() => undefined);
      throw err;
    }

    try {
      await this.client.move(stagingDir, target);
    } catch (err) {
      await this.client.delete(stagingDir).catch(() => undefined);
      if (err instanceof DropboxApiError && err.conflict) {
        throw new Error(`${target} appeared in the hotfolder during delivery — refusing to overwrite it`);
      }
      throw err;
    }
    return { location: target };
  }
}
