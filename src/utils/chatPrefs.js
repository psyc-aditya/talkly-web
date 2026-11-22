const PINNED_PREFIX = "talkly_pinned_chats_";
const MUTED_PREFIX = "talkly_muted_chats_";
const HIDDEN_PREFIX = "talkly_hidden_chats_";

function emitPrefsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("talkly-chat-prefs-changed"));
  }
}

function readStringArray(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStringArray(key, arr) {
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch {
    // ignore storage errors
  }
  emitPrefsChanged();
}

export function getPinnedChatIds(uid) {
  if (!uid) return [];
  return readStringArray(`${PINNED_PREFIX}${uid}`);
}

export function isChatPinned(uid, chatId) {
  if (!uid || !chatId) return false;
  return getPinnedChatIds(uid).includes(chatId);
}

export function togglePinnedChat(uid, chatId) {
  if (!uid || !chatId) return false;
  const list = getPinnedChatIds(uid);
  const exists = list.includes(chatId);
  const next = exists ? list.filter((id) => id !== chatId) : [chatId, ...list];
  writeStringArray(`${PINNED_PREFIX}${uid}`, next);
  return !exists;
}

export function getMutedChatIds(uid) {
  if (!uid) return [];
  return readStringArray(`${MUTED_PREFIX}${uid}`);
}

export function isChatMuted(uid, chatId) {
  if (!uid || !chatId) return false;
  return getMutedChatIds(uid).includes(chatId);
}

export function toggleMutedChat(uid, chatId) {
  if (!uid || !chatId) return false;
  const list = getMutedChatIds(uid);
  const exists = list.includes(chatId);
  const next = exists ? list.filter((id) => id !== chatId) : [...list, chatId];
  writeStringArray(`${MUTED_PREFIX}${uid}`, next);
  return !exists;
}

export function getHiddenChatsMap(uid) {
  if (!uid) return {};
  try {
    const raw = localStorage.getItem(`${HIDDEN_PREFIX}${uid}`);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function markChatHidden(uid, chatId, timestampMs = Date.now()) {
  if (!uid || !chatId) return;
  const map = getHiddenChatsMap(uid);
  map[chatId] = timestampMs;
  try {
    localStorage.setItem(`${HIDDEN_PREFIX}${uid}`, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
  emitPrefsChanged();
}

export function unhideChat(uid, chatId) {
  if (!uid || !chatId) return;
  const map = getHiddenChatsMap(uid);
  if (!(chatId in map)) return;
  delete map[chatId];
  try {
    localStorage.setItem(`${HIDDEN_PREFIX}${uid}`, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
  emitPrefsChanged();
}
