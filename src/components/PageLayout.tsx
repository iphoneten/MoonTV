'use client';

import { useEffect, useState } from 'react';

import { BackButton } from './BackButton';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import Sidebar from './Sidebar';
import TopNav from './TopNav';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
}

const PageLayout = ({ children, activePath = '/' }: PageLayoutProps) => {
  const [isTv, setIsTv] = useState(false);

  useEffect(() => {
    let nextIsTv = false;
    let shouldPersist: '1' | '0' | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const tvParam = params.get('tv');
      if (tvParam === '1') {
        nextIsTv = true;
        shouldPersist = '1';
      }
      if (tvParam === '0') {
        nextIsTv = false;
        shouldPersist = '0';
      }

      if (tvParam !== '1' && tvParam !== '0') {
        const stored = window.localStorage?.getItem('tvMode');
        if (stored === '1') {
          nextIsTv = true;
        }
        if (stored === '0') {
          nextIsTv = false;
        }

        if (stored !== '1' && stored !== '0') {
          const ua = window.navigator.userAgent || '';
          nextIsTv = /Android TV|AFT|BRAVIA|GoogleTV|SMART-TV|SmartTV|SMARTTV|Tizen|WebOS/i.test(
            ua
          );
          if (nextIsTv) {
            shouldPersist = '1';
          }
        }
      }
    } catch {
      // ignore
    }

    setIsTv(nextIsTv);

    try {
      if (shouldPersist) {
        window.localStorage?.setItem('tvMode', shouldPersist);
      }
    } catch {
      // ignore
    }

    if (nextIsTv) {
      document.documentElement.dataset.tv = 'true';
    } else {
      delete document.documentElement.dataset.tv;
    }
  }, []);

  const routeItems = [
    '/play',
    '/admin',
    '/bilibili/tv',
    '/bilibili/guoman',
    '/bilibili/movies',
  ]
  const isHideBottomNav = routeItems.includes(activePath);
  return (
    <div className='w-full min-h-screen'>
      {isTv && <TopNav activePath={activePath} />}
      {/* 移动端头部 */}
      {!isTv && (
        <div className="fixed top-0 left-0 w-full z-[9999]">
          <MobileHeader showBackButton={routeItems.includes(activePath)} />
        </div>
      )}

      {/* 主要布局容器 */}
      <div
        className={
          isTv
            ? 'flex flex-col w-full min-h-screen'
            : 'flex md:grid md:grid-cols-[auto_1fr] w-full min-h-screen md:min-h-auto'
        }
      >
        {/* 侧边栏 - 桌面端显示，移动端隐藏 */}
        {!isTv && (
          <div className='hidden md:block'>
            <Sidebar activePath={activePath} />
          </div>
        )}

        {/* 主内容区域 */}
        <div className='relative min-w-0 flex-1 transition-all duration-300'>
          {/* 桌面端左上角返回按钮 */}
          {['/play'].includes(activePath) && (
            <div className='absolute top-3 left-1 z-20 hidden md:flex'>
              <BackButton />
            </div>
          )}

          {/* 桌面端顶部按钮 */}
          {!isTv && (
            <div className='absolute top-2 right-4 z-20 hidden md:flex items-center gap-2'>
              <ThemeToggle />
              <UserMenu />
            </div>
          )}

          {/* 主内容 */}
          <main
            id="page-scroll-container"
            className={`flex-1 md:min-h-0 mb-14 md:mb-0 overflow-y-auto ${isTv ? 'pt-20' : 'pt-16'
              }`}
            style={{
              height: isTv ? 'calc(100vh - 64px)' : '100vh',
              paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom))',
            }}
          >
            {children}
          </main>
        </div>
      </div>

      {/* 移动端底部导航 */}
      {!isTv && (
        <div className='md:hidden'>
          {!isHideBottomNav && (<MobileBottomNav activePath={activePath} />)}
        </div>
      )}
    </div>
  );
};

export default PageLayout;
