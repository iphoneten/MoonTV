import { create } from "zustand";
// import { createJSONStorage, persist } from "zustand/middleware";

export interface IUIStoreState {
  activeTab: 'home' | 'favorites';
  pageScroll: {
    [key: string]: number;
  }
  doubanType: 'movie' | 'tv' | 'show';
  setActiveTab: (tab: 'home' | 'favorites') => void;
  setPageScroll: (key: string, value: number) => void;
  setDoubanType: (type: 'movie' | 'tv' | 'show') => void;
}

const useUIStore = create<IUIStoreState>()(
  // persist(
  (set) => ({
    activeTab: 'home',
    pageScroll: {},
    doubanType: 'movie',
    setDoubanType: (type) => set({ doubanType: type }),
    setActiveTab: (tab) => set({ activeTab: tab }),
    setPageScroll: (key: string, value: number) => set((state) => ({
      pageScroll: {
        ...state.pageScroll,
        [key]: value,
      }
    })),
  }),
  // {
  //   name: "ui-storage", // 存储的名称
  //   // 使用 localStorage 进行存储
  //   storage: createJSONStorage(() => localStorage),
  // }
  // )
);

export default useUIStore;