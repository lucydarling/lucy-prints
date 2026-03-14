"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SaveStore {
  /** Session token from Supabase */
  sessionToken: string | null;
  sessionId: string | null;
  email: string | null;
  babyName: string | null;
  babyBirthdate: string | null;

  /** Pre-session baby info (collected before a session is created) */
  pendingBabyName: string;
  pendingBabyBirthdate: string;
  birthdateOptOut: boolean;
  setPendingBabyInfo: (name: string, birthdate: string, optOut: boolean) => void;

  /** UI state — baby info modal */
  showBabyInfoModal: boolean;
  setShowBabyInfoModal: (show: boolean) => void;

  /** Upload tracking */
  uploadQueue: string[];
  uploadingSlot: string | null;
  uploadedSlots: string[];
  uploadErrors: Record<string, string>;

  /** UI state */
  showSaveModal: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";

  /** Actions */
  setSession: (token: string, sessionId: string, email: string, babyName?: string, babyBirthdate?: string) => void;
  clearSession: () => void;
  setShowSaveModal: (show: boolean) => void;
  setSaveStatus: (status: "idle" | "saving" | "saved" | "error") => void;
  addToUploadQueue: (slotKeys: string[]) => void;
  setUploadingSlot: (slotKey: string | null) => void;
  markUploaded: (slotKey: string) => void;
  markUploadError: (slotKey: string, error: string) => void;
  removeFromQueue: (slotKey: string) => void;
  isSlotUploaded: (slotKey: string) => boolean;
}

export const useSaveStore = create<SaveStore>()(
  persist(
    (set, get) => ({
      sessionToken: null,
      sessionId: null,
      email: null,
      babyName: null,
      babyBirthdate: null,

      pendingBabyName: "",
      pendingBabyBirthdate: "",
      birthdateOptOut: false,
      setPendingBabyInfo: (name, birthdate, optOut) =>
        set({ pendingBabyName: name, pendingBabyBirthdate: birthdate, birthdateOptOut: optOut }),

      showBabyInfoModal: false,
      setShowBabyInfoModal: (show) => set({ showBabyInfoModal: show }),

      uploadQueue: [],
      uploadingSlot: null,
      uploadedSlots: [],
      uploadErrors: {},

      showSaveModal: false,
      saveStatus: "idle",

      setSession: (token, sessionId, email, babyName, babyBirthdate) =>
        set({ sessionToken: token, sessionId, email, babyName: babyName || null, babyBirthdate: babyBirthdate || null }),

      clearSession: () =>
        set({
          sessionToken: null,
          sessionId: null,
          email: null,
          babyName: null,
          babyBirthdate: null,
          uploadQueue: [],
          uploadingSlot: null,
          uploadedSlots: [],
          uploadErrors: {},
          saveStatus: "idle",
        }),

      setShowSaveModal: (show) => set({ showSaveModal: show }),
      setSaveStatus: (status) => set({ saveStatus: status }),

      addToUploadQueue: (slotKeys) =>
        set((state) => {
          const existing = new Set([...state.uploadQueue, ...state.uploadedSlots]);
          const newKeys = slotKeys.filter((k) => !existing.has(k));
          return { uploadQueue: [...state.uploadQueue, ...newKeys] };
        }),

      setUploadingSlot: (slotKey) => set({ uploadingSlot: slotKey }),

      markUploaded: (slotKey) =>
        set((state) => ({
          uploadingSlot: null,
          uploadQueue: state.uploadQueue.filter((k) => k !== slotKey),
          uploadedSlots: [...state.uploadedSlots, slotKey],
          uploadErrors: (() => {
            const e = { ...state.uploadErrors };
            delete e[slotKey];
            return e;
          })(),
        })),

      markUploadError: (slotKey, error) =>
        set((state) => ({
          uploadingSlot: null,
          uploadQueue: state.uploadQueue.filter((k) => k !== slotKey),
          uploadErrors: { ...state.uploadErrors, [slotKey]: error },
        })),

      removeFromQueue: (slotKey) =>
        set((state) => ({
          uploadQueue: state.uploadQueue.filter((k) => k !== slotKey),
        })),

      isSlotUploaded: (slotKey) => get().uploadedSlots.includes(slotKey),
    }),
    {
      name: "lucy-prints-save",
      partialize: (state) => ({
        sessionToken: state.sessionToken,
        sessionId: state.sessionId,
        email: state.email,
        babyName: state.babyName,
        babyBirthdate: state.babyBirthdate,
        uploadedSlots: state.uploadedSlots,
        pendingBabyName: state.pendingBabyName,
        pendingBabyBirthdate: state.pendingBabyBirthdate,
        birthdateOptOut: state.birthdateOptOut,
      }),
    }
  )
);
