import { create } from "zustand";
import { appDB } from "../db/appDB";

export const useAppStore = create((set) => ({
  presets: [],

  // Load all presets from Dexie
  loadAll: async () => {
    const all = await appDB.presets.toArray();
    set({ presets: all });
  },

  // Optional: update store after saving
  setPresets: (presets) => set({ presets }),
}));
