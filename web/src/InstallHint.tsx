// iPhone only: a one-time hint to add Fitbook to the Home Screen, since iOS has no
// install prompt. Works from Safari and Chrome (iOS 16.4+); hidden in the home-screen
// app itself, in other in-app browsers, and once dismissed.
import { useEffect, useState } from 'preact/hooks';

const KEY = 'fitbook:install-hint-dismissed';

// Which browser's Share button to point at, or null for no hint.
function browser(): 'safari' | 'chrome' | null {
  const ua = navigator.userAgent;
  if (!/iPhone|iPod/.test(ua)) return null;
  if (/CriOS/.test(ua)) return 'chrome';
  if (/Safari/.test(ua) && !/FxiOS|EdgiOS|OPiOS|GSA|FBAN|FBAV|Instagram/.test(ua)) return 'safari';
  return null;
}

function shouldShow(): boolean {
  const installed = (navigator as { standalone?: boolean }).standalone || matchMedia('(display-mode: standalone)').matches;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(KEY) === '1';
  } catch {}
  return !!browser() && !installed && !dismissed;
}

export function InstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!shouldShow()) return;
    const t = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
    setShow(false);
  };
  return (
    <div class="install-hint" role="dialog" aria-label="Add Fitbook to your Home Screen">
      <img src="/apple-touch-icon.png?v=3" alt="" width="40" height="40" />
      <div class="ih-text">
        <strong>Get the Fitbook app</strong>
        <span>
          Tap{' '}
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-label="Share"
          >
            <path d="M12 3v12M8 7l4-4 4 4" />
            <path d="M6 11H5v10h14V11h-1" />
          </svg>{' '}
          {browser() === 'chrome' ? 'at the top right' : 'in Safari'}, then <b>Add to Home Screen</b>.
        </span>
      </div>
      <button class="ih-close" onClick={dismiss} aria-label="Dismiss">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
