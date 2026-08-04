// Firebase client init. In dev we connect to the local Emulator Suite (offline
// `demo-app` project); in prod we use the real config from VITE_FIREBASE_* env.
// This is the ONLY place the Firebase SDK is initialized.
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'demo-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'demo-app.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'demo-app',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? 'demo-app-id',
}

const firebaseApp = initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)
// Persistent local cache (IndexedDB): query results and listener sync tokens
// survive reloads and Capacitor app relaunches, so the store's onSnapshot
// listeners resume where they left off and re-pay only the CHANGED documents
// instead of the full collection. Multi-tab so a second tab shares the cache
// instead of failing to acquire the IndexedDB lease.
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

// Wire the emulators exactly once in dev. The offline `demo-app` project id
// means no credentials and no network are needed.
if (import.meta.env.DEV) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
