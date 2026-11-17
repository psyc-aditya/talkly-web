export const APP_LOCK_FREQUENCIES = [
  { id: "every_visit", label: "Every Visit", desc: "Ask on refresh, tab switch, or minimize", ms: 0 },
  { id: "1h", label: "Every 1 Hour", desc: "Stay unlocked for 1 hour", ms: 60 * 60 * 1000 },
  { id: "12h", label: "Every 12 Hours", desc: "Stay unlocked for 12 hours", ms: 12 * 60 * 60 * 1000 },
  { id: "1d", label: "Every 1 Day", desc: "Ask once every 24 hours", ms: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "Every 7 Days", desc: "Ask once every week", ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "30d", label: "Every 30 Days", desc: "Ask once every 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
];

const CONFIG_KEY = (uid) => `talkly_applock_cfg_${uid}`;
const UNLOCKED_AT_KEY = (uid) => `talkly_applock_unlocked_at_${uid}`;
export const RESET_LOCK_UID_KEY = "talkly_reset_lock_uid";

export function generateSalt() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function hashAppLockPassword(password, salt) {
  const input = `${salt}:${password}`;
  if (typeof crypto !== "undefined" && crypto.subtle && typeof TextEncoder !== "undefined") {
    const encoded = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Deterministic fallback hash if SubtleCrypto is unavailable
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

export function getLocalAppLock(uid) {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(CONFIG_KEY(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function setLocalAppLock(uid, config) {
  if (!uid) return;
  try {
    if (!config || !config.enabled) {
      localStorage.removeItem(CONFIG_KEY(uid));
      clearAppLockSession(uid);
    } else {
      localStorage.setItem(CONFIG_KEY(uid), JSON.stringify(config));
    }
  } catch {
    // ignore storage errors
  }
}

export function markAppLockUnlocked(uid) {
  if (!uid) return;
  try {
    localStorage.setItem(UNLOCKED_AT_KEY(uid), String(Date.now()));
  } catch {
    // ignore storage errors
  }
}

export function clearAppLockSession(uid) {
  if (!uid) return;
  try {
    localStorage.removeItem(UNLOCKED_AT_KEY(uid));
  } catch {
    // ignore storage errors
  }
}

export function isAppLockRequired(uid, config, inMemoryUnlocked = false) {
  if (!uid || !config || !config.enabled || !config.hash) return false;

  const freq = config.frequency || "every_visit";
  if (freq === "every_visit") {
    return !inMemoryUnlocked;
  }

  const freqObj = APP_LOCK_FREQUENCIES.find((f) => f.id === freq);
  const intervalMs = freqObj?.ms ?? 24 * 60 * 60 * 1000;

  try {
    const rawTs = localStorage.getItem(UNLOCKED_AT_KEY(uid));
    if (!rawTs) return true;
    const lastUnlocked = Number(rawTs);
    if (!Number.isFinite(lastUnlocked) || lastUnlocked <= 0) return true;
    return Date.now() - lastUnlocked >= intervalMs;
  } catch {
    return true;
  }
}

export function getFrequencyLabel(freqId) {
  return APP_LOCK_FREQUENCIES.find((f) => f.id === freqId)?.label || "Every Visit";
}
