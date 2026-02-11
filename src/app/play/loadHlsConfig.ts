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

  // 【关键修改1】大幅精简黑名单，避免误杀。
  // 删掉类似 'cdn', 'hls' 这种正片也会包含的词
  const AD_BLACKLIST = ['pangolin', 'gdtimg', 'union-ads', 'ad-content', 'adv_content', 'analysis'];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // 【关键修改2】保守逻辑：只删除不连续标识。
    // 不再使用 inAdBlock 状态机去批量删除后续行，防止把正片全删了
    if (line.includes('#EXT-X-DISCONTINUITY')) {
      continue;
    }

    // 【关键修改3】精确过滤黑名单
    const isHitBlacklist = AD_BLACKLIST.some(key => line.toLowerCase().includes(key));
    if (isHitBlacklist) {
      if (line.startsWith('#EXTINF')) {
        i++; // 跳过时长和紧随其后的地址
      }
      continue;
    }

    // 【关键修改4】路径补全补丁
    // 必须要补全，否则经过自定义 Loader 后的相对路径会报 404
    if (!line.startsWith('#') && !line.startsWith('http')) {
      try {
        line = new URL(line, baseUrl).href;
      } catch (e) {
        // 转换失败则保留原样
      }
    }

    filteredLines.push(line);
  }

  // 【关键修改5】安全检查：如果过滤后剩下的行数太少（说明误杀了），则返回原内容
  if (filteredLines.length < 5) {
    console.warn('过滤逻辑可能误杀，已恢复原始数据');
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

// 4. 实例化时的配置
export const getHlsConfig = (isBlockAd: boolean) => ({
  debug: false,
  enableWorker: true,
  // 根据开关决定是否加载去广告 Loader
  loader: isBlockAd ? CustomHlsJsLoader : Hls.DefaultConfig.loader,

  // 容错配置：自动跳过删掉广告后留下的微小时间轴空隙
  maxBufferHole: 0.5,
  nudgeOffset: 0.1,
  nudgeMaxRetry: 15,
  skipPdtOnSegmentSymbolic: true,
});