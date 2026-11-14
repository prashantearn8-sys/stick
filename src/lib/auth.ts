import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  collection,
  query,
  where,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Ensure Firebase Auth persists the signed-in user across browser sessions and page reloads
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('Could not set browserLocalPersistence:', err);
});

const STORAGE_TOKEN_KEY = 'clearslate_google_access_token_v1';
const STORAGE_USER_KEY = 'clearslate_remembered_user_v1';

export interface RememberedUserInfo {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

function loadStoredAccessToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveStoredAccessToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(STORAGE_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors in restricted environments
  }
}

export function getRememberedUser(): RememberedUserInfo | null {
  try {
    const raw = localStorage.getItem(STORAGE_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.uid === 'string') {
      return parsed as RememberedUserInfo;
    }
    return null;
  } catch {
    return null;
  }
}

function saveRememberedUser(user: User | null): void {
  try {
    if (user) {
      const info: RememberedUserInfo = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
      };
      localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(info));
    } else {
      localStorage.removeItem(STORAGE_USER_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

// Validate connection to Firestore on boot per firebase-integration-rpc skill
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface CloudRestorationJob {
  id: string;
  ownerId: string;
  fileName: string;
  source: 'local' | 'drive';
  width: number;
  height: number;
  regionCount: number;
  watermarkType: string;
  restorationMethod: string;
  status: 'detected' | 'restored' | 'exported_drive';
  driveFileId?: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

const ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;
const MAX_FILENAME_LEN = 255;
const MAX_WATERMARK_TYPE_LEN = 120;
const MAX_METHOD_LEN = 120;

export function sanitizeId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  return ID_PATTERN.test(cleaned) ? cleaned : `job_${Date.now()}`;
}

export function subscribeToUserJobs(
  userId: string,
  onUpdate: (jobs: CloudRestorationJob[]) => void
) {
  const path = 'restorationJobs';
  const q = query(collection(db, path), where('ownerId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const records: CloudRestorationJob[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<CloudRestorationJob, 'id'>),
      }));
      onUpdate(records);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function saveRestorationJobToFirestore(params: {
  jobId: string;
  fileName: string;
  source: 'local' | 'drive';
  width: number;
  height: number;
  regionCount: number;
  watermarkType: string;
  restorationMethod: string;
  status: 'detected' | 'restored' | 'exported_drive';
  driveFileId?: string;
}) {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  const safeJobId = sanitizeId(params.jobId);
  const path = `restorationJobs/${safeJobId}`;
  const docRef = doc(db, 'restorationJobs', safeJobId);

  const safeRegionCount = Math.max(
    0,
    Math.min(500, Math.round(params.regionCount || 0))
  );
  const safeWatermarkType = (
    params.watermarkType || 'Detected Watermark'
  ).slice(0, MAX_WATERMARK_TYPE_LEN);
  const safeMethod = (
    params.restorationMethod || 'AI-Guided Content-Aware Inpaint'
  ).slice(0, MAX_METHOD_LEN);

  let existingSnap;
  try {
    existingSnap = await getDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (existingSnap && existingSnap.exists()) {
    const existingData = existingSnap.data();
    // Respect terminal state rule: once exported_drive, do not mutate further
    if (existingData?.status === 'exported_drive') {
      return;
    }

    const updatePayload: Record<string, unknown> = {
      regionCount: safeRegionCount,
      watermarkType: safeWatermarkType,
      restorationMethod: safeMethod,
      status: params.status,
      updatedAt: serverTimestamp(),
    };

    if (params.driveFileId) {
      updatePayload.driveFileId = params.driveFileId.slice(0, 128);
    }

    try {
      await updateDoc(docRef, updatePayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
    return;
  }

  const createPayload: Record<string, unknown> = {
    ownerId: currentUser.uid.slice(0, 128),
    fileName: (params.fileName || 'image.png').slice(0, MAX_FILENAME_LEN),
    source: params.source === 'drive' ? 'drive' : 'local',
    width: Math.max(1, Math.min(16384, Math.round(params.width || 800))),
    height: Math.max(1, Math.min(16384, Math.round(params.height || 600))),
    regionCount: safeRegionCount,
    watermarkType: safeWatermarkType,
    restorationMethod: safeMethod,
    status: params.status,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (params.driveFileId) {
    createPayload.driveFileId = params.driveFileId.slice(0, 128);
  }

  try {
    await setDoc(docRef, createPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function markJobExportedToDriveInFirestore(
  jobId: string,
  driveFileId: string,
  fallbackMeta?: {
    fileName: string;
    source: 'local' | 'drive';
    width: number;
    height: number;
    regionCount: number;
  }
) {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  const safeJobId = sanitizeId(jobId);
  await saveRestorationJobToFirestore({
    jobId: safeJobId,
    fileName: fallbackMeta?.fileName || 'image.png',
    source: fallbackMeta?.source || 'local',
    width: fallbackMeta?.width || 800,
    height: fallbackMeta?.height || 600,
    regionCount: fallbackMeta?.regionCount ?? 1,
    watermarkType: 'Exported to Google Drive',
    restorationMethod: 'Exported Image',
    status: 'exported_drive',
    driveFileId: driveFileId.slice(0, 128),
  });
}

export async function deleteRestorationJobFromFirestore(jobId: string) {
  const currentUser = auth.currentUser;
  if (!currentUser) return;
  const safeJobId = sanitizeId(jobId);
  const path = `restorationJobs/${safeJobId}`;
  try {
    await deleteDoc(doc(db, 'restorationJobs', safeJobId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

let isSigningIn = false;
let cachedAccessToken: string | null = loadStoredAccessToken();

export const clearCachedAccessToken = () => {
  cachedAccessToken = null;
  saveStoredAccessToken(null);
};

export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      saveRememberedUser(user);
      if (!cachedAccessToken) {
        cachedAccessToken = loadStoredAccessToken();
      }
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      saveStoredAccessToken(null);
      saveRememberedUser(null);
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
    await setPersistence(auth, browserLocalPersistence);
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      saveRememberedUser(result.user);
      return null;
    }

    cachedAccessToken = credential.accessToken;
    saveStoredAccessToken(cachedAccessToken);
    saveRememberedUser(result.user);
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
  if (!cachedAccessToken) {
    cachedAccessToken = loadStoredAccessToken();
  }
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  saveStoredAccessToken(null);
  saveRememberedUser(null);
};
