/// <reference types="vite/client" />
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import { type Status } from "./types";

const env = import.meta.env;
export const previewMode = env.VITE_PREVIEW_MODE === "true";
const firebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY?.trim(),
  projectId: env.VITE_FIREBASE_PROJECT_ID?.trim(),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN?.trim(),
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET?.trim(),
  appId: env.VITE_FIREBASE_APP_ID?.trim(),
};
const configuredApiOrigin = env.VITE_API_ORIGIN?.trim();
export const cloudMode = !previewMode && Boolean(
  env.VITE_CLOUD_MODE === "true" ||
    configuredApiOrigin ||
    Object.values(firebaseOptions).some(Boolean),
);
export const freeMode = cloudMode && env.VITE_DEPLOYMENT_MODE !== "paid";
export const cloudOwnerEmail = env.VITE_OWNER_EMAIL?.trim().toLowerCase() || "";
export let cloudConfigurationError = "";
let auth: Auth | null = null;
let firebaseApp: FirebaseApp | null = null;
let apiOrigin = "";

if (cloudMode) {
  const required = {
    VITE_FIREBASE_API_KEY: firebaseOptions.apiKey,
    VITE_FIREBASE_PROJECT_ID: firebaseOptions.projectId,
    VITE_FIREBASE_AUTH_DOMAIN: firebaseOptions.authDomain,
    VITE_FIREBASE_APP_ID: firebaseOptions.appId,
    ...(!freeMode ? {
      VITE_FIREBASE_STORAGE_BUCKET: firebaseOptions.storageBucket,
      VITE_API_ORIGIN: configuredApiOrigin,
    } : {}),
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    cloudConfigurationError = `Firebase 배포 설정이 필요합니다: ${missing.join(", ")}. Netlify 환경 변수를 등록하고 다시 배포해 주세요.`;
  } else {
    try {
      if (!freeMode) {
        const parsed = new URL(configuredApiOrigin!);
        if (
          parsed.protocol !== "https:" ||
          parsed.username ||
          parsed.password ||
          parsed.search ||
          parsed.hash
        )
          throw new Error(
            "API 주소는 HTTPS여야 하며 인증 정보, 쿼리, 해시를 포함할 수 없습니다.",
          );
        apiOrigin = parsed.toString().replace(/\/+$/, "");
      }
      firebaseApp = initializeApp(firebaseOptions);
      auth = getAuth(firebaseApp);
    } catch (e) {
      cloudConfigurationError = `Firebase 연결 설정을 확인해 주세요. ${e instanceof Error ? e.message : "설정 오류"}`;
    }
  }
}

export function getFirebaseApp() {
  if (cloudConfigurationError) throw new Error(cloudConfigurationError);
  return firebaseApp;
}

export function cloudApiUrl(path: string) {
  if (cloudConfigurationError) throw new Error(cloudConfigurationError);
  if (!cloudMode || freeMode) return `/api${path}`;
  return `${apiOrigin}/api${path}`;
}

export async function readyCloudUser(): Promise<User | null> {
  if (cloudConfigurationError) throw new Error(cloudConfigurationError);
  if (!auth) return null;
  await auth.authStateReady();
  return auth.currentUser;
}

export function hasCloudSession() {
  return Boolean(auth?.currentUser);
}

export function cloudUserError(user: User) {
  if (!user.emailVerified || !user.email)
    return "이메일이 확인된 구글 계정으로 로그인해 주세요.";
  if (cloudOwnerEmail && user.email.toLowerCase() !== cloudOwnerEmail)
    return "이 앱을 사용할 수 있는 본인 구글 계정으로 다시 로그인해 주세요.";
  return "";
}

export function signedOutCloudStatus(authenticationError = ""): Status {
  return {
    mode: "firebase",
    deploymentMode: freeMode ? "free" : "paid",
    user: null,
    googleConfigured: !cloudConfigurationError,
    firebaseConfigured: !cloudConfigurationError,
    // 서버의 소유자, AI, 드라이브 설정은 로그인 후 확인합니다.
    ownerConfigured: false,
    aiConfigured: false,
    driveConfigured: false,
    driveConnected: false,
    lastBackup: null,
    configurationError: cloudConfigurationError || undefined,
    authenticationError: authenticationError || undefined,
  };
}

export function subscribeCloudAuth(listener: () => void): () => void {
  if (!auth) {
    queueMicrotask(listener);
    return () => {};
  }
  return onAuthStateChanged(auth, listener);
}

export async function cloudToken() {
  const user = await readyCloudUser();
  if (!user) throw new Error("구글 계정으로 로그인해 주세요.");
  const error = cloudUserError(user);
  if (error) throw new Error(error);
  // SDK가 만료된 ID 토큰을 갱신합니다. 구글 OAuth 접근 토큰과 구분합니다.
  return user.getIdToken();
}

export async function cloudRefreshToken() {
  const user = await readyCloudUser();
  if (!user) throw new Error("구글 계정으로 로그인해 주세요.");
  const error = cloudUserError(user);
  if (error) throw new Error(error);
  return user.refreshToken;
}

export async function signInCloud() {
  if (cloudConfigurationError) throw new Error(cloudConfigurationError);
  if (!auth) throw new Error("Firebase 로그인 설정이 필요합니다.");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  const error = cloudUserError(result.user);
  if (error) {
    await signOut(auth);
    throw new Error(error);
  }
}

export async function signOutCloud() {
  if (auth) await signOut(auth);
}
