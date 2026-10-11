// Google sign-in through Firebase. The web config comes from the VITE_FIREBASE_*
// variables in .env (see README); it is public by design, so it ships in the bundle.
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';

const env = import.meta.env;
// Without a config (local development with DEV_USER_EMAIL), sign-in is simply off.
export const auth = env.VITE_FIREBASE_API_KEY
  ? getAuth(
      initializeApp({
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        appId: env.VITE_FIREBASE_APP_ID,
      }),
    )
  : null;
const noConfig = () => Promise.reject(new Error('Sign-in is not configured: set the VITE_FIREBASE_* values in .env.'));

// A popup works on iPhone Safari, where redirect sign-in is blocked by storage partitioning.
// From the home-screen app, if iOS refuses the popup we fall back to a redirect.
const POPUP_REFUSED = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'];
export async function signIn() {
  if (!auth) return noConfig();
  try {
    return await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    if (POPUP_REFUSED.includes((e as { code?: string })?.code ?? '')) return signInWithRedirect(auth, new GoogleAuthProvider());
    throw e;
  }
}
// Finishes a redirect sign-in, if one is in progress.
if (auth) getRedirectResult(auth).catch(() => {});
export const logOut = () => (auth ? signOut(auth) : Promise.resolve());
export function watchUser(cb: (u: User | null) => void): () => void {
  if (auth) return onAuthStateChanged(auth, cb);
  cb(null);
  return () => {};
}
