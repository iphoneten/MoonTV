'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { DoubanItem } from "@/lib/types";

import PageLayout from "@/components/PageLayout";
import VideoCard from "@/components/VideoCard";

const GuomanPageClient = () => {
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [data, setData] = useState<DoubanItem[]>([]);
  const observer = useRef<IntersectionObserver | null>(null);
  const cousourRef = useRef(0);

  const getData = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const url = `/api/bilibili?coursor=${cousourRef.current}`;
      const respose = await fetch(url);
      if (respose.status !== 200) {
        throw new Error(`HTTP error! Status: ${respose.status}`);
      }
      const data = await respose.json();
      const { list, has_next, coursor } = data;
      setData(preData => [...preData, ...list]);
      setHasMore(has_next);
      setLoading(false);
      cousourRef.current = coursor;
    } catch (error) {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    getData();
  }, [getData]);

  const lastElementRef = useCallback((node: HTMLDivElement | null) => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        getData();
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, hasMore, getData]);

  return (
    <PageLayout activePath='/bilibili/guoman'>
      <div className='max-w-[95%] mx-auto mt-8 overflow-visible'>
        {/* 内容网格 */}
        <div className='grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fit,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'>
          {
            data.map((item, index) => {
              if (index === data.length - 1) {
                return (
                  <div key={`${item.title}-${index}`} ref={lastElementRef} className='w-full'>
                    <VideoCard
                      from='douban'
                      title={item.title}
                      poster={item.poster}
                      douban_id={item.id}
                      rate={item.rate}
                      year={item.year}
                    // type={type === 'movie' ? 'movie' : ''} // 电影类型严格控制，tv 不控
                    />
                  </div>
                )
              } else {
                return (
                  <div key={`${item.title}-${index}`} className='w-full'>
                    <VideoCard
                      from='douban'
                      title={item.title}
                      poster={item.poster}
                      douban_id={item.id}
                      rate={item.rate}
                      year={item.year}
                    // type={type === 'movie' ? 'movie' : ''} // 电影类型严格控制，tv 不控
                    />
                  </div>
                )
              }
            })
          }
        </div>
        <div className="text-center mt-4 mb-8">
          {loading && <div>加载中...</div>}
          {!hasMore && !loading && <div>没有更多内容了</div>}
        </div>
      </div>
    </PageLayout>
  )
}

export default function GuoManPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <GuomanPageClient />
    </Suspense>
  );
}