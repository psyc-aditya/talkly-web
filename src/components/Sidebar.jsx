import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useTheme } from "../context/ThemeContext";
import { db, auth, rtdb } from "../firebase";
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
import { updateProfile } from "firebase/auth";
import {
  Share2,
  ArrowLeft,
  Sun,
  Moon,
  X,
  MessageSquarePlus,
  MoreVertical,
  LogOut,
  Search,
  Check,
  CheckCheck,
  Flame,
  WifiOff,
  UserPlus,
  MessageSquare,
  Clock,
  Lock,
  Eye,
  EyeOff,
  Bell,
  BellOff,
  Copy,
  QrCode,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { handleFirestoreError, OperationType } from "../utils/errorHandler";
import { APP_LOCK_FREQUENCIES, getFrequencyLabel } from "../utils/appLock";
import {
  isNotificationSupported,
  getNotificationPermission,
  getDesktopNotifEnabled,
  setDesktopNotifEnabled,
  requestDesktopNotificationPermission,
  showDesktopNotification,
  TALKLY_LOCKED_ICON,
} from "../utils/notifications";

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

function ShareProfileModal({
  isOpen,
  onClose,
  profile,
  currentUser,
  onCopySuccess,
}) {
  if (!isOpen) return null;

  const cleanId = (profile?.talklyId || "").replace(/^@+/, "");
  const talklyIdDisplay = cleanId ? `@${cleanId}` : "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareSearchUrl = `${origin}/?search=${encodeURIComponent(talklyIdDisplay)}`;

  const copyText = async (value, successMsg) => {
    try {
      await navigator.clipboard?.writeText(value);
      onCopySuccess(successMsg);
    } catch {
      onCopySuccess("Could not copy automatically.");
    }
  };

  const handleNativeShare = () => {
    if (navigator.share) {
      navigator
        .share({
          title: "My Talkly Profile",
          text: `Find me on Talkly! My ID is ${talklyIdDisplay}`,
          url: shareSearchUrl,
        })
        .catch((err) => {
          if (err?.name !== "AbortError") {
            copyText(shareSearchUrl, "Profile link copied to clipboard!");
          }
        });
    } else {
      copyText(shareSearchUrl, "Profile link copied to clipboard!");
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/45 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl shadow-2xl w-full max-w-sm p-6 relative text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
          aria-label="Close share profile"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center mt-1 mb-4">
          <img
            src={
              currentUser?.photoURL ||
              "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
            }
            alt={profile?.displayName || currentUser?.displayName || ""}
            className="w-16 h-16 rounded-full object-cover border-2 border-blue-500/30 shadow-sm mb-2"
          />
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Share Talkly Profile
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Scan the QR code, share your link, or copy your Talkly ID
          </p>
        </div>

        {/* Scannable QR Code */}
        <div className="inline-flex flex-col items-center p-4 rounded-2xl bg-white border border-gray-200 shadow-xs mb-4">
          <QRCodeSVG value={shareSearchUrl} size={152} includeMargin={false} />
          <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600">
            <QrCode className="w-3.5 h-3.5" />
            {talklyIdDisplay || "Talkly"}
          </span>
        </div>

        {/* Talkly ID quick copy */}
        {talklyIdDisplay && (
          <div className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 mb-2.5">
            <div className="text-left min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                Talkly ID
              </p>
              <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 truncate">
                {talklyIdDisplay}
              </p>
            </div>
            <button
              type="button"
              onClick={() => copyText(talklyIdDisplay, "Talkly ID copied!")}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors shrink-0"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy ID
            </button>
          </div>
        )}

        {/* Query-based Share URL (works directly on Firebase Hosting without 404) */}
        <div className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 mb-4">
          <div className="text-left min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
              Direct Link
            </p>
            <p className="text-xs text-gray-700 dark:text-gray-300 truncate">
              {shareSearchUrl}
            </p>
          </div>
          <button
            type="button"
            onClick={() => copyText(shareSearchUrl, "Profile link copied!")}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-200/80 dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-xs font-medium hover:bg-gray-300/80 dark:hover:bg-gray-700 transition-colors shrink-0"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy Link
          </button>
        </div>

        <button
          type="button"
          onClick={handleNativeShare}
          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
        >
          <Share2 className="w-4 h-4" />
          Share Profile Link
        </button>
      </div>
    </div>
  );
}

function ChatRow({ chat, currentUserId, isSelected, onSelect }) {
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
      className={`flex items-center p-3 cursor-pointer transition-colors ${
        isSelected
          ? "bg-blue-50/70 dark:bg-blue-900/20"
          : "hover:bg-gray-50 dark:hover:bg-gray-800"
      }`}
      onClick={onSelect}
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
              ? "bg-amber-400"
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
          <span
            className={`text-[17px] truncate ${
              unreadCount > 0
                ? "font-semibold text-gray-900 dark:text-white"
                : "text-gray-900 dark:text-gray-100"
            }`}
          >
            {chat.userInfo?.displayName}
          </span>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {chat.updatedAt && (
              <span
                className={`text-xs ${
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
            {unreadCount > 0 && (
              <span className="bg-blue-600 dark:bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                {unreadCount}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 mt-0.5 pr-4 min-w-0">
          {isTyping ? (
            <span className="text-sm text-blue-600 dark:text-blue-400 font-medium truncate">
              typing...
            </span>
          ) : chat.status === "pending" ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
              Waiting for response...
            </p>
          ) : chat.lastMessage?.disappeared ? (
            <p className="text-sm text-amber-600 dark:text-amber-400 italic truncate flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 shrink-0" />
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
      </div>
    </div>
  );
}

export default function Sidebar() {
  const {
    currentUser,
    isOnline,
    logout,
    appLockConfig,
    lockAppNow,
    saveAppLock,
    disableAppLock,
    verifyCurrentAppLockPassword,
  } = useAuth();
  const { data, dispatch } = useChat();
  const { darkMode, toggleTheme } = useTheme();
  const [chats, setChats] = useState([]);
  const [searchUsername, setSearchUsername] = useState("");
  const [allUsers, setAllUsers] = useState([]);
  const [showContacts, setShowContacts] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newName, setNewName] = useState(currentUser.displayName || "");
  const [newAbout, setNewAbout] = useState("");
  const [myProfile, setMyProfile] = useState(null);
  const [blockedUsersList, setBlockedUsersList] = useState([]);

  const [newTalklyId, setNewTalklyId] = useState("");
  const [showMainMenu, setShowMainMenu] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [profileError, setProfileError] = useState("");
  const [selectedProfileUser, setSelectedProfileUser] = useState(null);
  const [selectedProfileOnline, setSelectedProfileOnline] = useState("offline");
  const [selectedProfileLastSeen, setSelectedProfileLastSeen] = useState(null);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  const [showLockEditor, setShowLockEditor] = useState(false);
  const [currentLockPwd, setCurrentLockPwd] = useState("");
  const [newLockPwd, setNewLockPwd] = useState("");
  const [confirmLockPwd, setConfirmLockPwd] = useState("");
  const [lockFrequency, setLockFrequency] = useState("every_visit");
  const [showLockPasswords, setShowLockPasswords] = useState(false);
  const [lockError, setLockError] = useState("");
  const [savingLock, setSavingLock] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [desktopNotifEnabled, setDesktopNotifEnabledState] = useState(() =>
    getDesktopNotifEnabled(currentUser?.uid)
  );
  const [notifPermission, setNotifPermission] = useState(() => getNotificationPermission());

  const userCacheRef = useRef(new Map());
  const deliveringChatsRef = useRef(new Set());
  const mainMenuRef = useRef(null);
  const immediateSearchRef = useRef(false);
  const searchInputRef = useRef(null);

  useEffect(() => {
    setNotifPermission(getNotificationPermission());
    setDesktopNotifEnabledState(getDesktopNotifEnabled(currentUser?.uid));
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(""), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    if (!showMainMenu) return;
    const handleOutside = (e) => {
      if (mainMenuRef.current && !mainMenuRef.current.contains(e.target)) {
        setShowMainMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showMainMenu]);

  useEffect(() => {
    const fetchMe = async () => {
      try {
        const d = await getDoc(doc(db, "users", currentUser.uid));
        if (d.exists()) {
          const userData = d.data();
          setMyProfile(userData);
          setNewAbout(userData.about || "Hey there! I am using Talkly.");
          setNewName(userData.displayName || currentUser.displayName);
          setNewTalklyId(userData.talklyId?.replace("@", "") || "");
        }
      } catch (e) {
        console.error(e);
      }
    };
    if (currentUser?.uid) fetchMe();
  }, [currentUser]);

  useEffect(() => {
    const fetchBlockedUsers = async () => {
      if (showProfile && myProfile?.blockedUsers?.length > 0) {
        try {
          const q = query(collection(db, "users"), where("uid", "in", myProfile.blockedUsers));
          const querySnapshot = await getDocs(q);
          const users = [];
          querySnapshot.forEach((d) => {
            users.push(d.data());
          });
          setBlockedUsersList(users);
        } catch (err) {
          console.error("Error fetching blocked users:", err);
        }
      } else {
        setBlockedUsersList([]);
      }
    };
    fetchBlockedUsers();
  }, [showProfile, myProfile?.blockedUsers]);

  const handleUnblock = async (userIdToUnblock) => {
    try {
      const updatedBlockedUsers = myProfile.blockedUsers.filter((id) => id !== userIdToUnblock);
      await updateDoc(doc(db, "users", currentUser.uid), {
        blockedUsers: updatedBlockedUsers,
      });
      setMyProfile((prev) => ({ ...prev, blockedUsers: updatedBlockedUsers }));
      setToastMsg("User unblocked.");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  const handleSaveProfile = async () => {
    setProfileError("");
    try {
      const formattedId = newTalklyId
        ? newTalklyId.startsWith("@")
          ? newTalklyId
          : "@" + newTalklyId
        : myProfile.talklyId;

      if (formattedId !== myProfile.talklyId) {
        const q = query(collection(db, "users"), where("talklyId", "==", formattedId));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          setProfileError("Username is already taken.");
          return;
        }
      }

      await updateProfile(auth.currentUser, { displayName: newName });
      await updateDoc(doc(db, "users", currentUser.uid), {
        displayName: newName,
        about: newAbout,
        talklyId: formattedId,
      });
      setMyProfile((prev) => ({
        ...prev,
        displayName: newName,
        about: newAbout,
        talklyId: formattedId,
      }));
      setShowProfile(false);
      setToastMsg("Profile updated.");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  const handleShareProfile = () => {
    setShowMainMenu(false);
    setShowShareModal(true);
  };

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
    setShowProfile(false);
    setShowSettings(false);
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
    setSelectedProfileUser(null);
    setSearchUsername("");
    setShowContacts(false);
    dispatch({ type: "CHANGE_USER", payload: u });
  };

  const selectedExistingChat = selectedProfileUser
    ? chats.find((c) => c.userInfo?.uid === selectedProfileUser.uid)
    : null;

  const filteredUsers = allUsers;
  const pendingRequests = chats.filter((c) => c.status === "pending" && c.senderId !== currentUser.uid);
  const activeChats = chats.filter(
    (c) => c.status === "accepted" || !c.status || (c.status === "pending" && c.senderId === currentUser.uid)
  );

  if (showProfile) {
    return (
      <div className="flex flex-col w-full h-full bg-white dark:bg-gray-900 transition-colors duration-200 relative">
        <div className="h-[65px] bg-blue-600 dark:bg-blue-800 flex items-center px-4 py-2 text-white">
          <ArrowLeft
            className="w-6 h-6 cursor-pointer mr-4"
            onClick={() => {
              setShowProfile(false);
              setProfileError("");
            }}
          />
          <h1 className="text-xl font-medium">Profile</h1>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950 flex flex-col items-center py-8 px-4 transition-colors duration-200">
          <img
            src={
              currentUser.photoURL ||
              "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
            }
            alt="Profile"
            className="w-40 h-40 rounded-full object-cover mb-4 shadow-md"
          />
          {myProfile?.talklyId && (
            <p className="text-blue-600 dark:text-blue-400 font-medium mb-6 bg-blue-50 dark:bg-blue-900/30 px-4 py-1 rounded-full">
              {myProfile.talklyId}
            </p>
          )}

          {profileError && (
            <div className="w-full max-w-md mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 text-sm text-center">
              {profileError}
            </div>
          )}

          <div className="w-full max-w-md bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 mb-6 transition-colors duration-200">
            <label className="block text-sm font-medium text-blue-600 dark:text-blue-400 mb-2">
              Your Name
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full border-b-2 border-gray-200 dark:border-gray-700 focus:border-blue-600 dark:focus:border-blue-400 bg-transparent outline-none py-2 text-lg text-gray-800 dark:text-gray-100 transition-colors"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              This is not your username or pin. This name will be visible to your Talkly contacts.
            </p>
          </div>

          <div className="w-full max-w-md bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 mb-6 transition-colors duration-200">
            <label className="block text-sm font-medium text-blue-600 dark:text-blue-400 mb-2">
              Username (Talkly ID)
            </label>
            <div className="flex items-center border-b-2 border-gray-200 dark:border-gray-700 focus-within:border-blue-600 dark:focus-within:border-blue-400 transition-colors">
              <span className="text-gray-500 dark:text-gray-400 text-lg mr-1">@</span>
              <input
                type="text"
                value={newTalklyId}
                onChange={(e) => setNewTalklyId(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                className="w-full bg-transparent outline-none py-2 text-lg text-gray-800 dark:text-gray-100"
              />
            </div>
          </div>

          <div className="w-full max-w-md bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 mb-8 transition-colors duration-200">
            <label className="block text-sm font-medium text-blue-600 dark:text-blue-400 mb-2">
              About
            </label>
            <input
              type="text"
              value={newAbout}
              onChange={(e) => setNewAbout(e.target.value)}
              className="w-full border-b-2 border-gray-200 dark:border-gray-700 focus:border-blue-600 dark:focus:border-blue-400 bg-transparent outline-none py-2 text-lg text-gray-800 dark:text-gray-100 transition-colors"
            />
          </div>

          <button
            onClick={handleSaveProfile}
            className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-medium py-3 px-8 rounded-full transition-colors shadow-sm mb-4"
          >
            Save Changes
          </button>

          <button
            onClick={handleShareProfile}
            className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-medium py-3 px-8 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors mb-8"
          >
            <Share2 className="w-5 h-5" /> Share Profile
          </button>

          <div className="w-full max-w-md bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 mb-8 transition-colors duration-200">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Blocked Users</h3>
            {blockedUsersList.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No blocked users.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {blockedUsersList.map((user) => (
                  <div
                    key={user.uid}
                    className="flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={
                          user.photoURL ||
                          "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
                        }
                        alt=""
                        className="w-10 h-10 rounded-full object-cover"
                      />
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {user.displayName}
                      </span>
                    </div>
                    <button
                      onClick={() => handleUnblock(user.uid)}
                      className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium px-3 py-1 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <ShareProfileModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          profile={myProfile}
          currentUser={currentUser}
          onCopySuccess={(msg) => setToastMsg(msg)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-white dark:bg-gray-900 transition-colors duration-200 relative">
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
              onClick={() => setShowProfile(true)}
              title="Edit Profile"
            />
            <span
              className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 ${
                isOnline ? "bg-emerald-500" : "bg-amber-500"
              }`}
              title={isOnline ? "Connected" : "Offline"}
            />
          </div>
          {!isOnline && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
              <WifiOff className="w-3 h-3" />
              Offline
            </span>
          )}
        </div>

        <div className="flex gap-4 text-gray-500 dark:text-gray-400 relative items-center" ref={mainMenuRef}>
          <button
            type="button"
            onClick={handleToggleDesktopNotifications}
            className={`hover:text-blue-600 dark:hover:text-blue-400 transition relative ${
              desktopNotifEnabled ? "text-blue-600 dark:text-blue-400" : ""
            }`}
            title={
              desktopNotifEnabled
                ? "Desktop Notifications On (click to mute)"
                : notifPermission === "denied"
                ? "Notifications blocked in browser settings"
                : "Enable Desktop Notifications"
            }
          >
            {desktopNotifEnabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
          </button>
          <button
            onClick={toggleTheme}
            className="hover:text-blue-600 dark:hover:text-blue-400 transition"
            title="Toggle Theme"
          >
            {darkMode ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
          </button>
          {showContacts ? (
            <X
              className="w-6 h-6 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition"
              onClick={() => setShowContacts(false)}
              title="Close Contacts"
            />
          ) : (
            <MessageSquarePlus
              className="w-6 h-6 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition"
              onClick={() => setShowContacts(true)}
              title="New Chat"
            />
          )}
          <MoreVertical
            className="w-6 h-6 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition"
            onClick={() => setShowMainMenu(!showMainMenu)}
          />
          {showMainMenu && (
            <div className="absolute right-8 top-8 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-lg rounded-xl py-2 w-48 z-50">
              <button
                onClick={() => {
                  setShowProfile(true);
                  setShowMainMenu(false);
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Edit Profile
              </button>
              <button
                onClick={handleShareProfile}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Share Profile
              </button>
              <button
                onClick={() => {
                  setShowMainMenu(false);
                  setShowLockEditor(false);
                  setLockError("");
                  setCurrentLockPwd("");
                  setNewLockPwd("");
                  setConfirmLockPwd("");
                  setLockFrequency(appLockConfig?.frequency || "every_visit");
                  setShowSettings(true);
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Settings
              </button>
              {appLockConfig?.enabled && (
                <button
                  onClick={() => {
                    setShowMainMenu(false);
                    lockAppNow();
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors flex items-center gap-2"
                >
                  <Lock className="w-4 h-4" />
                  <span>Lock Now</span>
                </button>
              )}
            </div>
          )}
          <LogOut
            className="w-6 h-6 cursor-pointer text-red-500 hover:text-red-600 dark:hover:text-red-400 transition"
            onClick={logout}
            title="Logout"
          />
        </div>
      </div>

      {/* Toast */}
      {toastMsg && (
        <div className="absolute top-[72px] left-1/2 -translate-x-1/2 z-50 bg-gray-900 dark:bg-gray-700 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg whitespace-nowrap">
          {toastMsg}
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Settings</h3>
              <button
                onClick={() => {
                  setShowSettings(false);
                  setShowLockEditor(false);
                  setLockError("");
                }}
                className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Appearance</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {darkMode ? "Dark theme active" : "Light theme active"}
                  </p>
                </div>
                <button
                  onClick={toggleTheme}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                >
                  Switch to {darkMode ? "Light" : "Dark"}
                </button>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Talkly ID</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {myProfile?.talklyId || "Loading..."}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowSettings(false);
                    setShowProfile(true);
                  }}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                >
                  Edit
                </button>
              </div>

              {/* Optional Website Opening Password */}
              <div className="py-2 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      Website Opening Password
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {appLockConfig?.enabled
                        ? `Active • ${getFrequencyLabel(appLockConfig.frequency)}`
                        : "Optional • Not set"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {appLockConfig?.enabled && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowSettings(false);
                          lockAppNow();
                        }}
                        className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
                      >
                        Lock
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setShowLockEditor((prev) => !prev);
                        setLockError("");
                        setCurrentLockPwd("");
                        setNewLockPwd("");
                        setConfirmLockPwd("");
                        setLockFrequency(appLockConfig?.frequency || "every_visit");
                      }}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                    >
                      {showLockEditor ? "Close" : appLockConfig?.enabled ? "Manage" : "Set Password"}
                    </button>
                  </div>
                </div>

                {showLockEditor && (
                  <div className="mt-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 space-y-3">
                    {lockError && (
                      <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 text-xs">
                        {lockError}
                      </div>
                    )}

                    {appLockConfig?.enabled && (
                      <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Current Password
                        </label>
                        <div className="relative">
                          <input
                            type={showLockPasswords ? "text" : "password"}
                            value={currentLockPwd}
                            onChange={(e) => {
                              setCurrentLockPwd(e.target.value);
                              if (lockError) setLockError("");
                            }}
                            placeholder="Enter current opening password"
                            className="w-full pr-9 pl-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => setShowLockPasswords((p) => !p)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                          >
                            {showLockPasswords ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {appLockConfig?.enabled
                          ? "New Password (optional if only changing schedule)"
                          : "Opening Password (min 4 characters)"}
                      </label>
                      <div className="relative">
                        <input
                          type={showLockPasswords ? "text" : "password"}
                          value={newLockPwd}
                          onChange={(e) => {
                            setNewLockPwd(e.target.value);
                            if (lockError) setLockError("");
                          }}
                          placeholder={appLockConfig?.enabled ? "Leave blank to keep current" : "Create password"}
                          className="w-full pr-9 pl-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
                        />
                        {!appLockConfig?.enabled && (
                          <button
                            type="button"
                            onClick={() => setShowLockPasswords((p) => !p)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                          >
                            {showLockPasswords ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {(!appLockConfig?.enabled || newLockPwd.length > 0) && (
                      <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Confirm Password
                        </label>
                        <input
                          type={showLockPasswords ? "text" : "password"}
                          value={confirmLockPwd}
                          onChange={(e) => {
                            setConfirmLockPwd(e.target.value);
                            if (lockError) setLockError("");
                          }}
                          placeholder="Re-enter password"
                          className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        Ask Password
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {APP_LOCK_FREQUENCIES.map((freq) => {
                          const selected = lockFrequency === freq.id;
                          return (
                            <button
                              key={freq.id}
                              type="button"
                              onClick={() => setLockFrequency(freq.id)}
                              className={`text-left px-2.5 py-2 rounded-lg border text-xs transition-colors ${
                                selected
                                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold"
                                  : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
                              }`}
                            >
                              <div>{freq.label}</div>
                              <div className="text-[10px] font-normal text-gray-500 dark:text-gray-400 truncate">
                                {freq.desc}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={savingLock}
                        onClick={async () => {
                          setLockError("");
                          if (appLockConfig?.enabled) {
                            if (!currentLockPwd) {
                              setLockError("Enter your current password to make changes.");
                              return;
                            }
                            const valid = await verifyCurrentAppLockPassword(currentLockPwd);
                            if (!valid) {
                              setLockError("Current password is incorrect.");
                              return;
                            }
                          }
                          if (!appLockConfig?.enabled && newLockPwd.length < 4) {
                            setLockError("Password must be at least 4 characters.");
                            return;
                          }
                          if (newLockPwd && newLockPwd.length < 4) {
                            setLockError("New password must be at least 4 characters.");
                            return;
                          }
                          if (newLockPwd && newLockPwd !== confirmLockPwd) {
                            setLockError("Passwords do not match.");
                            return;
                          }
                          setSavingLock(true);
                          try {
                            await saveAppLock({
                              password: newLockPwd || undefined,
                              frequency: lockFrequency,
                            });
                            setShowLockEditor(false);
                            setCurrentLockPwd("");
                            setNewLockPwd("");
                            setConfirmLockPwd("");
                            setToastMsg(
                              `Opening password saved (${getFrequencyLabel(lockFrequency)}).`
                            );
                          } catch (err) {
                            setLockError(err?.message || "Failed to save password.");
                          } finally {
                            setSavingLock(false);
                          }
                        }}
                        className="flex-1 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors"
                      >
                        {savingLock
                          ? "Saving..."
                          : appLockConfig?.enabled
                          ? "Save Changes"
                          : "Enable Password"}
                      </button>

                      {appLockConfig?.enabled && (
                        <button
                          type="button"
                          disabled={savingLock}
                          onClick={async () => {
                            setLockError("");
                            if (!currentLockPwd) {
                              setLockError("Enter your current password to disable lock.");
                              return;
                            }
                            const valid = await verifyCurrentAppLockPassword(currentLockPwd);
                            if (!valid) {
                              setLockError("Current password is incorrect.");
                              return;
                            }
                            setSavingLock(true);
                            try {
                              await disableAppLock();
                              setShowLockEditor(false);
                              setCurrentLockPwd("");
                              setNewLockPwd("");
                              setConfirmLockPwd("");
                              setToastMsg("Opening password disabled.");
                            } catch (err) {
                              setLockError(err?.message || "Failed to disable password.");
                            } finally {
                              setSavingLock(false);
                            }
                          }}
                          className="py-2 px-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 text-xs font-semibold transition-colors"
                        >
                          Disable
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Web-to-Desktop Notifications */}
              <div className="flex items-center justify-between gap-2 py-2 border-b border-gray-100 dark:border-gray-800">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                    {desktopNotifEnabled ? (
                      <Bell className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <BellOff className="w-4 h-4 text-gray-400" />
                    )}
                    Desktop Notifications
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {!isNotificationSupported()
                      ? "Not supported in this browser"
                      : notifPermission === "denied"
                      ? "Blocked in browser settings"
                      : desktopNotifEnabled
                      ? "Active • Private alert when locked; muted on open chat"
                      : "Off • Click Enable for desktop alerts"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {desktopNotifEnabled && (
                    <button
                      type="button"
                      onClick={() =>
                        showDesktopNotification({
                          title: "Talkly Test Notification",
                          body: "Desktop alerts are working cleanly.",
                          icon: TALKLY_LOCKED_ICON,
                          tag: "talkly-test-notification",
                        })
                      }
                      className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                      Test
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleToggleDesktopNotifications}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      desktopNotifEnabled
                        ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                        : "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                    }`}
                  >
                    {desktopNotifEnabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Connection Status</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {isOnline ? "Real-time sync connected" : "Currently offline"}
                  </p>
                </div>
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    isOnline ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <ShareProfileModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        profile={myProfile}
        currentUser={currentUser}
        onCopySuccess={(msg) => setToastMsg(msg)}
      />

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
                    ? "bg-amber-400"
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
                <span className="text-amber-600 dark:text-amber-400 font-medium">Away</span>
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
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-medium">
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
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 shrink-0">
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
                className="flex items-center p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer bg-blue-50 dark:bg-blue-900/20 transition-colors"
                key={chat.id}
                onClick={() => dispatch({ type: "CHANGE_USER", payload: chat.userInfo })}
              >
                <img
                  src={
                    chat.userInfo?.photoURL ||
                    "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
                  }
                  alt=""
                  className="w-12 h-12 rounded-full object-cover mr-4"
                />
                <div className="flex-1 border-b border-gray-100 dark:border-gray-800 pb-3 pt-1 flex flex-col justify-center">
                  <div className="flex justify-between items-center">
                    <span className="text-[17px] text-gray-900 dark:text-gray-100 font-medium">
                      {chat.userInfo?.displayName}
                    </span>
                    {chat.updatedAt && (
                      <span className="text-xs text-blue-600 dark:text-blue-400">
                        {new Date(chat.updatedAt.toDate()).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-blue-600 dark:text-blue-400 truncate mt-0.5">
                    Wants to connect with you
                  </p>
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
                isSelected={data.chatId === chat.id}
                onSelect={() => dispatch({ type: "CHANGE_USER", payload: chat.userInfo })}
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
