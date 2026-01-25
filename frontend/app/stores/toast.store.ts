import { create } from "zustand";
import type { Toast } from "~/types/errors";

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

const MAX_TOASTS = 5;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (toast) =>
    set((state) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      const newToast = { ...toast, id };

      // 限制最多 5 个 Toast
      const toasts = [...state.toasts, newToast];
      if (toasts.length > MAX_TOASTS) {
        toasts.shift(); // 移除最旧的
      }

      return { toasts };
    }),

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  clearToasts: () => set({ toasts: [] }),
}));
