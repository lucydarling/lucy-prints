/**
 * Minimal Dropbox API client for print-order delivery. Server-side only.
 *
 * The Dropbox app has FULL-account access (so the folder can be shared with
 * the print partner later), so this client is the fence: every path it sends
 * must sit inside DROPBOX_ROOT_PATH, and writes are further limited to the
 * folders named in `writable` (relative to the root). A path outside either is
 * refused before any request is made. Dropbox paths are case-insensitive, and
 * so is the check.
 */

export class DropboxPathRefused extends Error {}

export type Env = Record<string, string | undefined>;

export class DropboxApiError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number,
    /** Dropbox's machine-readable summary, e.g. "path/not_found/..". */
    readonly summary: string
  ) {
    super(`Dropbox ${endpoint} failed (${status}): ${summary}`);
  }
  get notFound() {
    return /not_found/.test(this.summary);
  }
  get conflict() {
    return /conflict/.test(this.summary);
  }
}

/**
 * Validate the configured root: absolute, at least one folder deep, no
 * relative segments. "/" (the whole account) is refused.
 */
export function normalizeRoot(root: string | undefined): string {
  const r = (root ?? "").trim().replace(/\/+$/, "");
  if (!r) throw new DropboxPathRefused("DROPBOX_ROOT_PATH is not set");
  checkShape(r, "DROPBOX_ROOT_PATH");
  return r;
}

function checkShape(p: string, what: string) {
  if (!p.startsWith("/")) throw new DropboxPathRefused(`${what} must be absolute: ${p}`);
  if (/[\\\u0000-\u001f]/.test(p)) throw new DropboxPathRefused(`${what} has a backslash or control character: ${JSON.stringify(p)}`);
  const segs = p.slice(1).split("/");
  if (segs.some((s) => s === "" || s === "." || s === ".." || s.trim() !== s)) {
    throw new DropboxPathRefused(`${what} has an empty, "." or ".." segment: ${p}`);
  }
}

/** True when `p` is `root` or inside it (case-insensitive, whole segments only). */
export function isInside(root: string, p: string): boolean {
  const r = root.toLowerCase();
  const x = p.toLowerCase();
  return x === r || x.startsWith(`${r}/`);
}

/** Refuse anything that is not an absolute, clean path inside the root. */
export function assertInRoot(root: string, p: string): string {
  checkShape(p, "path");
  if (!isInside(root, p)) throw new DropboxPathRefused(`refusing ${p}: outside ${root}`);
  return p;
}

/** Join path pieces under the root; each piece must be one plain segment. */
export function joinPath(root: string, ...pieces: string[]): string {
  for (const s of pieces) {
    if (!s || s.includes("/") || s === "." || s === "..") throw new DropboxPathRefused(`bad path segment: ${JSON.stringify(s)}`);
  }
  return assertInRoot(root, [root, ...pieces].join("/"));
}

/** Dropbox-API-Arg must be ASCII: escape anything else as \uXXXX. */
export function apiArgHeader(arg: unknown): string {
  return JSON.stringify(arg).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export interface DropboxCredentials {
  appKey: string;
  appSecret: string;
  refreshToken: string;
}

export interface DropboxEntry {
  ".tag": "file" | "folder" | "deleted";
  name: string;
  path_display: string;
  size?: number;
}

export interface DropboxClientOptions {
  root: string;
  /** Folders (one segment each, relative to the root) this client may write into. Empty = read-only. */
  writable: string[];
  credentials: DropboxCredentials;
  fetch?: typeof fetch;
}

const API = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";
export const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

export class DropboxClient {
  readonly root: string;
  private readonly writable: string[];
  private readonly creds: DropboxCredentials;
  private readonly fetchFn: typeof fetch;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(opts: DropboxClientOptions) {
    this.root = normalizeRoot(opts.root);
    this.writable = opts.writable.map((w) => joinPath(this.root, w));
    this.creds = opts.credentials;
    this.fetchFn = opts.fetch ?? fetch;
    if (!this.creds.appKey || !this.creds.appSecret || !this.creds.refreshToken) {
      throw new Error("Dropbox credentials are incomplete (DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN)");
    }
  }

  private read(p: string) {
    return assertInRoot(this.root, p);
  }

  /** A write target must be inside one of the writable folders (the folder itself only for createFolder). */
  private write(p: string, allowFolderItself = false) {
    assertInRoot(this.root, p);
    const ok = this.writable.some((w) => (allowFolderItself && p.toLowerCase() === w.toLowerCase()) || p.toLowerCase().startsWith(`${w.toLowerCase()}/`));
    if (!ok) throw new DropboxPathRefused(`refusing to write ${p}: not inside ${this.writable.join(" or ") || "(read-only client)"}`);
    return p;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.creds.appKey}:${this.creds.appSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.creds.refreshToken }).toString(),
    });
    // Never include the response body: it could carry a token.
    if (!res.ok) throw new Error(`Dropbox token refresh failed (${res.status})`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private async call(url: string, endpoint: string, init: (token: string) => RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(url, init(await this.accessToken()));
      if (res.ok) return res;
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
        await new Promise((r) => setTimeout(r, Math.min(wait, 30) * 1000));
        continue;
      }
      let summary = `${res.status}`;
      try {
        const body = await res.text();
        summary = (JSON.parse(body) as { error_summary?: string }).error_summary ?? body.slice(0, 200);
      } catch {
        /* keep the status */
      }
      throw new DropboxApiError(endpoint, res.status, summary);
    }
  }

  private async rpc<T>(endpoint: string, arg: unknown): Promise<T> {
    const res = await this.call(`${API}/${endpoint}`, endpoint, (t) => ({
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify(arg),
    }));
    return (await res.json()) as T;
  }

  /** Metadata, or null when nothing is at that path. */
  async getMetadata(path: string): Promise<DropboxEntry | null> {
    try {
      return await this.rpc<DropboxEntry>("files/get_metadata", { path: this.read(path) });
    } catch (err) {
      if (err instanceof DropboxApiError && err.notFound) return null;
      throw err;
    }
  }

  /** Every entry directly inside a folder; [] when the folder does not exist. */
  async listFolder(path: string): Promise<DropboxEntry[]> {
    const out: DropboxEntry[] = [];
    let page: { entries: DropboxEntry[]; cursor: string; has_more: boolean };
    try {
      page = await this.rpc("files/list_folder", { path: this.read(path), recursive: false });
    } catch (err) {
      if (err instanceof DropboxApiError && err.notFound) return [];
      throw err;
    }
    out.push(...page.entries);
    while (page.has_more) {
      page = await this.rpc("files/list_folder/continue", { cursor: page.cursor });
      out.push(...page.entries);
    }
    // Defence in depth: never hand back anything outside the root.
    return out.filter((e) => isInside(this.root, e.path_display));
  }

  /** Create a folder; an existing folder is fine. */
  async ensureFolder(path: string): Promise<void> {
    try {
      await this.rpc("files/create_folder_v2", { path: this.write(path, true), autorename: false });
    } catch (err) {
      if (err instanceof DropboxApiError && err.conflict) return;
      throw err;
    }
  }

  /** Upload one file. Never overwrites: an existing file at the path is an error. The file appears only once complete. */
  async upload(path: string, data: Buffer): Promise<DropboxEntry> {
    const target = this.write(path);
    const res = await this.call(`${CONTENT}/files/upload`, "files/upload", (t) => ({
      method: "POST",
      headers: {
        Authorization: `Bearer ${t}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": apiArgHeader({ path: target, mode: "add", autorename: false, mute: true, strict_conflict: true }),
      },
      body: new Uint8Array(data),
    }));
    return (await res.json()) as DropboxEntry;
  }

  async download(path: string): Promise<Buffer> {
    const target = this.read(path);
    const res = await this.call(`${CONTENT}/files/download`, "files/download", (t) => ({
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Dropbox-API-Arg": apiArgHeader({ path: target }) },
    }));
    return Buffer.from(await res.arrayBuffer());
  }

  /** Server-side move. Fails (conflict) rather than overwrite or rename if the target exists. */
  async move(from: string, to: string): Promise<void> {
    await this.rpc("files/move_v2", {
      from_path: this.write(from),
      to_path: this.write(to),
      autorename: false,
      allow_ownership_transfer: false,
    });
  }

  /** Delete a file or folder. Only inside the writable folders. Missing is fine. */
  async delete(path: string): Promise<void> {
    try {
      await this.rpc("files/delete_v2", { path: this.write(path) });
    } catch (err) {
      if (err instanceof DropboxApiError && err.notFound) return;
      throw err;
    }
  }
}

/** Credentials from the environment (never logged). */
export function dropboxCredentialsFromEnv(env: Env = process.env): DropboxCredentials {
  return {
    appKey: env.DROPBOX_APP_KEY ?? "",
    appSecret: env.DROPBOX_APP_SECRET ?? "",
    refreshToken: env.DROPBOX_REFRESH_TOKEN ?? "",
  };
}
