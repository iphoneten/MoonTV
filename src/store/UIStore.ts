import { create } from "zustand";
// import { createJSONStorage, persist } from "zustand/middleware";

export interface IUIStoreState {
  activeTab: 'home' | 'favorites';
  doubanType: 'movie' | 'tv' | 'show';
  topNavLast: string;
  setActiveTab: (tab: 'home' | 'favorites') => void;
  setDoubanType: (type: 'movie' | 'tv' | 'show') => void;
  setTopNavLast: (value: string) => void;
}

const useUIStore = create<IUIStoreState>()(
  // persist(
  (set) => ({
    activeTab: 'home',
    doubanType: 'movie',
    topNavLast: '/',
    setDoubanType: (type) => set({ doubanType: type }),
    setActiveTab: (tab) => set({ activeTab: tab }),
    setTopNavLast: (value) => set({ topNavLast: value }),
  }),
  // {
  //   name: "ui-storage", // 存储的名称
  //   // 使用 localStorage 进行存储
  //   storage: createJSONStorage(() => localStorage),
  // }
  // )
);

export default useUIStore;
