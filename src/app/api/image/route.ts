import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  if (!url) {
    return new Response('Missing url', { status: 400 });
  }

  // 基本防护，防止被当成开放代理
  if (!/^https?:\/\/img\d+\.doubanio\.com\//.test(url)) {
    return new Response('Forbidden', { status: 403 });
  }

  const resp = await fetch(url, {
    headers: {
      // 关键：豆瓣防盗链主要看这个
      Referer: 'https://movie.douban.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    },
  });

  if (!resp.ok) {
    return new Response(`Upstream error: ${resp.status}`, {
      status: resp.status,
    });
  }

  const contentType = resp.headers.get('content-type') || 'image/jpeg';
  return new Response(resp.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=15720000, s-maxage=15720000',
      'CDN-Cache-Control': 'public, s-maxage=15720000',
      'Vercel-CDN-Cache-Control': 'public, s-maxage=15720000',
    },
  });
}