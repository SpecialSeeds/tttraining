// Firebase sign in and storage. Each person's plan and sessions live under users/{uid},
// and firestore.rules lets only invited members read or write their own documents.
// Firestore keeps a copy on the device, so logging works offline and syncs later.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,
  connectAuthEmulator,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  terminate,
  clearIndexedDbPersistence,
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

// Local testing only: http://localhost:<port>/?emu talks to the Firebase emulators.
const EMULATOR = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emu');

export const configured = EMULATOR || !String(firebaseConfig.apiKey || '').startsWith('PASTE');

let auth = null;
let db = null;

if (configured) {
  const app = initializeApp(EMULATOR ? { apiKey: 'demo', authDomain: 'localhost', projectId: 'demo-tt' } : firebaseConfig);
  auth = getAuth(app);
  let cache;
  try {
    cache = persistentLocalCache({ tabManager: persistentMultipleTabManager() });
  } catch {
    cache = memoryLocalCache(); // private browsing can block IndexedDB
  }
  db = initializeFirestore(app, { localCache: cache, ignoreUndefinedProperties: true });
  if (EMULATOR) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
}

/* ---------- account ---------- */

export const onUser = (cb) => onAuthStateChanged(auth, cb);

export async function signIn(email, password, remember) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());

// Signing out also wipes this device's cached copy, so a shared phone keeps nothing behind.
// Wiping shuts the database down, so reload the page afterwards.
export async function signOutUser({ wipe = true } = {}) {
  await signOut(auth);
  if (!wipe) return;
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch {
    /* another tab still has it open; the data stays protected by the rules */
  }
}

export async function membership(email) {
  const snap = await getDoc(doc(db, 'members', email.toLowerCase()));
  return snap.exists() ? snap.data() : null;
}

/* ---------- plan ---------- */

export async function loadPlan(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() && snap.data().plan ? snap.data().plan : null;
}

export const savePlan = (uid, plan) => track(setDoc(doc(db, 'users', uid), { plan, planUpdated: Date.now() }, { merge: true }));

export async function loadTemplate() {
  try {
    const snap = await getDoc(doc(db, 'templates', 'default'));
    return snap.exists() ? snap.data().plan : null;
  } catch {
    return null;
  }
}

export const saveTemplate = (plan) => track(setDoc(doc(db, 'templates', 'default'), { plan, updated: Date.now() }));

/* ---------- sessions ---------- */

// Local keys look like "2026-09-28|mon"; Firestore ids can't hold "|" reliably in URLs, so use "_".
const toId = (key) => key.replace('|', '_');
const toKey = (id) => id.replace('_', '|');

export async function loadSessions(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'sessions'));
  const sessions = {};
  snap.forEach((d) => (sessions[toKey(d.id)] = d.data()));
  return sessions;
}

export const saveSession = (uid, key, session) => track(setDoc(doc(db, 'users', uid, 'sessions', toId(key)), session));

/* ---------- sync status ---------- */

// A write's promise settles when the server confirms it, so pending > 0 means
// "saved on this device, not yet in the cloud" (usually because you're offline).
let pending = 0;
const listeners = new Set();
const notify = (err) => listeners.forEach((fn) => fn(pending, err));
export const onSync = (fn) => listeners.add(fn);

function track(promise) {
  pending++;
  notify();
  promise.then(
    () => {
      pending--;
      notify();
    },
    (err) => {
      pending--;
      notify(err);
    }
  );
  return promise;
}
