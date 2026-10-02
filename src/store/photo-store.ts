import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  getBookProgress,
  getRegion,
  getSlots,
  isSquarePrintSize,
  resolveRegionChoice,
  type RegionChoice,
  type PrintOrientation,
  type PrintSize,
  type ProductType,
} from "@/lib/photo-slots";

export interface PhotoEntry {
  slotKey: string;
  /** Original file as object URL (for display) */
  previewUrl: string | null;
  /** Cropped image as data URL (print-ready) */
  croppedUrl: string | null;
  /** Custom label for "My First ___" slots */
  customLabel?: string;
  /** Optional date for personal records (not printed) */
  milestoneDate?: string;
  status: "empty" | "uploaded" | "cropped";
}

export interface ExtraPrint {
  id: string;
  size: PrintSize;
  /**
   * Always "portrait" for a new extra. Only changes the shape of the
   * rectangular sizes (4x3, 4x6) — squares ignore it.
   */
  orientation: PrintOrientation;
  /**
   * True once the customer has picked an orientation themselves. Until then
   * an uploaded photo sets the orientation to match its own shape; after it,
   * their choice wins and a later upload won't silently flip the print.
   */
  orientationLocked?: boolean;
  previewUrl: string | null;
  croppedUrl: string | null;
  quantity: number;
}

/** The parts of a saved session that belong to one book. */
export interface ShelvedSession {
  sessionToken: string | null;
  sessionId: string | null;
  email: string | null;
  babyName: string | null;
  babyBirthdate: string | null;
  uploadedSlots: string[];
}

/**
 * One product's work, set aside while the customer has a different product
 * open — so opening the pregnancy journal never discards a memory book's
 * unsaved photos, and vice versa. See openBook() in lib/open-book.ts.
 */
export interface ShelvedBook {
  bookTheme: string;
  photos: Record<string, PhotoEntry>;
  extras: ExtraPrint[];
  notes: Record<string, Record<string, string>>;
  detailsMode: boolean;
  regionLayouts: Record<string, RegionChoice>;
  session: ShelvedSession;
}

interface PhotoStore {
  /** Which book theme the customer selected */
  bookTheme: string | null;
  setBookTheme: (theme: string) => void;

  /** Other products' work, keyed by product (never the open product). */
  shelf: Partial<Record<ProductType, ShelvedBook>>;

  /** Layout + orientation the customer picked for each region (by region key). */
  regionLayouts: Record<string, RegionChoice>;
  /**
   * Pick a region's layout. If that changes the print's shape, crops made
   * for the old shape can't be reused: they're cleared (the image is kept
   * to re-crop from) and their keys returned, so the caller can let them
   * upload again once re-cropped.
   */
  setRegionChoice: (regionKey: string, choice: RegionChoice) => string[];

  /** Photo entries keyed by slot key */
  photos: Record<string, PhotoEntry>;
  initializeSlots: () => void;
  setPhoto: (slotKey: string, previewUrl: string) => void;
  setCropped: (slotKey: string, croppedUrl: string) => void;
  setCustomLabel: (slotKey: string, label: string) => void;
  setMilestoneDate: (slotKey: string, date: string) => void;
  removePhoto: (slotKey: string) => void;

  /** Extra prints for blank pages */
  extras: ExtraPrint[];
  addExtra: (size: PrintSize, orientation?: PrintOrientation) => void;
  setExtraPhoto: (
    id: string,
    previewUrl: string,
    detectedOrientation?: PrintOrientation | null
  ) => void;
  setExtraCropped: (id: string, croppedUrl: string) => void;
  setExtraOrientation: (id: string, orientation: PrintOrientation) => void;
  removeExtra: (id: string) => void;

  /** Progress */
  getProgress: () => { uploaded: number; total: number; percent: number };

  /** Currently editing slot (for crop modal) */
  editingSlot: string | null;
  setEditingSlot: (slotKey: string | null) => void;

  /** Whether "Book Details" mode is enabled */
  detailsMode: boolean;
  setDetailsMode: (on: boolean) => void;

  /** Book detail notes keyed by slotKey → promptKey → value */
  notes: Record<string, Record<string, string>>;
  setNote: (slotKey: string, promptKey: string, value: string) => void;
}

export const usePhotoStore = create<PhotoStore>()(
  persist(
    (set, get) => ({
      bookTheme: null,
      setBookTheme: (theme) => set({ bookTheme: theme }),

      shelf: {},

      regionLayouts: {},
      setRegionChoice: (regionKey, choice) => {
        const state = get();
        const region = getRegion(state.bookTheme, regionKey);
        if (!region) return [];
        const before = resolveRegionChoice(region, state.regionLayouts[regionKey]);
        const after = resolveRegionChoice(region, choice);
        const shapeChanged =
          before.layout.size !== after.layout.size ||
          (!isSquarePrintSize(after.layout.size) && before.orientation !== after.orientation);

        const cleared: string[] = [];
        const photos = { ...state.photos };
        if (shapeChanged) {
          const regionSlotKeys = new Set(
            getSlots(state.bookTheme)
              .filter((sl) => sl.region === regionKey)
              .map((sl) => sl.key)
          );
          for (const [key, p] of Object.entries(photos)) {
            if (!regionSlotKeys.has(key) || !p.croppedUrl) continue;
            photos[key] = {
              ...p,
              previewUrl: p.previewUrl ?? p.croppedUrl,
              croppedUrl: null,
              status: "uploaded",
            };
            cleared.push(key);
          }
        }
        set({
          photos,
          regionLayouts: {
            ...state.regionLayouts,
            [regionKey]: { layoutId: after.layout.id, orientation: after.orientation },
          },
        });
        return cleared;
      },

      photos: {},
      initializeSlots: () => {
        const existing = get().photos;
        const photos: Record<string, PhotoEntry> = {};
        for (const slot of getSlots(get().bookTheme)) {
          photos[slot.key] = existing[slot.key] ?? {
            slotKey: slot.key,
            previewUrl: null,
            croppedUrl: null,
            status: "empty",
          };
        }
        set({ photos });
      },

      setPhoto: (slotKey, previewUrl) =>
        set((state) => ({
          photos: {
            ...state.photos,
            [slotKey]: {
              ...state.photos[slotKey],
              previewUrl,
              status: "uploaded",
            },
          },
        })),

      setCropped: (slotKey, croppedUrl) =>
        set((state) => ({
          photos: {
            ...state.photos,
            [slotKey]: {
              ...state.photos[slotKey],
              croppedUrl,
              status: "cropped",
            },
          },
        })),

      setCustomLabel: (slotKey, label) =>
        set((state) => ({
          photos: {
            ...state.photos,
            [slotKey]: {
              ...state.photos[slotKey],
              customLabel: label,
            },
          },
        })),

      setMilestoneDate: (slotKey, date) =>
        set((state) => ({
          photos: {
            ...state.photos,
            [slotKey]: {
              ...state.photos[slotKey],
              milestoneDate: date,
            },
          },
        })),

      removePhoto: (slotKey) =>
        set((state) => ({
          photos: {
            ...state.photos,
            [slotKey]: {
              slotKey,
              previewUrl: null,
              croppedUrl: null,
              status: "empty",
            },
          },
        })),

      extras: [],
      addExtra: (size, orientation = "portrait") =>
        set((state) => ({
          extras: [
            ...state.extras,
            {
              id: `extra_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              size,
              orientation,
              previewUrl: null,
              croppedUrl: null,
              quantity: 1,
            },
          ],
        })),

      setExtraPhoto: (id, previewUrl, detectedOrientation) =>
        set((state) => ({
          extras: state.extras.map((e) => {
            if (e.id !== id) return e;
            // Match the print to the photo's own shape, unless the customer
            // already chose an orientation or the size is square (where the
            // choice would do nothing).
            const adopt =
              detectedOrientation &&
              !e.orientationLocked &&
              !isSquarePrintSize(e.size);
            return {
              ...e,
              previewUrl,
              orientation: adopt ? detectedOrientation : e.orientation,
            };
          }),
        })),

      setExtraCropped: (id, croppedUrl) =>
        set((state) => ({
          extras: state.extras.map((e) =>
            e.id === id ? { ...e, croppedUrl } : e
          ),
        })),

      setExtraOrientation: (id, orientation) =>
        set((state) => ({
          extras: state.extras.map((e) => {
            if (e.id !== id) return e;
            // Picking the already-active option is still an explicit choice —
            // lock it so a later upload can't flip the print back.
            if (e.orientation === orientation) {
              return { ...e, orientationLocked: true };
            }
            // A crop made for the old shape can't be reused — drop it so the
            // customer re-crops. Blob previewUrls don't survive a reload, so
            // fall back to the cropped image as the source to re-crop from.
            return {
              ...e,
              orientation,
              orientationLocked: true,
              previewUrl: e.previewUrl ?? e.croppedUrl,
              croppedUrl: null,
            };
          }),
        })),

      removeExtra: (id) =>
        set((state) => ({
          extras: state.extras.filter((e) => e.id !== id),
        })),

      getProgress: () => {
        const { done: uploaded, total } = getBookProgress(
          get().bookTheme,
          get().photos,
          get().regionLayouts
        );
        return {
          uploaded,
          total,
          percent: total > 0 ? Math.round((uploaded / total) * 100) : 0,
        };
      },

      editingSlot: null,
      setEditingSlot: (slotKey) => set({ editingSlot: slotKey }),

      detailsMode: false,
      setDetailsMode: (on) => set({ detailsMode: on }),

      notes: {},
      setNote: (slotKey, promptKey, value) =>
        set((state) => ({
          notes: {
            ...state.notes,
            [slotKey]: {
              ...state.notes[slotKey],
              [promptKey]: value,
            },
          },
        })),
    }),
    {
      name: "lucy-prints-photos",
      merge: (persisted, current) => {
        const merged = {
          ...current,
          ...(persisted as Partial<PhotoStore>),
        } as PhotoStore;

        // Extras saved before orientation existed come back without it —
        // treat those as portrait, the default for every new extra.
        merged.extras = (merged.extras ?? []).map((e) => ({
          ...e,
          orientation: e.orientation === "landscape" ? "landscape" : "portrait",
          orientationLocked: e.orientationLocked === true,
        }));
        // Browsers that saved before books were kept apart have no shelf.
        merged.shelf = merged.shelf ?? {};
        merged.regionLayouts = merged.regionLayouts ?? {};

        return merged;
      },
      partialize: (state) => {
        // Strip blob: previewUrls (invalid after page reload) to reduce storage size.
        // CroppedUrls (base64) are kept for local display until uploaded to Supabase.
        const cleanPhotos: Record<string, PhotoEntry> = {};
        for (const [key, entry] of Object.entries(state.photos)) {
          cleanPhotos[key] = {
            ...entry,
            previewUrl: null, // blob URLs can't survive reload
          };
        }

        const cleanExtras = state.extras.map((e) => ({
          ...e,
          previewUrl: null,
        }));

        const cleanShelf: Partial<Record<ProductType, ShelvedBook>> = {};
        for (const [product, book] of Object.entries(state.shelf)) {
          if (!book) continue;
          cleanShelf[product as ProductType] = {
            ...book,
            photos: Object.fromEntries(
              Object.entries(book.photos).map(([k, p]) => [k, { ...p, previewUrl: null }])
            ),
            extras: book.extras.map((e) => ({ ...e, previewUrl: null })),
          };
        }

        return {
          bookTheme: state.bookTheme,
          photos: cleanPhotos,
          extras: cleanExtras,
          detailsMode: state.detailsMode,
          notes: state.notes,
          shelf: cleanShelf,
          regionLayouts: state.regionLayouts,
        };
      },
      storage: {
        getItem: (name) => {
          try {
            const str = localStorage.getItem(name);
            return str ? JSON.parse(str) : null;
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            localStorage.setItem(name, JSON.stringify(value));
          } catch (e) {
            // Quota exceeded — silently fail rather than crashing.
            // Photos are safe if session was saved (they're in Supabase).
            console.warn("localStorage quota exceeded:", e);
          }
        },
        removeItem: (name) => {
          try {
            localStorage.removeItem(name);
          } catch {
            // ignore
          }
        },
      },
    }
  )
);
