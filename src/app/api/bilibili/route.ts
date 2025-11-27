/* eslint-disable no-console */

import { NextResponse } from "next/server";

import { BilibiliResult, DoubanItem } from "@/lib/types";

export const runtime = 'edge';

interface bilibiliData {
  card_style: string;
  episode_id: string;
  title: string;
  cover: string;
  sub_items: bilibiliData[];
  rating: string;
  season_id: string;
}

const fetchGuoMan = async (coursor: number, type?: string) => {
  // 添加超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  let url = `https://tv-api-black.vercel.app/api/bilibili?coursor=${coursor}`;
  if (type !== undefined) {
    url = `https://tv-api-black.vercel.app/api/bilibili?type=${type}&coursor=${coursor}`;
  }
  if (process.env.NODE_ENV === 'development') {
    url = `https://api.bilibili.com/pgc/page/web/v3/feed?name=guochuang&coursor=${coursor}}`;
    if (type !== undefined) {
      if (type === 'child') {
        const page = coursor + 1;
        url = `https://api.bilibili.com/pgc/season/index/result?style_id=10027&order=1&page=${page}&season_type=4&pagesize=50&type=1`
      } else {
        url = `https://api.bilibili.com/pgc/page/web/feed?name=${type}&coursor=${coursor}&new_cursor_status=true`;
      }
    }
  }
  console.log('fetch url:', url);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Referer: 'https://www.bilibili.com/',
        Origin: 'https://www.bilibili.com',
        Accept: 'application/json, text/plain, */*',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    clearTimeout(timeoutId);
    const data = await response.json();
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const coursor = searchParams.get('coursor') || 0;
  const type = searchParams.get('type') || undefined;
  console.log('bilibili called: ', request.url, 'coursor:', coursor, 'type:', type);
  try {
    const jsonData = await fetchGuoMan(Number(coursor), type);
    const code = jsonData.code
    const data = jsonData.data
    if (code !== 0) {
      return NextResponse.json({ error: 'Failed to fetch data' }, { status: 400 });
    }

    const cour = data.coursor
    const has_next = data.has_next
    const items = data.items
    const tmpList: DoubanItem[] = []
    console.log('coursor:', cour);
    if (type === 'movie' || type === 'tv') {
      items.forEach((item: bilibiliData) => {
        const tmp: DoubanItem = {
          id: item.episode_id,
          title: item.title,
          poster: item.cover,
          rate: '',
          year: ''
        }
        tmpList.push(tmp)
      })
    }

    items.forEach((item: bilibiliData) => {
      const subitems = item.sub_items || []
      subitems.forEach((subitem: bilibiliData) => {
        if (subitem.card_style === 'v_card') {
          const tmp: DoubanItem = {
            id: subitem.episode_id,
            title: subitem.title,
            poster: subitem.cover,
            rate: subitem.rating,
            year: ''
          }
          tmpList.push(tmp)
        }
        if (subitem.card_style === 'rank') {
          const subsubitems = subitem.sub_items
          subsubitems.forEach((subsubitem: bilibiliData) => {
            if (subsubitem.card_style === 'v_card') {
              const tmp: DoubanItem = {
                id: subsubitem.season_id,
                title: subsubitem.title,
                poster: subsubitem.cover,
                rate: subsubitem.rating,
                year: ''
              }
              tmpList.push(tmp)
            }
          })
        }
      })
    })

    const seenTitles = new Set<string>();
    const uniqueTmpList = tmpList.filter(item => {
      if (seenTitles.has(item.title)) return false;
      seenTitles.add(item.title);
      return true;
    });

    // console.log('uniqueTmpList: ', uniqueTmpList);
    const result: BilibiliResult = {
      coursor: cour,
      has_next: has_next,
      list: uniqueTmpList
    }
    const headers = {
      'Cache-Control': 'no-store'
    };
    return NextResponse.json(result, { status: 200, headers });
  } catch (error) {
    console.error('Error fetching data:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}