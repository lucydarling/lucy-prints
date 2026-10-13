import { create } from "zustand";
import type { PersistStorage, StorageValue } from "zustand/middleware";

/**
 * Whether this browser is keeping the customer's work. The persisted stores
 * write to localStorage, which fills after about 10 real photos; when a write
 * fails, the work exists only on this page until it's saved to the cloud.
 * Not persisted itself (it couldn't be, when storage is full).
 */
interface StorageStatus {
  /** localStorage keys whose last write failed. */
  failedKeys: string[];
  /**
   * The saved session was reloaded from the cloud since this page loaded, so
   * everything is on screen even though the browser can't keep it.
   */
  reloadedFromCloud: boolean;
}

export const useStorageStatus = create<StorageStatus>(() => ({
  failedKeys: [],
  reloadedFromCloud: false,
}));

export const isStorageFull = (s: StorageStatus) => s.failedKeys.length > 0;

/**
 * How many of a saved book's cloud photos this browser has no crop for. The
 * upload list (`uploadedSlots`) is small, so it survives a full browser; when
 * the page is reloaded, only the photos that fit come back, and the rest show
 * up here. Removing a photo or clearing a crop takes it off the list too.
 */
export function countMissingFromBrowser(
  uploadedSlots: string[],
  photos: Record<string, { croppedUrl: string | null } | undefined>,
  extras: { id: string; croppedUrl: string | null }[]
): number {
  const extraCrop = new Map(extras.map((e) => [e.id, e.croppedUrl]));
  return uploadedSlots.filter((k) => !(photos[k]?.croppedUrl || extraCrop.get(k))).length;
}

function noteWrite(name: string, ok: boolean) {
  const { failedKeys } = useStorageStatus.getState();
  const failed = failedKeys.includes(name);
  if (ok && failed) useStorageStatus.setState({ failedKeys: failedKeys.filter((k) => k !== name) });
  if (!ok && !failed) useStorageStatus.setState({ failedKeys: [...failedKeys, name] });
}

/**
 * localStorage for zustand's persist that never throws: a failed read is
 * "nothing saved", and a failed write (quota exceeded) is recorded here so
 * the page can tell the customer, instead of failing silently or throwing
 * into whatever action changed the store.
 */
export function safeLocalStorage<S>(): PersistStorage<S> {
  return {
    getItem: (name) => {
      try {
        const str = localStorage.getItem(name);
        return str ? (JSON.parse(str) as StorageValue<S>) : null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        localStorage.setItem(name, JSON.stringify(value));
        noteWrite(name, true);
      } catch (e) {
        console.warn("localStorage write failed:", e);
        noteWrite(name, false);
      }
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
