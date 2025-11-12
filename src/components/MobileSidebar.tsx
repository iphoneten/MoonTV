'use client';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { createPortal } from 'react-dom';


const menuItems = [
  { label: '动漫', href: '/bilibili/guoman' },
  { label: '电视剧', href: '/bilibili/tv' },
  { label: '电影', href: '/bilibili/movies' },
];

export const MobileSidebar = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* 菜单按钮 */}
      <button
        onClick={() => setOpen(true)}
        className="p-2 text-gray-700 dark:text-gray-200"
        aria-label="打开菜单"
      >
        <Menu size={22} />
      </button>

      {/* 半透明背景 */}
      {open && (
        <div
          className="fixed inset-0 bg-black z-40 opacity-50"
          onClick={() => setOpen(false)}
        />
      )}

      {/* 侧滑栏 */}
      {open && createPortal(
        <div
          className="fixed top-0 left-0 z-[9999] h-screen w-64 bg-white shadow-xl transform transition-transform duration-300 ease-in-out translate-x-0"
        >
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="text-xl font-bold text-gray-900 dark:text-gray-100"
            >
              B站来源
            </Link>
            <button onClick={() => setOpen(false)} aria-label="关闭菜单">
              <X size={22} className="text-gray-700 dark:text-gray-200" />
            </button>
          </div>

          <nav className="flex flex-col p-4 space-y-3">
            {menuItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="text-gray-700 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400 transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* <div className="absolute bottom-4 left-4">
            <ThemeToggle />
          </div> */}
        </div>,
        document.body
      )}
    </>
  );
};