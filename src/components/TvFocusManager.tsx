'use client';

import { useEffect } from 'react';

type Direction = 'left' | 'right' | 'up' | 'down';

const TV_SELECTOR = '[data-tv-focusable="true"]';
const FALLBACK_SELECTOR =
  'a,button,input,select,textarea,[role="button"],[tabindex]:not([tabindex="-1"])';

const isEditable = (el: Element | null) => {
  if (!el) return false;
  const tag = (el as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return (el as HTMLElement).isContentEditable;
};

const isVisible = (el: HTMLElement) => {
  if (!el) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const getFocusable = () => {
  const base = Array.from(document.querySelectorAll<HTMLElement>(FALLBACK_SELECTOR));
  const tv = Array.from(document.querySelectorAll<HTMLElement>(TV_SELECTOR));
  const merged = new Set<HTMLElement>([...tv, ...base]);
  return Array.from(merged).filter(isVisible);
};

const getFocusableIn = (container: Element | null) => {
  if (!container) return [] as HTMLElement[];
  const base = Array.from(container.querySelectorAll<HTMLElement>(FALLBACK_SELECTOR));
  const tv = Array.from(container.querySelectorAll<HTMLElement>(TV_SELECTOR));
  const merged = new Set<HTMLElement>([...tv, ...base]);
  return Array.from(merged).filter(isVisible);
};

const pickEntryTarget = (list: HTMLElement[]) => {
  if (!list.length) return null;
  const explicit = list.find((el) => el.hasAttribute('data-tv-entry'));
  if (explicit) return explicit;
  const sorted = [...list].sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    if (ra.top !== rb.top) return ra.top - rb.top;
    return ra.left - rb.left;
  });
  const inView = sorted.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom >= 0 && r.top <= window.innerHeight;
  });
  return inView[0] || sorted[0] || null;
};

const getCenter = (el: HTMLElement) => {
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
};

const ensureTvFocusableTabIndex = () => {
  const nodes = document.querySelectorAll<HTMLElement>(TV_SELECTOR);
  nodes.forEach((el) => {
    if (!el.hasAttribute('tabindex')) {
      el.tabIndex = 0;
    }
  });
};

const getDirectionFromEvent = (e: KeyboardEvent): Direction | null => {
  const key = e.key;
  const code = e.code;
  const keyCode = e.keyCode;

  if (
    key === 'ArrowLeft' ||
    key === 'Left' ||
    key === 'DPAD_LEFT' ||
    code === 'ArrowLeft' ||
    keyCode === 21
  ) {
    return 'left';
  }

  if (
    key === 'ArrowRight' ||
    key === 'Right' ||
    key === 'DPAD_RIGHT' ||
    code === 'ArrowRight' ||
    keyCode === 22
  ) {
    return 'right';
  }

  if (
    key === 'ArrowUp' ||
    key === 'Up' ||
    key === 'DPAD_UP' ||
    code === 'ArrowUp' ||
    keyCode === 19
  ) {
    return 'up';
  }

  if (
    key === 'ArrowDown' ||
    key === 'Down' ||
    key === 'DPAD_DOWN' ||
    code === 'ArrowDown' ||
    keyCode === 20
  ) {
    return 'down';
  }

  return null;
};

const isEnterKey = (e: KeyboardEvent) => {
  const key = e.key;
  const code = e.code;
  const keyCode = e.keyCode;
  return (
    key === 'Enter' ||
    key === ' ' ||
    key === 'DPAD_CENTER' ||
    code === 'Enter' ||
    code === 'Space' ||
    keyCode === 13 ||
    keyCode === 23 ||
    keyCode === 32 ||
    keyCode === 66
  );
};

const findNext = (current: HTMLElement, direction: Direction, list?: HTMLElement[]) => {
  const currentCenter = getCenter(current);
  const pool = list && list.length ? list : getFocusable();
  const candidates = pool.filter((el) => el !== current);
  const currentRect = current.getBoundingClientRect();
  const alignThreshold =
    direction === 'left' || direction === 'right'
      ? Math.max(12, currentRect.height * 0.6)
      : Math.max(12, currentRect.width * 0.6);

  if (direction === 'up' || direction === 'down') {
    const rowThreshold = Math.max(16, currentRect.height * 0.7);
    const rows: { y: number; items: HTMLElement[] }[] = [];
    const all = pool;

    all.forEach((el) => {
      const { y } = getCenter(el);
      let row = rows.find((r) => Math.abs(r.y - y) <= rowThreshold);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      } else {
        row.y = (row.y * row.items.length + y) / (row.items.length + 1);
      }
      row.items.push(el);
    });

    rows.sort((a, b) => a.y - b.y);
    let currentRowIndex = rows.findIndex((r) => Math.abs(r.y - currentCenter.y) <= rowThreshold);
    if (currentRowIndex === -1) {
      currentRowIndex = rows.reduce((best, r, idx) => {
        const bestDist = Math.abs(rows[best].y - currentCenter.y);
        const dist = Math.abs(r.y - currentCenter.y);
        return dist < bestDist ? idx : best;
      }, 0);
    }

    const nextRowIndex = direction === 'down' ? currentRowIndex + 1 : currentRowIndex - 1;
    const nextRow = rows[nextRowIndex];
    if (nextRow) {
      let best: { el: HTMLElement; score: number } | null = null;
      for (const el of nextRow.items) {
        if (el === current) continue;
        const { x, y } = getCenter(el);
        const dx = Math.abs(x - currentCenter.x);
        const dy = Math.abs(y - currentCenter.y);
        const score = dy + dx * 0.6;
        if (!best || score < best.score) {
          best = { el, score };
        }
      }
      if (best?.el) return best.el;
    }
  }

  const getCandidateList = (requireAligned: boolean) => {
    const filtered: { el: HTMLElement; dx: number; dy: number }[] = [];
    for (const el of candidates) {
      const { x, y } = getCenter(el);
      const dx = x - currentCenter.x;
      const dy = y - currentCenter.y;

      if (direction === 'left' && dx >= -1) continue;
      if (direction === 'right' && dx <= 1) continue;
      if (direction === 'up' && dy >= -1) continue;
      if (direction === 'down' && dy <= 1) continue;

      if (requireAligned) {
        const aligned =
          direction === 'left' || direction === 'right'
            ? Math.abs(dy) <= alignThreshold
            : Math.abs(dx) <= alignThreshold;
        if (!aligned) continue;
      }

      filtered.push({ el, dx, dy });
    }
    return filtered;
  };

  const pickBest = (items: { el: HTMLElement; dx: number; dy: number }[]) => {
    let best: { el: HTMLElement; score: number } | null = null;
    for (const item of items) {
      const primary =
        direction === 'left' || direction === 'right'
          ? Math.abs(item.dx)
          : Math.abs(item.dy);
      const secondary =
        direction === 'left' || direction === 'right'
          ? Math.abs(item.dy)
          : Math.abs(item.dx);
      const score = primary + secondary * 0.8;
      if (!best || score < best.score) {
        best = { el: item.el, score };
      }
    }
    return best?.el || null;
  };

  const alignedCandidates = getCandidateList(true);
  const alignedBest = pickBest(alignedCandidates);
  if (alignedBest) return alignedBest;

  return pickBest(getCandidateList(false));
};

const scrollIfNeeded = (direction: Direction) => {
  const container = document.getElementById('page-scroll-container');
  if (!container) return;
  const amount = Math.round(window.innerHeight * 0.6);
  if (direction === 'down') {
    container.scrollBy({ top: amount, behavior: 'smooth' });
  } else if (direction === 'up') {
    container.scrollBy({ top: -amount, behavior: 'smooth' });
  }
};

export default function TvFocusManager() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;

      if (isEditable(active)) return;

      const sidebar = document.querySelector('[data-sidebar]');
      const isTopNav = !!document.querySelector('[data-tv-nav="top"]');
      const main = document.getElementById('page-scroll-container');
      const sidebarTargets = getFocusableIn(sidebar);
      const mainTargets = getFocusableIn(main);
      const focusable = [...mainTargets, ...sidebarTargets];
      if (!focusable.length) return;

      const direction = getDirectionFromEvent(e);
      if (direction) {
        e.preventDefault();
        const current = active && focusable.includes(active) ? active : focusable[0];
        if (!current) return;

        const inSidebar = !!current.closest('[data-sidebar]');
        const inMain = !!current.closest('#page-scroll-container');

        if (isTopNav) {
          if (direction === 'down' && inSidebar) {
            const target = pickEntryTarget(mainTargets);
            if (target) {
              target.focus({ preventScroll: true });
              target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
            return;
          }

          if (direction === 'up' && inMain) {
            const nextInMain = findNext(current, 'up', mainTargets);
            if (nextInMain) {
              nextInMain.focus({ preventScroll: true });
              nextInMain.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              return;
            }

            const entryInMain = pickEntryTarget(mainTargets);
            if (entryInMain && entryInMain !== current) {
              entryInMain.focus({ preventScroll: true });
              entryInMain.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              return;
            }

            const target = pickEntryTarget(sidebarTargets);
            if (target) {
              target.focus({ preventScroll: true });
              target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
            return;
          }
        } else {
          if (direction === 'right' && inSidebar) {
            const next = findNext(current, 'right', mainTargets);
            const target = next || mainTargets[0];
            if (target) {
              target.focus({ preventScroll: true });
              target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
            return;
          }

          if (direction === 'left' && inMain) {
            const nextInMain = findNext(current, 'left', mainTargets);
            if (nextInMain) {
              nextInMain.focus({ preventScroll: true });
              nextInMain.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              return;
            }

            const nextInSidebar = findNext(current, 'left', sidebarTargets);
            const target = nextInSidebar || sidebarTargets[0];
            if (target) {
              target.focus({ preventScroll: true });
              target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
            return;
          }
        }

        const scopedTargets = inMain
          ? mainTargets
          : inSidebar
            ? sidebarTargets
            : focusable;

        const next = findNext(current, direction, scopedTargets);
        if (next) {
          next.focus({ preventScroll: true });
          next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } else {
          scrollIfNeeded(direction);
        }
        return;
      }

      if (isEnterKey(e)) {
        if (active && (active as HTMLElement).click) {
          e.preventDefault();
          (active as HTMLElement).click();
        }
      }
    };

    const ensureInitialFocus = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body) return;
      const sidebar = document.querySelector('[data-sidebar]');
      const isTopNav = !!document.querySelector('[data-tv-nav="top"]');
      const main = document.getElementById('page-scroll-container');
      const mainTargets = getFocusableIn(main);
      const sidebarTargets = getFocusableIn(sidebar);
      const target = isTopNav
        ? pickEntryTarget(sidebarTargets) || pickEntryTarget(mainTargets)
        : pickEntryTarget(mainTargets) || pickEntryTarget(sidebarTargets);
      if (target) target.focus({ preventScroll: true });
    };

    ensureTvFocusableTabIndex();

    const observer = new MutationObserver(() => {
      ensureTvFocusableTabIndex();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('keydown', onKeyDown, { passive: false });
    const id = window.setTimeout(ensureInitialFocus, 300);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(id);
      observer.disconnect();
    };
  }, []);

  return null;
}
