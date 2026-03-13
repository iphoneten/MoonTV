'use client';

import { createContext, ReactNode, useContext } from 'react';

const SiteContext = createContext<{ siteName: string }>({
  // 默认值
  siteName: 'MoonTV',
});

export const useSite = () => useContext(SiteContext);

export function SiteProvider({
  children,
  siteName,
}: {
  children: ReactNode;
  siteName: string;
}) {
  return (
    <SiteContext.Provider value={{ siteName }}>
      {children}
    </SiteContext.Provider>
  );
}
