import { create } from "zustand";

export const useSettingsStore = create((set) => ({
  yardAddress: "4805 8th Line, Beeton, ON L0G 1A0",
  delivery20Rate: 3.5,
  delivery20Min: 195,
  delivery40Rate: 4.5,
  delivery40Min: 295,
  rounding: "50",
  hideBreakdown: true,
  includeInContainer: true,

  updateSettings: (data) => set(data),
}));
