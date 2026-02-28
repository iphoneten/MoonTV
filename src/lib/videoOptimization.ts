import { SearchResult } from './types';
import { getVideoResolutionFromM3u8 } from './utils';

// 计算播放源综合评分
export const calculateSourceScore = (
  testResult: {
    quality: string;
    loadSpeed: string;
    pingTime: number;
  },
  maxSpeed: number,
  minPing: number,
  maxPing: number
): number => {
  let score = 0;

  // 分辨率评分 (40% 权重)
  const qualityScore = (() => {
    switch (testResult.quality) {
      case '4K':
        return 100;
      case '2K':
        return 85;
      case '1080p':
        return 75;
      case '720p':
        return 60;
      case '480p':
        return 40;
      case 'SD':
        return 20;
      default:
        return 0;
    }
  })();
  score += qualityScore * 0.4;

  // 下载速度评分 (40% 权重) - 基于最大速度线性映射
  const speedScore = (() => {
    const speedStr = testResult.loadSpeed;
    if (speedStr === '未知' || speedStr === '测量中...') return 30;

    // 解析速度值
    const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
    if (!match) return 30;

    const value = parseFloat(match[1]);
    const unit = match[2];
    const speedKBps = unit === 'MB/s' ? value * 1024 : value;

    // 基于最大速度线性映射，最高100分
    const speedRatio = speedKBps / maxSpeed;
    return Math.min(100, Math.max(0, speedRatio * 100));
  })();
  score += speedScore * 0.4;

  // 网络延迟评分 (20% 权重) - 基于延迟范围线性映射
  const pingScore = (() => {
    const ping = testResult.pingTime;
    if (ping <= 0) return 0; // 无效延迟给默认分

    // 如果所有延迟都相同，给满分
    if (maxPing === minPing) return 100;

    // 线性映射：最低延迟=100分，最高延迟=0分
    const pingRatio = (maxPing - ping) / (maxPing - minPing);
    return Math.min(100, Math.max(0, pingRatio * 100));
  })();
  score += pingScore * 0.2;

  return Math.round(score * 100) / 100; // 保留两位小数
};

export type PrecomputedVideoInfo = Map<
  string,
  {
    quality: string;
    loadSpeed: string;
    pingTime: number;
    avgSpeed?: number;
    tsSuccessRate?: number;
    hasError?: boolean;
  }
>;

// 会话级缓存，避免单次打开页面重复测速
const sessionSpeedCache: Map<string, any> = new Map();

// 播放源优选函数（生产级多次采样测速 + TS 成功率 + 缓存 + 并发优化 + 早停逻辑）
export const preferBestSource = async (
  sources: SearchResult[],
  availableSources: SearchResult[]
): Promise<{
  bestSource: SearchResult;
  precomputedVideoInfo: PrecomputedVideoInfo;
  sortedAvailableSources: SearchResult[];
}> => {
  const newVideoInfoMap: PrecomputedVideoInfo = new Map();

  if (sources.length === 0) {
    return {
      bestSource: sources[0], // fallback
      precomputedVideoInfo: newVideoInfoMap,
      sortedAvailableSources: availableSources,
    };
  }

  if (sources.length === 1) {
    return {
      bestSource: sources[0],
      precomputedVideoInfo: newVideoInfoMap,
      sortedAvailableSources: availableSources,
    };
  }

  // 1. 检查缓存逻辑
  // 如果所有 sources 都在缓存中，直接返回
  const allInCache = sources.every((s) =>
    sessionSpeedCache.has(`${s.source}-${s.id}`)
  );
  if (allInCache && sources.length > 0) {
    console.log('检测到全量测速缓存，跳过实时测试');
    sources.forEach((s) => {
      const data = sessionSpeedCache.get(`${s.source}-${s.id}`);
      newVideoInfoMap.set(`${s.source}-${s.id}`, data.testResult);
    });
    // 复用之前的评分逻辑进行排序... 为了简洁，这里直接进入下面的通用流也能处理缓存
  }

  // 生产级多次采样测速参数
  const TEST_ROUNDS = 2; // 减少轮数至2轮，权衡准确度与速度
  const TS_SUCCESS_SAMPLE_COUNT = 3; // 减少采样分片数
  const TS_SUCCESS_TIMEOUT = 2500;
  const CONCURRENT_COUNT = 4; // 增加并发数

  // 定义“完美源”标准：1080p及以上，速度 > 3MB/s，延迟 < 300ms
  const isPerfectSource = (res: any) => {
    if (!res) return false;
    const { quality, avgSpeed, pingTime, tsSuccessRate } = res;
    const isHighQuality =
      quality === '4K' || quality === '2K' || quality === '1080p';
    return (
      isHighQuality && avgSpeed > 3072 && pingTime < 300 && tsSuccessRate >= 0.8
    );
  };

  const results: any[] = [];
  let foundPerfect = false;

  // 测试单个播放源
  async function testSource(source: SearchResult) {
    if (foundPerfect) return null;

    const cacheKey = `${source.source}-${source.id}`;
    if (sessionSpeedCache.has(cacheKey)) {
      return sessionSpeedCache.get(cacheKey);
    }

    if (!source.episodes || source.episodes.length === 0) return null;

    // 取第一集或第二集测试
    const episodeUrl =
      source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];
    const qualities: string[] = [];
    const speeds: number[] = [];
    const pings: number[] = [];
    let tsSuccessRate = 0;
    let tsSuccessChecked = false;

    for (let i = 0; i < TEST_ROUNDS; i++) {
      try {
        const result = await getVideoResolutionFromM3u8(episodeUrl);
        if (result.quality) qualities.push(result.quality);
        if (
          result.loadSpeed &&
          result.loadSpeed !== '未知' &&
          result.loadSpeed !== '测量中...'
        ) {
          const match = result.loadSpeed.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
          if (match) {
            let v = parseFloat(match[1]);
            if (match[2] === 'MB/s') v = v * 1024;
            speeds.push(v);
          }
        }
        if (typeof result.pingTime === 'number' && result.pingTime > 0)
          pings.push(result.pingTime);

        if (
          !tsSuccessChecked &&
          Array.isArray(result.tsUrls) &&
          result.tsUrls.length > 0
        ) {
          tsSuccessChecked = true;
          let ok = 0;
          const total = Math.min(result.tsUrls.length, TS_SUCCESS_SAMPLE_COUNT);
          await Promise.all(
            result.tsUrls.slice(0, total).map(async (tsUrl: string) => {
              try {
                const resp = await fetch(tsUrl, {
                  method: 'HEAD',
                  signal: AbortSignal.timeout(TS_SUCCESS_TIMEOUT),
                });
                if (resp.ok) ok += 1;
              } catch {
                /* ignore */
              }
            })
          );
          tsSuccessRate = ok / total;
        }
      } catch {
        /* ignore */
      }
    }

    const finalResult = {
      source,
      testResult: {
        quality: qualities[0] || '未知',
        loadSpeed:
          speeds.length > 0
            ? speeds[0] >= 1024
              ? `${(speeds[0] / 1024).toFixed(1)} MB/s`
              : `${speeds[0].toFixed(1)} KB/s`
            : '未知',
        pingTime: pings.length > 0 ? Math.min(...pings) : 0,
        avgSpeed:
          speeds.length > 0
            ? speeds.reduce((a, b) => a + b, 0) / speeds.length
            : 0,
        tsSuccessRate: tsSuccessChecked ? tsSuccessRate : 1,
      },
    };

    // 存入缓存
    sessionSpeedCache.set(cacheKey, finalResult);

    if (isPerfectSource(finalResult.testResult)) {
      foundPerfect = true;
    }
    return finalResult;
  }

  // 分批并发测速
  for (let i = 0; i < sources.length; i += CONCURRENT_COUNT) {
    if (foundPerfect) break;
    const batch = sources.slice(i, i + CONCURRENT_COUNT);
    const batchResults = await Promise.all(batch.map((s) => testSource(s)));
    results.push(...batchResults.filter(Boolean));
  }

  // 构造返回 Map
  results.forEach((r) => {
    newVideoInfoMap.set(`${r.source.source}-${r.source.id}`, r.testResult);
  });

  if (results.length === 0) {
    return {
      bestSource: sources[0],
      precomputedVideoInfo: newVideoInfoMap,
      sortedAvailableSources: availableSources,
    };
  }

  // 计算和排序
  const validSpeeds = results
    .map((r) => r.testResult.avgSpeed)
    .filter((v) => v > 0);
  const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024;
  const validPings = results
    .map((r) => r.testResult.pingTime)
    .filter((p) => p > 0);
  const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
  const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

  const resultsWithScore = results.map((r) => {
    const tsPenalty = r.testResult.tsSuccessRate < 0.8 ? 0.5 : 1;
    const score = calculateSourceScore(
      r.testResult,
      maxSpeed,
      minPing,
      maxPing
    );
    return { ...r, score: score * tsPenalty };
  });

  resultsWithScore.sort((a, b) => b.score - a.score);

  const bestSource = resultsWithScore[0].source;
  const successSources = resultsWithScore.map((r) => r.source);
  const otherSources = availableSources.filter(
    (s) =>
      !successSources.find(
        (success) => success.source === s.source && success.id === s.id
      )
  );

  return {
    bestSource,
    precomputedVideoInfo: newVideoInfoMap,
    sortedAvailableSources: [...successSources, ...otherSources],
  };
};
