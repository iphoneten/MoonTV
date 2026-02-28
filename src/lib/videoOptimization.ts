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

// 播放源优选函数（生产级多次采样测速 + TS 成功率和播放成功重置逻辑）
export const preferBestSource = async (
  sources: SearchResult[],
  availableSources: SearchResult[]
): Promise<{
  bestSource: SearchResult;
  precomputedVideoInfo: PrecomputedVideoInfo;
  sortedAvailableSources: SearchResult[];
}> => {
  const newVideoInfoMap: PrecomputedVideoInfo = new Map();

  if (sources.length === 1) {
    return {
      bestSource: sources[0],
      precomputedVideoInfo: newVideoInfoMap,
      sortedAvailableSources: availableSources,
    };
  }

  // 生产级多次采样测速参数
  const TEST_ROUNDS = 3;
  const TS_SUCCESS_SAMPLE_COUNT = 5; // 检查前5个TS分片
  const TS_SUCCESS_TIMEOUT = 3000; // 每个分片最大超时

  // 测试单个播放源，返回测速综合信息
  async function testSource(source: SearchResult) {
    if (!source.episodes || source.episodes.length === 0) {
      return null;
    }
    const episodeUrl =
      source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];
    // 多次测速取均值
    const qualities: string[] = [];
    const speeds: number[] = [];
    const pings: number[] = [];
    const speedLabels: string[] = [];
    let tsSuccessRate = 0;
    let tsSuccessChecked = false;
    let lastResult: any = null;
    for (let i = 0; i < TEST_ROUNDS; i++) {
      try {
        // getVideoResolutionFromM3u8 返回 {quality, loadSpeed, pingTime, tsUrls?}
        const result = await getVideoResolutionFromM3u8(episodeUrl);
        lastResult = result;
        if (result.quality) qualities.push(result.quality);
        // 解析 loadSpeed
        if (result.loadSpeed && result.loadSpeed !== '未知' && result.loadSpeed !== '测量中...') {
          const match = result.loadSpeed.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
          if (match) {
            let v = parseFloat(match[1]);
            if (match[2] === 'MB/s') v = v * 1024;
            speeds.push(v);
            speedLabels.push(result.loadSpeed);
          }
        }
        if (typeof result.pingTime === 'number' && result.pingTime > 0) {
          pings.push(result.pingTime);
        }
        // 只在第1次测速时检查TS成功率
        if (!tsSuccessChecked && Array.isArray(result.tsUrls) && result.tsUrls.length > 0) {
          tsSuccessChecked = true;
          let ok = 0;
          const total = Math.min(result.tsUrls.length, TS_SUCCESS_SAMPLE_COUNT);
          await Promise.all(
            result.tsUrls.slice(0, total).map(async (tsUrl: string) => {
              try {
                const ctrl = new AbortController();
                const timeout = setTimeout(() => ctrl.abort(), TS_SUCCESS_TIMEOUT);
                const resp = await fetch(tsUrl, { method: 'HEAD', signal: ctrl.signal });
                clearTimeout(timeout);
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                if (resp.ok) ok += 1;
              } catch { /* ignore */ }
            })
          );
          tsSuccessRate = total > 0 ? ok / total : 0;
        }
      } catch (e) {
        // ignore
      }
    }
    // 取众数或均值
    const quality =
      qualities.length > 0
        ? qualities.sort(
          (a, b) =>
            qualities.filter((v) => v === b).length -
            qualities.filter((v) => v === a).length
        )[0]
        : lastResult?.quality || '未知';
    const avgSpeed =
      speeds.length > 0
        ? speeds.reduce((a, b) => a + b, 0) / speeds.length
        : 0;
    const speedLabel =
      speedLabels.length > 0
        ? speedLabels.sort(
          (a, b) =>
            speedLabels.filter((v) => v === b).length -
            speedLabels.filter((v) => v === a).length
        )[0]
        : lastResult?.loadSpeed || '未知';
    const avgPing =
      pings.length > 0
        ? Math.round(
          pings.reduce((a, b) => a + b, 0) / pings.length
        )
        : lastResult?.pingTime || 0;
    return {
      source,
      testResult: {
        quality,
        loadSpeed: speedLabel,
        pingTime: avgPing,
        avgSpeed,
        tsSuccessRate: tsSuccessChecked ? tsSuccessRate : 1,
      },
    };
  }

  // 批量测速，分批进行避免并发过多
  const batchSize = Math.ceil(sources.length / 2);
  const allResults: Array<{
    source: SearchResult;
    testResult: {
      quality: string;
      loadSpeed: string;
      pingTime: number;
      avgSpeed?: number;
      tsSuccessRate?: number;
    };
  } | null> = [];

  for (let start = 0; start < sources.length; start += batchSize) {
    const batchSources = sources.slice(start, start + batchSize);
    const batchResults = await Promise.all(
      batchSources.map((source) => testSource(source))
    );
    allResults.push(...batchResults);
  }

  // 构造 precomputedVideoInfo
  allResults.forEach((result, index) => {
    const source = sources[index];
    const sourceKey = `${source.source}-${source.id}`;
    if (result) {
      newVideoInfoMap.set(sourceKey, result.testResult);
    }
  });

  // 只保留测速成功的
  const successfulResults = allResults.filter(Boolean) as Array<{
    source: SearchResult;
    testResult: {
      quality: string;
      loadSpeed: string;
      pingTime: number;
      avgSpeed?: number;
      tsSuccessRate?: number;
    };
  }>;

  let bestSource = sources[0];
  let sortedAvailableSources = [...availableSources];

  if (successfulResults.length === 0) {
    console.warn('所有播放源测速都失败，使用第一个播放源');
    return {
      bestSource,
      precomputedVideoInfo: newVideoInfoMap,
      sortedAvailableSources,
    };
  }

  // 统计最大速度和延迟区间
  const validSpeeds = successfulResults
    .map((r) => r.testResult.avgSpeed || 0)
    .filter((v) => v > 0);
  const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024;
  const validPings = successfulResults
    .map((r) => r.testResult.pingTime)
    .filter((p) => p > 0);
  const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
  const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

  // 计算综合评分
  const resultsWithScore = successfulResults.map((result) => {
    // TS分片成功率低于0.8的直接降权
    const tsRate = typeof result.testResult.tsSuccessRate === 'number'
      ? result.testResult.tsSuccessRate
      : 1;
    const tsPenalty = tsRate < 0.8 ? 0.5 : 1;
    let score = calculateSourceScore(
      result.testResult,
      maxSpeed,
      minPing,
      maxPing
    );
    score = score * tsPenalty;
    return {
      ...result,
      score,
      tsSuccessRate: tsRate,
    };
  });

  // 按综合评分排序
  resultsWithScore.sort((a, b) => b.score - a.score);

  // 打印排序
  console.log('播放源评分排序结果:');
  resultsWithScore.forEach((result, index) => {
    console.log(
      `${index + 1}. ${result.source.source_name
      } - 评分: ${result.score.toFixed(2)} (${result.testResult.quality}, ${result.testResult.loadSpeed
      }, ${result.testResult.pingTime}ms, TS成功率:${(result.tsSuccessRate * 100).toFixed(0)}%)`
    );
  });

  // 优先排序availableSources
  const successSources = resultsWithScore.map((r) => r.source);
  const otherSources = availableSources.filter((s) => !successSources.includes(s));
  sortedAvailableSources = [...successSources, ...otherSources];

  // 播放成功重置逻辑：如果最佳源的TS成功率低于0.5，且有其他源TS成功率高的，换用下一个
  let best = resultsWithScore[0];
  if (best.tsSuccessRate < 0.5 && resultsWithScore.length > 1) {
    const next = resultsWithScore.find((r) => r.tsSuccessRate >= 0.8);
    if (next) {
      console.warn(
        `最佳源TS分片成功率过低(${(best.tsSuccessRate * 100).toFixed(0)}%)，切换为${next.source.source_name}`
      );
      best = next;
    }
  }

  bestSource = best.source;

  return {
    bestSource,
    precomputedVideoInfo: newVideoInfoMap,
    sortedAvailableSources,
  };
};
