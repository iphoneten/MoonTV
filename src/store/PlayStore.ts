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
  cachedEpisodes: CachedEpisode[];
  addCachedEpisode: (episode: CachedEpisode) => void;
  removeCachedEpisode: (key: string) => void;
  clearCachedEpisodes: () => void;
}

export interface CachedEpisode {
  key: string;
  title: string;
  year?: string;
  cover?: string;
  source?: string;
  sourceName?: string;
  id?: string;
  episodeIndex: number;
  totalEpisodes?: number;
  url: string;
  cachedAt: number;
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
      cachedEpisodes: [],
      addCachedEpisode: (episode: CachedEpisode) => set((state) => {
        const filtered = state.cachedEpisodes.filter((item) => item.key !== episode.key);
        return { cachedEpisodes: [episode, ...filtered] };
      }),
      removeCachedEpisode: (key: string) => set((state) => ({
        cachedEpisodes: state.cachedEpisodes.filter((item) => item.key !== key),
      })),
      clearCachedEpisodes: () => set({ cachedEpisodes: [] }),
    }),
    {
      name: "play-storage", // 存储的名称
      storage: createJSONStorage(() => localStorage), // 使用 localStorage 进行存储
    }
  )
);

export default usePlayStore;
