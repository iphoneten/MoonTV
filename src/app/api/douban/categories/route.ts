import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { DoubanItem, DoubanResult } from '@/lib/types';

interface DoubanCategoryApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

interface IQIYIItem {
  entity_id: number;
  date: {
    day: number;
    month: number;
    year: number;
  },
  image_cover: string;
  title: string;
  display_name: string;
  dq_updatestatus: string;
}

interface BilibiliItem {
  cover: string;
  media_id: number;
  title: string;
  score: string;
}

async function fetchDoubanData(
  url: string
): Promise<DoubanCategoryApiResponse> {
  // 添加超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

  // 设置请求选项，包括信号和头部
  const fetchOptions = {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Referer: 'https://movie.douban.com/',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://movie.douban.com',
    },
  };

  try {
    // 尝试直接访问豆瓣API
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function getIQIYIDataChild() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
  const fetchOptions = {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
    },
  };
  try {
    const url = 'https://mesh.if.iqiyi.com/portal/lw/character/child?source=qbb_child_character_card&deviceId=abcdefghijklmnopqrstuvwxyz12345678&uid=1'
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const jsonData = await response.json();
    return jsonData;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function getBilibiliChild(page: number) {
  const pageSize = page + 1;
  const controller = new AbortController();

  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
  const fetchOptions = {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
    },
  };

  try {
    let url = `https://api.bilibili.com/pgc/season/index/result?style_id=10027&order=1&page=${pageSize}&season_type=4&pagesize=50&type=1`;
    if (process.env.NODE_ENV !== 'development') {
      url = `https://tv-api-black.vercel.app/api/bilibili?type=child&coursor=${pageSize}`;
    }
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const jsonData = await response.json();
    return jsonData;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export const runtime = 'edge';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // 获取参数
  const kind = searchParams.get('kind') || 'movie';
  const category = searchParams.get('category');
  const type = searchParams.get('type');
  const pageLimit = parseInt(searchParams.get('limit') || '20');
  const pageStart = parseInt(searchParams.get('start') || '0');

  // 验证参数
  if (!kind || !category || !type) {
    return NextResponse.json(
      { error: '缺少必要参数: kind 或 category 或 type' },
      { status: 400 }
    );
  }

  if (!['tv', 'movie'].includes(kind)) {
    return NextResponse.json(
      { error: 'kind 参数必须是 tv 或 movie' },
      { status: 400 }
    );
  }

  if (pageLimit < 1 || pageLimit > 100) {
    return NextResponse.json(
      { error: 'pageSize 必须在 1-100 之间' },
      { status: 400 }
    );
  }

  if (pageStart < 0) {
    return NextResponse.json(
      { error: 'pageStart 不能小于 0' },
      { status: 400 }
    );
  }

  const target = `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${category}&type=${type}`;
  try {
    // 调用豆瓣 API
    let list: DoubanItem[]
    if (category === 'show') {
      if (type === 'show') {
        const jsonData = await getBilibiliChild((pageStart / pageLimit));
        const videos = jsonData.data.list;
        list = videos.map((item: BilibiliItem) => ({
          id: item.media_id,
          title: item.title,
          poster: item.cover,
          rate: item.score,
          year: '',
        }))
      } else if (type === 'show_foreign') {
        const jsonData = await getIQIYIDataChild();
        const videos = jsonData.data.video;
        list = videos.map((item: IQIYIItem) => ({
          id: item.entity_id,
          title: item.title,
          poster: item.image_cover,
          rate: '',
          year: item.date.year,
        }))
      } else {
        const doubanData = await fetchDoubanData(target);
        // 转换数据格式
        list = doubanData.items.map((item) => ({
          id: item.id,
          title: item.title,
          poster: item.pic?.normal || item.pic?.large || '',
          rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
          year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
        }));
      }
    } else {
      const doubanData = await fetchDoubanData(target);
      // 转换数据格式
      list = doubanData.items.map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.pic?.normal || item.pic?.large || '',
        rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
        year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
      }));
    }


    const response: DoubanResult = {
      code: 200,
      message: '获取成功',
      list: list,
    };

    const cacheTime = await getCacheTime();
    const headers = {
      'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
      'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
    }
    return NextResponse.json(response, {
      headers: headers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: '获取豆瓣数据失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
