import { useToastStore } from "~/stores/toast.store";
import type { ToastAction } from "~/types/errors";

interface ToastOptions {
  title: string;
  message: string;
  duration?: number;
  actions?: ToastAction[];
  details?: string;
}

export const toast = {
  success: (options: ToastOptions) => {
    useToastStore.getState().addToast({
      type: "success",
      duration: options.duration ?? 3000,
      ...options,
    });
  },

  error: (options: ToastOptions) => {
    useToastStore.getState().addToast({
      type: "error",
      duration: options.duration ?? 5000,
      ...options,
    });
  },

  warning: (options: ToastOptions) => {
    useToastStore.getState().addToast({
      type: "warning",
      duration: options.duration ?? 4000,
      ...options,
    });
  },

  info: (options: ToastOptions) => {
    useToastStore.getState().addToast({
      type: "info",
      duration: options.duration ?? 3000,
      ...options,
    });
  },
};
