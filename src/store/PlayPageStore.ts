import { create } from "zustand";

import { SearchResult } from "@/lib/types";

interface IPlayPageStoreState {
  // 视频信息
  videoTitle: string;
  videoYear: string;
  videoCover: string;
  currentSource: string;
  currentId: string;
  currentEpisodeIndex: number;
  totalEpisodes: number;
  detail: SearchResult | null;
  videoUrl: string;

  setVideoInfo: (info: Partial<IPlayPageStoreState>) => void;
}

const usePlayPageStore = create<IPlayPageStoreState>((set) => ({
  videoTitle: '',
  videoYear: '',
  videoCover: '',
  currentSource: '',
  currentId: '',
  currentEpisodeIndex: 0,
  totalEpisodes: 0,
  detail: null,
  videoUrl: '',

  setVideoInfo: (info) => (set(info)),
}));

export default usePlayPageStore;