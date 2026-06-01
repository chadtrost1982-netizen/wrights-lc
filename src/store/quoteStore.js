import { create } from "zustand";

export const useQuoteStore = create((set) => ({
  currentQuote: {
    container: null,
    mods: [],
  },

  addToQuote: (item) =>
    set((state) => {
      // If it's a container, replace the existing one
      if (item.type === "container") {
        return {
          currentQuote: {
            ...state.currentQuote,
            container: item,
          },
        };
      }

      // If it's a mod, append it
      return {
        currentQuote: {
          ...state.currentQuote,
          mods: [...state.currentQuote.mods, item],
        },
      };
    }),

  removeMod: (index) =>
    set((state) => ({
      currentQuote: {
        ...state.currentQuote,
        mods: state.currentQuote.mods.filter((_, i) => i !== index),
      },
    })),

  clearQuote: () =>
    set({
      currentQuote: {
        container: null,
        mods: [],
      },
    }),
}));
