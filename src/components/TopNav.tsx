'use client';

import { Cat, Cctv, Clover, Film, Home, Search, Star, Tv, Video } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import useUIStore from '@/store/UIStore';

import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface TopNavProps {
  activePath?: string;
}

interface MenuItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
}

const TopNav = ({ activePath = '/' }: TopNavProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(activePath);
  const { topNavLast, setTopNavLast } = useUIStore();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([
    { icon: Film, label: '电影', href: '/douban?type=movie' },
    { icon: Tv, label: '剧集', href: '/douban?type=tv' },
    { icon: Clover, label: '综艺', href: '/douban?type=show' },
    { icon: Cat, label: 'B站-动漫', href: '/bilibili/guoman' },
    { icon: Cctv, label: 'B站-电视剧', href: '/bilibili/tv' },
    { icon: Video, label: 'B站-电影', href: '/bilibili/movies' },
  ]);

  useEffect(() => {
    const fullPath = searchParams.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname;
    setActive(fullPath);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!activePath) return;
    setTopNavLast(activePath);
  }, [activePath, setTopNavLast]);

  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    if (runtimeConfig?.CUSTOM_CATEGORIES) {
      setMenuItems((prevItems) => [
        ...prevItems,
        ...runtimeConfig.CUSTOM_CATEGORIES.map((category: any) => ({
          icon: Star,
          label: category.name || category.query,
          href: `/douban?type=${category.type}&tag=${category.query}${category.name ? `&name=${category.name}` : ''
            }&custom=true`,
        })),
      ]);
    }
  }, []);

  return (
    <header
      data-sidebar
      data-tv-nav='top'
      className='fixed top-0 left-0 w-full z-[9998] bg-white/70 backdrop-blur-xl border-b border-gray-200/50 shadow-sm dark:bg-gray-900/70 dark:border-gray-700/50'
    >
      <div className='h-16 px-6 flex items-center gap-4'>
        <nav className='flex-1 overflow-x-auto scrollbar-hide'>
          <div className='flex items-center gap-2 min-w-max'>
            <Link
              href='/'
              onClick={() => setActive('/')}
              onFocus={() => {
                setActive('/');
                setTopNavLast('/');
              }}
              data-active={active === '/'}
              data-tv-focusable='true'
              data-tv-entry={topNavLast === '/' ? 'true' : undefined}
              className='tv-focusable inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-100/60 hover:text-green-600 focus-visible:bg-green-500/20 focus-visible:text-green-700 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 font-medium transition-colors dark:text-gray-300 dark:hover:text-green-400 dark:focus-visible:bg-green-500/10 dark:focus-visible:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400'
            >
              <Home className='h-4 w-4' />
              首页
            </Link>
            <button
              type='button'
              onClick={(e) => {
                e.preventDefault();
                router.push('/search');
                setActive('/search');
              }}
              onFocus={() => {
                setActive('/search');
                setTopNavLast('/search');
              }}
              data-active={active === '/search'}
              data-tv-focusable='true'
              data-tv-entry={topNavLast === '/search' ? 'true' : undefined}
              className='tv-focusable inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-100/60 hover:text-green-600 focus-visible:bg-green-500/20 focus-visible:text-green-700 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 font-medium transition-colors dark:text-gray-300 dark:hover:text-green-400 dark:focus-visible:bg-green-500/10 dark:focus-visible:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400'
            >
              <Search className='h-4 w-4' />
              搜索
            </button>
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onFocus={() => {
                    setActive(item.href);
                    setTopNavLast(item.href);
                  }}
                  data-active={active === item.href}
                  data-tv-focusable='true'
                  data-tv-entry={topNavLast === item.href ? 'true' : undefined}
                  className='tv-focusable inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-100/60 hover:text-green-600 focus-visible:bg-green-500/20 focus-visible:text-green-700 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 font-medium transition-colors dark:text-gray-300 dark:hover:text-green-400 dark:focus-visible:bg-green-500/10 dark:focus-visible:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400'
                >
                  <Icon className='h-4 w-4 text-gray-500 dark:text-gray-400' />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className='flex items-center gap-2'>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
};

export default TopNav;
