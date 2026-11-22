import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { useChat } from "../context/ChatContext";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useContextMenu } from "../context/ContextMenuContext";
import { db, rtdb } from "../firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  writeBatch,
  deleteDoc,
  getDoc,
  increment,
} from "firebase/firestore";
import { ref as rtdbRef, onValue, set, remove, onDisconnect } from "firebase/database";
import {
  Search,
  MoreVertical,
  Smile,
  Send,
  ArrowLeft,
  Check,
  X,
  Eye,
  Clock,
  Timer,
  WifiOff,
  Ban,
  ChevronRight,
  User,
  Reply,
  Eraser,
  UserMinus,
  ArrowDown,
  Minus,
  Plus,
  ShieldOff,
} from "lucide-react";
import Message from "./Message";
import EmojiScreenEffects from "./EmojiScreenEffects";
import EmojiPicker, { Theme as EmojiTheme } from "emoji-picker-react";
import { handleFirestoreError, OperationType } from "../utils/errorHandler";
import { unhideChat } from "../utils/chatPrefs";
import { createEmojiEffectPayload } from "../utils/emojiEffects";

const QUICK_REACTION_EMOJIS = ["❤️", "😂", "🔥", "🎉", "😭", "✨", "👍", "😍"];

const DEFAULT_AFTER_SEEN_SECONDS = 10;
const MIN_AFTER_SEEN_SECONDS = 3;
const MAX_AFTER_SEEN_SECONDS = 300;
const PRESET_AFTER_SEEN_SECONDS = [5, 10, 15, 30, 60];

const DISAPPEAR_OPTIONS = [
  { id: "off", label: "Off", desc: "Messages stay in chat" },
  {
    id: "after_seen",
    label: "Seen & Disappear",
    desc: "Vanishes after fixed seconds once seen or on exit",
  },
  { id: "1h", label: "1 Hour", desc: "Disappears 1 hour after sending" },
  { id: "24h", label: "24 Hours", desc: "Disappears 24 hours after sending" },
  { id: "7d", label: "7 Days", desc: "Disappears 7 days after sending" },
];

const DURATION_MAP_MS = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

function clampAfterSeenSeconds(val) {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return DEFAULT_AFTER_SEEN_SECONDS;
  return Math.max(MIN_AFTER_SEEN_SECONDS, Math.min(MAX_AFTER_SEEN_SECONDS, n));
}

function getAfterSeenDurationMs(message, chatBaseSeconds = DEFAULT_AFTER_SEEN_SECONDS) {
  const baseSec = clampAfterSeenSeconds(message?.afterSeenSeconds || chatBaseSeconds);
  return baseSec * 1000;
}

function formatLastSeen(ts) {
  if (!ts || typeof ts !== "number") return "Offline";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "Offline";
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Offline • Last seen today at ${timeStr}`;
  if (isYesterday) return `Offline • Last seen yesterday at ${timeStr}`;
  return `Offline • Last seen ${date.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

export default function Chat() {
  const { data, dispatch } = useChat();
  const { currentUser, isOnline } = useAuth();
  const { darkMode } = useTheme();
  const { openContextMenu } = useContextMenu();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [otherOnlineState, setOtherOnlineState] = useState("offline");
  const [otherLastSeen, setOtherLastSeen] = useState(null);
  const [isOtherReading, setIsOtherReading] = useState(false);
  const [chatMeta, setChatMeta] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [firstUnreadId, setFirstUnreadId] = useState(null);
  const [unreadDividerCount, setUnreadDividerCount] = useState(0);
  const [isTabVisible, setIsTabVisible] = useState(
    typeof document !== "undefined" ? document.visibilityState === "visible" : true
  );
  const [nowMs, setNowMs] = useState(Date.now());
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [hiddenExpiredIds, setHiddenExpiredIds] = useState(() => new Set());

  const [showMenu, setShowMenu] = useState(false);
  const [showDisappearOptions, setShowDisappearOptions] = useState(false);
  const [customSeenSeconds, setCustomSeenSeconds] = useState(String(DEFAULT_AFTER_SEEN_SECONDS));
  const [confirmAction, setConfirmAction] = useState(null); // 'clear' | 'block' | 'unconnect' | null
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replyingTo, setReplyingTo] = useState(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState(null);
  const [navSelectedMsgId, setNavSelectedMsgId] = useState(null);
  const [activeEmojiEffect, setActiveEmojiEffect] = useState(null);
  const [isChatShaking, setIsChatShaking] = useState(false);

  const endRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const highlightTimeoutRef = useRef(null);
  const shakeTimeoutRef = useRef(null);
  const seenEffectMsgIdsRef = useRef(new Set());
  const initialEffectsSeededRef = useRef(false);
  const prevLastMsgIdRef = useRef(null);
  const typingTimeout = useRef(null);
  const initialUnreadCapturedRef = useRef(false);
  const messagesLoadedRef = useRef(false);
  const chatMetaLoadedRef = useRef(false);
  const markingReadIdsRef = useRef(new Set());
  const markingDeliveredIdsRef = useRef(new Set());
  const deletingIdsRef = useRef(new Set());
  const localReadObservedAtRef = useRef(new Map());
  const latestMessagesRef = useRef([]);
  const latestChatMetaRef = useRef(null);
  const shouldInstantScrollRef = useRef(true);
  const sendingTickRef = useRef(false);
  const menuRef = useRef(null);

  const effectiveDisappearingMode =
    chatMeta?.disappearingMode || (chatMeta?.disappearing ? "24h" : "off");
  const effectiveAfterSeenSeconds = clampAfterSeenSeconds(chatMeta?.afterSeenSeconds);

  const showToast = (msg) => {
    setToastMsg(msg);
  };

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(""), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Track document visibility so messages aren't marked "read" when tab is in background
  useEffect(() => {
    const handleVisibility = () => {
      setIsTabVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
        setShowDisappearOptions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    latestChatMetaRef.current = chatMeta;
    if (chatMeta?.afterSeenSeconds) {
      setCustomSeenSeconds(String(clampAfterSeenSeconds(chatMeta.afterSeenSeconds)));
    }
  }, [chatMeta]);

  // Sync with Firebase server clock offset to eliminate local clock skew
  useEffect(() => {
    const offsetRef = rtdbRef(rtdb, ".info/serverTimeOffset");
    const unsubOffset = onValue(offsetRef, (snap) => {
      setServerOffsetMs(typeof snap.val() === "number" ? snap.val() : 0);
    });
    return () => unsubOffset();
  }, []);

  useEffect(() => {
    setFirstUnreadId(null);
    setUnreadDividerCount(0);
    initialUnreadCapturedRef.current = false;
    messagesLoadedRef.current = false;
    chatMetaLoadedRef.current = false;
    markingReadIdsRef.current.clear();
    markingDeliveredIdsRef.current.clear();
    deletingIdsRef.current.clear();
    localReadObservedAtRef.current.clear();
    shouldInstantScrollRef.current = true;
    prevLastMsgIdRef.current = null;
    clearTimeout(typingTimeout.current);
    setShowMenu(false);
    setShowDisappearOptions(false);
    setConfirmAction(null);
    setShowContactInfo(false);
    setShowEmoji(false);
    setReplyingTo(null);
    setHighlightedMsgId(null);
    setNavSelectedMsgId(null);
    setActiveEmojiEffect(null);
    seenEffectMsgIdsRef.current.clear();
    initialEffectsSeededRef.current = false;
    if (data.chatId && data.chatId !== "null") {
      try {
        const stored = JSON.parse(localStorage.getItem(`talkly_expired_${data.chatId}`) || "[]");
        setHiddenExpiredIds(new Set(Array.isArray(stored) ? stored : []));
      } catch {
        setHiddenExpiredIds(new Set());
      }
    } else {
      setHiddenExpiredIds(new Set());
    }
  }, [data.chatId]);

  const persistExpiredIds = (chatId, ids) => {
    if (!chatId || chatId === "null" || ids.length === 0) return;
    setHiddenExpiredIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      try {
        localStorage.setItem(`talkly_expired_${chatId}`, JSON.stringify(Array.from(next).slice(-300)));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
  };

  // Clear chat handler (preserves accepted chat connection)
  const handleClearChat = async () => {
    const currentMsgs = [...messages];
    const msgIds = currentMsgs.map((m) => m.id);
    persistExpiredIds(data.chatId, msgIds);
    setFirstUnreadId(null);
    setUnreadDividerCount(0);
    setConfirmAction(null);
    setShowMenu(false);

    try {
      if (currentMsgs.length > 0) {
        try {
          const deleteBatch = writeBatch(db);
          currentMsgs.forEach((m) => {
            deleteBatch.delete(doc(db, "messages", m.id));
          });
          await deleteBatch.commit();
        } catch (err) {
          if (err?.code === "permission-denied") {
            // Firestore rules restrict delete: attempt soft-wipe via update
            try {
              const wipeBatch = writeBatch(db);
              currentMsgs.forEach((m) => {
                wipeBatch.update(doc(db, "messages", m.id), {
                  expired: true,
                  text: "",
                  disappearedAt: serverTimestamp(),
                });
              });
              await wipeBatch.commit();
            } catch {
              // clearedAt + local hiddenExpiredIds still clear the chat cleanly
            }
          }
        }
      }

      // Preserve the chat document and its 'accepted' status; only clear messages/preview
      await updateDoc(doc(db, "chats", data.chatId), {
        lastMessage: null,
        [`unreadCounts.${currentUser.uid}`]: 0,
        clearedAt: serverTimestamp(),
      }).catch(() => {});

      showToast("Chat cleared. Your connection remains active.");
    } catch (error) {
      if (error?.code !== "permission-denied") {
        handleFirestoreError(error, OperationType.UPDATE, `chats/${data.chatId}`);
      } else {
        showToast("Chat cleared. Your connection remains active.");
      }
    }
  };

  // Disappearing mode handler
  const handleSetDisappearingMode = async (mode, customSecondsOverride = null) => {
    try {
      const nextSeconds =
        mode === "after_seen"
          ? clampAfterSeenSeconds(customSecondsOverride ?? effectiveAfterSeenSeconds)
          : effectiveAfterSeenSeconds;

      await updateDoc(doc(db, "chats", data.chatId), {
        disappearing: mode !== "off",
        disappearingMode: mode,
        ...(mode === "after_seen" ? { afterSeenSeconds: nextSeconds } : {}),
        disappearingUpdatedAt: serverTimestamp(),
        disappearingUpdatedBy: currentUser.uid,
        disappearingUpdatedByName: currentUser.displayName || "Someone",
      });
      if (mode === "after_seen") {
        setCustomSeenSeconds(String(nextSeconds));
      }
      if (customSecondsOverride === null && mode !== "after_seen") {
        setShowDisappearOptions(false);
        setShowMenu(false);
      } else if (customSecondsOverride !== null) {
        setShowDisappearOptions(false);
        setShowMenu(false);
      }
      const selected = DISAPPEAR_OPTIONS.find((o) => o.id === mode);
      showToast(
        mode === "off"
          ? "Disappearing messages turned off."
          : mode === "after_seen"
          ? `Seen & Disappear set to ${nextSeconds}s.`
          : `${selected?.label} enabled for this chat.`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `chats/${data.chatId}`);
    }
  };

  // Un-connect handler (deletes messages and removes chat connection)
  const handleUnconnect = async () => {
    const currentMsgs = [...messages];
    const activeChatId = data.chatId;
    setConfirmAction(null);
    setShowMenu(false);
    try {
      if (currentMsgs.length > 0) {
        try {
          const deleteBatch = writeBatch(db);
          currentMsgs.forEach((m) => deleteBatch.delete(doc(db, "messages", m.id)));
          await deleteBatch.commit();
        } catch {
          // ignore if rules restrict deleting other user's messages
        }
      }
      await deleteDoc(doc(db, "chats", activeChatId));
      dispatch({ type: "CHANGE_USER", payload: null });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `chats/${activeChatId}`);
    }
  };

  // Block user handler
  const handleBlockUser = async () => {
    try {
      const userRef = doc(db, "users", currentUser.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const blockedUsers = userSnap.data().blockedUsers || [];
        if (!blockedUsers.includes(data.user.uid)) {
          await updateDoc(userRef, {
            blockedUsers: [...blockedUsers, data.user.uid],
          });
        }
      }
      setConfirmAction(null);
      setShowMenu(false);
      dispatch({ type: "CHANGE_USER", payload: null });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  // Listen to chat metadata & messages
  useEffect(() => {
    if (data.chatId === "null") return;

    const unsubMeta = onSnapshot(doc(db, "chats", data.chatId), (docSnap) => {
      chatMetaLoadedRef.current = true;
      if (docSnap.exists()) {
        setChatMeta(docSnap.data());
      } else {
        setChatMeta(null);
      }
    });

    const q = query(collection(db, "messages"), where("chatId", "==", data.chatId));

    const unsubMsgs = onSnapshot(
      q,
      (snapshot) => {
        const msgs = [];
        snapshot.forEach((d) => {
          msgs.push({ id: d.id, ...d.data() });
        });
        // Sort client-side (pending optimistic serverTimestamp messages sort at bottom, not 0)
        msgs.sort((a, b) => {
          const aMs = a.timestamp?.toMillis ? a.timestamp.toMillis() : Number.MAX_SAFE_INTEGER;
          const bMs = b.timestamp?.toMillis ? b.timestamp.toMillis() : Number.MAX_SAFE_INTEGER;
          return aMs - bMs;
        });
        messagesLoadedRef.current = true;
        setMessages(msgs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, "messages");
      }
    );

    return () => {
      unsubMeta();
      unsubMsgs();
    };
  }, [data.chatId]);

  // Process Read / Delivered status transitions based on tab visibility
  useEffect(() => {
    if (data.chatId === "null" || !messagesLoadedRef.current || !chatMetaLoadedRef.current) return;

    const serverNow = Date.now() + serverOffsetMs;
    messages.forEach((m) => {
      if (m.status === "read" && !localReadObservedAtRef.current.has(m.id)) {
        localReadObservedAtRef.current.set(
          m.id,
          m.readAt?.toMillis ? m.readAt.toMillis() : serverNow
        );
      }
    });

    const clearedAtMs = chatMeta?.clearedAt?.toMillis ? chatMeta.clearedAt.toMillis() : 0;
    const unreadMsgs = messages.filter(
      (m) =>
        !m.expired &&
        !hiddenExpiredIds.has(m.id) &&
        !(clearedAtMs && m.timestamp?.toMillis && m.timestamp.toMillis() <= clearedAtMs) &&
        m.senderId !== currentUser.uid &&
        m.status !== "read"
    );

    if (isTabVisible) {
      if (!initialUnreadCapturedRef.current) {
        if (unreadMsgs.length > 0) {
          setFirstUnreadId(unreadMsgs[0].id);
          setUnreadDividerCount(unreadMsgs.length);
        }
        initialUnreadCapturedRef.current = true;
      }

      const toMarkRead = unreadMsgs.filter((m) => !markingReadIdsRef.current.has(m.id));
      if (toMarkRead.length > 0) {
        toMarkRead.forEach((m) => {
          markingReadIdsRef.current.add(m.id);
          if (!localReadObservedAtRef.current.has(m.id)) {
            localReadObservedAtRef.current.set(m.id, serverNow);
          }
        });
        const batch = writeBatch(db);
        toMarkRead.forEach((m) => {
          const msgRef = doc(db, "messages", m.id);
          const payload = {
            status: "read",
            readAt: serverTimestamp(),
          };
          if (effectiveDisappearingMode === "after_seen") {
            if (!m.disappearMode) {
              payload.disappearMode = "after_seen";
            }
            if (!m.afterSeenSeconds) {
              payload.afterSeenSeconds = effectiveAfterSeenSeconds;
            }
          }
          batch.update(msgRef, payload);
        });

        const chatUpdates = {
          [`unreadCounts.${currentUser.uid}`]: 0,
        };
        if (chatMeta?.lastMessage && chatMeta.lastMessage.senderId !== currentUser.uid) {
          chatUpdates["lastMessage.status"] = "read";
        }
        batch.update(doc(db, "chats", data.chatId), chatUpdates);
        batch.commit().catch((err) => {
          toMarkRead.forEach((m) => markingReadIdsRef.current.delete(m.id));
          console.error("Error marking read:", err);
          if (err?.code === "permission-denied") {
            showToast("Database permission denied updating read status.");
          }
        });
      }
    } else {
      // Tab is hidden: acknowledge delivery ('delivered') without marking 'read'
      const toMarkDelivered = unreadMsgs.filter(
        (m) => m.status === "sent" && !markingDeliveredIdsRef.current.has(m.id)
      );
      if (toMarkDelivered.length > 0) {
        toMarkDelivered.forEach((m) => markingDeliveredIdsRef.current.add(m.id));
        const batch = writeBatch(db);
        toMarkDelivered.forEach((m) => {
          batch.update(doc(db, "messages", m.id), {
            status: "delivered",
            deliveredAt: serverTimestamp(),
          });
        });
        if (
          chatMeta?.lastMessage &&
          chatMeta.lastMessage.senderId !== currentUser.uid &&
          chatMeta.lastMessage.status === "sent"
        ) {
          batch.update(doc(db, "chats", data.chatId), {
            "lastMessage.status": "delivered",
          });
        }
        batch.commit().catch((err) => {
          toMarkDelivered.forEach((m) => markingDeliveredIdsRef.current.delete(m.id));
          console.error("Error marking delivered:", err);
        });
      }
    }
  }, [
    messages,
    isTabVisible,
    data.chatId,
    currentUser.uid,
    effectiveDisappearingMode,
    chatMeta?.lastMessage,
    serverOffsetMs,
  ]);

  // 1-second ticker & staggered one-by-one schedule for disappearing / Seen & Disappear messages
  const clearedAtMs = chatMeta?.clearedAt?.toMillis ? chatMeta.clearedAt.toMillis() : 0;
  const disappearingUpdatedAtMs = chatMeta?.disappearingUpdatedAt?.toMillis
    ? chatMeta.disappearingUpdatedAt.toMillis()
    : 0;

  const hasActiveDisappearingMessages = useMemo(() => {
    const activeMsgs = messages.filter(
      (m) =>
        !m.expired &&
        !hiddenExpiredIds.has(m.id) &&
        !(clearedAtMs && m.timestamp?.toMillis && m.timestamp.toMillis() <= clearedAtMs)
    );
    if (effectiveDisappearingMode !== "off") return activeMsgs.length > 0;
    return activeMsgs.some((m) => m.disappearMode === "after_seen");
  }, [effectiveDisappearingMode, messages, hiddenExpiredIds, clearedAtMs]);

  // Compute fixed expiration schedule using strictly the user-configured disappearing seconds
  const afterSeenSchedule = useMemo(() => {
    const schedule = new Map();

    for (const m of messages) {
      if (
        m.expired ||
        hiddenExpiredIds.has(m.id) ||
        (clearedAtMs && m.timestamp?.toMillis && m.timestamp.toMillis() <= clearedAtMs)
      ) {
        continue;
      }

      const readMs = m.readAt?.toMillis
        ? m.readAt.toMillis()
        : localReadObservedAtRef.current.get(m.id);

      const isAfterSeenMsg =
        m.disappearMode === "after_seen" ||
        (effectiveDisappearingMode === "after_seen" &&
          m.status === "read" &&
          (!disappearingUpdatedAtMs || (readMs || 0) >= disappearingUpdatedAtMs - 2000));

      if (!isAfterSeenMsg || m.status !== "read" || !readMs) {
        continue;
      }

      const durationMs = getAfterSeenDurationMs(m, effectiveAfterSeenSeconds);
      schedule.set(m.id, { expireAtMs: readMs + durationMs, durationMs });
    }

    return schedule;
  }, [
    messages,
    hiddenExpiredIds,
    clearedAtMs,
    effectiveDisappearingMode,
    disappearingUpdatedAtMs,
    effectiveAfterSeenSeconds,
  ]);

  useEffect(() => {
    if (!hasActiveDisappearingMessages) return;
    setNowMs(Date.now());
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [hasActiveDisappearingMessages]);

  const serverNowMs = nowMs + serverOffsetMs;

  // Delete expired disappearing messages & sync lastMessage cleanly
  useEffect(() => {
    if (data.chatId === "null" || messages.length === 0) return;

    const toDelete = messages.filter((m) => {
      if (deletingIdsRef.current.has(m.id) || m.expired || hiddenExpiredIds.has(m.id)) {
        return false;
      }
      if (clearedAtMs && m.timestamp?.toMillis && m.timestamp.toMillis() <= clearedAtMs) {
        return false;
      }

      // 1. Seen & Disappear (strictly user-configured duration after seen)
      const scheduleEntry = afterSeenSchedule.get(m.id);
      if (scheduleEntry) {
        return serverNowMs >= scheduleEntry.expireAtMs;
      }

      // 2. Time-based disappearing modes (1h, 24h, 7d)
      const modeDuration = DURATION_MAP_MS[m.disappearMode] || DURATION_MAP_MS[effectiveDisappearingMode];
      if (modeDuration && m.timestamp?.toMillis) {
        return serverNowMs - m.timestamp.toMillis() >= modeDuration;
      }

      return false;
    });

    if (toDelete.length === 0) return;

    const expiredIds = toDelete.map((m) => m.id);
    toDelete.forEach((m) => deletingIdsRef.current.add(m.id));
    // Immediately hide from UI and persist locally so messages always vanish on time
    persistExpiredIds(data.chatId, expiredIds);

    const deleteIdsSet = new Set(expiredIds);
    const visibleBeforeDelete = messages.filter(
      (m) =>
        !m.expired &&
        !hiddenExpiredIds.has(m.id) &&
        !(clearedAtMs && m.timestamp?.toMillis && m.timestamp.toMillis() <= clearedAtMs)
    );
    const remaining = visibleBeforeDelete.filter((m) => !deleteIdsSet.has(m.id));
    const lastVisible = visibleBeforeDelete[visibleBeforeDelete.length - 1];
    const lastWasDeleted = lastVisible && deleteIdsSet.has(lastVisible.id);

    const syncLastMessage = async () => {
      if (!lastWasDeleted) return;
      const nextLast = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      await updateDoc(doc(db, "chats", data.chatId), {
        lastMessage: nextLast
          ? {
              text: nextLast.text,
              senderId: nextLast.senderId,
              status: nextLast.status || "sent",
            }
          : {
              text: "Message disappeared",
              senderId: lastVisible.senderId,
              disappeared: true,
              status: lastVisible.status || "read",
            },
      }).catch(() => {});
    };

    const runDelete = async () => {
      try {
        const deleteBatch = writeBatch(db);
        toDelete.forEach((m) => {
          deleteBatch.delete(doc(db, "messages", m.id));
        });
        await deleteBatch.commit();
        await syncLastMessage();
      } catch (err) {
        if (err?.code === "permission-denied") {
          // Firestore rules block delete: attempt soft-wipe via update so content is wiped for both users
          try {
            const wipeBatch = writeBatch(db);
            toDelete.forEach((m) => {
              wipeBatch.update(doc(db, "messages", m.id), {
                expired: true,
                text: "",
                disappearedAt: serverTimestamp(),
              });
            });
            await wipeBatch.commit();
          } catch {
            // Rules also restrict update; local hiddenExpiredIds keeps them vanished in UI
          }
          await syncLastMessage();
        } else {
          toDelete.forEach((m) => deletingIdsRef.current.delete(m.id));
        }
      }
    };

    runDelete();
  }, [
    serverNowMs,
    messages,
    afterSeenSchedule,
    effectiveDisappearingMode,
    data.chatId,
    clearedAtMs,
    currentUser.uid,
    hiddenExpiredIds,
  ]);

  // Vanish on exit: if viewer leaves chat after reading 'after_seen' messages, delete/hide them immediately
  useEffect(() => {
    const activeChatId = data.chatId;
    if (!activeChatId || activeChatId === "null") return;

    return () => {
      const msgs = latestMessagesRef.current;
      const meta = latestChatMetaRef.current;
      const mode = meta?.disappearingMode || (meta?.disappearing ? "24h" : "off");
      const seenToVanish = msgs.filter(
        (m) =>
          !deletingIdsRef.current.has(m.id) &&
          !m.expired &&
          m.senderId !== currentUser.uid &&
          m.status === "read" &&
          (m.disappearMode === "after_seen" || mode === "after_seen")
      );
      if (seenToVanish.length === 0) return;

      const vanishedIdsList = seenToVanish.map((m) => m.id);
      try {
        const existing = JSON.parse(localStorage.getItem(`talkly_expired_${activeChatId}`) || "[]");
        const merged = Array.from(new Set([...(Array.isArray(existing) ? existing : []), ...vanishedIdsList])).slice(-300);
        localStorage.setItem(`talkly_expired_${activeChatId}`, JSON.stringify(merged));
      } catch {
        // ignore storage errors
      }

      const vanishedIds = new Set(vanishedIdsList);
      const remaining = msgs.filter((m) => !vanishedIds.has(m.id) && !m.expired);
      const lastOriginal = msgs[msgs.length - 1];
      const lastWasDeleted = lastOriginal && vanishedIds.has(lastOriginal.id);

      const syncLastOnExit = () => {
        if (!lastWasDeleted) return Promise.resolve();
        const nextLast = remaining.length > 0 ? remaining[remaining.length - 1] : null;
        return updateDoc(doc(db, "chats", activeChatId), {
          lastMessage: nextLast
            ? {
                text: nextLast.text,
                senderId: nextLast.senderId,
                status: nextLast.status || "sent",
              }
            : {
                text: "Message disappeared",
                senderId: lastOriginal.senderId,
                disappeared: true,
                status: "read",
              },
        }).catch(() => {});
      };

      const batch = writeBatch(db);
      seenToVanish.forEach((m) => {
        deletingIdsRef.current.add(m.id);
        batch.delete(doc(db, "messages", m.id));
      });
      batch
        .commit()
        .then(syncLastOnExit)
        .catch(async (err) => {
          if (err?.code === "permission-denied") {
            try {
              const wipeBatch = writeBatch(db);
              seenToVanish.forEach((m) => {
                wipeBatch.update(doc(db, "messages", m.id), {
                  expired: true,
                  text: "",
                  disappearedAt: serverTimestamp(),
                });
              });
              await wipeBatch.commit();
            } catch {
              // fallback handled via localStorage
            }
            await syncLastOnExit();
          }
        });
    };
  }, [data.chatId, currentUser.uid]);

  // Publish my own "Reading chat" presence to RTDB
  useEffect(() => {
    if (!data.chatId || data.chatId === "null" || !currentUser?.uid) return;
    const myReadingRef = rtdbRef(rtdb, `reading/${data.chatId}/${currentUser.uid}`);
    const isPendingChat = chatMeta?.status === "pending";

    if (isTabVisible && !isPendingChat) {
      onDisconnect(myReadingRef).remove();
      set(myReadingRef, true);
    } else {
      set(myReadingRef, false);
    }

    return () => {
      remove(myReadingRef).catch(() => {});
    };
  }, [data.chatId, currentUser?.uid, isTabVisible, chatMeta?.status]);

  // Listen to other user's status, typing, and reading indicator
  useEffect(() => {
    if (!data.user?.uid) return;
    const statusRef = rtdbRef(rtdb, `/status/${data.user.uid}`);
    const unsubStatus = onValue(statusRef, (snapshot) => {
      const statusData = snapshot.val();
      if (statusData) {
        const nextState =
          statusData.state === "online"
            ? "online"
            : statusData.state === "away"
            ? "away"
            : "offline";
        setOtherOnlineState(nextState);
        setOtherLastSeen(typeof statusData.last_changed === "number" ? statusData.last_changed : null);
      } else {
        setOtherOnlineState("offline");
        setOtherLastSeen(null);
      }
    });

    const typingRef = rtdbRef(rtdb, `typing/${data.chatId}/${data.user.uid}`);
    const unsubTyping = onValue(typingRef, (snapshot) => {
      setIsTyping(Boolean(snapshot.val()));
    });

    const otherReadingRef = rtdbRef(rtdb, `reading/${data.chatId}/${data.user.uid}`);
    const unsubReading = onValue(otherReadingRef, (snapshot) => {
      setIsOtherReading(Boolean(snapshot.val()));
    });

    return () => {
      unsubStatus();
      unsubTyping();
      unsubReading();
    };
  }, [data.chatId, data.user?.uid]);

  const handleAccept = async () => {
    try {
      await updateDoc(doc(db, "chats", data.chatId), {
        status: "accepted",
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `chats/${data.chatId}`);
    }
  };

  const handleReject = async () => {
    try {
      await deleteDoc(doc(db, "chats", data.chatId));
      dispatch({ type: "CHANGE_USER", payload: null });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `chats/${data.chatId}`);
    }
  };

  const isPending = chatMeta?.status === "pending";
  const isReceiver = isPending && chatMeta?.senderId !== currentUser.uid;
  const isSender = isPending && chatMeta?.senderId === currentUser.uid;

  const triggerEmojiEffect = useCallback((msgText, origin = "outgoing") => {
    const payload = createEmojiEffectPayload(msgText, origin);
    if (!payload) return;
    setActiveEmojiEffect(payload);
    if (payload.shake) {
      setIsChatShaking(false);
      requestAnimationFrame(() => {
        setIsChatShaking(true);
        clearTimeout(shakeTimeoutRef.current);
        shakeTimeoutRef.current = setTimeout(() => {
          setIsChatShaking(false);
        }, 420);
      });
    }
  }, []);

  const handleSend = async (overrideText = null) => {
    const rawText = typeof overrideText === "string" ? overrideText : text;
    const trimmed = rawText.trim();
    if (!trimmed || !data.chatId || data.chatId === "null" || !currentUser?.uid || !data.user?.uid) {
      return;
    }
    if (sendingTickRef.current) return;
    sendingTickRef.current = true;
    queueMicrotask(() => {
      sendingTickRef.current = false;
    });

    const myTypingRef = rtdbRef(rtdb, `typing/${data.chatId}/${currentUser.uid}`);
    set(myTypingRef, false);
    clearTimeout(typingTimeout.current);

    const messageData = {
      chatId: data.chatId,
      senderId: currentUser.uid,
      receiverId: data.user.uid,
      text: trimmed,
      timestamp: serverTimestamp(),
      status: "sent",
      ...(replyingTo
        ? {
            replyTo: {
              id: replyingTo.id,
              text: replyingTo.text,
              senderId: replyingTo.senderId,
              senderName: replyingTo.senderName,
            },
          }
        : {}),
      ...(effectiveDisappearingMode !== "off" ? { disappearMode: effectiveDisappearingMode } : {}),
      ...(effectiveDisappearingMode === "after_seen"
        ? { afterSeenSeconds: effectiveAfterSeenSeconds }
        : {}),
    };

    if (typeof overrideText !== "string") {
      setText("");
      if (inputRef.current) {
        inputRef.current.style.height = "auto";
      }
    }
    setReplyingTo(null);
    setNavSelectedMsgId(null);
    setShowEmoji(false);
    unhideChat(currentUser.uid, data.chatId);
    triggerEmojiEffect(trimmed, "outgoing");

    // Keep virtual keyboard open on phones by focusing synchronously inside the user gesture
    const isCoarsePointer =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)")?.matches;
    if (typeof overrideText !== "string" || !isCoarsePointer) {
      inputRef.current?.focus({ preventScroll: true });
    }

    try {
      try {
        await addDoc(collection(db, "messages"), messageData);
      } catch (msgErr) {
        const isAlreadyExists =
          msgErr?.code === "already-exists" ||
          /already exists/i.test(msgErr?.message || "");
        if (!isAlreadyExists) {
          throw msgErr;
        }
        // Commit succeeded on an earlier transport attempt before retry; proceed to sync chat metadata
      }

      const receiverId = data.user.uid;
      await updateDoc(doc(db, "chats", data.chatId), {
        lastMessage: { text: trimmed, senderId: currentUser.uid, status: "sent" },
        updatedAt: serverTimestamp(),
        [`unreadCounts.${receiverId}`]: increment(1),
      }).catch(() => {});
    } catch (error) {
      showToast("Failed to send message. Please try again.");
      handleFirestoreError(error, OperationType.WRITE, "messages");
    }
  };

  const handleTyping = (e) => {
    setText(e.target.value);
    if (!data.chatId || data.chatId === "null") return;

    const myTypingRef = rtdbRef(rtdb, `typing/${data.chatId}/${currentUser.uid}`);
    set(myTypingRef, true);

    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      set(myTypingRef, false);
    }, 2000);
  };

  const onEmojiClick = (emojiObject) => {
    setText((prev) => prev + emojiObject.emoji);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const handleEditMessage = async (msg, newText) => {
    if (!msg?.id || !newText) return;
    try {
      await updateDoc(doc(db, "messages", msg.id), {
        text: newText,
        edited: true,
        editedAt: serverTimestamp(),
      });

      const visibleMsgs = messages.filter(
        (m) =>
          !m.expired &&
          !hiddenExpiredIds.has(m.id) &&
          !(clearedAtMs && m.timestamp?.toMillis && m.timestamp.toMillis() <= clearedAtMs)
      );
      const latestVisible = visibleMsgs[visibleMsgs.length - 1];
      if (latestVisible?.id === msg.id) {
        await updateDoc(doc(db, "chats", data.chatId), {
          "lastMessage.text": newText,
        }).catch(() => {});
      }
      showToast("Message updated.");
    } catch (error) {
      if (error?.code === "permission-denied") {
        showToast("Unable to edit message (permission denied).");
      } else {
        handleFirestoreError(error, OperationType.UPDATE, `messages/${msg.id}`);
      }
    }
  };

  const handleDeleteMessage = async (msg) => {
    if (!msg?.id) return;
    persistExpiredIds(data.chatId, [msg.id]);

    const visibleBefore = messages.filter(
      (m) =>
        !m.expired &&
        !hiddenExpiredIds.has(m.id) &&
        !(clearedAtMs && m.timestamp?.toMillis && m.timestamp.toMillis() <= clearedAtMs)
    );
    const wasLatest = visibleBefore[visibleBefore.length - 1]?.id === msg.id;
    const remaining = visibleBefore.filter((m) => m.id !== msg.id);
    const nextLast = remaining.length > 0 ? remaining[remaining.length - 1] : null;

    const syncLastAfterDelete = async () => {
      if (!wasLatest) return;
      await updateDoc(doc(db, "chats", data.chatId), {
        lastMessage: nextLast
          ? {
              text: nextLast.text,
              senderId: nextLast.senderId,
              status: nextLast.status || "sent",
            }
          : null,
      }).catch(() => {});
    };

    try {
      await deleteDoc(doc(db, "messages", msg.id));
      await syncLastAfterDelete();
      showToast("Message deleted.");
    } catch (error) {
      if (error?.code === "permission-denied") {
        try {
          await updateDoc(doc(db, "messages", msg.id), {
            expired: true,
            text: "",
            deletedAt: serverTimestamp(),
          });
          await syncLastAfterDelete();
          showToast("Message deleted.");
        } catch {
          await syncLastAfterDelete();
          showToast("Message removed locally.");
        }
      } else {
        handleFirestoreError(error, OperationType.DELETE, `messages/${msg.id}`);
      }
    }
  };

  const handleCopyMessage = async (msg) => {
    if (!msg?.text) return;
    try {
      await navigator.clipboard.writeText(msg.text);
      showToast("Message copied.");
    } catch {
      showToast("Could not copy message.");
    }
  };

  const handleReplyMessage = (msg) => {
    if (!msg?.id) return;
    setReplyingTo({
      id: msg.id,
      text: msg.text || "",
      senderId: msg.senderId,
      senderName:
        msg.senderId === currentUser.uid
          ? currentUser.displayName || "You"
          : data.user?.displayName || "User",
    });
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const handleDeleteForMe = (msg) => {
    if (!msg?.id) return;
    persistExpiredIds(data.chatId, [msg.id]);
    showToast("Message removed for you.");
  };

  const handleJumpToMessage = (msgId) => {
    if (!msgId || !messagesContainerRef.current) return;
    const target = messagesContainerRef.current.querySelector(`[data-msg-id="${msgId}"]`);
    if (!target) {
      showToast("Original message is no longer available.");
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMsgId(msgId);
    clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedMsgId(null);
    }, 1600);
  };

  const handleChatAreaContextMenu = (e) => {
    const tag = e.target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    e.preventDefault();
    e.stopPropagation();

    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      header: {
        avatar:
          data.user?.photoURL ||
          "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png",
        title: data.user?.displayName || "Chat",
        subtitle: data.user?.talklyId || "",
      },
      items: [
        {
          id: "search",
          label: "Search Messages",
          icon: Search,
          onClick: () => setShowSearch(true),
        },
        {
          id: "profile",
          label: "View Profile",
          icon: User,
          onClick: () => setShowContactInfo(true),
        },
        {
          id: "disappear",
          label: "Disappearing Messages",
          icon: Clock,
          onClick: () => {
            setShowMenu(true);
            setShowDisappearOptions(true);
          },
        },
        {
          id: "bottom",
          label: "Scroll to Bottom",
          icon: ArrowDown,
          onClick: () => {
            const el = messagesContainerRef.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          },
        },
        { type: "divider" },
        {
          id: "clear",
          label: "Clear Chat",
          icon: Eraser,
          onClick: () => setConfirmAction("clear"),
        },
        {
          id: "unconnect",
          label: "Un-connect",
          icon: UserMinus,
          danger: true,
          onClick: () => setConfirmAction("unconnect"),
        },
        {
          id: "block",
          label: "Block User",
          icon: Ban,
          danger: true,
          onClick: () => setConfirmAction("block"),
        },
        {
          id: "close",
          label: "Close Chat",
          icon: X,
          onClick: () => dispatch({ type: "CHANGE_USER", payload: null }),
        },
      ],
    });
  };

  const filteredMessages = useMemo(
    () =>
      messages.filter(
        (m) =>
          !m.expired &&
          !hiddenExpiredIds.has(m.id) &&
          !(clearedAtMs && m.timestamp?.toMillis && m.timestamp.toMillis() <= clearedAtMs) &&
          (!searchQuery || m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
      ),
    [messages, hiddenExpiredIds, clearedAtMs, searchQuery]
  );

  const selectMessageForArrowReply = useCallback(
    (msg) => {
      if (!msg?.id) return;
      setNavSelectedMsgId(msg.id);
      setReplyingTo({
        id: msg.id,
        text: msg.text || "",
        senderId: msg.senderId,
        senderName:
          msg.senderId === currentUser.uid
            ? currentUser.displayName || "You"
            : data.user?.displayName || "User",
      });
      requestAnimationFrame(() => {
        const target = messagesContainerRef.current?.querySelector(`[data-msg-id="${msg.id}"]`);
        target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        inputRef.current?.focus();
      });
    },
    [currentUser?.uid, currentUser?.displayName, data.user?.displayName]
  );

  // Trigger smart screen emoji animations when a NEW incoming message arrives with emojis
  useEffect(() => {
    if (!messagesLoadedRef.current) return;
    if (!initialEffectsSeededRef.current) {
      messages.forEach((m) => seenEffectMsgIdsRef.current.add(m.id));
      initialEffectsSeededRef.current = true;
      return;
    }

    const newlyArrived = [];
    for (const m of messages) {
      if (!seenEffectMsgIdsRef.current.has(m.id)) {
        seenEffectMsgIdsRef.current.add(m.id);
        newlyArrived.push(m);
      }
    }

    const latestIncoming = newlyArrived
      .filter((m) => !m.expired && m.senderId !== currentUser?.uid && m.text)
      .pop();

    if (latestIncoming) {
      triggerEmojiEffect(latestIncoming.text, "incoming");
    }
  }, [messages, currentUser?.uid, triggerEmojiEffect]);

  // Auto-grow composer textarea smoothly up to 120px without breaking layout
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 120;
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${Math.max(24, nextHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [text, data.chatId]);

  // Keep messages scrolled to bottom when mobile virtual keyboard opens/resizes viewport
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const handleViewportResize = () => {
      const container = messagesContainerRef.current;
      if (!container) return;
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom < 220) {
        requestAnimationFrame(() => {
          container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
        });
      }
    };
    vv.addEventListener("resize", handleViewportResize);
    return () => vv.removeEventListener("resize", handleViewportResize);
  }, []);

  // Auto-focus composer input on desktop whenever user lands on a chat or closes overlays
  useEffect(() => {
    if (
      !data.chatId ||
      data.chatId === "null" ||
      isPending ||
      showSearch ||
      confirmAction ||
      showContactInfo
    ) {
      return;
    }
    const isCoarsePointer =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)")?.matches;
    if (isCoarsePointer) return;
    const rafId = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [data.chatId, isPending, showSearch, confirmAction, showContactInfo]);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmoji) return;
    const handleOutside = (e) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showEmoji]);

  // Shared WhatsApp-style arrow reply handler:
  // ArrowLeft -> reply to incoming (received) message
  // ArrowRight -> reply to our sent (own) message
  // ArrowUp / ArrowDown -> shift across all messages
  const handleArrowReplyKey = useCallback(
    (key) => {
      if (filteredMessages.length === 0) return false;

      const currentIndex = navSelectedMsgId
        ? filteredMessages.findIndex((m) => m.id === navSelectedMsgId)
        : -1;

      if (key === "ArrowUp") {
        const nextIdx =
          currentIndex === -1 ? filteredMessages.length - 1 : Math.max(0, currentIndex - 1);
        selectMessageForArrowReply(filteredMessages[nextIdx]);
        return true;
      }

      if (key === "ArrowDown") {
        if (currentIndex === -1) return false;
        if (currentIndex >= filteredMessages.length - 1) {
          setNavSelectedMsgId(null);
          setReplyingTo(null);
        } else {
          selectMessageForArrowReply(filteredMessages[currentIndex + 1]);
        }
        return true;
      }

      if (key === "ArrowLeft") {
        const searchStart = currentIndex > 0 ? currentIndex - 1 : filteredMessages.length - 1;
        let found = null;
        for (let i = searchStart; i >= 0; i--) {
          if (filteredMessages[i].senderId !== currentUser.uid) {
            found = filteredMessages[i];
            break;
          }
        }
        if (!found) {
          for (let i = filteredMessages.length - 1; i >= 0; i--) {
            if (filteredMessages[i].senderId !== currentUser.uid) {
              found = filteredMessages[i];
              break;
            }
          }
        }
        if (found) {
          selectMessageForArrowReply(found);
          return true;
        }
        showToast("No received message to reply to.");
        return true;
      }

      if (key === "ArrowRight") {
        const searchStart = currentIndex > 0 ? currentIndex - 1 : filteredMessages.length - 1;
        let found = null;
        for (let i = searchStart; i >= 0; i--) {
          if (filteredMessages[i].senderId === currentUser.uid) {
            found = filteredMessages[i];
            break;
          }
        }
        if (!found) {
          for (let i = filteredMessages.length - 1; i >= 0; i--) {
            if (filteredMessages[i].senderId === currentUser.uid) {
              found = filteredMessages[i];
              break;
            }
          }
        }
        if (found) {
          selectMessageForArrowReply(found);
          return true;
        }
        showToast("No sent message to reply to.");
        return true;
      }

      return false;
    },
    [filteredMessages, navSelectedMsgId, currentUser?.uid, selectMessageForArrowReply]
  );

  // Global keyboard shortcuts inside Chat:
  // - Ctrl + E: Toggle Emoji Picker
  // - Escape: Close Emoji Picker or cancel active reply/arrow selection
  // - Arrow keys when chat area is focused: reply / shift over messages
  // - Type anywhere: Auto-focus message input immediately without needing a click
  useEffect(() => {
    if (!data.chatId || data.chatId === "null" || isPending) return;

    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setShowEmoji((prev) => {
          const next = !prev;
          if (!next) {
            requestAnimationFrame(() => inputRef.current?.focus());
          }
          return next;
        });
        return;
      }

      if (e.key === "Escape") {
        if (showEmoji) {
          e.preventDefault();
          setShowEmoji(false);
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }
        if (replyingTo || navSelectedMsgId) {
          e.preventDefault();
          setReplyingTo(null);
          setNavSelectedMsgId(null);
          return;
        }
      }

      if (showSearch || confirmAction || showContactInfo || showMenu || showEmoji) return;
      const activeEl = document.activeElement;
      const activeTag = activeEl?.tagName?.toLowerCase();
      const isEditableFocused =
        activeTag === "input" ||
        activeTag === "textarea" ||
        activeEl?.isContentEditable;
      const isSeparatorFocused = activeEl?.getAttribute?.("role") === "separator";

      if (!isEditableFocused && !isSeparatorFocused) {
        const isArrow =
          e.key === "ArrowUp" ||
          e.key === "ArrowDown" ||
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight";

        if (isArrow && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (handleArrowReplyKey(e.key)) {
            e.preventDefault();
          }
          return;
        }

        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
          inputRef.current?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    data.chatId,
    isPending,
    showEmoji,
    showSearch,
    confirmAction,
    showContactInfo,
    showMenu,
    replyingTo,
    navSelectedMsgId,
    handleArrowReplyKey,
  ]);

  // Composer key handler:
  // - Laptop/Desktop: Enter sends, Shift+Enter inserts a newline
  // - Phone/Touch: Return inserts a newline (Send button sends while keeping keyboard open)
  // - Empty input: ArrowLeft (incoming reply), ArrowRight (own reply), ArrowUp/Down (shift all messages)
  const handleKey = (e) => {
    if (e.nativeEvent?.isComposing) return;

    if (e.key === "Enter") {
      const isCoarsePointer =
        typeof window !== "undefined" &&
        window.matchMedia?.("(pointer: coarse)")?.matches;

      // Shift+Enter always creates a newline; touch keyboards also insert newline on Return
      if (e.shiftKey || isCoarsePointer) {
        return;
      }
      e.preventDefault();
      handleSend();
      return;
    }

    if (showEmoji) return;

    const isInputEmpty = text.length === 0;
    const isArrow =
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight";

    if (!isArrow || filteredMessages.length === 0) return;

    // Preserve normal caret & multi-line navigation whenever user has typed text
    if (!isInputEmpty) {
      return;
    }

    if (handleArrowReplyKey(e.key)) {
      e.preventDefault();
    }
  };

  const lastVisibleMessage =
    filteredMessages.length > 0 ? filteredMessages[filteredMessages.length - 1] : null;
  const lastVisibleMessageId = lastVisibleMessage?.id || null;
  const lastVisibleMessageStatus = lastVisibleMessage?.status || "";
  const lastVisibleMessageText = lastVisibleMessage?.text || "";

  // Auto-scroll to bottom on chat open and whenever a new message arrives (both own and front user)
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || filteredMessages.length === 0) return;

    const isInitialOpen = shouldInstantScrollRef.current;
    const hasNewTailMessage =
      Boolean(lastVisibleMessageId) && lastVisibleMessageId !== prevLastMsgIdRef.current;

    if (!isInitialOpen && !hasNewTailMessage) {
      // Keep scrolled to bottom if user is already near the bottom when receipt/text updates
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom > 120) return;
    }

    prevLastMsgIdRef.current = lastVisibleMessageId;
    const behavior = isInitialOpen ? "auto" : "smooth";
    shouldInstantScrollRef.current = false;

    const rafId = requestAnimationFrame(() => {
      const el = messagesContainerRef.current;
      if (!el) return;
      el.scrollTo({
        top: el.scrollHeight,
        behavior,
      });
    });

    return () => cancelAnimationFrame(rafId);
  }, [
    data.chatId,
    filteredMessages.length,
    lastVisibleMessageId,
    lastVisibleMessageStatus,
    lastVisibleMessageText,
  ]);

  const lastOutgoingId = useMemo(() => {
    for (let i = filteredMessages.length - 1; i >= 0; i--) {
      if (filteredMessages[i].senderId === currentUser.uid) {
        return filteredMessages[i].id;
      }
    }
    return null;
  }, [filteredMessages, currentUser.uid]);

  const activeDisappearLabel =
    effectiveDisappearingMode === "after_seen"
      ? `Seen & Disappear (${effectiveAfterSeenSeconds}s)`
      : DISAPPEAR_OPTIONS.find((o) => o.id === effectiveDisappearingMode)?.label || "Off";

  return (
    <div
      className={`flex flex-col w-full h-full bg-white dark:bg-gray-900 relative transition-colors duration-200 overflow-hidden ${
        isChatShaking ? "animate-chat-shake" : ""
      }`}
    >
      {/* Smart Right-Side Chat Screen Emoji Animation Overlay */}
      <EmojiScreenEffects effect={activeEmojiEffect} darkMode={darkMode} />
      {/* Header */}
      <div className="h-[65px] bg-white dark:bg-gray-900 flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800 z-50 relative transition-colors duration-200">
        {showSearch ? (
          <div className="flex items-center w-full gap-3 bg-gray-100 dark:bg-gray-800 rounded-full px-4 py-2 transition-colors duration-200">
            <ArrowLeft
              className="w-5 h-5 text-gray-500 dark:text-gray-400 cursor-pointer"
              onClick={() => {
                setShowSearch(false);
                setSearchQuery("");
              }}
            />
            <input
              type="text"
              placeholder="Search messages..."
              className="bg-transparent outline-none w-full text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <X
                className="w-5 h-5 text-gray-500 dark:text-gray-400 cursor-pointer"
                onClick={() => setSearchQuery("")}
              />
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 min-w-0">
              <ArrowLeft
                className="w-6 h-6 text-gray-500 dark:text-gray-400 md:hidden cursor-pointer shrink-0"
                onClick={() => dispatch({ type: "BACK_TO_SIDEBAR" })}
              />
              <button
                type="button"
                onClick={() => setShowContactInfo(true)}
                className="relative shrink-0 rounded-full focus:outline-none hover:opacity-90 transition-opacity"
                title="View profile"
              >
                <img
                  src={
                    data.user?.photoURL ||
                    "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
                  }
                  alt=""
                  className="w-10 h-10 rounded-full object-cover"
                />
                <span
                  className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 ${
                      otherOnlineState === "online"
                        ? "bg-emerald-500"
                        : otherOnlineState === "away"
                        ? "bg-sky-400"
                        : "bg-gray-400 dark:bg-gray-600"
                    }`}
                  title={
                    otherOnlineState === "online"
                      ? "Online"
                      : otherOnlineState === "away"
                      ? "Away"
                      : "Offline"
                  }
                />
              </button>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowContactInfo(true)}
                    className="text-[16px] text-gray-900 dark:text-gray-100 font-medium truncate hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-left"
                  >
                    {data.user?.displayName}
                  </button>
                  {effectiveDisappearingMode !== "off" && (
                    <button
                      onClick={() => {
                        setShowMenu(true);
                        setShowDisappearOptions(true);
                      }}
                      className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 border border-sky-200/70 dark:border-sky-800/40"
                    >
                      {effectiveDisappearingMode === "after_seen" ? (
                        <Clock className="w-3 h-3" />
                      ) : (
                        <Timer className="w-3 h-3" />
                      )}
                      {activeDisappearLabel}
                    </button>
                  )}
                </div>

                {/* Live Presence / Typing / Reading / Offline Indicator */}
                <div className="text-xs flex items-center gap-1.5 truncate">
                  {isTyping ? (
                    <span className="text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1">
                      <span className="inline-flex gap-0.5">
                        <span className="w-1 h-1 rounded-full bg-blue-600 dark:bg-blue-400 animate-bounce" />
                        <span className="w-1 h-1 rounded-full bg-blue-600 dark:bg-blue-400 animate-bounce [animation-delay:150ms]" />
                        <span className="w-1 h-1 rounded-full bg-blue-600 dark:bg-blue-400 animate-bounce [animation-delay:300ms]" />
                      </span>
                      typing...
                    </span>
                  ) : isOtherReading && otherOnlineState === "online" ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium inline-flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5 animate-pulse" />
                      Reading chat
                    </span>
                  ) : otherOnlineState === "online" ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium inline-flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Online
                    </span>
                  ) : otherOnlineState === "away" ? (
                    <span className="text-sky-600 dark:text-sky-400 font-medium inline-flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                      Away
                    </span>
                  ) : (
                    <span className="text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5 truncate">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-600 shrink-0" />
                      <span className="truncate">{formatLastSeen(otherLastSeen)}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-3 text-gray-500 dark:text-gray-400 relative items-center" ref={menuRef}>
              <Search
                className="w-5 h-5 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition"
                onClick={() => setShowSearch(true)}
              />

              <button
                type="button"
                aria-label="Chat settings"
                className={`p-2 rounded-full cursor-pointer transition-colors ${
                  showMenu
                    ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                onClick={() => {
                  setShowMenu((prev) => !prev);
                  if (showMenu) setShowDisappearOptions(false);
                }}
              >
                {showMenu ? <X className="w-5 h-5" /> : <MoreVertical className="w-5 h-5" />}
              </button>

              {showMenu && (
                <div
                  className={`absolute right-0 top-12 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border border-gray-200/90 dark:border-gray-800 shadow-2xl rounded-2xl z-50 overflow-hidden animate-context-menu ${
                    showDisappearOptions ? "w-[310px]" : "w-64 py-1.5"
                  }`}
                >
                  {showDisappearOptions ? (
                    <div className="p-3.5 space-y-3">
                      {/* Refined Disappearing Mode Header */}
                      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-gray-100 dark:border-gray-800">
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={() => setShowDisappearOptions(false)}
                            className="p-1 -ml-1 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                            aria-label="Back to chat menu"
                          >
                            <ArrowLeft className="w-4 h-4" />
                          </button>
                          <div className="w-7 h-7 rounded-lg bg-sky-50 dark:bg-sky-900/30 flex items-center justify-center text-blue-600 dark:text-sky-400 shrink-0">
                            <Clock className="w-4 h-4" />
                          </div>
                          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                            Disappearing
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setShowMenu(false);
                            setShowDisappearOptions(false);
                          }}
                          className="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          aria-label="Close disappearing settings"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Primary Modes: Off vs After Seen */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleSetDisappearingMode("off")}
                          className={`flex flex-col items-start gap-1.5 p-3 rounded-xl border text-left transition-all ${
                            effectiveDisappearingMode === "off"
                              ? "bg-blue-50/90 dark:bg-blue-900/25 border-blue-400/70 dark:border-sky-500/50 text-blue-700 dark:text-sky-300"
                              : "bg-gray-50/70 dark:bg-gray-800/50 border-gray-200/70 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-800"
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <ShieldOff className="w-4 h-4" />
                            {effectiveDisappearingMode === "off" && (
                              <Check className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400" />
                            )}
                          </div>
                          <span className="text-xs font-semibold">Off</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleSetDisappearingMode("after_seen")}
                          className={`flex flex-col items-start gap-1.5 p-3 rounded-xl border text-left transition-all ${
                            effectiveDisappearingMode === "after_seen"
                              ? "bg-blue-50/90 dark:bg-blue-900/25 border-blue-400/70 dark:border-sky-500/50 text-blue-700 dark:text-sky-300"
                              : "bg-gray-50/70 dark:bg-gray-800/50 border-gray-200/70 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-800"
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <Eye className="w-4 h-4" />
                            {effectiveDisappearingMode === "after_seen" && (
                              <Check className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400" />
                            )}
                          </div>
                          <span className="text-xs font-semibold">After Seen</span>
                        </button>
                      </div>

                      {/* Timer Controls when After Seen is Active */}
                      {effectiveDisappearingMode === "after_seen" && (
                        <div className="rounded-xl bg-sky-50/60 dark:bg-slate-800/70 border border-sky-200/70 dark:border-slate-700/70 p-3 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400" />
                              Timer
                            </span>
                            <span className="text-xs font-semibold text-blue-600 dark:text-sky-300 tabular-nums">
                              {effectiveAfterSeenSeconds}s
                            </span>
                          </div>

                          <div className="grid grid-cols-5 gap-1.5">
                            {PRESET_AFTER_SEEN_SECONDS.map((sec) => (
                              <button
                                key={sec}
                                type="button"
                                onClick={() => handleSetDisappearingMode("after_seen", sec)}
                                className={`py-1.5 rounded-lg text-xs font-semibold tabular-nums transition-colors ${
                                  effectiveAfterSeenSeconds === sec
                                    ? "bg-blue-600 text-white shadow-xs"
                                    : "bg-white dark:bg-gray-900/80 text-gray-700 dark:text-gray-300 border border-gray-200/80 dark:border-gray-700 hover:border-blue-400 dark:hover:border-sky-500"
                                }`}
                              >
                                {sec}s
                              </button>
                            ))}
                          </div>

                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              handleSetDisappearingMode("after_seen", customSeenSeconds);
                            }}
                            className="flex items-center gap-1.5"
                          >
                            <div className="flex items-center flex-1 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = clampAfterSeenSeconds(
                                    Number(customSeenSeconds || effectiveAfterSeenSeconds) - 5
                                  );
                                  setCustomSeenSeconds(String(next));
                                }}
                                aria-label="Decrease seconds"
                                className="px-2 py-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <input
                                type="number"
                                min={MIN_AFTER_SEEN_SECONDS}
                                max={MAX_AFTER_SEEN_SECONDS}
                                value={customSeenSeconds}
                                onChange={(e) => setCustomSeenSeconds(e.target.value)}
                                className="w-full text-center text-xs font-semibold tabular-nums bg-transparent text-gray-900 dark:text-gray-100 outline-none py-1.5"
                                placeholder="Sec"
                              />
                              <span className="text-[11px] text-gray-400 pr-1">s</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = clampAfterSeenSeconds(
                                    Number(customSeenSeconds || effectiveAfterSeenSeconds) + 5
                                  );
                                  setCustomSeenSeconds(String(next));
                                }}
                                aria-label="Increase seconds"
                                className="px-2 py-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <button
                              type="submit"
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors shrink-0"
                            >
                              Apply
                            </button>
                          </form>
                        </div>
                      )}

                      {/* Scheduled Auto-Delete Strip */}
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 px-0.5">
                          <Timer className="w-3.5 h-3.5" />
                          <span>Scheduled</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {[
                            { id: "1h", label: "1 Hour" },
                            { id: "24h", label: "24 Hours" },
                            { id: "7d", label: "7 Days" },
                          ].map((opt) => {
                            const isActive = effectiveDisappearingMode === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => handleSetDisappearingMode(opt.id)}
                                className={`py-2 px-2 rounded-xl text-xs font-medium border transition-all text-center ${
                                  isActive
                                    ? "bg-blue-50/90 dark:bg-blue-900/25 border-blue-400/70 dark:border-sky-500/50 text-blue-700 dark:text-sky-300 font-semibold"
                                    : "bg-gray-50/70 dark:bg-gray-800/50 border-gray-200/70 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-800"
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 mb-1 flex items-center justify-between">
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                          Chat Options
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowDisappearOptions(true)}
                        className="w-full text-left px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5">
                          {effectiveDisappearingMode === "after_seen" ? (
                            <Clock className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                          ) : (
                            <Timer className="w-4 h-4 text-blue-500" />
                          )}
                          <div>
                            <p className="font-medium">Disappearing Messages</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {activeDisappearLabel}
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          setShowContactInfo(true);
                        }}
                        className="w-full text-left px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2.5"
                      >
                        <User className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                        <span>View Profile</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          setConfirmAction("clear");
                        }}
                        className="w-full text-left px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2.5"
                      >
                        <Eraser className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                        <span>Clear Chat</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          setConfirmAction("unconnect");
                        }}
                        className="w-full text-left px-4 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2.5"
                      >
                        <UserMinus className="w-4 h-4" />
                        <span>Un-connect</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          setConfirmAction("block");
                        }}
                        className="w-full text-left px-4 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2.5"
                      >
                        <Ban className="w-4 h-4" />
                        <span>Block User</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Toast Notification */}
      {toastMsg && (
        <div className="absolute top-[74px] left-1/2 -translate-x-1/2 z-40 bg-gray-900 dark:bg-gray-700 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg">
          {toastMsg}
        </div>
      )}

      {/* Offline Banner inside Chat */}
      {!isOnline && (
        <div className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 px-4 py-1.5 flex items-center justify-center gap-2 text-xs text-slate-700 dark:text-slate-300 z-20">
          <WifiOff className="w-3.5 h-3.5" />
          <span>You are offline. Messages will sync when reconnected.</span>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {confirmAction === "clear"
                ? "Clear chat messages?"
                : confirmAction === "unconnect"
                ? `Un-connect ${data.user?.displayName}?`
                : `Block ${data.user?.displayName}?`}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              {confirmAction === "clear"
                ? `All messages in this chat will be cleared. Your accepted connection with ${
                    data.user?.displayName || "this user"
                  } will remain active.`
                : confirmAction === "unconnect"
                ? "This removes your connection and deletes this conversation. You will need to send a new request to chat again."
                : "You will no longer receive messages or chat requests from this user."}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={
                  confirmAction === "clear"
                    ? handleClearChat
                    : confirmAction === "unconnect"
                    ? handleUnconnect
                    : handleBlockUser
                }
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors"
              >
                {confirmAction === "clear"
                  ? "Clear Chat"
                  : confirmAction === "unconnect"
                  ? "Un-connect"
                  : "Block User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contact Info Modal */}
      {showContactInfo && (
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
          onClick={() => setShowContactInfo(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl shadow-2xl max-w-sm w-full p-6 text-center relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowContactInfo(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
              aria-label="Close profile"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="relative inline-block mb-3 mt-2">
              <img
                src={
                  data.user?.photoURL ||
                  "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
                }
                alt={data.user?.displayName || ""}
                className="w-24 h-24 rounded-full object-cover border-4 border-white dark:border-gray-800 shadow-md"
              />
              <span
                className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-white dark:border-gray-900 ${
                  otherOnlineState === "online"
                    ? "bg-emerald-500"
                    : otherOnlineState === "away"
                    ? "bg-sky-400"
                    : "bg-gray-400 dark:bg-gray-600"
                }`}
              />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {data.user?.displayName}
            </h3>
            {data.user?.talklyId && (
              <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mt-0.5">
                {data.user.talklyId}
              </p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">
              {otherOnlineState === "online"
                ? "Online"
                : otherOnlineState === "away"
                ? "Away"
                : formatLastSeen(otherLastSeen)}
            </p>
            <div className="bg-gray-50 dark:bg-gray-950 border border-gray-100 dark:border-gray-800 rounded-2xl p-4 text-left mb-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
                About
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {data.user?.about || "Hey there! I am using Talkly."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowContactInfo(false)}
              className="w-full py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors"
            >
              Back to Chat
            </button>
          </div>
        </div>
      )}

      {/* Top System Notice for Disappearing / Seen & Disappear Mode */}
      {effectiveDisappearingMode !== "off" && (
        <div className="bg-gray-50 dark:bg-gray-950 px-4 pt-3 pb-1 flex justify-center shrink-0 z-10 transition-colors duration-200">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-4 py-1.5 rounded-full text-center ${
              effectiveDisappearingMode === "after_seen"
                ? "bg-sky-50 text-sky-900 dark:bg-slate-800/90 dark:text-sky-200 border border-sky-200/80 dark:border-slate-700"
                : "bg-gray-200/80 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
            }`}
          >
            {effectiveDisappearingMode === "after_seen" ? (
              <>
                <Clock className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                <span>
                  Seen &amp; Disappear enabled
                  {chatMeta?.disappearingUpdatedByName
                    ? ` by ${
                        chatMeta.disappearingUpdatedBy === currentUser.uid
                          ? "you"
                          : chatMeta.disappearingUpdatedByName
                      }`
                    : ""}
                  . Messages vanish {effectiveAfterSeenSeconds}s after being seen or on exit.
                </span>
              </>
            ) : (
              <>
                <Timer className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Disappearing messages enabled ({activeDisappearLabel}). New &amp; active messages vanish automatically.
                </span>
              </>
            )}
          </span>
        </div>
      )}

      {/* Messages (bottom-aligned, growing upward with auto-scroll) */}
      <div
        ref={messagesContainerRef}
        onContextMenu={handleChatAreaContextMenu}
        className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col bg-gray-50 dark:bg-gray-950 transition-colors duration-200"
      >
        <div className="z-10 flex flex-col gap-2 mt-auto">

          {filteredMessages.map((m) => {
            const scheduleEntry = afterSeenSchedule.get(m.id);
            return (
              <div key={m.id} className="flex flex-col">
                {m.id === firstUnreadId && !searchQuery && unreadDividerCount > 0 && (
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px bg-blue-200 dark:bg-blue-800/60" />
                    <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-3 py-1 rounded-full dark:bg-blue-900/60 dark:text-blue-300 shadow-xs">
                      {unreadDividerCount}{" "}
                      {unreadDividerCount === 1 ? "Unread Message" : "Unread Messages"}
                    </span>
                    <div className="flex-1 h-px bg-blue-200 dark:bg-blue-800/60" />
                  </div>
                )}
                <Message
                  message={m}
                  isLastOutgoing={m.id === lastOutgoingId}
                  disappearingMode={effectiveDisappearingMode}
                  nowMs={serverNowMs}
                  fallbackReadAtMs={localReadObservedAtRef.current.get(m.id)}
                  disappearDeadlineMs={scheduleEntry?.expireAtMs}
                  disappearDurationMs={scheduleEntry?.durationMs}
                  otherUserName={data.user?.displayName || ""}
                  isHighlighted={highlightedMsgId === m.id}
                  isKeyboardSelected={navSelectedMsgId === m.id}
                  onEditMessage={handleEditMessage}
                  onDeleteMessage={handleDeleteMessage}
                  onDeleteForMe={handleDeleteForMe}
                  onCopyMessage={handleCopyMessage}
                  onReplyMessage={handleReplyMessage}
                  onJumpToMessage={handleJumpToMessage}
                  onTriggerEmojiEffect={triggerEmojiEffect}
                />
              </div>
            );
          })}

          {searchQuery && filteredMessages.length === 0 && (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-4 text-sm">
              No messages found for "{searchQuery}"
            </div>
          )}
          <div ref={endRef}></div>
        </div>
      </div>

      {/* Input or Request Actions */}
      {isReceiver ? (
        <div className="absolute inset-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6 text-center transition-colors duration-200">
          <img
            src={
              data.user?.photoURL ||
              "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
            }
            alt=""
            className="w-24 h-24 rounded-full object-cover mb-4 shadow-lg border-4 border-white dark:border-gray-800"
          />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {data.user?.displayName}
          </h2>
          <p className="text-gray-600 dark:text-gray-300 mb-8 max-w-sm">
            Wants to connect with you. Accepting this request will allow them to send you messages.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xs">
            <button
              onClick={handleAccept}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 dark:bg-blue-700 text-white font-medium rounded-xl hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors shadow-sm"
            >
              <Check className="w-5 h-5" /> Accept Request
            </button>
            <button
              onClick={handleReject}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 text-red-600 dark:text-red-400 font-medium border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/20 rounded-xl hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
            >
              <X className="w-5 h-5" /> Reject
            </button>
          </div>
        </div>
      ) : isSender ? (
        <div className="absolute inset-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6 text-center transition-colors duration-200">
          <div className="w-20 h-20 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mb-6">
            <Send className="w-8 h-8 text-blue-600 dark:text-blue-400 ml-1" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Request Sent</h2>
          <p className="text-gray-600 dark:text-gray-300 max-w-sm">
            Waiting for {data.user?.displayName} to accept your request. You'll be able to chat once they approve.
          </p>
          <button
            onClick={() => dispatch({ type: "BACK_TO_SIDEBAR" })}
            className="mt-8 text-blue-600 dark:text-blue-400 font-medium hover:underline"
          >
            Go Back
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 relative z-20 transition-colors duration-200 pb-[env(safe-area-inset-bottom)]">
          {/* WhatsApp-Style Reply Preview Strip */}
          {replyingTo && (
            <div className="px-3 sm:px-4 py-2 flex items-center justify-between gap-2.5 border-b border-gray-100 dark:border-gray-800/80 bg-gray-50/90 dark:bg-gray-900/95">
              <div className="flex items-center gap-2.5 min-w-0 flex-1 bg-white dark:bg-gray-800/80 border border-gray-200/80 dark:border-gray-700/80 rounded-xl px-3 py-1.5 overflow-hidden">
                <Reply className="w-4 h-4 text-blue-600 dark:text-sky-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-blue-600 dark:text-sky-400 truncate">
                      {replyingTo.senderId === currentUser.uid ? "You" : replyingTo.senderName}
                    </p>
                    <span className="hidden sm:inline text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                      ↑↓ shift · ← incoming · → yours · Esc
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 [overflow-wrap:anywhere]">
                    {replyingTo.text}
                  </p>
                </div>
              </div>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  setReplyingTo(null);
                  setNavSelectedMsgId(null);
                  inputRef.current?.focus({ preventScroll: true });
                }}
                onClick={() => {
                  setReplyingTo(null);
                  setNavSelectedMsgId(null);
                  inputRef.current?.focus({ preventScroll: true });
                }}
                aria-label="Cancel reply"
                className="p-2 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/70 dark:hover:bg-gray-800 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="min-h-[64px] flex items-end px-2.5 sm:px-4 py-2.5 gap-2 sm:gap-3 relative">
            {showEmoji && (
              <div
                ref={emojiPickerRef}
                className="absolute bottom-[74px] left-2 right-2 sm:left-4 sm:right-auto sm:w-[320px] z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl rounded-2xl overflow-hidden animate-context-menu"
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50/90 dark:bg-gray-900">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                      Emojis
                    </span>
                    <span className="hidden sm:inline text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                      Ctrl+E
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmoji(false);
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                    aria-label="Close emoji picker"
                    title="Close (Ctrl+E or Esc)"
                    className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200/70 dark:hover:bg-gray-800 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Instant Quick-Send Animated Reactions */}
                <div className="flex items-center justify-between gap-1 px-2.5 py-1.5 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto">
                  {QUICK_REACTION_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => handleSend(em)}
                      title={`Send ${em} with screen effect`}
                      className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-lg hover:bg-blue-50 dark:hover:bg-gray-800 hover:scale-115 active:scale-95 transition-transform"
                    >
                      {em}
                    </button>
                  ))}
                </div>

                <EmojiPicker
                  theme={darkMode ? EmojiTheme.DARK : EmojiTheme.LIGHT}
                  onEmojiClick={onEmojiClick}
                  width="100%"
                  height={340}
                  previewConfig={{ showPreview: false }}
                />
              </div>
            )}

            <div className="flex items-center text-gray-500 dark:text-gray-400 shrink-0 pb-0.5">
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowEmoji((prev) => !prev)}
                title="Emojis (Ctrl+E)"
                aria-label="Toggle emoji picker"
                className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${
                  showEmoji
                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-sky-400"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400"
                }`}
              >
                <Smile className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 min-w-0 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center px-3.5 sm:px-4 py-2 transition-colors duration-200 focus-within:ring-2 focus-within:ring-blue-500/30 dark:focus-within:ring-sky-400/30">
              <textarea
                ref={inputRef}
                rows={1}
                placeholder={
                  effectiveDisappearingMode === "after_seen"
                    ? "Send a Seen & Disappear message..."
                    : "Type a message"
                }
                className="w-full min-w-0 bg-transparent outline-none resize-none text-[16px] md:text-[15px] leading-6 max-h-[120px] text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 [overflow-wrap:anywhere]"
                value={text}
                onChange={handleTyping}
                onKeyDown={handleKey}
              />
            </div>

            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onTouchEnd={(e) => {
                if (!text.trim()) return;
                const touch = e.changedTouches?.[0];
                if (touch) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pad = 16;
                  const inside =
                    touch.clientX >= rect.left - pad &&
                    touch.clientX <= rect.right + pad &&
                    touch.clientY >= rect.top - pad &&
                    touch.clientY <= rect.bottom + pad;
                  if (!inside) return;
                }
                e.preventDefault();
                handleSend();
              }}
              onClick={() => {
                if (text.trim()) handleSend();
              }}
              aria-disabled={!text.trim()}
              aria-label="Send message"
              className={`w-10 h-10 shrink-0 flex items-center justify-center rounded-full transition-colors mb-0.5 select-none touch-manipulation ${
                text.trim()
                  ? "bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer active:scale-95"
                  : "text-gray-300 dark:text-gray-600 cursor-default"
              }`}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
