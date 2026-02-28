/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';
import Hls, { HlsConfig } from 'hls.js';

function filterAdsFromM3U81(m3u8Content: string): string {
  if (!m3u8Content) return '';

  // 按行分割M3U8内容
  const lines = m3u8Content.split('\n');
  const filteredLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 只过滤#EXT-X-DISCONTINUITY标识
    if (!line.includes('#EXT-X-DISCONTINUITY')) {
      filteredLines.push(line);
    }
  }

  return filteredLines.join('\n');
}

function filterAdsFromM3U8(m3u8Content: string, originalUrl: string): string {
  if (!m3u8Content) return '';

  const lines = m3u8Content.split('\n');
  const filteredLines: string[] = [];
  const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);

  // 【扩展黑名单】涵盖更多常见的移动端和网页端广告标识
  const AD_BLACKLIST = [
    'pangolin', 'gdtimg', 'union-ads', 'ad-content', 'adv_content',
    'analysis', 'pangle', 'byteimg', 'dsp', 'mads', 'ad-sdk',
    'ads-video', 'advertisement', 'volcengine', 'toponad'
  ];

  // 【广告标签黑名单】
  const AD_TAGS = [
    '#EXT-X-CUE-OUT',    // 标记广告开始
    '#EXT-X-CUE-IN',     // 标记广告结束
    '#EXT-X-AD-BEGIN',
    '#EXT-X-AD-END',
    '#EXT-OATCLS-SCTE35', // SCTE-35 广告标记
    '#EXT-X-CUE-OUT-CONT' // 广告持续
  ];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // 1. 过滤广告相关的特定标签
    if (AD_TAGS.some(tag => line.includes(tag))) {
      continue;
    }

    // 2. 依然保留对不连续标识的过滤，这是大多数广告插播的基础
    if (line.includes('#EXT-X-DISCONTINUITY')) {
      continue;
    }

    // 3. 精确过滤黑名单路径
    const isHitBlacklist = AD_BLACKLIST.some(key => line.toLowerCase().includes(key));
    if (isHitBlacklist) {
      if (line.startsWith('#EXTINF')) {
        // 如果当前行是时长信息且命中黑名单，跳过该行及其后的分片地址
        i++;
      }
      continue;
    }

    // 4. 路径补全（保持原有逻辑，确保相对路径可用）
    if (!line.startsWith('#') && !line.startsWith('http')) {
      try {
        line = new URL(line, baseUrl).href;
      } catch (e) {
        // 转换失败则保留原样
      }
    }

    filteredLines.push(line);
  }

  // 安全检查：如果过滤后剩下的行数太少（说明误杀了），则返回原内容
  // 阈值设为 5 行（HLS 头部加少量分片）
  if (filteredLines.length < 5) {
    return m3u8Content;
  }

  return filteredLines.join('\n');
}

// 3. 自定义 Hls.js Loader 类
class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
  constructor(config: HlsConfig) {
    super(config);
    const load = this.load.bind(this);

    this.load = function (context: any, config: any, callbacks: any) {
      if (context.type === 'manifest' || context.type === 'level') {
        const onSuccess = callbacks.onSuccess;
        callbacks.onSuccess = function (response: any, stats: any, ctx: any) {
          if (response.data && typeof response.data === 'string') {
            // 在这里调用过滤函数，并传入 context.url
            response.data = filterAdsFromM3U8(response.data, context.url);
          }
          onSuccess(response, stats, ctx, null);
        };
      }
      load(context, config, callbacks);
    };
  }
}

// 4. 实例化时的配置 - 提供最优的性能和稳定性平衡
export const getHlsConfig = (isBlockAd: boolean) => ({
  debug: false,
  enableWorker: true, // 开启 Web Worker 解析，减轻主线程压力
  lowLatencyMode: false, // 电影流不需要超低延迟，关闭以换取更高缓存稳定性

  // ABR (自动码率选择) 逻辑
  abrEwmaDefaultEstimate: 5000000, // 初始带宽估算设为 5Mbps (约 625KB/s)，优先加载高清
  testBandwidth: true,

  // 极佳的缓存预加载策略
  maxBufferLength: 60, // 最大正向缓存 60s
  maxMaxBufferLength: 300, // 允许缓存随着播放自动增长到 300s
  backBufferLength: 60, // 保留 60s 后向缓存，方便拖进度重看
  maxBufferSize: 200 * 1024 * 1024, // 允许占用 200MB 内存缓存

  // 极强纠错与时间轴同步逻辑 (针对去广告后的空隙)
  maxBufferHole: 0.5, // 允许并自动跳过 0.5s 的空洞
  nudgeOffset: 0.1, // 遇到卡顿尝试微调 0.1s
  nudgeMaxRetry: 20, // 最多尝试 20 次微调
  skipPdtOnSegmentSymbolic: true,

  // 渲染优化
  enableSoftwareAES: true, // 开启软件 AES 解密，增加某些源的兼容性

  // 激进的重试策略 (应对不稳定的第三方切片源)
  manifestLoadingMaxRetry: 5,
  levelLoadingMaxRetry: 5,
  fragLoadingMaxRetry: 5, // 分片加载失败最多自动重试 5 次
  fragLoadingRetryDelay: 1000, // 每次重试间隔 1s

  // 根据开关决定是否加载去广告 Loader
  loader: isBlockAd ? CustomHlsJsLoader : Hls.DefaultConfig.loader,
});