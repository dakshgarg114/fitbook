// App themes: each sets data-theme on <html>; the colours live in style.css.
import type { Theme } from '../../shared/types.ts';

export const THEME_INFO: Record<Theme, { name: string; bar: string; swatch: [string, string, string]; dark: boolean }> = {
  paper: { name: 'Paper', bar: '#fbf8f1', swatch: ['#fbf8f1', '#f2b45c', '#e4567a'], dark: false },
  midnight: { name: 'Midnight', bar: '#13151b', swatch: ['#1b1e27', '#7c6cf2', '#3fc4d8'], dark: true },
  sage: { name: 'Sage', bar: '#f1f4ec', swatch: ['#f1f4ec', '#8cc47e', '#2f8f72'], dark: false },
  dusk: { name: 'Dusk', bar: '#f6f1f8', swatch: ['#f6f1f8', '#c79bf2', '#ef7fa6'], dark: false },
};

const KEY = 'fitbook:theme';

export function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme as Theme | undefined;
  return t && t in THEME_INFO ? t : 'paper';
}

export function applyTheme(theme: Theme) {
  const t = theme in THEME_INFO ? theme : 'paper';
  const root = document.documentElement;
  if (root.dataset.theme === t) return;
  root.dataset.theme = t;
  root.style.colorScheme = THEME_INFO[t].dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_INFO[t].bar);
  try {
    localStorage.setItem(KEY, t);
  } catch {}
}

// Paint the last-used theme before the profile loads, so there's no flash.
export function restoreTheme() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {}
  applyTheme((saved as Theme) ?? 'paper');
}
