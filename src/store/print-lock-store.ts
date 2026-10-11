import { create } from "zustand";

/** "frozen" once a print order is ready/refused; "held" while one waits for photos. */
export const usePrintLockStore = create<{
  lock: "frozen" | "held" | null;
  setLock: (lock: "frozen" | "held" | null) => void;
}>((set) => ({ lock: null, setLock: (lock) => set({ lock }) }));
