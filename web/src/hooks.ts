import { useEffect, useRef, useState } from 'preact/hooks';

// Keeps the chat exactly the size of the visible area, so the iOS keyboard
// never pushes the page around.
export function useVisualViewport() {
  const [vv, setVv] = useState({ h: window.innerHeight, top: 0 });
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const update = () => setVv({ h: v.height, top: v.offsetTop });
    v.addEventListener('resize', update);
    v.addEventListener('scroll', update);
    update();
    return () => {
      v.removeEventListener('resize', update);
      v.removeEventListener('scroll', update);
    };
  }, []);
  return vv;
}

// The parts of the Web Speech API we use; TypeScript's DOM types don't include it yet.
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: () => void;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

// Voice input through the browser's speech recognition (Chrome, Safari), when it exists.
export function useDictation(onText: (t: string) => void) {
  const W = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const SR = W.SpeechRecognition ?? W.webkitSpeechRecognition;
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    if (!SR) return;
    const r = new SR();
    r.lang = navigator.language || 'en-IN';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) =>
      onText(
        Array.from(e.results)
          .map((x) => x[0].transcript)
          .join(''),
      );
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };
  useEffect(() => () => rec.current?.abort(), []);
  return { supported: !!SR, listening, toggle };
}
