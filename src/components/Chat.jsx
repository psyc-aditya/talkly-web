import { useState, useEffect, useRef, useMemo } from "react";
import { useChat } from "../context/ChatContext";
import { useAuth } from "../context/AuthContext";
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
  Flame,
  Timer,
  WifiOff,
  Trash2,
  Ban,
  ChevronRight,
  User,
} from "lucide-react";
import Message from "./Message";
import EmojiPicker, { Theme as EmojiTheme } from "emoji-picker-react";
import { handleFirestoreError, OperationType } from "../utils/errorHandler";

const DISAPPEAR_OPTIONS = [
  { id: "off", label: "Off", desc: "Messages stay in chat" },
  { id: "after_seen", label: "Seen & Disappear", desc: "Vanishes 10s after seen or on exit" },
  { id: "1h", label: "1 Hour", desc: "Disappears 1 hour after sending" },
  { id: "24h", label: "24 Hours", desc: "Disappears 24 hours after sending" },
  { id: "7d", label: "7 Days", desc: "Disappears 7 days after sending" },
];

const DURATION_MAP_MS = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

const AFTER_SEEN_MS = 10000;

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
  const [confirmAction, setConfirmAction] = useState(null); // 'clear' | 'block' | null
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const endRef = useRef(null);
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
  const menuRef = useRef(null);

  const effectiveDisappearingMode =
    chatMeta?.disappearingMode || (chatMeta?.disappearing ? "24h" : "off");

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
  }, [chatMeta]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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
    setShowMenu(false);
    setShowDisappearOptions(false);
    setConfirmAction(null);
    setShowContactInfo(false);
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
  const handleSetDisappearingMode = async (mode) => {
    try {
      await updateDoc(doc(db, "chats", data.chatId), {
        disappearing: mode !== "off",
        disappearingMode: mode,
        disappearingUpdatedAt: serverTimestamp(),
        disappearingUpdatedBy: currentUser.uid,
        disappearingUpdatedByName: currentUser.displayName || "Someone",
      });
      setShowDisappearOptions(false);
      setShowMenu(false);
      const selected = DISAPPEAR_OPTIONS.find((o) => o.id === mode);
      showToast(
        mode === "off"
          ? "Disappearing messages turned off."
          : `${selected?.label} enabled for this chat.`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `chats/${data.chatId}`);
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
        // Sort client-side to avoid needing a composite index in Firestore
        msgs.sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
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
          if (effectiveDisappearingMode === "after_seen" && !m.disappearMode) {
            payload.disappearMode = "after_seen";
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

  // 1-second ticker for disappearing / Seen & Disappear messages
  const clearedAtMs = chatMeta?.clearedAt?.toMillis ? chatMeta.clearedAt.toMillis() : 0;
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
      if (deletingIdsRef.current.has(m.id) || m.expired) return false;

      const isAfterSeenMsg =
        m.disappearMode === "after_seen" ||
        (effectiveDisappearingMode === "after_seen" &&
          m.status === "read" &&
          (!chatMeta?.disappearingUpdatedAt?.toMillis ||
            (m.readAt?.toMillis?.() || localReadObservedAtRef.current.get(m.id) || 0) >=
              chatMeta.disappearingUpdatedAt.toMillis() - 2000));

      // 1. Seen & Disappear (10s after seen)
      if (isAfterSeenMsg) {
        if (m.status === "read") {
          const readMs = m.readAt?.toMillis
            ? m.readAt.toMillis()
            : localReadObservedAtRef.current.get(m.id);
          if (readMs) {
            return serverNowMs - readMs >= AFTER_SEEN_MS;
          }
        }
        return false;
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
    const remaining = messages.filter(
      (m) => !deleteIdsSet.has(m.id) && !m.expired && !hiddenExpiredIds.has(m.id)
    );
    const lastOriginal = messages[messages.length - 1];
    const lastWasDeleted = lastOriginal && deleteIdsSet.has(lastOriginal.id);

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
              senderId: lastOriginal.senderId,
              disappeared: true,
              status: lastOriginal.status || "read",
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
    effectiveDisappearingMode,
    data.chatId,
    chatMeta?.disappearingUpdatedAt,
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

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

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
      ...(effectiveDisappearingMode !== "off" ? { disappearMode: effectiveDisappearingMode } : {}),
    };

    setText("");
    setShowEmoji(false);

    try {
      await addDoc(collection(db, "messages"), messageData);
      const receiverId = data.user.uid;

      await updateDoc(doc(db, "chats", data.chatId), {
        lastMessage: { text: trimmed, senderId: currentUser.uid, status: "sent" },
        updatedAt: serverTimestamp(),
        [`unreadCounts.${receiverId}`]: increment(1),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "messages");
    }
  };

  const handleKey = (e) => {
    if (e.code === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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

  const lastOutgoingId = useMemo(() => {
    for (let i = filteredMessages.length - 1; i >= 0; i--) {
      if (filteredMessages[i].senderId === currentUser.uid) {
        return filteredMessages[i].id;
      }
    }
    return null;
  }, [filteredMessages, currentUser.uid]);

  const activeDisappearLabel =
    DISAPPEAR_OPTIONS.find((o) => o.id === effectiveDisappearingMode)?.label || "Off";

  return (
    <div className="flex flex-col w-full h-full bg-white dark:bg-gray-900 relative transition-colors duration-200">
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
                      ? "bg-amber-400"
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
                      className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                        effectiveDisappearingMode === "after_seen"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                          : "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                      }`}
                    >
                      {effectiveDisappearingMode === "after_seen" ? (
                        <Flame className="w-3 h-3" />
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
                    <span className="text-amber-600 dark:text-amber-400 font-medium inline-flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
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
                <div className="absolute right-0 top-12 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-xl rounded-xl py-2 w-64 z-50 overflow-hidden">
                  <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700 mb-1 flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {showDisappearOptions ? "Disappearing Mode" : "Chat Settings"}
                    </p>
                    {showDisappearOptions && (
                      <button
                        type="button"
                        onClick={() => setShowDisappearOptions(false)}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Back
                      </button>
                    )}
                  </div>

                  {showDisappearOptions ? (
                    <div className="py-1">
                      {DISAPPEAR_OPTIONS.map((opt) => {
                        const isActive = effectiveDisappearingMode === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleSetDisappearingMode(opt.id)}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between gap-2 ${
                              isActive
                                ? "bg-blue-50/80 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                                : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                            }`}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium flex items-center gap-1.5">
                                {opt.id === "after_seen" && (
                                  <Flame className="w-3.5 h-3.5 text-amber-500" />
                                )}
                                {opt.label}
                              </span>
                              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                {opt.desc}
                              </span>
                            </div>
                            {isActive && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowDisappearOptions(true)}
                        className="w-full text-left px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5">
                          {effectiveDisappearingMode === "after_seen" ? (
                            <Flame className="w-4 h-4 text-amber-500" />
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
                        className="w-full text-left px-4 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2.5"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Clear Chat</span>
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
        <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800/50 px-4 py-1.5 flex items-center justify-center gap-2 text-xs text-amber-800 dark:text-amber-300 z-20">
          <WifiOff className="w-3.5 h-3.5" />
          <span>You are offline. Messages will sync when reconnected.</span>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {confirmAction === "clear" ? "Clear chat messages?" : `Block ${data.user?.displayName}?`}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              {confirmAction === "clear"
                ? `All messages in this chat will be cleared. Your accepted connection with ${
                    data.user?.displayName || "this user"
                  } will remain active.`
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
                onClick={confirmAction === "clear" ? handleClearChat : handleBlockUser}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors"
              >
                {confirmAction === "clear" ? "Clear Chat" : "Block User"}
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
                    ? "bg-amber-400"
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col gap-2 bg-gray-50 dark:bg-gray-950 transition-colors duration-200">
        <div className="z-10 flex flex-col gap-2">
          {effectiveDisappearingMode !== "off" && (
            <div className="flex justify-center my-2">
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-4 py-1.5 rounded-full text-center ${
                  effectiveDisappearingMode === "after_seen"
                    ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-200/80 dark:border-amber-700/50"
                    : "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                }`}
              >
                {effectiveDisappearingMode === "after_seen" ? (
                  <>
                    <Flame className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>
                      Seen &amp; Disappear enabled
                      {chatMeta?.disappearingUpdatedByName
                        ? ` by ${
                            chatMeta.disappearingUpdatedBy === currentUser.uid
                              ? "you"
                              : chatMeta.disappearingUpdatedByName
                          }`
                        : ""}
                      . Messages vanish 10s after being seen or on exit.
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

          {filteredMessages.map((m) => (
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
                onEditMessage={handleEditMessage}
                onDeleteMessage={handleDeleteMessage}
              />
            </div>
          ))}

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
        <div className="min-h-[70px] bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex items-end px-4 py-3 gap-3 relative z-20 transition-colors duration-200">
          {showEmoji && (
            <div className="absolute bottom-[80px] left-4 z-50 shadow-xl rounded-xl overflow-hidden">
              <EmojiPicker
                theme={EmojiTheme.DARK}
                onEmojiClick={onEmojiClick}
                width={300}
                height={400}
              />
            </div>
          )}
          <div className="flex gap-4 text-gray-500 dark:text-gray-400 mb-2">
            <Smile
              className="w-6 h-6 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition"
              onClick={() => setShowEmoji(!showEmoji)}
            />
          </div>

          <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center px-4 py-2 transition-colors duration-200">
            <input
              type="text"
              placeholder={
                effectiveDisappearingMode === "after_seen"
                  ? "Send a Seen & Disappear message..."
                  : "Type a message"
              }
              className="w-full bg-transparent outline-none text-[15px] text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
              value={text}
              onChange={handleTyping}
              onKeyDown={handleKey}
            />
          </div>

          <button
            type="button"
            onClick={handleSend}
            disabled={!text.trim()}
            aria-label="Send message"
            className={`mb-1 p-1 rounded-full transition-colors ${
              text.trim()
                ? "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer"
                : "text-gray-300 dark:text-gray-600 cursor-default"
            }`}
          >
            <Send className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
}
