import type { PersistStorage, StorageValue } from "zustand/middleware";
import {
  allCropKeys,
  blobToDataUrl,
  cropDbAvailable,
  dataUrlToBlob,
  deleteCrops,
  getCrops,
  putCrops,
} from "@/lib/crop-db";
import { CROP_REF, isCropRef, listCrops, mapCrops, type PersistedPhotos } from "@/lib/crop-persist";
import { noteWrite, useStorageStatus } from "@/store/storage-status";

/**
 * zustand persist storage for the photo store: the crops go to IndexedDB, the
 * rest (and a `idb:<key>` reference per crop) to localStorage.
 *
 * Rules:
 * - A crop leaves localStorage only after its IndexedDB write is confirmed:
 *   each save writes the crops first, then the localStorage copy that points
 *   at them. Existing browsers (all crops inline) migrate on their next save.
 * - Without IndexedDB, or if a crop can't be written there, the crop stays
 *   inline in localStorage, as before (and the out-of-room banner covers it).
 * - Loading: the localStorage part is read synchronously (the open book, its
 *   layout and notes are there at once); the crops load right after, while
 *   `cropsLoading` is true. Nothing is saved until they're in.
 * - Unused crops are deleted from IndexedDB only when a page loads, never
 *   mid-session, so one tab can't delete a crop another open tab points to.
 */

/** Crop key → the data URL known to be stored under it in IndexedDB. */
const stored = new Map<string, string>();
/** Crops being written right now (the tidy-up must never delete these). */
const writing = new Set<string>();
/** Crops whose read failed (not "missing"): keep pointing at them on disk. */
const unreadable = new Set<string>();
/** References found at load, still to be read. */
let refsToLoad: string[] = [];
let loading = false;
let idb: boolean | null = null;
let persistAsked = false;
/** Blobs refused (WebKit private browsing): store data URL strings instead. */
let storeStrings = false;

export interface LoadedCrops {
  urls: Map<string, string>;
  /** Crops that couldn't be loaded (cleared by the browser, or unreadable): show as empty. */
  lost: Set<string>;
}

export function photoStorage<S>(): PersistStorage<S> {
  let pending: { name: string; value: StorageValue<S> } | null = null;
  let running = false;

  async function flush() {
    running = true;
    try {
      while (pending) {
        const { name, value } = pending;
        pending = null;
        await writeOnce(name, value);
      }
    } finally {
      running = false;
    }
  }

  return {
    getItem: (name) => {
      let value: StorageValue<S> | null;
      try {
        const str = localStorage.getItem(name);
        value = str ? (JSON.parse(str) as StorageValue<S>) : null;
      } catch {
        return null;
      }
      if (!value?.state) return value;
      const state = value.state as unknown as PersistedPhotos;
      refsToLoad = [...listCrops(state)].filter(([, u]) => isCropRef(u)).map(([k]) => k);
      if (refsToLoad.length > 0) {
        loading = true;
        useStorageStatus.setState({ cropsLoading: true });
      }
      // Until they load, a referenced crop is "no crop yet".
      return { ...value, state: mapCrops(state, (_k, u) => (isCropRef(u) ? null : u)) as unknown as S };
    },
    setItem: (name, value) => {
      // While crops are loading the state is incomplete; the load itself
      // saves the complete state when it finishes.
      if (loading) return;
      pending = { name, value };
      if (!running) void flush();
    },
    removeItem: (name) => {
      try {
        localStorage.removeItem(name);
      } catch {
        // ignore
      }
    },
  };
}

async function writeOnce<S>(name: string, value: StorageValue<S>) {
  // No browser storage at all (server, tests): nothing to save to.
  if (typeof localStorage === "undefined") return;
  const state = value.state as unknown as PersistedPhotos;
  if (idb === null) idb = await cropDbAvailable();

  if (idb) {
    const toPut = [...listCrops(state)].filter(
      (e): e is [string, string] => typeof e[1] === "string" && e[1].startsWith("data:") && stored.get(e[0]) !== e[1]
    );
    if (toPut.length > 0) {
      for (const [k] of toPut) writing.add(k);
      try {
        if (!storeStrings) {
          try {
            await putCrops(await Promise.all(toPut.map(async ([k, u]) => [k, await dataUrlToBlob(u)] as [string, Blob])));
          } catch {
            storeStrings = true;
          }
        }
        if (storeStrings) await putCrops(toPut);
        for (const [k, u] of toPut) stored.set(k, u);
        if (!persistAsked) {
          persistAsked = true;
          void navigator.storage?.persist?.().catch(() => {});
        }
      } catch (e) {
        // They stay inline in localStorage this time.
        console.warn("IndexedDB crop write failed:", e);
      } finally {
        for (const [k] of toPut) writing.delete(k);
      }
    }
  }

  const meta = mapCrops(state, (k, u) => {
    if (u && stored.get(k) === u) return CROP_REF + k;
    if (!u && unreadable.has(k)) return CROP_REF + k;
    return u;
  });
  try {
    localStorage.setItem(name, JSON.stringify({ ...value, state: meta }));
    noteWrite(name, true);
  } catch (e) {
    console.warn("localStorage write failed:", e);
    noteWrite(name, false);
  }
}

/**
 * Read the referenced crops from IndexedDB and hand them to `apply`, then
 * tidy crops nothing points at. Call once, after the store has rehydrated.
 */
export async function loadStoredCrops(apply: (loaded: LoadedCrops) => void): Promise<void> {
  // Called during the store's creation: never touch the store before it exists.
  await Promise.resolve();
  const keys = refsToLoad;
  refsToLoad = [];
  if (keys.length === 0) {
    // Nothing to load (a first visit, or crops still inline before migrating).
    if (typeof localStorage !== "undefined") setTimeout(() => void collectGarbage(), 5000);
    return;
  }
  const urls = new Map<string, string>();
  const lost = new Set<string>();
  try {
    const blobs = await getCrops(keys);
    for (const k of keys) {
      const blob = blobs.get(k);
      if (!blob) {
        lost.add(k);
        continue;
      }
      const url = typeof blob === "string" ? blob : await blobToDataUrl(blob);
      urls.set(k, url);
      stored.set(k, url);
    }
  } catch (e) {
    console.error("IndexedDB crop read failed:", e);
    // Kept on disk (a later load may read them), shown as empty for now.
    for (const k of keys) if (!urls.has(k)) {
      unreadable.add(k);
      lost.add(k);
    }
  }
  loading = false;
  useStorageStatus.setState({ cropsLoading: false });
  // Saves the complete state (the store's setState triggers a write).
  apply({ urls, lost });
  // After the first saves have settled; it only tidies.
  setTimeout(() => void collectGarbage(), 5000);
}

/** Delete crops that no saved reference points at (page load only). */
async function collectGarbage() {
  try {
    if (!(await cropDbAvailable())) return;
    const keys = await allCropKeys();
    // Read the newest saved copy right before deleting: another tab may have
    // saved since this page loaded.
    const raw = localStorage.getItem("lucy-prints-photos");
    const state = raw ? (JSON.parse(raw).state as PersistedPhotos) : null;
    const referenced = new Set(state ? [...listCrops(state)].filter(([, u]) => isCropRef(u)).map(([k]) => k) : []);
    const unused = keys.filter((k) => !referenced.has(k) && !stored.has(k) && !writing.has(k) && !unreadable.has(k));
    await deleteCrops(unused);
  } catch {
    // Tidying only; never worth an error.
  }
}
