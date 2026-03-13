/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import Artplayer from 'artplayer';
import { Setting } from 'artplayer/types/setting';
import Hls from 'hls.js';
import { useSearchParams } from 'next/navigation';
import { FC, Suspense, useEffect, useRef, useState } from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  getAllPlayRecords,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { processImageUrl, formatTime } from '@/lib/utils';
import { preferBestSource, PrecomputedVideoInfo } from '@/lib/videoOptimization';

import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';

import usePlayStore, { CachedEpisode } from '@/store/PlayStore';

import ErrorPage from '@/app/play/errorPage';
import FavoriteIcon from '@/app/play/favoriteIcon';
import { getHlsConfig } from '@/app/play/loadHlsConfig';
import LoadingPage from '@/app/play/loadingPage';
// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

const PlayPageClient: FC = () => {
  const searchParams = useSearchParams();
  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);
  const [favorited, setFavorited] = useState(false);
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  const {
    playbackSpeed,
    skipConfigMap,
    setPlaybackSpeed,
    setSkipConfigMap,
    addCachedEpisode,
    removeCachedEpisode,
  } = usePlayStore();
  const currentSkipConfig = skipConfigMap[currentId] || {
    enable: false,
    intro_time: 0,
    outro_time: 0,
  };

  const currentSkipConfigRef = useRef(currentSkipConfig);

  useEffect(() => {
    const newConfig =
      skipConfigMap[currentId] || {
        enable: false,
        intro_time: 0,
        outro_time: 0,
      };

    currentSkipConfigRef.current = newConfig;

    // 删除跳过配置时，立即重置节流时间，避免残留判断
    lastSkipCheckRef.current = 0;

    // 如果关闭跳过功能，不再做任何自动跳转
    if (!newConfig.enable && artPlayerRef.current) {
      artPlayerRef.current.notice.show = '';
    }
  }, [skipConfigMap, currentId]);


  // 跳过检查的时间间隔控制
  const lastSkipCheckRef = useRef(0);

  // 去广告开关（从 localStorage 继承，默认 true）
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  // 视频基本信息
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  // 当前源和ID
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || ''
  );

  // 搜索所需信息
  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');

  // 是否需要优选
  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true'
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);
  // 集数相关
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);
  const isLockedRef = useRef(false);
  const autoSwitchAttemptedRef = useRef<Set<string>>(new Set());
  const autoSwitchingRef = useRef(false);
  const lastAutoSwitchAtRef = useRef(0);

  // 视频播放地址
  const [videoUrl, setVideoUrl] = useState('');
  const VIDEO_CACHE_NAME = 'moontv-video';
  const [isEpisodeCached, setIsEpisodeCached] = useState(false);
  const [isCaching, setIsCaching] = useState(false);
  const isEpisodeCachedRef = useRef(isEpisodeCached);
  const isCachingRef = useRef(isCaching);

  // 同步最新值到 refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  useEffect(() => {
    isEpisodeCachedRef.current = isEpisodeCached;
  }, [isEpisodeCached]);

  useEffect(() => {
    isCachingRef.current = isCaching;
  }, [isCaching]);

  // 总集数
  const totalEpisodes = detail?.episodes?.length || 0;

  // 用于记录是否需要在播放器 ready 后跳转到指定进度
  const resumeTimeRef = useRef<number | null>(null);
  // 上次使用的音量，默认 0.7
  const lastVolumeRef = useRef<number>(0.7);
  // 上次使用的播放速率，默认 1.0
  const lastPlaybackRateRef = useRef<number>(playbackSpeed);

  // 当全局 playbackSpeed 改变时，同步到播放器并更新 ref
  useEffect(() => {
    lastPlaybackRateRef.current = playbackSpeed;
    if (artPlayerRef.current) {
      if (
        Math.abs(
          artPlayerRef.current.playbackRate - playbackSpeed
        ) > 0.01
      ) {
        artPlayerRef.current.playbackRate = playbackSpeed;
      }
    }
  }, [playbackSpeed]);

  // 换源相关状态
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );

  // 优选和测速开关
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // 保存优选时的测速结果，避免EpisodeSelector重复测速
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<PrecomputedVideoInfo>(new Map());

  // 折叠状态（仅在 lg 及以上屏幕有效）
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // 换源加载状态
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');

  // 播放进度保存相关
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------



  // 更新视频地址
  const updateVideoUrl = (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }
    const newUrl = detailData?.episodes[episodeIndex] || '';
    if (newUrl !== videoUrl) {
      setVideoUrl(newUrl);
    }
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除旧的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始终允许远程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾经有禁用属性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  const isM3u8Url = (url: string) => {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      return pathname.endsWith('.m3u8');
    } catch {
      return url.toLowerCase().includes('.m3u8');
    }
  };

  const normalizeUrl = (rawUrl: string, baseUrl: string) => {
    try {
      return new URL(rawUrl, baseUrl).toString();
    } catch {
      return rawUrl;
    }
  };

  const resolveMediaPlaylist = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`获取播放列表失败: ${response.status}`);
    }
    const text = await response.text();

    if (text.includes('#EXT-X-STREAM-INF')) {
      const lines = text.split('\n');
      let bestUrl = '';
      let bestBandwidth = -1;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF')) {
          const bwMatch = /BANDWIDTH=(\d+)/.exec(line);
          const bandwidth = bwMatch ? Number(bwMatch[1]) : 0;
          const nextLine = (lines[i + 1] || '').trim();
          if (nextLine && !nextLine.startsWith('#')) {
            const absUrl = normalizeUrl(nextLine, url);
            if (bandwidth >= bestBandwidth) {
              bestBandwidth = bandwidth;
              bestUrl = absUrl;
            }
          }
        }
      }
      if (bestUrl) {
        return resolveMediaPlaylist(bestUrl);
      }
    }

    const lines = text.split('\n');
    const normalizedLines: string[] = [];
    const segmentUrls: string[] = [];
    const keyUrls: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        normalizedLines.push(rawLine);
        continue;
      }

      if (line.startsWith('#EXT-X-KEY')) {
        const uriMatch = /URI="([^"]+)"/.exec(line);
        if (uriMatch) {
          const absKeyUrl = normalizeUrl(uriMatch[1], url);
          keyUrls.push(absKeyUrl);
          normalizedLines.push(line.replace(uriMatch[1], absKeyUrl));
        } else {
          normalizedLines.push(line);
        }
        continue;
      }

      if (line.startsWith('#')) {
        normalizedLines.push(line);
        continue;
      }

      const absUrl = normalizeUrl(line, url);
      segmentUrls.push(absUrl);
      normalizedLines.push(absUrl);
    }

    return {
      manifestText: normalizedLines.join('\n'),
      segmentUrls,
      keyUrls,
    };
  };

  const cacheUrlsWithConcurrency = async (
    cache: Cache,
    urls: string[],
    concurrency = 6,
    onProgress?: (completed: number, total: number) => void
  ) => {
    let index = 0;
    let completed = 0;
    const total = urls.length;
    const workers = new Array(Math.min(concurrency, total)).fill(null).map(() =>
      (async () => {
        while (true) {
          const currentIndex = index++;
          if (currentIndex >= total) break;
          const targetUrl = urls[currentIndex];
          const request = new Request(targetUrl, { mode: 'cors' });
          const cached = await cache.match(request);
          if (!cached) {
            const response = await fetch(request);
            if (response.ok || response.type === 'opaque') {
              await cache.put(request, response);
            }
          }
          completed += 1;
          onProgress?.(completed, total);
        }
      })()
    );

    await Promise.all(workers);
  };

  const refreshEpisodeCacheState = async (url: string) => {
    if (typeof window === 'undefined') return;
    if (!url) {
      setIsEpisodeCached(false);
      return;
    }
    try {
      const cache = await caches.open(VIDEO_CACHE_NAME);
      const hit = await cache.match(url);
      const isCached = !!hit;
      setIsEpisodeCached(isCached);

      const entry = buildCachedEpisodeEntry(url);
      if (entry && !isCached) {
        removeCachedEpisode(entry.key);
      }
    } catch {
      setIsEpisodeCached(false);
    }
  };

  const buildCachedEpisodeEntry = (url: string): CachedEpisode | null => {
    const d = detailRef.current;
    if (!d || !url) return null;
    const episodeIndex = currentEpisodeIndexRef.current;
    const key = `${d.source}-${d.id}-${episodeIndex}`;
    return {
      key,
      title: d.title || videoTitleRef.current || '',
      year: d.year || videoYearRef.current || '',
      cover: d.poster,
      source: d.source,
      sourceName: d.source_name,
      id: d.id,
      episodeIndex,
      totalEpisodes: d.episodes?.length || 1,
      url,
      cachedAt: Date.now(),
    };
  };

  const cacheCurrentEpisode = async () => {
    if (isCaching || !videoUrl) return;
    setIsCaching(true);
    try {
      const cache = await caches.open(VIDEO_CACHE_NAME);
      if (isM3u8Url(videoUrl)) {
        if (artPlayerRef.current?.notice) {
          artPlayerRef.current.notice.show = '开始缓存播放列表...';
        }
        const { manifestText, segmentUrls, keyUrls } =
          await resolveMediaPlaylist(videoUrl);

        const manifestResponse = new Response(manifestText, {
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
          },
        });
        await cache.put(videoUrl, manifestResponse);

        const allUrls = Array.from(new Set([...segmentUrls, ...keyUrls]));
        await cacheUrlsWithConcurrency(cache, allUrls, 6, (done, total) => {
          if (artPlayerRef.current?.notice) {
            artPlayerRef.current.notice.show = `离线缓存中 ${done}/${total}`;
          }
        });
      } else {
        if (artPlayerRef.current?.notice) {
          artPlayerRef.current.notice.show = '开始缓存视频文件...';
        }
        const response = await fetch(videoUrl);
        if (!response.ok) {
          throw new Error(`缓存失败: ${response.status}`);
        }
        await cache.put(videoUrl, response);
      }

      setIsEpisodeCached(true);
      const entry = buildCachedEpisodeEntry(videoUrl);
      if (entry) {
        addCachedEpisode(entry);
      }
      if (artPlayerRef.current?.notice) {
        artPlayerRef.current.notice.show = '离线缓存完成';
      }
    } catch (err) {
      console.error('离线缓存失败:', err);
      if (artPlayerRef.current?.notice) {
        artPlayerRef.current.notice.show = '离线缓存失败';
      }
    } finally {
      setIsCaching(false);
      refreshEpisodeCacheState(videoUrl);
    }
  };

  const removeEpisodeCache = async () => {
    if (!videoUrl) return;
    try {
      const cache = await caches.open(VIDEO_CACHE_NAME);
      if (isM3u8Url(videoUrl)) {
        const cachedManifest = await cache.match(videoUrl);
        let manifestText = '';
        if (cachedManifest) {
          manifestText = await cachedManifest.text();
        }
        if (!manifestText) {
          const networkManifest = await fetch(videoUrl);
          if (networkManifest.ok) {
            manifestText = await networkManifest.text();
          }
        }
        if (manifestText) {
          const lines = manifestText.split('\n');
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            if (line.startsWith('#EXT-X-KEY')) {
              const uriMatch = /URI="([^"]+)"/.exec(line);
              if (uriMatch) {
                const absKeyUrl = normalizeUrl(uriMatch[1], videoUrl);
                await cache.delete(absKeyUrl);
              }
              continue;
            }
            if (line.startsWith('#')) continue;
            const absUrl = normalizeUrl(line, videoUrl);
            await cache.delete(absUrl);
          }
        }
      }

      await cache.delete(videoUrl);
      setIsEpisodeCached(false);
      const entry = buildCachedEpisodeEntry(videoUrl);
      if (entry) {
        removeCachedEpisode(entry.key);
      }
      if (artPlayerRef.current?.notice) {
        artPlayerRef.current.notice.show = '已删除离线缓存';
      }
    } catch (err) {
      console.error('删除缓存失败:', err);
      if (artPlayerRef.current?.notice) {
        artPlayerRef.current.notice.show = '删除缓存失败';
      }
    } finally {
      refreshEpisodeCacheState(videoUrl);
    }
  };

  // 跳过片头片尾配置相关函数
  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }, fromSwitch = false) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      // 第一步：更新全局配置，保证后续取到最新值
      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        setSkipConfigMap(currentIdRef.current, {
          enable: false,
          intro_time: 0,
          outro_time: 0,
        });
      } else {
        setSkipConfigMap(currentIdRef.current, newConfig);
      }

      // 第二步：更新播放器界面的 SettingsLayer (设置面板)，不管此时是设为空还是变更了时间
      if (artPlayerRef.current && artPlayerRef.current.setting) {

        if (!fromSwitch) {
          artPlayerRef.current.setting.update({
            name: '跳过片头片尾',
            html: '跳过片头片尾',
            switch: newConfig.enable,
            onSwitch: function (item: any) {
              const upConfig = {
                ...currentSkipConfigRef.current,
                enable: !item.switch,
              };
              handleSkipConfigChange(upConfig, true);
              return !item.switch;
            },
          });
        }
        artPlayerRef.current.setting.update({
          name: '设置片头',
          html: '设置片头',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
          tooltip:
            newConfig.intro_time === 0
              ? '设置片头时间'
              : `${formatTime(newConfig.intro_time)}`,
          onClick: function () {
            const currentTime = artPlayerRef.current?.currentTime || 0;
            if (currentTime > 0) {
              const upConfig = {
                ...currentSkipConfigRef.current,
                intro_time: currentTime,
              };
              handleSkipConfigChange(upConfig);
              return `${formatTime(currentTime)}`;
            }
          },
        });
        artPlayerRef.current.setting.update({
          name: '设置片尾',
          html: '设置片尾',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
          tooltip:
            newConfig.outro_time >= 0
              ? '设置片尾时间'
              : `-${formatTime(-newConfig.outro_time)}`,
          onClick: function () {
            const outroTime =
              -(
                artPlayerRef.current?.duration -
                artPlayerRef.current?.currentTime
              ) || 0;
            if (outroTime < 0) {
              const upConfig = {
                ...currentSkipConfigRef.current,
                outro_time: outroTime,
              };
              handleSkipConfigChange(upConfig);
              return `-${formatTime(-outroTime)}`;
            }
          },
        });
      }
    } catch (err) {
      console.error('保存跳过片头片尾配置失败:', err);
    }
  };

  // 当集数索引变化时自动更新视频地址
  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex]);

  useEffect(() => {
    refreshEpisodeCacheState(videoUrl);
  }, [videoUrl]);

  // 进入页面时直接获取全部源信息
  useEffect(() => {
    const fetchSourceDetail = async (
      source: string,
      id: string
    ): Promise<SearchResult[]> => {
      try {
        const detailResponse = await fetch(
          `/api/detail?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`
        );
        if (!detailResponse.ok) {
          throw new Error(`获取详情失败 (状态码: ${detailResponse.status})`);
        }
        const detailData = (await detailResponse.json()) as SearchResult;
        setAvailableSources([detailData]);
        return [detailData];
      } catch (err) {
        console.error('获取视频详情失败:', err);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };
    const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
      // 根据搜索词获取全部源信息
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`
        );
        if (!response.ok) {
          throw new Error('搜索失败');
        }
        const data = await response.json();

        // 处理搜索结果，根据规则过滤
        const results = data.results.filter(
          (result: SearchResult) =>
            result.title.replaceAll(' ', '').toLowerCase() ===
            videoTitleRef.current.replaceAll(' ', '').toLowerCase() &&
            (videoYearRef.current
              ? result.year.toLowerCase() === videoYearRef.current.toLowerCase()
              : true) &&
            (searchType
              ? (searchType === 'tv' && result.episodes.length > 1) ||
              (searchType === 'movie' && result.episodes.length === 1)
              : true)
        );
        setAvailableSources(results);
        return results;
      } catch (err) {
        setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        setAvailableSources([]);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const initAll = async () => {
      // 优先从 URL 参数中直接获取最新值，避免 state 闭包滞后
      const sParam = searchParams.get('source') || '';
      const idParam = searchParams.get('id') || '';
      const sTitleParam = searchParams.get('stitle') || '';
      const titleParam = searchParams.get('title') || '';
      const offlineUrlParam = searchParams.get('offline_url') || '';
      const offlineFlag = searchParams.get('offline') === '1';
      const coverParam = searchParams.get('cover') || '';
      const sourceNameParam = searchParams.get('sname') || '';
      const epParamRaw = searchParams.get('ep') || '';
      const epParam = Number.isNaN(Number(epParamRaw))
        ? 0
        : Math.max(0, Number(epParamRaw));

      if (offlineFlag && offlineUrlParam) {
        const offlineDetail: SearchResult = {
          source: sParam || 'offline',
          id: idParam || offlineUrlParam,
          title: titleParam || '离线播放',
          year: searchParams.get('year') || '',
          poster: coverParam || '',
          episodes: [offlineUrlParam],
          source_name: sourceNameParam || '离线缓存',
        };
        setAvailableSources([offlineDetail]);
        setCurrentSource(offlineDetail.source);
        setCurrentId(offlineDetail.id);
        setVideoYear(offlineDetail.year);
        setVideoTitle(offlineDetail.title);
        setVideoCover(offlineDetail.poster);
        setDetail(offlineDetail);
        setCurrentEpisodeIndex(0);
        setVideoUrl(offlineUrlParam);
        setError(null);
        setLoadingStage('ready');
        setLoading(false);
        return;
      }

      if (!sParam && !idParam && !titleParam && !sTitleParam) {
        setError('参数不完整，无法播放');
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        let detailData: SearchResult | null = null;
        let sourcesInfo: SearchResult[] = [];

        // 先读取历史记录，判断是否从历史记录进入（存在对应记录）
        const recordsData = await getAllPlayRecords().catch(
          () => ({} as Record<string, any>)
        );
        const records = recordsData as Record<string, any>;
        const recordKey =
          sParam && idParam ? generateStorageKey(sParam, idParam) : '';
        const record = recordKey ? records[recordKey] : null;
        const isHistoryEntry = !!record;

        const query = sTitleParam || record?.search_title || titleParam;
        const shouldSearchAllSources = !sParam || !idParam || isHistoryEntry;

        setLoadingStage(shouldSearchAllSources ? 'searching' : 'fetching');
        setLoadingMessage(
          shouldSearchAllSources
            ? '🔍 正在搜索播放源...'
            : '🎬 正在快速进入播放...'
        );

        // --- 并行执行基础检查 ---
        const [searchResults, targetDetail] = await Promise.all([
          shouldSearchAllSources ? fetchSourcesData(query) : Promise.resolve([]),
          // 如果有现成 ID 且非历史记录入口，尝试直接请求详情
          sParam && idParam && !isHistoryEntry
            ? fetchSourceDetail(sParam, idParam).catch((err) => {
              console.warn('直接获取详情失败，将尝试从搜索结果中恢复:', err);
              return [];
            })
            : Promise.resolve([]),
        ]);

        sourcesInfo = searchResults;

        // 1. 优先路径：已有 Source 和 ID
        if (sParam && idParam && !isHistoryEntry) {
          if (targetDetail && targetDetail.length > 0) {
            detailData = targetDetail[0];
          }

          // 检查播放记录并准备恢复进度
          if (record) {
            setCurrentEpisodeIndex(record.index - 1);
            resumeTimeRef.current = record.play_time;
          }

          // 如果因为有 ID 所以跳过了初次搜索，现在在后台补齐换源列表
          if (sourcesInfo.length === 0) {
            fetchSourcesData(query).then(res => {
              if (res.length > 0) setAvailableSources(res);
            });
          }
        }

        // 2. 兜底路径：如果直连详情失败了，或者原本就没有 ID，尝试从搜索结果中寻找
        if (!detailData) {
          const finalSources =
            sourcesInfo.length > 0 ? sourcesInfo : await fetchSourcesData(query);
          sourcesInfo = finalSources;

          if (finalSources.length > 0) {
            let matched = finalSources.find((s: any) => s.source === sParam && s.id === idParam);

            // 如果需要优选且开启了优化，则在一批搜索结果中寻找最快的
            const shouldPrefer =
              optimizationEnabled &&
              (needPreferRef.current || shouldSearchAllSources);
            if (!matched && shouldPrefer) {
              setLoadingMessage('🚀 正在为您测速并优选最佳播放源...');
              const { bestSource, precomputedVideoInfo, sortedAvailableSources } =
                await preferBestSource(finalSources, finalSources);

              matched = bestSource;
              setPrecomputedVideoInfo(precomputedVideoInfo);
              setAvailableSources(sortedAvailableSources);
            }

            detailData = matched || finalSources[0];

            // 既然是新找到的源，重新同步一次它的播放记录
            const key = generateStorageKey(detailData.source, detailData.id);
            const record = records[key];
            if (record) {
              setCurrentEpisodeIndex(record.index - 1);
              resumeTimeRef.current = record.play_time;
            }
          }
        }

        if (!detailData) {
          setError('抱歉，未能成功加载视频详情，请尝试刷新或查看其他来源');
          setLoading(false);
          return;
        }

        // 应用数据
        setCurrentSource(detailData.source);
        setCurrentId(detailData.id);
        setVideoYear(detailData.year);
        setVideoTitle(detailData.title || titleParam);
        setVideoCover(detailData.poster);
        setDetail(detailData);

        if (currentEpisodeIndex >= detailData.episodes.length) {
          setCurrentEpisodeIndex(0);
        }

        // 更新历史记录（不刷新页面）
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('source', detailData.source);
        newUrl.searchParams.set('id', detailData.id);
        newUrl.searchParams.set('title', detailData.title);
        newUrl.searchParams.delete('prefer');
        window.history.replaceState({}, '', newUrl.toString());

        setLoadingStage('ready');
        setTimeout(() => setLoading(false), 300);

      } catch (err) {
        console.error('初始化失败:', err);
        setError('播放器配置出错，请检查网络后重试');
        setLoading(false);
      }
    };

    initAll();
  }, []);

  // 播放记录处理 - 已整合进 initAll，此处改为仅监听收藏数据的额外同步逻辑
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentId]);

  // 处理换源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    try {
      // 显示换源加载状态
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      // 记录当前播放进度（仅在同一集数切换时恢复）
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      console.log('换源前当前播放时间:', currentPlayTime);

      // 清除前一个历史记录
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current
          );
          console.log('已清除前一个播放记录');
        } catch (err) {
          console.error('清除播放记录失败:', err);
        }
      }

      // 清除并设置下一个跳过片头片尾配置
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          // await deleteSkipConfig(
          //   currentSourceRef.current,
          //   currentIdRef.current
          // );
          // await saveSkipConfig(newSource, newId, currentSkipConfig);
        } catch (err) {
          console.error('清除跳过片头片尾配置失败:', err);
        }
      }

      const newDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!newDetail) {
        setError('未找到匹配结果');
        return;
      }

      // 尝试跳转到当前正在播放的集数
      let targetIndex = currentEpisodeIndex;

      // 如果当前集数超出新源的范围，则跳转到第一集
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      // 如果仍然是同一集数且播放进度有效，则在播放器就绪后恢复到原始进度
      if (targetIndex !== currentEpisodeIndex) {
        resumeTimeRef.current = 0;
      } else if (
        (!resumeTimeRef.current || resumeTimeRef.current === 0) &&
        currentPlayTime > 1
      ) {
        resumeTimeRef.current = currentPlayTime;
      }

      // 更新URL参数（不刷新页面）
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      window.history.replaceState({}, '', newUrl.toString());

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      // 隐藏换源加载状态
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  const attemptAutoSwitch = (reason: string) => {
    if (autoSwitchingRef.current) return;
    if (availableSources.length <= 1) return;
    const now = Date.now();
    if (now - lastAutoSwitchAtRef.current < 1500) return;
    lastAutoSwitchAtRef.current = now;

    const currentKey = `${currentSourceRef.current}-${currentIdRef.current}`;
    if (currentSourceRef.current && currentIdRef.current) {
      autoSwitchAttemptedRef.current.add(currentKey);
    }

    const nextSource = availableSources.find((s) => {
      const key = `${s.source}-${s.id}`;
      return !autoSwitchAttemptedRef.current.has(key);
    });

    if (!nextSource) {
      console.warn('自动换源失败，已无可用候选:', reason);
      setError('当前源无法播放，已尝试其他来源仍失败');
      return;
    }

    console.warn('播放源异常，自动切换:', reason, nextSource);
    autoSwitchingRef.current = true;
    if (artPlayerRef.current?.notice) {
      artPlayerRef.current.notice.show = '播放源异常，正在自动切换...';
    }
    handleSourceChange(nextSource.source, nextSource.id, nextSource.title);
    setTimeout(() => {
      autoSwitchingRef.current = false;
    }, 1000);
  };

  // 处理长按快进逻辑
  const longPressSpeedRef = useRef<number | null>(null);
  const isLongPressingRef = useRef(false);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleKeyDownExt = (e: KeyboardEvent) => {
      // 忽略输入框
      if (
        (e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'TEXTAREA'
      ) return;

      if (!e.altKey && e.key === 'ArrowRight') {
        if (!e.repeat && !isLongPressingRef.current) {
          // 不是长按，可能是单次点击
          longPressTimerRef.current = setTimeout(() => {
            isLongPressingRef.current = true;
            if (artPlayerRef.current) {
              if (longPressSpeedRef.current === null) {
                longPressSpeedRef.current = artPlayerRef.current.playbackRate;
              }
              artPlayerRef.current.playbackRate = 3;
              artPlayerRef.current.notice.show = '>>> 3x 快速播放中';
            }
          }, 500); // 500ms 判定为长按
        }
      }
    };

    const handleKeyUpExt = (e: KeyboardEvent) => {
      if (!e.altKey && e.key === 'ArrowRight') {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }

        if (isLongPressingRef.current && artPlayerRef.current) {
          isLongPressingRef.current = false;
          if (longPressSpeedRef.current !== null) {
            artPlayerRef.current.playbackRate = longPressSpeedRef.current;
            longPressSpeedRef.current = null;
          }
          artPlayerRef.current.notice.show = `恢复加速: ${artPlayerRef.current.playbackRate}x`;
        }
      }
    };

    document.addEventListener('keydown', handleKeyboardShortcuts);
    document.addEventListener('keydown', handleKeyDownExt);
    document.addEventListener('keyup', handleKeyUpExt);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
      document.removeEventListener('keydown', handleKeyDownExt);
      document.removeEventListener('keyup', handleKeyUpExt);
    };
  }, []);


  // ---------------------------------------------------------------------------
  // 集数切换
  // ---------------------------------------------------------------------------
  // 处理集数切换
  const handleEpisodeChange = (episodeNumber: number) => {
    if (episodeNumber >= 0 && episodeNumber < totalEpisodes) {
      // 在更换集数前保存当前播放进度
      if (artPlayerRef.current && artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(episodeNumber);
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx - 1);
    }
  };

  const handleNextEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx + 1);
    }
  };

  // ---------------------------------------------------------------------------
  // 键盘快捷键
  // ---------------------------------------------------------------------------
  // 处理全局快捷键
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    // 忽略输入框中的按键事件
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }

    // f 键 = 切换全屏
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }

    // [ = 设为片头
    if (e.key === '[') {
      const currentTime = artPlayerRef.current?.currentTime || 0;
      if (currentTime > 0) {
        const newConfig = {
          ...currentSkipConfigRef.current,
          enable: true,
          intro_time: currentTime,
        };
        handleSkipConfigChange(newConfig);
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show = `设为片头 (${formatTime(currentTime)})`;
        }
        e.preventDefault();
      }
    }

    // ] = 设为片尾
    if (e.key === ']') {
      const outroTime =
        -(
          (artPlayerRef.current?.duration || 0) -
          (artPlayerRef.current?.currentTime || 0)
        ) || 0;
      if (outroTime < 0) {
        const newConfig = {
          ...currentSkipConfigRef.current,
          enable: true,
          outro_time: outroTime,
        };
        handleSkipConfigChange(newConfig);
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show = `设为片尾 (-${formatTime(-outroTime)})`;
        }
        e.preventDefault();
      }
    }

    // < = 减速
    if (e.key === '<' || e.key === ',') {
      if (artPlayerRef.current && artPlayerRef.current.playbackRate > 0.5) {
        artPlayerRef.current.playbackRate = Math.max(0.5, artPlayerRef.current.playbackRate - 0.25);
        artPlayerRef.current.notice.show = `播放速度: ${artPlayerRef.current.playbackRate}x`;
        e.preventDefault();
      }
    }

    // > = 加速
    if (e.key === '>' || e.key === '.') {
      if (artPlayerRef.current && artPlayerRef.current.playbackRate < 3) {
        artPlayerRef.current.playbackRate = Math.min(3, artPlayerRef.current.playbackRate + 0.25);
        artPlayerRef.current.notice.show = `播放速度: ${artPlayerRef.current.playbackRate}x`;
        e.preventDefault();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 播放记录相关
  // ---------------------------------------------------------------------------
  // 保存播放进度
  const saveCurrentPlayProgress = async () => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;

    // 如果播放时间太短（少于5秒）或者视频时长无效，不保存
    if (currentTime < 1 || !duration) {
      return;
    }

    try {
      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1, // 转换为1基索引
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
      });

      lastSaveTimeRef.current = Date.now();
      console.log('播放进度已保存:', {
        title: videoTitleRef.current,
        episode: currentEpisodeIndexRef.current + 1,
        year: detailRef.current?.year,
        progress: `${Math.floor(currentTime)}/${Math.floor(duration)}`,
      });
    } catch (err) {
      console.error('保存播放进度失败:', err);
    }
  };

  useEffect(() => {
    // 页面即将卸载时保存播放进度
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
    };

    // 页面可见性变化时保存播放进度
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
      }
    };

    // 添加事件监听器
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 清理事件监听器
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, artPlayerRef.current]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 收藏相关
  // ---------------------------------------------------------------------------
  // 每当 source 或 id 变化时检查收藏状态
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentId]);

  // 监听收藏数据更新事件
  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      }
    );

    return unsubscribe;
  }, [currentSource, currentId]);

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        // 如果已收藏，删除收藏
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        // 如果未收藏，添加收藏
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  const titleLayer = (show: boolean) => {
    const titleLayerText = videoTitleRef.current + (totalEpisodes > 1 ? ' - 第' + (currentEpisodeIndexRef.current + 1) + '集' : '');
    const layer = {
      name: 'titleLayer',
      html: `<div class="artplayer-title"><span class="artplayer-title-content">${titleLayerText}</span></div>`,
      style: {
        position: 'absolute',
        top: '10px',
        left: '15px',
        color: '#fff',
        fontSize: '14px',
        textShadow: '0px 1px 2px rgba(0,0,0,0.5)',
        pointerEvents: 'none',
        // [新增] 初始状态为可见
        opacity: (show ? '1' : '0'),
        // [新增] 添加 0.5 秒的透明度过渡效果
        transition: 'opacity 0.5s ease',
      },
    }
    return layer;
  }

  const updateTitleLayer = (show: boolean) => {
    if (!artPlayerRef.current) return;

    const isFullscreen = artPlayerRef.current.fullscreen;
    const titleText =
      videoTitleRef.current +
      (totalEpisodes > 1 ? ` - 第${currentEpisodeIndexRef.current + 1}集` : '');

    if (isFullscreen && !isLockedRef.current) {
      // 全屏：显示 backButton + title
      artPlayerRef.current.layers.update({
        name: 'titleLayer',
        html: `
          <div class="artplayer-title flex items-center gap-2" style="width:100%; padding:0 10px;">
            <button class="exit-fullscreen-btn" style="color:white; font-size:14px;">←</button>
            <span class="artplayer-title-content">${titleText}</span>
          </div>
        `,
        style: {
          position: 'absolute',
          top: '10px',
          left: '0',
          right: '0',
          color: '#fff',
          fontSize: '14px',
          textShadow: '0px 1px 2px rgba(0,0,0,0.5)',
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          opacity: show ? '1' : '0',
          transition: 'opacity 0.3s ease',
        },
        mounted: ((el: HTMLElement) => {
          console.log('titleLayer mounted', el);
          const backBtn = el.querySelector(".exit-fullscreen-btn") as HTMLElement;
          if (backBtn) {
            backBtn.onclick = () => {
              artPlayerRef.current.fullscreen = false;
              artPlayerRef.current.fullscreenWeb = false;
            };
          }
        }),
      });
    } else {
      // 非全屏：只显示 titleLayer
      artPlayerRef.current.layers.update(titleLayer(show));
    }
  };

  const settingsLayer = (): Setting[] => {
    return [
      {
        html: '去广告',
        icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
        tooltip: blockAdEnabled ? '已开启' : '已关闭',
        onClick() {
          const newVal = !blockAdEnabled;
          try {
            localStorage.setItem('enable_blockad', String(newVal));
            if (artPlayerRef.current) {
              resumeTimeRef.current = artPlayerRef.current.currentTime;
              if (
                artPlayerRef.current.video &&
                artPlayerRef.current.video.hls
              ) {
                artPlayerRef.current.video.hls.destroy();
              }
              artPlayerRef.current.destroy();
              artPlayerRef.current = null;
            }
            setBlockAdEnabled(newVal);
          } catch (_) {
            // ignore
          }
          return newVal ? '当前开启' : '当前关闭';
        },
      },
      {
        name: '离线缓存',
        html: isEpisodeCached ? '删除离线缓存' : '离线缓存本集',
        tooltip: isEpisodeCached ? '已缓存' : '未缓存',
        onClick() {
          if (isCachingRef.current) {
            return '正在缓存中...';
          }
          if (isEpisodeCachedRef.current) {
            removeEpisodeCache();
            return '已删除缓存';
          }
          cacheCurrentEpisode();
          return '开始缓存';
        },
      },
      {
        name: '跳过片头片尾',
        html: '跳过片头片尾',
        switch: currentSkipConfig.enable,
        onSwitch: function (item) {
          const newConfig = {
            ...currentSkipConfigRef.current,
            enable: !item.switch,
          };
          handleSkipConfigChange(newConfig, true);
          return !item.switch;
        },
      },
      {
        html: '删除跳过配置',
        onClick: function () {
          handleSkipConfigChange({
            enable: false,
            intro_time: 0,
            outro_time: 0,
          });
          return '';
        },
      },
      {
        name: '设置片头',
        html: '设置片头',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
        tooltip:
          currentSkipConfig.intro_time === 0
            ? '设置片头时间'
            : `${formatTime(currentSkipConfig.intro_time)}`,
        onClick: function () {
          const currentTime = artPlayerRef.current?.currentTime || 0;
          if (currentTime > 0) {
            const newConfig = {
              ...currentSkipConfig,
              intro_time: currentTime,
            };
            handleSkipConfigChange(newConfig);
            return `${formatTime(currentTime)}`;
          }
        },
      },
      {
        name: '设置片尾',
        html: '设置片尾',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
        tooltip:
          currentSkipConfig.outro_time >= 0
            ? '设置片尾时间'
            : `-${formatTime(-currentSkipConfig.outro_time)}`,
        onClick: function () {
          const outroTime =
            -(
              artPlayerRef.current?.duration -
              artPlayerRef.current?.currentTime
            ) || 0;
          if (outroTime < 0) {
            const newConfig = {
              ...currentSkipConfig,
              outro_time: outroTime,
            };
            handleSkipConfigChange(newConfig);
            return `-${formatTime(-outroTime)}`;
          }
        },
      },
    ]
  }

  useEffect(() => {
    if (!artPlayerRef.current?.setting) return;
    artPlayerRef.current.setting.update({
      name: '离线缓存',
      html: isEpisodeCached ? '删除离线缓存' : '离线缓存本集',
      tooltip: isEpisodeCached ? '已缓存' : '未缓存',
      onClick() {
        if (isCachingRef.current) {
          return '正在缓存中...';
        }
        if (isEpisodeCachedRef.current) {
          removeEpisodeCache();
          return '已删除缓存';
        }
        cacheCurrentEpisode();
        return '开始缓存';
      },
    });
  }, [isEpisodeCached, isCaching, videoUrl]);

  const isSeekingRef = useRef(false);

  // 监听 SkipConfig 变化并同步到 Artplayer Highlights 控制进度条提示原点
  useEffect(() => {
    if (artPlayerRef.current && artPlayerRef.current.duration) {
      const highlights: { time: number; text: string }[] = [];
      const config = currentSkipConfigRef.current;
      const duration = artPlayerRef.current.duration;

      if (config.enable) {
        if (config.intro_time > 0) {
          highlights.push({ time: config.intro_time, text: '片头结束点' });
        }
        if (config.outro_time < 0 && duration > 0) {
          highlights.push({ time: duration + config.outro_time, text: '片尾开始点' });
        }
      }

      artPlayerRef.current.plugins.artplayerPluginHighlight = highlights;
      // hacky, artplayer might need to update highlight programatically if it doesn't auto sync.
      // But ArtPlayer does re-render highlights if we simply set it in plugins (via plugins manager)
      // We can also just update highlights directly:
      if (typeof artPlayerRef.current.emit === 'function') {
        artPlayerRef.current.emit('artplayerPluginHighlight', highlights);
      }
    }
  }, [skipConfigMap, currentId, artPlayerRef.current?.duration]);

  // 播放器初始化和切换逻辑
  useEffect(() => {
    if (
      !Artplayer ||
      !Hls ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    // 确保选集索引有效
    if (!detail || !detail.episodes || detail.episodes.length === 0) {
      setError(`该视频暂无可播放源或集数为空，请尝试切换其他可用播放源`);
      return;
    }

    if (currentEpisodeIndex >= detail.episodes.length || currentEpisodeIndex < 0) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }

    // 只初始化一次播放器实例
    if (!artPlayerRef.current) {
      try {
        Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
        Artplayer.USE_RAF = true;

        artPlayerRef.current = new Artplayer({
          container: artRef.current,
          url: videoUrl,
          poster: videoCover,
          volume: 0.7,
          isLive: false,
          muted: false,
          autoplay: true,
          pip: true,
          autoSize: false,
          autoMini: false,
          screenshot: false,
          setting: true,
          loop: false,
          flip: false,
          playbackRate: true,
          aspectRatio: false,
          fullscreen: true,
          fullscreenWeb: true,
          subtitleOffset: false,
          miniProgressBar: false,
          mutex: true,
          playsInline: true,
          autoPlayback: false,
          airplay: true,
          theme: '#22c55e',
          lang: 'zh-cn',
          hotkey: false,
          fastForward: true,
          autoOrientation: true,
          lock: true,
          moreVideoAttr: {
            crossOrigin: 'anonymous',
          },
          // HLS 支持配置
          customType: {
            m3u8: function (video: HTMLVideoElement, url: string) {
              if (!Hls) {
                console.error('HLS.js 未加载');
                return;
              }

              if (video.hls) {
                video.hls.destroy();
              }
              const hls = new Hls({
                ...getHlsConfig(blockAdEnabledRef.current),
              });

              hls.loadSource(url);
              hls.attachMedia(video);
              video.hls = hls;

              ensureVideoSource(video, url);

              hls.on(Hls.Events.ERROR, function (event: any, data: any) {
                console.error('HLS Error:', event, data);
                if (data.fatal) {
                  switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                      console.log('网络错误，尝试恢复...');
                      hls.startLoad();
                      break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                      console.log('媒体错误，尝试恢复...');
                      hls.recoverMediaError();
                      break;
                    default:
                      console.log('无法恢复的错误');
                      hls.destroy();
                      attemptAutoSwitch('hls-fatal');
                      break;
                  }
                }
              });
            },
          },
          icons: {
            loading:
              '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
          },
          settings: [
            ...settingsLayer(),
          ],
          controls: [
            {
              position: 'left',
              index: 13,
              html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
              tooltip: '播放下一集',
              click: function () {
                handleNextEpisode();
              },
            },
          ],

          highlight: [], // 预留，将在 ready/update 中更新
          layers: [
            titleLayer(true),
          ],
        });
        // 事件绑定
        artPlayerRef.current.on('ready', () => {
          updateTitleLayer(true);
          setError(null);
        });
        artPlayerRef.current.on('control', (state: boolean) => {
          updateTitleLayer(state);
        });
        artPlayerRef.current.on('fullscreen', (state: boolean) => {
          updateTitleLayer(true);

          // // 移动端全屏自动旋转逻辑
          // const art = artPlayerRef.current;
          // if (state && art && typeof window !== 'undefined' && (window as any).screen?.orientation?.lock) {
          //   const video = art.video;
          //   if (video && video.videoWidth > 0 && video.videoHeight > 0) {
          //     const isLandscape = video.videoWidth > video.videoHeight;
          //     if (isLandscape) {
          //       (window as any).screen.orientation.lock('landscape').catch(() => { });
          //     } else {
          //       (window as any).screen.orientation.lock('portrait').catch(() => { });
          //     }
          //   }
          // } else if (!state && typeof window !== 'undefined' && (window as any).screen?.orientation?.unlock) {
          //   (window as any).screen.orientation.unlock().catch(() => { });
          // }
        });

        artPlayerRef.current.on('fullscreenWeb', (state: boolean) => {
          updateTitleLayer(true);
          // 网页全屏由于不一定会占据整个系统屏幕，通常不需要锁定方向，
          // 但如果用户是在移动端浏览器中使用，unlock 也是安全的。
          // if (!state && typeof window !== 'undefined' && (window as any).screen?.orientation?.unlock) {
          //   (window as any).screen.orientation.unlock();
          // }
        });
        artPlayerRef.current.on('video:volumechange', () => {
          lastVolumeRef.current = artPlayerRef.current.volume;
        });

        artPlayerRef.current.on('video:seeking', () => {
          isSeekingRef.current = true;
        });

        artPlayerRef.current.on('video:seeked', () => {
          setTimeout(() => {
            isSeekingRef.current = false;
          }, 0);
        });

        artPlayerRef.current.on('video:ratechange', () => {
          if (isSeekingRef.current) return;

          const rate = artPlayerRef.current.playbackRate;

          // 记录最新倍率，确保换源 / 重新加载时能恢复
          lastPlaybackRateRef.current = rate;

          // 仅在真正变化时才同步到 store
          if (Math.abs(rate - playbackSpeed) > 0.01) {
            setPlaybackSpeed(rate);
          }
        });

        artPlayerRef.current.on('lock', (state: boolean) => {
          console.info('lock', state);
          isLockedRef.current = state;
          updateTitleLayer(true);
        });
        artPlayerRef.current.on('video:canplay', () => {
          if (resumeTimeRef.current && resumeTimeRef.current > 0) {
            try {
              const duration = artPlayerRef.current.duration || 0;
              let target = resumeTimeRef.current;
              if (duration && target >= duration - 2) {
                target = Math.max(0, duration - 5);
              }
              artPlayerRef.current.currentTime = target;
              console.log('成功恢复播放进度到:', resumeTimeRef.current);
            } catch (err) {
              console.warn('恢复播放进度失败:', err);
            }
          }
          resumeTimeRef.current = null;
          console.log('视频准备就绪，当前播放时间:', artPlayerRef.current.playbackRate, lastPlaybackRateRef.current);
          setTimeout(() => {
            if (
              Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) > 0.01
            ) {
              artPlayerRef.current.volume = lastVolumeRef.current;
            }
            if (
              Math.abs(
                artPlayerRef.current.playbackRate - lastPlaybackRateRef.current
              ) > 0.01
            ) {
              artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
            }
            artPlayerRef.current.notice.show = '';
          }, 0);
          setIsVideoLoading(false);
        });
        artPlayerRef.current.on('video:timeupdate', () => {
          const config = currentSkipConfigRef.current;
          if (!config.enable) return;

          const currentTime = artPlayerRef.current.currentTime || 0;
          const duration = artPlayerRef.current.duration || 0;
          const now = Date.now();

          if (now - lastSkipCheckRef.current < 1000) return;
          lastSkipCheckRef.current = now;

          // 跳过片头
          if (config.intro_time > 0 && currentTime < config.intro_time) {
            artPlayerRef.current.currentTime = config.intro_time;
            artPlayerRef.current.notice.show = `已跳过片头 (${formatTime(
              config.intro_time
            )})`;
            return;
          }

          // 跳过片尾
          if (
            config.outro_time < 0 &&
            duration > 0 &&
            currentTime > duration + config.outro_time
          ) {
            if (
              currentEpisodeIndexRef.current <
              (detailRef.current?.episodes?.length || 1) - 1
            ) {
              handleNextEpisode();
            } else {
              artPlayerRef.current.pause();
            }
            artPlayerRef.current.notice.show = `已跳过片尾 (${formatTime(
              -config.outro_time
            )})`;
          }
        });
        artPlayerRef.current.on('error', (err: any) => {
          console.error('播放器错误:', err);
          if (artPlayerRef.current.currentTime > 0) {
            return;
          }
          attemptAutoSwitch('player-error');
        });
        artPlayerRef.current.on('video:ended', () => {
          const d = detailRef.current;
          const idx = currentEpisodeIndexRef.current;
          if (d && d.episodes && idx < d.episodes.length - 1) {
            setTimeout(() => {
              setCurrentEpisodeIndex(idx + 1);
            }, 1000);
          }
        });
        artPlayerRef.current.on('video:timeupdate', () => {
          const now = Date.now();
          let interval = 5000;
          if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'd1') {
            interval = 10000;
          }
          if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash') {
            interval = 20000;
          }
          if (now - lastSaveTimeRef.current > interval) {
            saveCurrentPlayProgress();
            lastSaveTimeRef.current = now;
          }
        });
        artPlayerRef.current.on('pause', () => {
          saveCurrentPlayProgress();
        });
        if (artPlayerRef.current?.video) {
          ensureVideoSource(
            artPlayerRef.current.video as HTMLVideoElement,
            videoUrl
          );
        }
      } catch (err) {
        console.error('创建播放器失败:', err);
        setError('播放器初始化失败');
      }
    } else {
      // 切换视频源，不销毁播放器
      // 只需调用 switch 方法并更新 poster 和 title
      try {
        if (typeof artPlayerRef.current.switch === 'function') {
          artPlayerRef.current.switch(videoUrl);
        } else {
          // fallback: 兼容某些 Artplayer 版本
          artPlayerRef.current.url = videoUrl;
        }
        artPlayerRef.current.poster = videoCover;
        artPlayerRef.current.title = `${videoTitle} - 第${currentEpisodeIndex + 1}集`;
        if (artPlayerRef.current?.video) {
          ensureVideoSource(
            artPlayerRef.current.video as HTMLVideoElement,
            videoUrl
          );
        }
      } catch (err) {
        console.error('切换视频源失败:', err);
        setError('切换视频源失败');
      }
    }
    // 不销毁播放器实例，保持唯一
    // 清理逻辑在组件卸载时做
    return () => {
      // do not destroy on url change!
    };
    // 依赖项：Artplayer, Hls, videoUrl, loading, blockAdEnabled, videoCover, videoTitle, currentEpisodeIndex
  }, [Artplayer, Hls, videoUrl, loading, blockAdEnabled, videoCover, videoTitle, currentEpisodeIndex]);

  useEffect(() => {
    if (artPlayerRef.current) {
      const config = currentSkipConfigRef.current;
      const currentTime = artPlayerRef.current.currentTime;
      // 如果配置启用且播放时间还在片头部分
      if (
        config.enable &&
        currentTime < config.intro_time
      ) {
        // 跳过片头
        artPlayerRef.current.currentTime = config.intro_time;
        artPlayerRef.current.notice.show = `已跳过片头 (${formatTime(config.intro_time)})`;
      }

      // 跳过片尾
      if (
        config.outro_time < 0 &&
        (currentTime >
          (artPlayerRef.current.duration + config.outro_time))
      ) {
        if (
          currentEpisodeIndexRef.current <
          (detailRef.current?.episodes?.length || 1) - 1
        ) {
          handleNextEpisode();
        } else {
          artPlayerRef.current.pause();
        }
        artPlayerRef.current.notice.show = `已跳过片尾 (${formatTime(
          config.outro_time
        )})`;
      }

    }
  }, [artPlayerRef.current?.currentTime]);

  // 当组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
      if (artPlayerRef.current) {
        // 停掉视频播放
        if (artPlayerRef.current.video) {
          artPlayerRef.current.video.pause();
          // 销毁 HLS 实例
          if (artPlayerRef.current.video.hls) {
            artPlayerRef.current.video.hls.destroy();
            artPlayerRef.current.video.hls = null;
          }
        }
        artPlayerRef.current.destroy();
        artPlayerRef.current = null;
      }
    };
  }, []);

  if (loading) {
    return (
      <LoadingPage
        loadingStage={loadingStage}
        loadingMessage={loadingMessage}
      />
    );
  }

  if (error) {
    return (
      <ErrorPage
        error={error}
        videoTitle={videoTitle}
      />
    )
  }

  return (
    <PageLayout activePath='/play'>
      <div className='flex flex-col gap-3 py-4 px-5 lg:px-[3rem] 2xl:px-20'>
        {/* 第一行：影片标题 */}
        {/* <div className='py-1'>
          <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            {videoTitle || '影片标题'}
            {totalEpisodes > 1 && (
              <span className='text-gray-500 dark:text-gray-400'>
                {` > 第 ${currentEpisodeIndex + 1} 集`}
              </span>
            )}
          </h1>
        </div> */}
        {/* 第二行：播放器和选集 */}
        <div className='space-y-1'>
          {/* 折叠控制 - 仅在 lg 及以上屏幕显示 */}
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() =>
                setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
              }
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all duration-200'
              title={
                isEpisodeSelectorCollapsed ? '显示选集面板' : '隐藏选集面板'
              }
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isEpisodeSelectorCollapsed ? 'rotate-180' : 'rotate-0'
                  }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M9 5l7 7-7 7'
                />
              </svg>
              <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                {isEpisodeSelectorCollapsed ? '显示' : '隐藏'}
              </span>

              {/* 精致的状态指示点 */}
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${isEpisodeSelectorCollapsed
                  ? 'bg-orange-400 animate-pulse'
                  : 'bg-green-400'
                  }`}
              ></div>
            </button>
          </div>

          <div
            className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${isEpisodeSelectorCollapsed
              ? 'grid-cols-1'
              : 'grid-cols-1 md:grid-cols-4'
              }`}
          >
            {/* 播放器 */}
            <div
              className={`h-full transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 ${isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
                }`}
            >
              <div className='relative w-full h-[300px] lg:h-full'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg'
                ></div>

                {/* 换源加载蒙层 */}
                {isVideoLoading && (
                  <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl flex items-center justify-center z-[500] transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      {/* 动画影院图标 */}
                      <div className='relative mb-8'>
                        <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                          <div className='text-white text-4xl'>🎬</div>
                          {/* 旋转光环 */}
                          <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
                        </div>

                        {/* 浮动粒子效果 */}
                        <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                          <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                          <div
                            className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                            style={{ animationDelay: '0.5s' }}
                          ></div>
                          <div
                            className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                            style={{ animationDelay: '1s' }}
                          ></div>
                        </div>
                      </div>

                      {/* 换源消息 */}
                      <div className='space-y-2'>
                        <p className='text-xl font-semibold text-white animate-pulse'>
                          {videoLoadingStage === 'sourceChanging'
                            ? '🔄 切换播放源...'
                            : '🔄 视频加载中...'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 选集和换源 - 在移动端始终显示，在 lg 及以上可折叠 */}
            <div
              className={`h-[300px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${isEpisodeSelectorCollapsed
                ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                : 'md:col-span-1 lg:opacity-100 lg:scale-100'
                }`}
            >
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                value={currentEpisodeIndex + 1}
                onChange={handleEpisodeChange}
                onSourceChange={handleSourceChange}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={precomputedVideoInfo}
              />
            </div>
          </div>
        </div>

        {/* 详情展示 */}
        <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
          {/* 文字区 */}
          <div className='md:col-span-3'>
            <div className='p-6 flex flex-col min-h-0'>
              {/* 标题 */}
              <h1 className='text-3xl font-bold mb-2 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full'>
                {videoTitle || '影片标题'}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleFavorite();
                  }}
                  className='ml-3 flex-shrink-0 hover:opacity-80 transition-opacity'
                >
                  <FavoriteIcon filled={favorited} />
                </button>
              </h1>

              {/* 关键信息行 */}
              <div className='flex flex-wrap items-center gap-3 text-base mb-4 opacity-80 flex-shrink-0'>
                {detail?.class && (
                  <span className='text-green-600 font-semibold'>
                    {detail.class}
                  </span>
                )}
                {(detail?.year || videoYear) && (
                  <span>{detail?.year || videoYear}</span>
                )}
                {detail?.source_name && (
                  <span className='border border-gray-500/60 px-2 py-[1px] rounded'>
                    {detail.source_name}
                  </span>
                )}
                {detail?.type_name && <span>{detail.type_name}</span>}
              </div>
              {/* 剧情简介 */}
              {detail?.desc && (
                <div
                  className='mt-0 text-base leading-relaxed opacity-90 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
                  style={{ whiteSpace: 'pre-line' }}
                >
                  {detail.desc}
                </div>
              )}
            </div>
          </div>

          {/* 封面展示 */}
          <div className='hidden md:block md:col-span-1 md:order-first'>
            <div className='pl-0 py-4 pr-6'>
              <div className='bg-gray-300 dark:bg-gray-700 aspect-[2/3] flex items-center justify-center rounded-xl overflow-hidden'>
                {videoCover ? (
                  <img
                    src={processImageUrl(videoCover)}
                    alt={videoTitle}
                    className='w-full h-full object-cover'
                  />
                ) : (
                  <span className='text-gray-600 dark:text-gray-400'>
                    封面图片
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}


export default function PlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayPageClient />
    </Suspense>
  );
}
