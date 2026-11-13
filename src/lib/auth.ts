import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];

function createDriveAuthProvider() {
  const provider = new GoogleAuthProvider();
  for (const scope of SCOPES) {
    provider.addScope(scope);
  }
  return provider;
}

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token in memory only (never localStorage or sessionStorage).
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    // Create a fresh provider instance per attempt so a previous failed/403 popup state is never reused
    const freshProvider = createDriveAuthProvider();
    const result = await signInWithPopup(
      auth,
      freshProvider,
      browserPopupRedirectResolver
    );
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      return null;
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    const code = error?.code || '';
    if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request'
    ) {
      return null;
    }
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'Sign-in popup was blocked by your browser. Please allow popups for this site and try again.'
      );
    }
    throw new Error(
      error?.message || 'Unable to complete Google sign-in. Please try again.'
    );
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};
