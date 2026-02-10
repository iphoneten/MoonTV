import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface SkipConfig {
  enable: boolean;
  intro_time: number;
  outro_time: number;
}

export interface IPlayStoreState {
  skipConfigMap: {
    [key: string | number]: SkipConfig;
  };
  skipConfig: SkipConfig;
  playbackSpeed: number;
  setSkipConfig: (config: SkipConfig) => void;
  setPlaybackSpeed: (speed: number) => void;
  setSkipConfigMap: (key: string, config: SkipConfig) => void;
}

const usePlayStore = create<IPlayStoreState>()(
  persist(
    (set) => ({
      skipConfig: {
        enable: false,
        intro_time: 0,
        outro_time: 0,
      },
      skipConfigMap: {},
      playbackSpeed: 1,
      setSkipConfigMap: (key: string | number, config: SkipConfig) => set((state) => ({ skipConfigMap: { ...state.skipConfigMap, [key]: config } })),
      setPlaybackSpeed: (speed: number) => set({ playbackSpeed: speed }),
      setSkipConfig: (config: SkipConfig) => set({ skipConfig: config }),

    }),
    {
      name: "play-storage", // 存储的名称
      storage: createJSONStorage(() => localStorage), // 使用 localStorage 进行存储
    }
  )
);

export default usePlayStore;