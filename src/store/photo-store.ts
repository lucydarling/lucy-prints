import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PHOTO_SLOTS, type PrintSize } from "@/lib/photo-slots";

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
  addExtra: (size: PrintSize) => void;
  setExtraPhoto: (id: string, previewUrl: string) => void;
  setExtraCropped: (id: string, croppedUrl: string) => void;
  removeExtra: (id: string) => void;

  /** Progress */
  getProgress: () => { uploaded: number; total: number; percent: number };

  /** Currently editing slot (for crop modal) */
  editingSlot: string | null;
  setEditingSlot: (slotKey: string | null) => void;
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
      addExtra: (size) =>
        set((state) => ({
          extras: [
            ...state.extras,
            {
              id: `extra_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              size,
              previewUrl: null,
              croppedUrl: null,
              quantity: 1,
            },
          ],
        })),

      setExtraPhoto: (id, previewUrl) =>
        set((state) => ({
          extras: state.extras.map((e) =>
            e.id === id ? { ...e, previewUrl } : e
          ),
        })),

      setExtraCropped: (id, croppedUrl) =>
        set((state) => ({
          extras: state.extras.map((e) =>
            e.id === id ? { ...e, croppedUrl } : e
          ),
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
    }),
    {
      name: "lucy-prints-photos",
      partialize: (state) => ({
        bookTheme: state.bookTheme,
        photos: state.photos,
        extras: state.extras,
      }),
    }
  )
);
