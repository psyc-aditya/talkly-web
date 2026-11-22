import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useTheme } from "../context/ThemeContext";
import { db, auth } from "../firebase";
import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  doc,
  updateDoc,
} from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import {
  ArrowLeft,
  X,
  Sun,
  Moon,
  Lock,
  Eye,
  EyeOff,
  Bell,
  BellOff,
  User,
  Shield,
  Sliders,
  Share2,
  Copy,
  Check,
  QrCode,
  Wifi,
  WifiOff,
  LogOut,
  UserX,
  AtSign,
  Info,
  Link2,
  KeyRound,
  Clock,
  Save,
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

const SETTINGS_SECTIONS = [
  { id: "general", label: "General", icon: Sliders },
  { id: "profile", label: "Profile", icon: User },
  { id: "security", label: "Security", icon: Shield },
];

export default function SettingsPanel() {
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

  const [activeSection, setActiveSection] = useState(data.settingsSection || "general");
  const scrollContainerRef = useRef(null);
  const sectionRefs = useRef({
    general: null,
    profile: null,
    security: null,
  });

  const [myProfile, setMyProfile] = useState(null);
  const [newName, setNewName] = useState(currentUser?.displayName || "");
  const [newAbout, setNewAbout] = useState("Hey there! I am using Talkly.");
  const [newTalklyId, setNewTalklyId] = useState("");
  const [profileError, setProfileError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [blockedUsersList, setBlockedUsersList] = useState([]);

  const [currentLockPwd, setCurrentLockPwd] = useState("");
  const [newLockPwd, setNewLockPwd] = useState("");
  const [confirmLockPwd, setConfirmLockPwd] = useState("");
  const [lockFrequency, setLockFrequency] = useState(appLockConfig?.frequency || "every_visit");
  const [showLockPasswords, setShowLockPasswords] = useState(false);
  const [lockError, setLockError] = useState("");
  const [savingLock, setSavingLock] = useState(false);

  const [desktopNotifEnabled, setDesktopNotifEnabledState] = useState(() =>
    getDesktopNotifEnabled(currentUser?.uid)
  );
  const [notifPermission, setNotifPermission] = useState(() => getNotificationPermission());

  const [copiedType, setCopiedType] = useState("");
  const [toastMsg, setToastMsg] = useState("");

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(""), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    setLockFrequency(appLockConfig?.frequency || "every_visit");
  }, [appLockConfig?.frequency]);

  useEffect(() => {
    const syncNotif = () => {
      setNotifPermission(getNotificationPermission());
      setDesktopNotifEnabledState(getDesktopNotifEnabled(currentUser?.uid));
    };
    syncNotif();
    window.addEventListener("talkly-notif-pref-changed", syncNotif);
    return () => window.removeEventListener("talkly-notif-pref-changed", syncNotif);
  }, [currentUser?.uid]);

  // Smoothly scroll to the requested section when Settings opens or section changes externally
  useEffect(() => {
    const targetId = data.settingsSection || "general";
    setActiveSection(targetId);
    const targetEl = sectionRefs.current[targetId];
    if (targetEl) {
      requestAnimationFrame(() => {
        targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [data.settingsSection]);

  const scrollToSection = (sectionId) => {
    setActiveSection(sectionId);
    dispatch({ type: "SET_SETTINGS_SECTION", payload: sectionId });
    const targetEl = sectionRefs.current[sectionId];
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleSettingsScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 24) {
      const lastId = SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id;
      setActiveSection((prev) => (prev !== lastId ? lastId : prev));
      return;
    }
    const scrollTop = container.scrollTop + 96;
    let current = "general";
    for (const sec of SETTINGS_SECTIONS) {
      const el = sectionRefs.current[sec.id];
      if (el && el.offsetTop <= scrollTop) {
        current = sec.id;
      }
    }
    setActiveSection((prev) => (prev !== current ? current : prev));
  };

  useEffect(() => {
    if (!currentUser?.uid) return;
    const unsub = onSnapshot(
      doc(db, "users", currentUser.uid),
      (snap) => {
        if (snap.exists()) {
          const userData = snap.data();
          setMyProfile(userData);
          setNewName((prev) => prev || userData.displayName || currentUser.displayName || "");
          setNewAbout(userData.about || "Hey there! I am using Talkly.");
          setNewTalklyId(userData.talklyId?.replace("@", "") || "");
        }
      },
      (err) => {
        console.error("Error listening to profile in Settings:", err);
      }
    );
    return () => unsub();
  }, [currentUser?.uid, currentUser?.displayName]);

  useEffect(() => {
    let cancelled = false;
    const fetchBlocked = async () => {
      const blockedIds = myProfile?.blockedUsers || [];
      if (blockedIds.length === 0) {
        setBlockedUsersList([]);
        return;
      }
      try {
        const users = [];
        for (let i = 0; i < blockedIds.length; i += 10) {
          const chunk = blockedIds.slice(i, i + 10);
          const q = query(collection(db, "users"), where("uid", "in", chunk));
          const snap = await getDocs(q);
          snap.forEach((d) => users.push(d.data()));
        }
        if (!cancelled) setBlockedUsersList(users);
      } catch (err) {
        console.error("Error fetching blocked users:", err);
      }
    };
    fetchBlocked();
    return () => {
      cancelled = true;
    };
  }, [myProfile?.blockedUsers]);

  const handleClose = () => {
    dispatch({ type: "CLOSE_SETTINGS" });
  };

  const handleToggleDesktopNotifications = async () => {
    if (!isNotificationSupported()) {
      setToastMsg("Not supported in this browser.");
      return;
    }
    if (desktopNotifEnabled) {
      setDesktopNotifEnabled(currentUser?.uid, false);
      setDesktopNotifEnabledState(false);
      setToastMsg("Notifications off.");
      return;
    }

    const { granted, permission } = await requestDesktopNotificationPermission(currentUser?.uid);
    setNotifPermission(permission);
    if (granted) {
      setDesktopNotifEnabled(currentUser?.uid, true);
      setDesktopNotifEnabledState(true);
      setToastMsg("Notifications enabled.");
      showDesktopNotification({
        title: "Talkly",
        body: "Notifications active.",
        icon: TALKLY_LOCKED_ICON,
        tag: "talkly-test-notification",
      });
    } else if (permission === "denied") {
      setDesktopNotifEnabledState(false);
      setToastMsg("Blocked in browser settings.");
    }
  };

  const handleSaveProfile = async (e) => {
    e?.preventDefault();
    setProfileError("");
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setProfileError("Name required.");
      return;
    }
    setSavingProfile(true);
    try {
      const formattedId = newTalklyId.trim()
        ? newTalklyId.trim().startsWith("@")
          ? newTalklyId.trim()
          : "@" + newTalklyId.trim()
        : myProfile?.talklyId || "";

      if (formattedId && formattedId !== myProfile?.talklyId) {
        const q = query(collection(db, "users"), where("talklyId", "==", formattedId));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          setProfileError("Username taken.");
          setSavingProfile(false);
          return;
        }
      }

      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: trimmedName });
      }
      await updateDoc(doc(db, "users", currentUser.uid), {
        displayName: trimmedName,
        about: newAbout.trim() || "Hey there! I am using Talkly.",
        ...(formattedId ? { talklyId: formattedId } : {}),
      });
      setToastMsg("Profile saved.");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.uid}`);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUnblock = async (userIdToUnblock) => {
    try {
      const updatedBlockedUsers = (myProfile?.blockedUsers || []).filter(
        (id) => id !== userIdToUnblock
      );
      await updateDoc(doc(db, "users", currentUser.uid), {
        blockedUsers: updatedBlockedUsers,
      });
      setToastMsg("Unblocked.");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  const handleSaveLock = async () => {
    setLockError("");
    if (appLockConfig?.enabled) {
      if (!currentLockPwd) {
        setLockError("Enter current password.");
        return;
      }
      const valid = await verifyCurrentAppLockPassword(currentLockPwd);
      if (!valid) {
        setLockError("Incorrect current password.");
        return;
      }
    }
    if (!appLockConfig?.enabled && newLockPwd.length < 4) {
      setLockError("Min 4 characters.");
      return;
    }
    if (newLockPwd && newLockPwd.length < 4) {
      setLockError("Min 4 characters.");
      return;
    }
    if (newLockPwd && newLockPwd !== confirmLockPwd) {
      setLockError("Passwords don't match.");
      return;
    }
    setSavingLock(true);
    try {
      await saveAppLock({
        password: newLockPwd || undefined,
        frequency: lockFrequency,
      });
      setCurrentLockPwd("");
      setNewLockPwd("");
      setConfirmLockPwd("");
      setToastMsg("App lock saved.");
    } catch (err) {
      setLockError(err?.message || "Failed to save.");
    } finally {
      setSavingLock(false);
    }
  };

  const handleDisableLock = async () => {
    setLockError("");
    if (!currentLockPwd) {
      setLockError("Enter current password.");
      return;
    }
    const valid = await verifyCurrentAppLockPassword(currentLockPwd);
    if (!valid) {
      setLockError("Incorrect current password.");
      return;
    }
    setSavingLock(true);
    try {
      await disableAppLock();
      setCurrentLockPwd("");
      setNewLockPwd("");
      setConfirmLockPwd("");
      setToastMsg("App lock off.");
    } catch (err) {
      setLockError(err?.message || "Failed to disable.");
    } finally {
      setSavingLock(false);
    }
  };

  const handleText = myProfile?.talklyId || `@${currentUser?.uid?.slice(0, 8) || "user"}`;
  const directLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/?search=${encodeURIComponent(handleText)}`
      : `/?search=${encodeURIComponent(handleText)}`;

  const copyShareText = async (value, type, label) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedType(type);
      setToastMsg(`${label} copied.`);
      setTimeout(() => setCopiedType(""), 2000);
    } catch {
      setToastMsg("Copy failed.");
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: myProfile?.displayName || currentUser?.displayName || "Talkly",
          text: handleText,
          url: directLink,
        });
        return;
      } catch {
        // fallback to copy
      }
    }
    copyShareText(directLink, "link", "Link");
  };

  return (
    <div className="flex flex-col w-full h-full bg-gray-50 dark:bg-gray-950 transition-colors duration-200 relative">
      {/* Top Header with Quick Section Jump Anchors */}
      <div className="h-[65px] bg-white dark:bg-gray-900 flex items-center justify-between gap-3 px-4 md:px-6 border-b border-gray-200 dark:border-gray-800 shrink-0 transition-colors duration-200">
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="p-2 -ml-1 rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Back"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base md:text-lg font-semibold text-gray-900 dark:text-gray-100">
            Settings
          </h1>
        </div>

        {/* Scroll Anchor Nav */}
        <div className="hidden sm:flex items-center gap-1 p-1 rounded-xl bg-gray-100 dark:bg-gray-800/80">
          {SETTINGS_SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => scrollToSection(sec.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  isActive
                    ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-sky-300 shadow-xs"
                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{sec.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {appLockConfig?.enabled && (
            <button
              type="button"
              onClick={() => {
                handleClose();
                lockAppNow();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
              title="Lock Now"
            >
              <Lock className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Lock</span>
            </button>
          )}
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-50/80 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/35 transition-colors"
            title="Sign Out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Sign Out</span>
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="hidden md:inline-flex items-center justify-center p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Close"
            aria-label="Close Settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mobile Scroll Anchor Bar */}
      <div className="flex sm:hidden items-center gap-1.5 px-4 py-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 overflow-x-auto shrink-0">
        {SETTINGS_SECTIONS.map((sec) => {
          const Icon = sec.icon;
          const isActive = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => scrollToSection(sec.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{sec.label}</span>
            </button>
          );
        })}
      </div>

      {/* Toast */}
      {toastMsg && (
        <div className="absolute top-[74px] left-1/2 -translate-x-1/2 z-40 bg-gray-900 dark:bg-gray-700 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg whitespace-nowrap">
          {toastMsg}
        </div>
      )}

      {/* Full-Width Continuous Scrollable Settings Layout */}
      <main
        ref={scrollContainerRef}
        onScroll={handleSettingsScroll}
        className="relative flex-1 overflow-y-auto scroll-smooth p-4 md:p-6 lg:p-8"
      >
        <div className="w-full space-y-6 pb-8">
          {/* SECTION 1: GENERAL */}
          <section
            ref={(el) => {
              sectionRefs.current.general = el;
            }}
            className="scroll-mt-4 space-y-3"
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 px-1">
              <Sliders className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400" />
              <span>General</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {/* Theme Card */}
              <div className="bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-2xl p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-300 flex items-center justify-center shrink-0">
                    {darkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Theme
                  </span>
                </div>

                <div className="inline-flex items-center p-1 rounded-xl bg-gray-100 dark:bg-gray-800 gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => darkMode && toggleTheme()}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      !darkMode
                        ? "bg-white dark:bg-gray-900 text-blue-600 shadow-xs"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5" />
                    <span>Light</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => !darkMode && toggleTheme()}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      darkMode
                        ? "bg-gray-900 text-sky-300 shadow-xs"
                        : "text-gray-500 hover:text-gray-800"
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5" />
                    <span>Dark</span>
                  </button>
                </div>
              </div>

              {/* Notifications Card */}
              <div className="bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-2xl p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      desktopNotifEnabled
                        ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {desktopNotifEnabled ? (
                      <Bell className="w-4 h-4" />
                    ) : (
                      <BellOff className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      Notifications
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {!isNotificationSupported()
                        ? "Unsupported"
                        : notifPermission === "denied"
                        ? "Blocked"
                        : desktopNotifEnabled
                        ? "On"
                        : "Off"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {desktopNotifEnabled && (
                    <button
                      type="button"
                      onClick={() =>
                        showDesktopNotification({
                          title: "Talkly",
                          body: "Test alert.",
                          icon: TALKLY_LOCKED_ICON,
                          tag: "talkly-test-notification",
                        })
                      }
                      className="px-2.5 py-1.5 text-xs font-semibold rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                      Test
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleToggleDesktopNotifications}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors ${
                      desktopNotifEnabled
                        ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40"
                        : "bg-blue-600 hover:bg-blue-700 text-white"
                    }`}
                  >
                    {desktopNotifEnabled ? "Off" : "On"}
                  </button>
                </div>
              </div>

              {/* Status Card */}
              <div className="bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-2xl p-4 flex items-center justify-between gap-3 md:col-span-2 xl:col-span-1">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                    {isOnline ? (
                      <Wifi className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {handleText}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {currentUser?.email}
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg shrink-0 ${
                    isOnline
                      ? "bg-emerald-50 dark:bg-emerald-900/25 text-emerald-700 dark:text-emerald-300"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isOnline ? "bg-emerald-500" : "bg-slate-400"
                    }`}
                  />
                  {isOnline ? "Online" : "Offline"}
                </span>
              </div>
            </div>
          </section>

          {/* SECTION 2: PROFILE & SHARE */}
          <section
            ref={(el) => {
              sectionRefs.current.profile = el;
            }}
            className="scroll-mt-4 space-y-3"
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 px-1">
              <User className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400" />
              <span>Profile</span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              {/* Profile Form */}
              <form
                onSubmit={handleSaveProfile}
                className="xl:col-span-7 bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-2xl p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-4">
                  <div className="flex items-center gap-3.5 pb-3 border-b border-gray-100 dark:border-gray-800">
                    <img
                      src={
                        currentUser?.photoURL ||
                        "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
                      }
                      alt=""
                      className="w-12 h-12 rounded-full object-cover border border-gray-200 dark:border-gray-700 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {myProfile?.displayName || currentUser?.displayName}
                      </p>
                      <p className="text-xs font-medium text-blue-600 dark:text-sky-400 truncate">
                        {handleText}
                      </p>
                    </div>
                  </div>

                  {profileError && (
                    <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-900/25 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-300 text-xs font-medium">
                      {profileError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                        <User className="w-3.5 h-3.5" />
                        <span>Name</span>
                      </label>
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                        <AtSign className="w-3.5 h-3.5" />
                        <span>Username</span>
                      </label>
                      <div className="flex items-center px-3.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 focus-within:border-blue-500">
                        <span className="text-gray-400 text-sm mr-1">@</span>
                        <input
                          type="text"
                          value={newTalklyId}
                          onChange={(e) =>
                            setNewTalklyId(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))
                          }
                          className="w-full bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                      <Info className="w-3.5 h-3.5" />
                      <span>About</span>
                    </label>
                    <input
                      type="text"
                      value={newAbout}
                      onChange={(e) => setNewAbout(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingProfile ? "Saving..." : "Save"}</span>
                  </button>
                </div>
              </form>

              {/* QR & Share Card */}
              <div className="xl:col-span-5 bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-2xl p-5 flex flex-col sm:flex-row xl:flex-row items-center gap-5">
                <div className="flex flex-col items-center shrink-0">
                  <div className="bg-white p-2.5 rounded-2xl border border-gray-200">
                    <QRCodeSVG
                      value={directLink}
                      size={124}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#111827"
                    />
                  </div>
                  <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                    <QrCode className="w-3 h-3 text-blue-600 dark:text-sky-400" />
                    <span>QR Code</span>
                  </span>
                </div>

                <div className="flex-1 w-full min-w-0 space-y-2.5">
                  <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-sky-400 truncate">
                      <AtSign className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{handleText.replace(/^@/, "")}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => copyShareText(handleText, "id", "ID")}
                      className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-sky-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors shrink-0"
                      title="Copy ID"
                    >
                      {copiedType === "id" ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300 truncate">
                      <Link2 className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                      <span className="truncate">{directLink}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => copyShareText(directLink, "link", "Link")}
                      className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors shrink-0"
                      title="Copy Link"
                    >
                      {copiedType === "link" ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleNativeShare}
                    className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-colors inline-flex items-center justify-center gap-1.5"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share</span>
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 3: SECURITY */}
          <section
            ref={(el) => {
              sectionRefs.current.security = el;
            }}
            className="scroll-mt-4 space-y-3"
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 px-1">
              <Shield className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400" />
              <span>Security</span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              {/* App Lock Card */}
              <div className="xl:col-span-7 bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-3 pb-3 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        App Lock
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {appLockConfig?.enabled
                          ? getFrequencyLabel(appLockConfig.frequency)
                          : "Off"}
                      </p>
                    </div>
                  </div>

                  {appLockConfig?.enabled && (
                    <button
                      type="button"
                      onClick={() => {
                        handleClose();
                        lockAppNow();
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-sky-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Lock</span>
                    </button>
                  )}
                </div>

                {lockError && (
                  <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 text-xs font-medium">
                    {lockError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {appLockConfig?.enabled && (
                    <div className="sm:col-span-2 relative">
                      <KeyRound className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type={showLockPasswords ? "text" : "password"}
                        value={currentLockPwd}
                        onChange={(e) => {
                          setCurrentLockPwd(e.target.value);
                          if (lockError) setLockError("");
                        }}
                        placeholder="Current password"
                        className="w-full pl-9 pr-9 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLockPasswords((p) => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                        aria-label="Toggle password visibility"
                      >
                        {showLockPasswords ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  )}

                  <div className="relative">
                    <KeyRound className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showLockPasswords ? "text" : "password"}
                      value={newLockPwd}
                      onChange={(e) => {
                        setNewLockPwd(e.target.value);
                        if (lockError) setLockError("");
                      }}
                      placeholder={appLockConfig?.enabled ? "New password" : "Password (4+ chars)"}
                      className="w-full pl-9 pr-9 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
                    />
                    {!appLockConfig?.enabled && (
                      <button
                        type="button"
                        onClick={() => setShowLockPasswords((p) => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                        aria-label="Toggle password visibility"
                      >
                        {showLockPasswords ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </div>

                  <div className="relative">
                    <KeyRound className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showLockPasswords ? "text" : "password"}
                      value={confirmLockPwd}
                      onChange={(e) => {
                        setConfirmLockPwd(e.target.value);
                        if (lockError) setLockError("");
                      }}
                      placeholder="Confirm password"
                      disabled={Boolean(appLockConfig?.enabled && !newLockPwd)}
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Frequency</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {APP_LOCK_FREQUENCIES.map((freq) => {
                      const selected = lockFrequency === freq.id;
                      return (
                        <button
                          key={freq.id}
                          type="button"
                          onClick={() => setLockFrequency(freq.id)}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
                            selected
                              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-sky-300"
                              : "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
                          }`}
                        >
                          {freq.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={savingLock}
                    onClick={handleSaveLock}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>
                      {savingLock ? "Saving..." : appLockConfig?.enabled ? "Save" : "Enable"}
                    </span>
                  </button>

                  {appLockConfig?.enabled && (
                    <button
                      type="button"
                      disabled={savingLock}
                      onClick={handleDisableLock}
                      className="px-3.5 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 text-xs font-semibold transition-colors"
                    >
                      Disable
                    </button>
                  )}
                </div>
              </div>

              {/* Blocked Users Card */}
              <div className="xl:col-span-5 bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-2xl p-5 flex flex-col">
                <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 flex items-center justify-center shrink-0">
                      <UserX className="w-4 h-4" />
                    </div>
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Blocked
                    </span>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                    {blockedUsersList.length}
                  </span>
                </div>

                {blockedUsersList.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-6 text-gray-400 dark:text-gray-500">
                    <UserX className="w-6 h-6 mb-1.5 opacity-60" />
                    <span className="text-xs">No blocked users</span>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                    {blockedUsersList.map((user) => (
                      <div
                        key={user.uid}
                        className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-gray-50/50 dark:bg-gray-950/60"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img
                            src={
                              user.photoURL ||
                              "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
                            }
                            alt=""
                            className="w-8 h-8 rounded-full object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {user.displayName}
                            </p>
                            {user.talklyId && (
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                                {user.talklyId}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUnblock(user.uid)}
                          className="px-3 py-1 text-xs font-semibold rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-sky-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors shrink-0"
                        >
                          Unblock
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
