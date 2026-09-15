import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  PHOTO_SLOTS,
  isSquarePrintSize,
  type PrintOrientation,
  type PrintSize,
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

interface PhotoStore {
  /** Which book theme the customer selected */
  bookTheme: string | null;
  setBookTheme: (theme: string) => void;

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

      photos: {},
      initializeSlots: () => {
        const existing = get().photos;
        const photos: Record<string, PhotoEntry> = {};
        for (const slot of PHOTO_SLOTS) {
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
        const photos = get().photos;
        const total = PHOTO_SLOTS.length;
        const uploaded = Object.values(photos).filter(
          (p) => p.status === "cropped" || p.status === "uploaded"
        ).length;
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

        return {
          bookTheme: state.bookTheme,
          photos: cleanPhotos,
          extras: cleanExtras,
          detailsMode: state.detailsMode,
          notes: state.notes,
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
