import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useTheme } from "../context/ThemeContext";
import { useContextMenu } from "../context/ContextMenuContext";
import { db, rtdb } from "../firebase";
import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  doc,
  setDoc,
  serverTimestamp,
  getDoc,
  updateDoc,
  limit,
  writeBatch,
  deleteDoc,
} from "firebase/firestore";
import { ref as rtdbRef, onValue } from "firebase/database";
import {
  X,
  MessageSquarePlus,
  Settings,
  Search,
  Check,
  CheckCheck,
  WifiOff,
  UserPlus,
  MessageSquare,
  Clock,
  Bell,
  BellOff,
  Pin,
  PinOff,
  User,
  Eraser,
  Trash2,
  UserMinus,
  Ban,
  ChevronDown,
  CircleDot,
  Copy,
  Sun,
  Moon,
  Lock,
} from "lucide-react";
import { handleFirestoreError, OperationType } from "../utils/errorHandler";
import {
  isNotificationSupported,
  getNotificationPermission,
  getDesktopNotifEnabled,
  setDesktopNotifEnabled,
  requestDesktopNotificationPermission,
  showDesktopNotification,
  TALKLY_LOCKED_ICON,
} from "../utils/notifications";
import {
  getPinnedChatIds,
  togglePinnedChat,
  getMutedChatIds,
  toggleMutedChat,
  getHiddenChatsMap,
  markChatHidden,
  unhideChat,
} from "../utils/chatPrefs";

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
  if (isToday) return `Last seen today at ${timeStr}`;
  if (isYesterday) return `Last seen yesterday at ${timeStr}`;
  return `Last seen ${date.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function ChatRow({
  chat,
  currentUserId,
  isSelected,
  isPinned,
  isMuted,
  onSelect,
  onContextMenu,
  onOpenMenuButton,
}) {
  const [userPresence, setUserPresence] = useState("offline");
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    const uid = chat.userInfo?.uid;
    if (!uid) return;
    const statusRef = rtdbRef(rtdb, `/status/${uid}`);
    const unsubStatus = onValue(statusRef, (snap) => {
      const val = snap.val();
      setUserPresence(
        val?.state === "online" ? "online" : val?.state === "away" ? "away" : "offline"
      );
    });

    const typingRef = rtdbRef(rtdb, `typing/${chat.id}/${uid}`);
    const unsubTyping = onValue(typingRef, (snap) => {
      setIsTyping(Boolean(snap.val()));
    });

    return () => {
      unsubStatus();
      unsubTyping();
    };
  }, [chat.id, chat.userInfo?.uid]);

  const unreadCount = chat.unreadCounts?.[currentUserId] || 0;
  const isLastOutgoing = chat.lastMessage?.senderId === currentUserId;
  const lastStatus = chat.lastMessage?.status;

  return (
    <div
      className={`group flex items-center p-3 cursor-pointer transition-colors relative ${
        isSelected
          ? "bg-blue-50/70 dark:bg-blue-900/20"
          : "hover:bg-gray-50 dark:hover:bg-gray-800"
      }`}
      onClick={onSelect}
      onContextMenu={(e) => onContextMenu?.(e, chat)}
    >
      <div className="relative mr-4 shrink-0">
        <img
          src={
            chat.userInfo?.photoURL ||
            "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
          }
          alt=""
          className="w-12 h-12 rounded-full object-cover"
        />
        <span
          className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-900 ${
            userPresence === "online"
              ? "bg-emerald-500"
              : userPresence === "away"
              ? "bg-sky-400"
              : "bg-gray-400 dark:bg-gray-600"
          }`}
          title={
            userPresence === "online"
              ? "Online"
              : userPresence === "away"
              ? "Away"
              : "Offline"
          }
        />
      </div>

      <div className="flex-1 min-w-0 border-b border-gray-100 dark:border-gray-800 pb-3 pt-1 flex flex-col justify-center">
        <div className="flex justify-between items-center gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`text-[17px] truncate ${
                unreadCount > 0
                  ? "font-semibold text-gray-900 dark:text-white"
                  : "text-gray-900 dark:text-gray-100"
              }`}
            >
              {chat.userInfo?.displayName}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isMuted && (
              <BellOff
                className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0"
                title="Muted"
              />
            )}
            {isPinned && (
              <Pin
                className="w-3.5 h-3.5 text-blue-500 dark:text-sky-400 shrink-0 rotate-45"
                title="Pinned"
              />
            )}
            {chat.updatedAt && (
              <span
                className={`text-xs tabular-nums ${
                  unreadCount > 0
                    ? "text-blue-600 dark:text-blue-400 font-medium"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {new Date(chat.updatedAt.toDate()).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mt-0.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {isTyping ? (
              <span className="text-sm text-blue-600 dark:text-blue-400 font-medium truncate">
                typing...
              </span>
            ) : chat.status === "pending" ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                Waiting for response...
              </p>
            ) : chat.lastMessage?.disappeared ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 italic truncate flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>Message disappeared</span>
              </p>
            ) : (
              <>
                {isLastOutgoing && chat.lastMessage?.text && (
                  <span className="shrink-0 inline-flex items-center">
                    {lastStatus === "read" ? (
                      <CheckCheck className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                    ) : lastStatus === "delivered" ? (
                      <CheckCheck className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                    ) : (
                      <Check className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                    )}
                  </span>
                )}
                <p
                  className={`text-sm truncate ${
                    unreadCount > 0
                      ? "text-gray-900 dark:text-gray-100 font-medium"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {chat.lastMessage?.text || (chat.clearedAt ? "No messages yet" : "Started a chat")}
                </p>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {unreadCount > 0 && (
              <span className="bg-blue-600 dark:bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center tabular-nums">
                {unreadCount}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenMenuButton?.(e, chat);
              }}
              title="Chat options"
              aria-label={`Options for ${chat.userInfo?.displayName || "chat"}`}
              className="p-1 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/80 dark:hover:bg-gray-700/80 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const { currentUser, isOnline, appLockConfig, lockAppNow } = useAuth();
  const { data, dispatch } = useChat();
  const { darkMode, toggleTheme } = useTheme();
  const { openContextMenu } = useContextMenu();
  const [chats, setChats] = useState([]);
  const [searchUsername, setSearchUsername] = useState("");
  const [allUsers, setAllUsers] = useState([]);
  const [showContacts, setShowContacts] = useState(false);
  const [myProfile, setMyProfile] = useState(null);

  const [isSearching, setIsSearching] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [selectedProfileUser, setSelectedProfileUser] = useState(null);
  const [selectedProfileOnline, setSelectedProfileOnline] = useState("offline");
  const [selectedProfileLastSeen, setSelectedProfileLastSeen] = useState(null);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [isRunningAction, setIsRunningAction] = useState(false);

  const [pinnedChatIds, setPinnedChatIds] = useState(() => getPinnedChatIds(currentUser?.uid));
  const [mutedChatIds, setMutedChatIds] = useState(() => getMutedChatIds(currentUser?.uid));
  const [hiddenChatsMap, setHiddenChatsMap] = useState(() => getHiddenChatsMap(currentUser?.uid));

  const [desktopNotifEnabled, setDesktopNotifEnabledState] = useState(() =>
    getDesktopNotifEnabled(currentUser?.uid)
  );
  const [notifPermission, setNotifPermission] = useState(() => getNotificationPermission());

  const userCacheRef = useRef(new Map());
  const deliveringChatsRef = useRef(new Set());
  const immediateSearchRef = useRef(false);
  const searchInputRef = useRef(null);

  useEffect(() => {
    const syncPrefs = () => {
      setPinnedChatIds(getPinnedChatIds(currentUser?.uid));
      setMutedChatIds(getMutedChatIds(currentUser?.uid));
      setHiddenChatsMap(getHiddenChatsMap(currentUser?.uid));
    };
    syncPrefs();
    window.addEventListener("talkly-chat-prefs-changed", syncPrefs);
    return () => window.removeEventListener("talkly-chat-prefs-changed", syncPrefs);
  }, [currentUser?.uid]);

  useEffect(() => {
    const syncNotif = () => {
      setNotifPermission(getNotificationPermission());
      setDesktopNotifEnabledState(getDesktopNotifEnabled(currentUser?.uid));
    };
    syncNotif();
    window.addEventListener("talkly-notif-pref-changed", syncNotif);
    return () => window.removeEventListener("talkly-notif-pref-changed", syncNotif);
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(""), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const unsub = onSnapshot(
      doc(db, "users", currentUser.uid),
      (snap) => {
        if (snap.exists()) {
          setMyProfile(snap.data());
        }
      },
      (e) => {
        console.error(e);
      }
    );
    return () => unsub();
  }, [currentUser?.uid]);

  const handleToggleDesktopNotifications = async () => {
    if (!isNotificationSupported()) {
      setToastMsg("Desktop notifications are not supported in this browser.");
      return;
    }
    if (desktopNotifEnabled) {
      setDesktopNotifEnabled(currentUser?.uid, false);
      setDesktopNotifEnabledState(false);
      setToastMsg("Desktop notifications turned off.");
      return;
    }

    const { granted, permission } = await requestDesktopNotificationPermission(currentUser?.uid);
    setNotifPermission(permission);
    if (granted) {
      setDesktopNotifEnabled(currentUser?.uid, true);
      setDesktopNotifEnabledState(true);
      setToastMsg("Desktop notifications enabled!");
      showDesktopNotification({
        title: "Talkly Notifications Active",
        body: "You will be notified here when new messages arrive.",
        icon: TALKLY_LOCKED_ICON,
        tag: "talkly-test-notification",
      });
    } else if (permission === "denied") {
      setDesktopNotifEnabledState(false);
      setToastMsg("Notifications blocked in browser settings. Enable them for this site.");
    }
  };

  // Trigger automatic search from shared /search=@... link (both when already logged in and right after login)
  useEffect(() => {
    if (!currentUser?.uid || !myProfile) return;
    let pending = data.pendingSearch;
    if (!pending) {
      try {
        pending = localStorage.getItem("talkly_pending_search") || "";
      } catch {
        pending = "";
      }
    }
    if (!pending || !pending.trim()) return;

    const cleanQuery = pending.trim();
    immediateSearchRef.current = true;
    setSearchUsername(cleanQuery);
    setShowContacts(false);
    setSelectedProfileUser(null);

    try {
      localStorage.removeItem("talkly_pending_search");
    } catch {
      // ignore storage errors
    }
    dispatch({ type: "CLEAR_PENDING_SEARCH" });

    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, [data.pendingSearch, currentUser?.uid, myProfile, dispatch]);

  // Listen to selected user's live RTDB presence while profile modal is open
  useEffect(() => {
    if (!selectedProfileUser?.uid) {
      setSelectedProfileOnline("offline");
      setSelectedProfileLastSeen(null);
      return;
    }
    const statusRef = rtdbRef(rtdb, `/status/${selectedProfileUser.uid}`);
    const unsub = onValue(statusRef, (snap) => {
      const val = snap.val();
      setSelectedProfileOnline(
        val?.state === "online" ? "online" : val?.state === "away" ? "away" : "offline"
      );
      setSelectedProfileLastSeen(typeof val?.last_changed === "number" ? val.last_changed : null);
    });
    return () => unsub();
  }, [selectedProfileUser?.uid]);

  // Smarter, faster user search with parallel prefix queries + client-side relevance ranking
  useEffect(() => {
    let cancelled = false;

    const fetchUsers = async () => {
      const raw = searchUsername.trim();
      if (!raw) {
        if (!showContacts) {
          setAllUsers([]);
          setIsSearching(false);
          return;
        }
        setIsSearching(true);
        try {
          const snap = await getDocs(query(collection(db, "users"), limit(30)));
          if (cancelled) return;
          const blocked = myProfile?.blockedUsers || [];
          const list = [];
          snap.forEach((d) => {
            const u = d.data();
            userCacheRef.current.set(u.uid, u);
            const hasBlockedMe = u.blockedUsers?.includes(currentUser.uid);
            if (u.uid !== currentUser.uid && !blocked.includes(u.uid) && !hasBlockedMe) {
              list.push(u);
            }
          });
          setAllUsers(list);
        } catch (err) {
          if (!cancelled) handleFirestoreError(err, OperationType.LIST, "users");
        } finally {
          if (!cancelled) setIsSearching(false);
        }
        return;
      }

      setIsSearching(true);
      try {
        const rawLower = raw.toLowerCase();
        const stripped = raw.replace(/^@+/, "");
        const strippedLower = stripped.toLowerCase();
        const withAt = `@${stripped}`;
        const withAtLower = `@${strippedLower}`;

        const queriesToRun = [];
        const addPrefixQuery = (field, prefix, max = 20) => {
          if (!prefix) return;
          queriesToRun.push(
            getDocs(
              query(
                collection(db, "users"),
                where(field, ">=", prefix),
                where(field, "<=", prefix + "\uf8ff"),
                limit(max)
              )
            ).catch(() => null)
          );
        };

        // Prefix queries on talklyId (single-field range -> zero composite index needed)
        addPrefixQuery("talklyId", withAt, 20);
        if (withAtLower !== withAt) {
          addPrefixQuery("talklyId", withAtLower, 20);
        }
        if (stripped.length > 0) {
          const capAt = `@${stripped.charAt(0).toUpperCase()}${stripped.slice(1).toLowerCase()}`;
          if (capAt !== withAt && capAt !== withAtLower) {
            addPrefixQuery("talklyId", capAt, 15);
          }
        }

        // Prefix queries on displayName when query doesn't strictly start with '@'
        if (!raw.startsWith("@") && stripped) {
          addPrefixQuery("displayName", stripped, 20);
          if (strippedLower !== stripped) {
            addPrefixQuery("displayName", strippedLower, 15);
          }
          const capName = `${stripped.charAt(0).toUpperCase()}${stripped.slice(1)}`;
          if (capName !== stripped && capName !== strippedLower) {
            addPrefixQuery("displayName", capName, 15);
          }
        }

        // Fallback batch for substring & about bio matching
        queriesToRun.push(
          getDocs(query(collection(db, "users"), limit(50))).catch(() => null)
        );

        const snapshots = await Promise.all(queriesToRun);
        if (cancelled) return;

        const candidateMap = new Map();
        for (const cachedUser of userCacheRef.current.values()) {
          if (cachedUser?.uid) candidateMap.set(cachedUser.uid, cachedUser);
        }
        for (const chat of chats) {
          if (chat.userInfo?.uid) {
            candidateMap.set(chat.userInfo.uid, chat.userInfo);
          }
        }
        for (const snap of snapshots) {
          if (!snap) continue;
          snap.forEach((d) => {
            const u = d.data();
            if (u?.uid) {
              userCacheRef.current.set(u.uid, u);
              candidateMap.set(u.uid, u);
            }
          });
        }

        const blocked = myProfile?.blockedUsers || [];
        const scored = [];

        for (const u of candidateMap.values()) {
          const hasBlockedMe = u.blockedUsers?.includes(currentUser.uid);
          if (u.uid === currentUser.uid || blocked.includes(u.uid) || hasBlockedMe) continue;

          const idLower = (u.talklyId || "").toLowerCase();
          const nameLower = (u.displayName || "").toLowerCase();
          const aboutLower = (u.about || "").toLowerCase();

          let score = 0;
          if (idLower && idLower === withAtLower) score = 1000;
          else if (idLower && idLower === rawLower) score = 950;
          else if (nameLower && nameLower === strippedLower) score = 850;
          else if (idLower && idLower.startsWith(withAtLower)) score = 700;
          else if (nameLower && strippedLower && nameLower.startsWith(strippedLower)) score = 600;
          else if (
            nameLower &&
            strippedLower &&
            nameLower.split(/\s+/).some((w) => w.startsWith(strippedLower))
          ) {
            score = 500;
          } else if (idLower && strippedLower && idLower.includes(strippedLower)) score = 400;
          else if (nameLower && strippedLower && nameLower.includes(strippedLower)) score = 300;
          else if (aboutLower && strippedLower && aboutLower.includes(strippedLower)) score = 150;

          if (score > 0) {
            scored.push({ user: u, score });
          }
        }

        scored.sort(
          (a, b) =>
            b.score - a.score ||
            (a.user.displayName || "").localeCompare(b.user.displayName || "")
        );

        setAllUsers(scored.map((item) => item.user));
      } catch (err) {
        if (!cancelled) handleFirestoreError(err, OperationType.LIST, "users");
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    };

    const delay = immediateSearchRef.current ? 0 : 220;
    immediateSearchRef.current = false;

    const timeoutId = setTimeout(() => {
      if (currentUser?.uid && myProfile) {
        fetchUsers();
      }
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [searchUsername, showContacts, currentUser?.uid, myProfile, chats]);

  useEffect(() => {
    if (!currentUser?.uid || !myProfile) return;
    const q = query(collection(db, "chats"), where("members", "array-contains", currentUser.uid));

    const unsub = onSnapshot(
      q,
      async (querySnapshot) => {
        const chatsData = [];
        const blocked = myProfile?.blockedUsers || [];
        for (const d of querySnapshot.docs) {
          const chatDoc = d.data();
          const otherUserId = chatDoc.members.find((id) => id !== currentUser.uid);
          if (otherUserId && !blocked.includes(otherUserId)) {
            let userInfo = userCacheRef.current.get(otherUserId);
            if (!userInfo) {
              const userSnap = await getDoc(doc(db, "users", otherUserId));
              if (userSnap.exists()) {
                userInfo = userSnap.data();
                userCacheRef.current.set(otherUserId, userInfo);
              }
            }
            if (userInfo) {
              const hasBlockedMe = userInfo.blockedUsers?.includes(currentUser.uid);
              if (!hasBlockedMe) {
                chatsData.push({
                  id: d.id,
                  ...chatDoc,
                  userInfo,
                });
              }
            }
          }
        }
        chatsData.sort((a, b) => (b.updatedAt?.toMillis() || 0) - (a.updatedAt?.toMillis() || 0));
        setChats(chatsData);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, "chats");
      }
    );

    return () => unsub();
  }, [currentUser.uid, myProfile]);

  // Real-time Delivery Acknowledgment for incoming messages in chats not currently open
  useEffect(() => {
    if (!currentUser?.uid || !isOnline || chats.length === 0) return;

    const chatsNeedingDelivery = chats.filter((chat) => {
      if (chat.id === data.chatId && document.visibilityState === "visible") return false;
      if (deliveringChatsRef.current.has(chat.id)) return false;
      const lm = chat.lastMessage;
      const unreadForMe = chat.unreadCounts?.[currentUser.uid] || 0;
      return (
        lm &&
        lm.senderId !== currentUser.uid &&
        (lm.status === "sent" || (unreadForMe > 0 && lm.status !== "delivered" && lm.status !== "read"))
      );
    });

    chatsNeedingDelivery.forEach(async (chat) => {
      deliveringChatsRef.current.add(chat.id);
      try {
        const q = query(collection(db, "messages"), where("chatId", "==", chat.id));
        const snap = await getDocs(q);
        const batch = writeBatch(db);
        let updatedCount = 0;

        snap.forEach((mDoc) => {
          const m = mDoc.data();
          if (m.senderId !== currentUser.uid && m.status === "sent") {
            batch.update(doc(db, "messages", mDoc.id), {
              status: "delivered",
              deliveredAt: serverTimestamp(),
            });
            updatedCount++;
          }
        });

        if (updatedCount > 0 || chat.lastMessage?.status === "sent") {
          batch.update(doc(db, "chats", chat.id), {
            "lastMessage.status": "delivered",
          });
          await batch.commit();
        }
      } catch (err) {
        console.error("Error acknowledging delivery:", err);
      } finally {
        deliveringChatsRef.current.delete(chat.id);
      }
    });
  }, [chats, data.chatId, currentUser?.uid, isOnline]);

  const handleSendRequest = async (u) => {
    if (!u?.uid || isSubmittingRequest) return;
    setIsSubmittingRequest(true);
    const combinedId = [currentUser.uid, u.uid].sort().join("_");
    try {
      const chatRef = doc(db, "chats", combinedId);
      const chatSnap = await getDoc(chatRef);

      if (!chatSnap.exists()) {
        await setDoc(chatRef, {
          members: [currentUser.uid, u.uid].sort(),
          updatedAt: serverTimestamp(),
          lastMessage: null,
          status: "pending",
          senderId: currentUser.uid,
        });
        setToastMsg("Chat request sent!");
      }
      setSelectedProfileUser(null);
      setSearchUsername("");
      setShowContacts(false);
      dispatch({ type: "CHANGE_USER", payload: u });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `chats/${combinedId}`);
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const handleAcceptFromModal = async (chatId, u) => {
    if (!chatId || isSubmittingRequest) return;
    setIsSubmittingRequest(true);
    try {
      await updateDoc(doc(db, "chats", chatId), {
        status: "accepted",
        updatedAt: serverTimestamp(),
      });
      setSelectedProfileUser(null);
      setSearchUsername("");
      setShowContacts(false);
      dispatch({ type: "CHANGE_USER", payload: u });
      setToastMsg("Request accepted!");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `chats/${chatId}`);
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const handleDeclineFromModal = async (chatId) => {
    if (!chatId || isSubmittingRequest) return;
    setIsSubmittingRequest(true);
    try {
      await deleteDoc(doc(db, "chats", chatId));
      setSelectedProfileUser(null);
      setToastMsg("Request declined.");
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `chats/${chatId}`);
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const handleOpenChatFromModal = (u) => {
    const combinedId = [currentUser.uid, u.uid].sort().join("_");
    unhideChat(currentUser.uid, combinedId);
    setSelectedProfileUser(null);
    setSearchUsername("");
    setShowContacts(false);
    dispatch({ type: "CHANGE_USER", payload: u });
  };

  // Wipe messages helper shared by Clear Chat, Delete Chat, and Un-connect
  const wipeChatMessages = async (chatId) => {
    const q = query(collection(db, "messages"), where("chatId", "==", chatId));
    const snap = await getDocs(q);
    const ids = snap.docs.map((d) => d.id);

    if (ids.length > 0) {
      try {
        const existing = JSON.parse(localStorage.getItem(`talkly_expired_${chatId}`) || "[]");
        const merged = Array.from(
          new Set([...(Array.isArray(existing) ? existing : []), ...ids])
        ).slice(-300);
        localStorage.setItem(`talkly_expired_${chatId}`, JSON.stringify(merged));
      } catch {
        // ignore storage errors
      }

      try {
        const deleteBatch = writeBatch(db);
        snap.docs.forEach((d) => deleteBatch.delete(doc(db, "messages", d.id)));
        await deleteBatch.commit();
      } catch (err) {
        if (err?.code === "permission-denied") {
          try {
            const wipeBatch = writeBatch(db);
            snap.docs.forEach((d) =>
              wipeBatch.update(doc(db, "messages", d.id), {
                expired: true,
                text: "",
                disappearedAt: serverTimestamp(),
              })
            );
            await wipeBatch.commit();
          } catch {
            // fallback already handled via clearedAt + localStorage
          }
        }
      }
    }
  };

  const handleClearChatAction = async (chat) => {
    if (!chat?.id) return;
    setIsRunningAction(true);
    try {
      await wipeChatMessages(chat.id);
      await updateDoc(doc(db, "chats", chat.id), {
        lastMessage: null,
        [`unreadCounts.${currentUser.uid}`]: 0,
        clearedAt: serverTimestamp(),
      }).catch(() => {});
      setToastMsg(`Cleared chat with ${chat.userInfo?.displayName || "user"}.`);
    } catch (err) {
      if (err?.code !== "permission-denied") {
        handleFirestoreError(err, OperationType.UPDATE, `chats/${chat.id}`);
      }
    } finally {
      setIsRunningAction(false);
      setConfirmModal(null);
    }
  };

  const handleDeleteChatAction = async (chat) => {
    if (!chat?.id) return;
    setIsRunningAction(true);
    try {
      await wipeChatMessages(chat.id);
      await updateDoc(doc(db, "chats", chat.id), {
        lastMessage: null,
        [`unreadCounts.${currentUser.uid}`]: 0,
        clearedAt: serverTimestamp(),
      }).catch(() => {});
      markChatHidden(currentUser.uid, chat.id, Date.now() + 2000);
      if (data.chatId === chat.id) {
        dispatch({ type: "CHANGE_USER", payload: null });
      }
      setToastMsg(`Deleted chat with ${chat.userInfo?.displayName || "user"}.`);
    } catch (err) {
      if (err?.code !== "permission-denied") {
        handleFirestoreError(err, OperationType.UPDATE, `chats/${chat.id}`);
      }
    } finally {
      setIsRunningAction(false);
      setConfirmModal(null);
    }
  };

  const handleUnconnectAction = async (chat) => {
    if (!chat?.id) return;
    setIsRunningAction(true);
    try {
      await wipeChatMessages(chat.id);
      await deleteDoc(doc(db, "chats", chat.id));
      unhideChat(currentUser.uid, chat.id);
      if (data.chatId === chat.id) {
        dispatch({ type: "CHANGE_USER", payload: null });
      }
      setToastMsg(`Disconnected from ${chat.userInfo?.displayName || "user"}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `chats/${chat.id}`);
    } finally {
      setIsRunningAction(false);
      setConfirmModal(null);
    }
  };

  const handleBlockUserAction = async (userObj, chatId = null) => {
    if (!userObj?.uid) return;
    setIsRunningAction(true);
    try {
      const userRef = doc(db, "users", currentUser.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const blockedUsers = userSnap.data().blockedUsers || [];
        if (!blockedUsers.includes(userObj.uid)) {
          await updateDoc(userRef, {
            blockedUsers: [...blockedUsers, userObj.uid],
          });
        }
      }
      if ((chatId && data.chatId === chatId) || data.user?.uid === userObj.uid) {
        dispatch({ type: "CHANGE_USER", payload: null });
      }
      setToastMsg(`Blocked ${userObj.displayName || "user"}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.uid}`);
    } finally {
      setIsRunningAction(false);
      setConfirmModal(null);
    }
  };

  const handleToggleReadStatus = async (chat) => {
    if (!chat?.id) return;
    const currentUnread = chat.unreadCounts?.[currentUser.uid] || 0;
    const nextUnread = currentUnread > 0 ? 0 : 1;
    try {
      await updateDoc(doc(db, "chats", chat.id), {
        [`unreadCounts.${currentUser.uid}`]: nextUnread,
      });
      setToastMsg(nextUnread > 0 ? "Marked as unread." : "Marked as read.");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `chats/${chat.id}`);
    }
  };

  const openChatRowMenu = (x, y, chat) => {
    const isPinned = pinnedChatIds.includes(chat.id);
    const isMuted = mutedChatIds.includes(chat.id);
    const hasUnread = (chat.unreadCounts?.[currentUser.uid] || 0) > 0;
    const isPendingSent = chat.status === "pending" && chat.senderId === currentUser.uid;

    openContextMenu({
      x,
      y,
      header: {
        avatar:
          chat.userInfo?.photoURL ||
          "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png",
        title: chat.userInfo?.displayName || "Chat",
        subtitle: chat.userInfo?.talklyId || "",
      },
      items: [
        {
          id: "open",
          label: "Open Chat",
          icon: MessageSquare,
          onClick: () => dispatch({ type: "CHANGE_USER", payload: chat.userInfo }),
        },
        {
          id: "profile",
          label: "View Profile",
          icon: User,
          onClick: () => setSelectedProfileUser(chat.userInfo),
        },
        {
          id: "pin",
          label: isPinned ? "Unpin Chat" : "Pin Chat",
          icon: isPinned ? PinOff : Pin,
          active: isPinned,
          onClick: () => {
            const pinned = togglePinnedChat(currentUser.uid, chat.id);
            setToastMsg(pinned ? "Chat pinned to top." : "Chat unpinned.");
          },
        },
        {
          id: "mute",
          label: isMuted ? "Unmute Notifications" : "Mute Notifications",
          icon: isMuted ? Bell : BellOff,
          active: isMuted,
          onClick: () => {
            const muted = toggleMutedChat(currentUser.uid, chat.id);
            setToastMsg(muted ? "Notifications muted for this chat." : "Notifications unmuted.");
          },
        },
        {
          id: "unread",
          label: hasUnread ? "Mark as Read" : "Mark as Unread",
          icon: hasUnread ? CheckCheck : CircleDot,
          hidden: isPendingSent,
          onClick: () => handleToggleReadStatus(chat),
        },
        { type: "divider" },
        {
          id: "clear",
          label: "Clear Chat",
          icon: Eraser,
          hidden: isPendingSent,
          onClick: () => setConfirmModal({ type: "clear", chat, user: chat.userInfo }),
        },
        {
          id: "delete",
          label: "Delete Chat",
          icon: Trash2,
          danger: true,
          hidden: isPendingSent,
          onClick: () => setConfirmModal({ type: "delete", chat, user: chat.userInfo }),
        },
        {
          id: "unconnect",
          label: isPendingSent ? "Cancel Request" : "Un-connect",
          icon: UserMinus,
          danger: true,
          onClick: () => setConfirmModal({ type: "unconnect", chat, user: chat.userInfo }),
        },
        {
          id: "block",
          label: "Block User",
          icon: Ban,
          danger: true,
          onClick: () => setConfirmModal({ type: "block", chat, user: chat.userInfo }),
        },
      ],
    });
  };

  const handleChatRowContextMenu = (e, chat) => {
    e.preventDefault();
    e.stopPropagation();
    openChatRowMenu(e.clientX, e.clientY, chat);
  };

  const handleChatRowMenuButton = (e, chat) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openChatRowMenu(rect.right - 210, rect.bottom + 6, chat);
  };

  const openPendingRequestMenu = (x, y, chat) => {
    openContextMenu({
      x,
      y,
      header: {
        avatar:
          chat.userInfo?.photoURL ||
          "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png",
        title: chat.userInfo?.displayName || "Request",
        subtitle: "Message Request",
      },
      items: [
        {
          id: "profile",
          label: "View Profile",
          icon: User,
          onClick: () => setSelectedProfileUser(chat.userInfo),
        },
        {
          id: "accept",
          label: "Accept Request",
          icon: Check,
          active: true,
          onClick: () => handleAcceptFromModal(chat.id, chat.userInfo),
        },
        { type: "divider" },
        {
          id: "decline",
          label: "Decline Request",
          icon: X,
          danger: true,
          onClick: () => handleDeclineFromModal(chat.id),
        },
        {
          id: "block",
          label: "Block User",
          icon: Ban,
          danger: true,
          onClick: () => setConfirmModal({ type: "block", chat, user: chat.userInfo }),
        },
      ],
    });
  };

  const handleContactContextMenu = (e, userObj, existingChat) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      header: {
        avatar:
          userObj.photoURL ||
          "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png",
        title: userObj.displayName || "User",
        subtitle: userObj.talklyId || "",
      },
      items: [
        {
          id: "profile",
          label: "View Profile",
          icon: User,
          onClick: () => setSelectedProfileUser(userObj),
        },
        existingChat
          ? {
              id: "open",
              label: "Open Chat",
              icon: MessageSquare,
              onClick: () => handleOpenChatFromModal(userObj),
            }
          : {
              id: "request",
              label: "Send Chat Request",
              icon: UserPlus,
              onClick: () => handleSendRequest(userObj),
            },
        {
          id: "copy-id",
          label: "Copy @username",
          icon: Copy,
          hidden: !userObj.talklyId,
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(userObj.talklyId);
              setToastMsg("Username copied.");
            } catch {
              setToastMsg("Copy failed.");
            }
          },
        },
        { type: "divider" },
        {
          id: "block",
          label: "Block User",
          icon: Ban,
          danger: true,
          onClick: () => setConfirmModal({ type: "block", chat: existingChat, user: userObj }),
        },
      ],
    });
  };

  const handleSidebarBackgroundContextMenu = (e) => {
    const tag = e.target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    e.preventDefault();
    e.stopPropagation();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          id: "new-chat",
          label: showContacts ? "Close Contacts" : "New Chat",
          icon: showContacts ? X : MessageSquarePlus,
          onClick: () => setShowContacts((prev) => !prev),
        },
        {
          id: "search",
          label: "Search People",
          icon: Search,
          onClick: () => searchInputRef.current?.focus(),
        },
        {
          id: "theme",
          label: darkMode ? "Light Mode" : "Dark Mode",
          icon: darkMode ? Sun : Moon,
          onClick: toggleTheme,
        },
        {
          id: "settings",
          label: data.showSettings ? "Close Settings" : "Settings",
          icon: Settings,
          onClick: () =>
            data.showSettings
              ? dispatch({ type: "CLOSE_SETTINGS" })
              : dispatch({ type: "OPEN_SETTINGS", payload: "general" }),
        },
        ...(appLockConfig?.enabled
          ? [
              { type: "divider" },
              {
                id: "lock",
                label: "Lock App",
                icon: Lock,
                onClick: lockAppNow,
              },
            ]
          : []),
      ],
    });
  };

  const selectedExistingChat = selectedProfileUser
    ? chats.find((c) => c.userInfo?.uid === selectedProfileUser.uid)
    : null;

  const filteredUsers = allUsers;
  const pendingRequests = chats.filter((c) => c.status === "pending" && c.senderId !== currentUser.uid);
  const activeChats = chats
    .filter((c) => {
      const isVisibleType =
        c.status === "accepted" ||
        !c.status ||
        (c.status === "pending" && c.senderId === currentUser.uid);
      if (!isVisibleType) return false;
      const hiddenAt = hiddenChatsMap[c.id];
      if (hiddenAt) {
        const updatedMs = c.updatedAt?.toMillis?.() || 0;
        const hasNewMsg = Boolean(c.lastMessage?.text) && updatedMs > hiddenAt;
        if (!hasNewMsg) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aPinned = pinnedChatIds.includes(a.id) ? 1 : 0;
      const bPinned = pinnedChatIds.includes(b.id) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0);
    });

  return (
    <div
      onContextMenu={handleSidebarBackgroundContextMenu}
      className="flex flex-col w-full h-full bg-white dark:bg-gray-900 transition-colors duration-200 relative"
    >
      {/* Header */}
      <div className="h-[65px] bg-white dark:bg-gray-900 flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800 transition-colors duration-200">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <img
              src={
                currentUser.photoURL ||
                "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
              }
              alt=""
              className="w-10 h-10 rounded-full object-cover cursor-pointer hover:opacity-80 transition"
              onClick={() => dispatch({ type: "OPEN_SETTINGS", payload: "profile" })}
              title="Profile & Settings"
            />
            <span
              className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 ${
                isOnline ? "bg-emerald-500" : "bg-slate-400"
              }`}
              title={isOnline ? "Connected" : "Offline"}
            />
          </div>
          {!isOnline && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
              <WifiOff className="w-3 h-3" />
              Offline
            </span>
          )}
        </div>

        <div className="flex gap-3.5 text-gray-500 dark:text-gray-400 relative items-center">
          <button
            type="button"
            onClick={handleToggleDesktopNotifications}
            className={`p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400 transition ${
              desktopNotifEnabled ? "text-blue-600 dark:text-blue-400" : ""
            }`}
            title={
              desktopNotifEnabled
                ? "Notifications On"
                : notifPermission === "denied"
                ? "Notifications Blocked"
                : "Enable Notifications"
            }
            aria-label="Toggle Notifications"
          >
            {desktopNotifEnabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
          </button>

          {showContacts ? (
            <button
              type="button"
              onClick={() => setShowContacts(false)}
              className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400 transition"
              title="Close Contacts"
              aria-label="Close Contacts"
            >
              <X className="w-5 h-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowContacts(true)}
              className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400 transition"
              title="New Chat"
              aria-label="New Chat"
            >
              <MessageSquarePlus className="w-5 h-5" />
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              data.showSettings
                ? dispatch({ type: "CLOSE_SETTINGS" })
                : dispatch({ type: "OPEN_SETTINGS", payload: "general" })
            }
            className={`p-1.5 rounded-full transition ${
              data.showSettings
                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                : "hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400"
            }`}
            title="Settings"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Toast */}
      {toastMsg && (
        <div className="absolute top-[72px] left-1/2 -translate-x-1/2 z-50 bg-gray-900 dark:bg-gray-700 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg whitespace-nowrap">
          {toastMsg}
        </div>
      )}

      {/* Confirmation Modal for Sidebar Actions */}
      {confirmModal && (
        <div
          className="absolute inset-0 bg-black/45 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
          onClick={() => !isRunningAction && setConfirmModal(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-xl max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {confirmModal.type === "clear"
                ? `Clear chat with ${confirmModal.user?.displayName || "user"}?`
                : confirmModal.type === "delete"
                ? `Delete chat with ${confirmModal.user?.displayName || "user"}?`
                : confirmModal.type === "unconnect"
                ? `Un-connect ${confirmModal.user?.displayName || "user"}?`
                : `Block ${confirmModal.user?.displayName || "user"}?`}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              {confirmModal.type === "clear"
                ? "All messages will be cleared, while keeping this chat in your list and your connection active."
                : confirmModal.type === "delete"
                ? "All messages will be cleared and this conversation will be removed from your chat list."
                : confirmModal.type === "unconnect"
                ? "This removes your connection and deletes the conversation. You will need to send a new request to chat again."
                : "You will no longer receive messages or chat requests from this user."}
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                disabled={isRunningAction}
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isRunningAction}
                onClick={() => {
                  if (confirmModal.type === "clear") {
                    handleClearChatAction(confirmModal.chat);
                  } else if (confirmModal.type === "delete") {
                    handleDeleteChatAction(confirmModal.chat);
                  } else if (confirmModal.type === "unconnect") {
                    handleUnconnectAction(confirmModal.chat);
                  } else if (confirmModal.type === "block") {
                    handleBlockUserAction(confirmModal.user, confirmModal.chat?.id);
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-60"
              >
                {isRunningAction
                  ? "Working..."
                  : confirmModal.type === "clear"
                  ? "Clear Chat"
                  : confirmModal.type === "delete"
                  ? "Delete Chat"
                  : confirmModal.type === "unconnect"
                  ? "Un-connect"
                  : "Block"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Profile Details Modal (Two-Step Before Sending Request) */}
      {selectedProfileUser && (
        <div
          className="absolute inset-0 bg-black/45 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedProfileUser(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl shadow-2xl w-full max-w-sm p-6 text-center relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelectedProfileUser(null)}
              className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
              aria-label="Close user details"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="relative inline-block mb-3 mt-2">
              <img
                src={
                  selectedProfileUser.photoURL ||
                  "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
                }
                alt={selectedProfileUser.displayName || ""}
                className="w-24 h-24 rounded-full object-cover border-4 border-white dark:border-gray-800 shadow-md"
              />
              <span
                className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-white dark:border-gray-900 ${
                  selectedProfileOnline === "online"
                    ? "bg-emerald-500"
                    : selectedProfileOnline === "away"
                    ? "bg-sky-400"
                    : "bg-gray-400 dark:bg-gray-600"
                }`}
                title={
                  selectedProfileOnline === "online"
                    ? "Online"
                    : selectedProfileOnline === "away"
                    ? "Away"
                    : "Offline"
                }
              />
            </div>

            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {selectedProfileUser.displayName}
            </h3>
            {selectedProfileUser.talklyId && (
              <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mt-0.5">
                {selectedProfileUser.talklyId}
              </p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">
              {selectedProfileOnline === "online" ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Online</span>
              ) : selectedProfileOnline === "away" ? (
                <span className="text-sky-600 dark:text-sky-400 font-medium">Away</span>
              ) : (
                formatLastSeen(selectedProfileLastSeen)
              )}
            </p>

            <div className="bg-gray-50 dark:bg-gray-950 border border-gray-100 dark:border-gray-800 rounded-2xl p-4 text-left mb-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
                About
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {selectedProfileUser.about || "Hey there! I am using Talkly."}
              </p>
            </div>

            {!selectedExistingChat ? (
              <button
                type="button"
                disabled={isSubmittingRequest}
                onClick={() => handleSendRequest(selectedProfileUser)}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <UserPlus className="w-4 h-4" />
                {isSubmittingRequest ? "Sending Request..." : "Send Chat Request"}
              </button>
            ) : selectedExistingChat.status === "pending" &&
              selectedExistingChat.senderId === currentUser.uid ? (
              <div className="space-y-3">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-medium">
                  <Clock className="w-3.5 h-3.5" />
                  Request Pending • Waiting for approval
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenChatFromModal(selectedProfileUser)}
                  className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <MessageSquare className="w-4 h-4" />
                  Open Chat
                </button>
              </div>
            ) : selectedExistingChat.status === "pending" &&
              selectedExistingChat.senderId !== currentUser.uid ? (
              <div className="space-y-3">
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                  Sent you a chat request
                </p>
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    disabled={isSubmittingRequest}
                    onClick={() =>
                      handleAcceptFromModal(selectedExistingChat.id, selectedProfileUser)
                    }
                    className="flex-1 py-2.5 px-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    Accept &amp; Chat
                  </button>
                  <button
                    type="button"
                    disabled={isSubmittingRequest}
                    onClick={() => handleDeclineFromModal(selectedExistingChat.id)}
                    className="py-2.5 px-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 text-sm font-semibold rounded-xl transition-colors"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
                  <CheckCheck className="w-3.5 h-3.5" />
                  Connected
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenChatFromModal(selectedProfileUser)}
                  className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <MessageSquare className="w-4 h-4" />
                  Open Chat
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="bg-white dark:bg-gray-900 p-3 border-b border-gray-200 dark:border-gray-800 transition-colors duration-200">
        <div className="bg-gray-100 dark:bg-gray-800 flex items-center rounded-full px-4 py-2 transition-colors duration-200">
          <Search className="w-5 h-5 text-gray-500 dark:text-gray-400 mr-3 shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search by name or @username"
            className="bg-transparent outline-none w-full text-sm placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-gray-100"
            value={searchUsername}
            onChange={(e) => setSearchUsername(e.target.value)}
          />
          {searchUsername && (
            <button
              type="button"
              onClick={() => setSearchUsername("")}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-2"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Chat List / Search Results */}
      <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-900 transition-colors duration-200">
        {searchUsername || showContacts ? (
          <>
            <div className="px-4 py-2 text-sm text-blue-600 dark:text-blue-400 font-medium flex items-center justify-between">
              <span>{searchUsername ? "Search Results" : "Contacts"}</span>
              {!isSearching && (
                <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">
                  Tap a user to view profile
                </span>
              )}
            </div>
            {isSearching ? (
              <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Searching...</div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-4 text-sm text-gray-500 dark:text-gray-400">No users found</div>
            ) : (
              filteredUsers.map((user) => {
                const existing = chats.find((c) => c.userInfo?.uid === user.uid);
                return (
                  <div
                    key={user.uid}
                    className="flex items-center p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
                    onClick={() => setSelectedProfileUser(user)}
                    onContextMenu={(e) => handleContactContextMenu(e, user, existing)}
                  >
                    <img
                      src={
                        user.photoURL ||
                        "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
                      }
                      alt=""
                      className="w-12 h-12 rounded-full object-cover mr-4 shrink-0"
                    />
                    <div className="flex-1 min-w-0 border-b border-gray-100 dark:border-gray-800 pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[16px] font-medium text-gray-900 dark:text-gray-100 truncate">
                          {user.displayName}
                        </span>
                        {existing?.status === "accepted" || (existing && !existing.status) ? (
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 shrink-0">
                            Connected
                          </span>
                        ) : existing?.status === "pending" ? (
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 shrink-0">
                            {existing.senderId === currentUser.uid ? "Pending" : "Requested you"}
                          </span>
                        ) : null}
                      </div>
                      {user.talklyId && (
                        <p className="text-xs font-medium text-blue-600 dark:text-blue-400 truncate">
                          {user.talklyId}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {user.about || "Hey there! I am using Talkly."}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </>
        ) : (
          <>
            {/* Pending Requests */}
            {pendingRequests.length > 0 && (
              <div className="px-4 py-2 text-sm text-blue-600 dark:text-blue-400 font-medium bg-gray-50 dark:bg-gray-950 border-b border-gray-100 dark:border-gray-800 transition-colors">
                Message Requests ({pendingRequests.length})
              </div>
            )}
            {pendingRequests.map((chat) => (
              <div
                className="group flex items-center p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer bg-blue-50 dark:bg-blue-900/20 transition-colors"
                key={chat.id}
                onClick={() => dispatch({ type: "CHANGE_USER", payload: chat.userInfo })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openPendingRequestMenu(e.clientX, e.clientY, chat);
                }}
              >
                <img
                  src={
                    chat.userInfo?.photoURL ||
                    "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
                  }
                  alt=""
                  className="w-12 h-12 rounded-full object-cover mr-4 shrink-0"
                />
                <div className="flex-1 min-w-0 border-b border-gray-100 dark:border-gray-800 pb-3 pt-1 flex flex-col justify-center">
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-[17px] text-gray-900 dark:text-gray-100 font-medium truncate">
                      {chat.userInfo?.displayName}
                    </span>
                    {chat.updatedAt && (
                      <span className="text-xs text-blue-600 dark:text-blue-400 shrink-0 tabular-nums">
                        {new Date(chat.updatedAt.toDate()).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="text-sm text-blue-600 dark:text-blue-400 truncate">
                      Wants to connect with you
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        openPendingRequestMenu(rect.right - 210, rect.bottom + 6, chat);
                      }}
                      title="Request options"
                      aria-label={`Request options for ${chat.userInfo?.displayName || "user"}`}
                      className="p-1 rounded-full text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900/50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Active Chats */}
            {activeChats.length > 0 && pendingRequests.length > 0 && (
              <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 font-medium bg-gray-50 dark:bg-gray-950 border-b border-gray-100 dark:border-gray-800 transition-colors">
                Chats
              </div>
            )}
            {activeChats.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                currentUserId={currentUser.uid}
                isSelected={!data.showSettings && data.chatId === chat.id}
                isPinned={pinnedChatIds.includes(chat.id)}
                isMuted={mutedChatIds.includes(chat.id)}
                onSelect={() => dispatch({ type: "CHANGE_USER", payload: chat.userInfo })}
                onContextMenu={handleChatRowContextMenu}
                onOpenMenuButton={handleChatRowMenuButton}
              />
            ))}

            {/* Empty State */}
            {activeChats.length === 0 && pendingRequests.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 mt-20">
                <MessageSquarePlus className="w-16 h-16 mb-4 text-gray-300 dark:text-gray-600" />
                <p className="text-lg font-medium text-gray-600 dark:text-gray-300">No chats yet</p>
                <p className="text-sm mt-1">Search for a user to start chatting</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
