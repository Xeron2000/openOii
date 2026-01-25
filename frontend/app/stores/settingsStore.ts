import { create } from "zustand";

interface SettingsState {
  isModalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isModalOpen: false,
  openModal: () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false }),
}));
