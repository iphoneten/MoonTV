import { create } from "zustand";

export interface IUIStoreState {
  isShowLoading: boolean;
  loadingCount: number;
  setShowLoading: (show: boolean) => void;
  hideLoading: () => void;
}

const useUIStore = create<IUIStoreState>()(
  (set) => ({
    isShowLoading: false,
    loadingCount: 0,
    setShowLoading: (show: boolean) => set(state => ({ isShowLoading: show, loadingCount: state.loadingCount + 1 })),
    hideLoading: () => set(state => {
      const newCount = Math.max(state.loadingCount - 1, 0);
      return { loadingCount: newCount, isShowLoading: newCount > 0 };
    }),
  }));

export default useUIStore;