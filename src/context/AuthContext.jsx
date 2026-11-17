import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { auth, db, rtdb } from "../firebase";
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  updateProfile,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import {
  ref,
  onValue,
  onDisconnect,
  set,
  serverTimestamp as rtdbServerTimestamp,
} from "firebase/database";
import { handleFirestoreError, OperationType } from "../utils/errorHandler";
import {
  generateSalt,
  hashAppLockPassword,
  getLocalAppLock,
  setLocalAppLock,
  markAppLockUnlocked,
  clearAppLockSession,
  isAppLockRequired,
  RESET_LOCK_UID_KEY,
} from "../utils/appLock";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [rtdbConnected, setRtdbConnected] = useState(false);
  const [isAppVisible, setIsAppVisible] = useState(
    typeof document !== "undefined" ? document.visibilityState === "visible" : true
  );
  const [isWindowFocused, setIsWindowFocused] = useState(
    typeof document !== "undefined" ? document.hasFocus() : true
  );
  const [appLockConfig, setAppLockConfig] = useState(null);
  const [isAppLocked, setIsAppLocked] = useState(false);
  const manualLockRef = useRef(false);
  const inMemoryUnlockedRef = useRef(false);
  const appLockConfigRef = useRef(null);

  useEffect(() => {
    appLockConfigRef.current = appLockConfig;
  }, [appLockConfig]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const generateTalklyId = async (baseId = "") => {
    let isUnique = false;
    let newId = baseId;

    if (newId) {
      const q = query(collection(db, "users"), where("talklyId", "==", newId));
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) return newId;
    }

    while (!isUnique) {
      newId = "@" + Math.random().toString(36).substr(2, 8);
      const q = query(collection(db, "users"), where("talklyId", "==", newId));
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) {
        isUnique = true;
      }
    }
    return newId;
  };

  useEffect(() => {
    if (isSignInWithEmailLink(auth, window.location.href)) {
      let email = window.localStorage.getItem("emailForSignIn");
      if (!email) {
        email = window.prompt("Please provide your email for confirmation");
      }
      if (email) {
        signInWithEmailLink(auth, email, window.location.href)
          .then(() => {
            window.localStorage.removeItem("emailForSignIn");
            window.history.replaceState(null, "", window.location.pathname);
          })
          .catch((error) => console.error("Error signing in with email link", error));
      }
    }

    let unsubConnected = null;
    let unsubUserDoc = null;

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (unsubConnected) {
        unsubConnected();
        unsubConnected = null;
      }
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }

      if (user) {
        manualLockRef.current = false;
        inMemoryUnlockedRef.current = false;

        // Check if user requested App Lock reset prior to re-login
        let shouldResetLock = false;
        try {
          if (sessionStorage.getItem(RESET_LOCK_UID_KEY) === user.uid) {
            shouldResetLock = true;
            sessionStorage.removeItem(RESET_LOCK_UID_KEY);
          }
        } catch {
          // ignore storage errors
        }

        if (shouldResetLock) {
          setLocalAppLock(user.uid, null);
          setAppLockConfig({ enabled: false });
          setIsAppLocked(false);
        } else {
          // Immediately evaluate locally cached lock config so UI never flashes before Firestore snapshot
          const cachedLock = getLocalAppLock(user.uid);
          if (cachedLock?.enabled) {
            setAppLockConfig(cachedLock);
            setIsAppLocked(isAppLockRequired(user.uid, cachedLock, inMemoryUnlockedRef.current));
          } else {
            setAppLockConfig(null);
            setIsAppLocked(false);
          }
        }

        const userRef = doc(db, "users", user.uid);
        try {
          const userSnap = await getDoc(userRef);

          if (!userSnap.exists()) {
            const talklyId = await generateTalklyId();
            await setDoc(userRef, {
              uid: user.uid,
              displayName: user.displayName || user.email.split("@")[0],
              email: user.email,
              photoURL:
                user.photoURL ||
                "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png",
              about: "Hey there! I am using Talkly.",
              talklyId: talklyId,
              blockedUsers: [],
            });
          } else {
            const data = userSnap.data();
            let updates = {};
            if (!data.talklyId) {
              updates.talklyId = await generateTalklyId();
            }
            if (!data.blockedUsers) {
              updates.blockedUsers = [];
            }
            if (shouldResetLock && data.appLock?.enabled) {
              updates.appLock = { enabled: false };
            }
            if (Object.keys(updates).length > 0) {
              await setDoc(userRef, updates, { merge: true });
            }
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
        }

        setCurrentUser(user);

        // Listen to user doc for appLock sync across tabs/devices
        unsubUserDoc = onSnapshot(
          userRef,
          (snap) => {
            if (!snap.exists()) return;
            const remoteLock = snap.data()?.appLock || null;
            if (remoteLock?.enabled && remoteLock?.hash) {
              setLocalAppLock(user.uid, remoteLock);
              setAppLockConfig(remoteLock);
              if (
                manualLockRef.current ||
                isAppLockRequired(user.uid, remoteLock, inMemoryUnlockedRef.current)
              ) {
                setIsAppLocked(true);
              }
            } else {
              setLocalAppLock(user.uid, null);
              setAppLockConfig(remoteLock);
              setIsAppLocked(false);
            }
          },
          () => {}
        );

        // Track RTDB connection status
        const connectedRef = ref(rtdb, ".info/connected");
        unsubConnected = onValue(connectedRef, (snap) => {
          const connected = snap.val() === true;
          setRtdbConnected(connected);
          if (!connected && !navigator.onLine) {
            setIsOnline(false);
          } else if (connected) {
            setIsOnline(true);
          }
        });
      } else {
        setCurrentUser(null);
        setRtdbConnected(false);
        setAppLockConfig(null);
        setIsAppLocked(false);
        manualLockRef.current = false;
        inMemoryUnlockedRef.current = false;
      }
      setLoading(false);
    });

    return () => {
      unsub();
      if (unsubConnected) unsubConnected();
      if (unsubUserDoc) unsubUserDoc();
    };
  }, []);

  // Track foreground/background visibility, window focus, and instant lock on leave/tab-shift/minimize
  useEffect(() => {
    const uid = currentUser?.uid;
    const writeOfflineImmediately = () => {
      if (!uid) return;
      const userStatusRef = ref(rtdb, "/status/" + uid);
      set(userStatusRef, {
        state: "offline",
        last_changed: rtdbServerTimestamp(),
      }).catch(() => {});
    };

    const lockIfEveryVisit = () => {
      const cfg = appLockConfigRef.current;
      if (cfg?.enabled && cfg?.frequency === "every_visit") {
        inMemoryUnlockedRef.current = false;
        setIsAppLocked(true);
      }
    };

    const handleVisibilityChange = () => {
      const visible = document.visibilityState === "visible";
      setIsAppVisible(visible);
      if (!visible) {
        writeOfflineImmediately();
        lockIfEveryVisit();
      } else {
        setIsWindowFocused(document.hasFocus());
      }
    };

    const handlePageHide = () => {
      setIsAppVisible(false);
      writeOfflineImmediately();
      lockIfEveryVisit();
    };

    const handlePageShow = () => {
      const visible = document.visibilityState === "visible";
      setIsAppVisible(visible);
      setIsWindowFocused(document.hasFocus());
    };

    const handleWindowBlur = () => {
      setIsWindowFocused(false);
    };

    const handleWindowFocus = () => {
      setIsWindowFocused(true);
      if (document.visibilityState === "visible") {
        setIsAppVisible(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("freeze", handlePageHide);
    document.addEventListener("resume", handlePageShow);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("beforeunload", handlePageHide);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("freeze", handlePageHide);
      document.removeEventListener("resume", handlePageShow);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("beforeunload", handlePageHide);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [currentUser?.uid]);

  // Keep RTDB /status/{uid} strictly synchronized with connection, visibility, window focus, and lock state
  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid || !rtdbConnected) return;

    const userStatusDatabaseRef = ref(rtdb, "/status/" + uid);
    const offlinePayload = {
      state: "offline",
      last_changed: rtdbServerTimestamp(),
    };
    const awayPayload = {
      state: "away",
      last_changed: rtdbServerTimestamp(),
    };
    const onlinePayload = {
      state: "online",
      last_changed: rtdbServerTimestamp(),
    };

    if (isAppLocked || !isAppVisible) {
      set(userStatusDatabaseRef, offlinePayload).catch(() => {});
      return;
    }

    onDisconnect(userStatusDatabaseRef)
      .set(offlinePayload)
      .then(() => {
        if (document.visibilityState !== "visible") {
          set(userStatusDatabaseRef, offlinePayload).catch(() => {});
          return;
        }
        if (isWindowFocused) {
          set(userStatusDatabaseRef, onlinePayload).catch(() => {});
        } else {
          set(userStatusDatabaseRef, awayPayload).catch(() => {});
        }
      })
      .catch(() => {});
  }, [currentUser?.uid, rtdbConnected, isAppVisible, isWindowFocused, isAppLocked]);

  // Re-evaluate App Lock expiration when returning to foreground
  useEffect(() => {
    if (!currentUser?.uid || !appLockConfig?.enabled) return;
    if (isAppVisible) {
      if (
        manualLockRef.current ||
        isAppLockRequired(currentUser.uid, appLockConfig, inMemoryUnlockedRef.current)
      ) {
        setIsAppLocked(true);
      }
    }
  }, [isAppVisible, currentUser?.uid, appLockConfig]);

  const unlockApp = useCallback(
    async (password) => {
      if (!currentUser?.uid || !appLockConfig?.enabled || !appLockConfig?.hash) return true;
      const computed = await hashAppLockPassword(password, appLockConfig.salt || "");
      if (computed !== appLockConfig.hash) {
        return false;
      }
      manualLockRef.current = false;
      inMemoryUnlockedRef.current = true;
      markAppLockUnlocked(currentUser.uid);
      setIsAppLocked(false);
      return true;
    },
    [currentUser?.uid, appLockConfig]
  );

  const verifyCurrentAppLockPassword = useCallback(
    async (password) => {
      if (!appLockConfig?.enabled || !appLockConfig?.hash) return true;
      const computed = await hashAppLockPassword(password, appLockConfig.salt || "");
      return computed === appLockConfig.hash;
    },
    [appLockConfig]
  );

  const lockAppNow = useCallback(() => {
    if (!currentUser?.uid || !appLockConfig?.enabled) return;
    manualLockRef.current = true;
    inMemoryUnlockedRef.current = false;
    clearAppLockSession(currentUser.uid);
    setIsAppLocked(true);
  }, [currentUser?.uid, appLockConfig]);

  const saveAppLock = useCallback(
    async ({ password, frequency }) => {
      if (!currentUser?.uid) return;
      const salt = password ? generateSalt() : appLockConfig?.salt || generateSalt();
      const hash = password
        ? await hashAppLockPassword(password, salt)
        : appLockConfig?.hash;

      if (!hash) {
        throw new Error("Please enter a password.");
      }

      const nextConfig = {
        enabled: true,
        salt,
        hash,
        frequency: frequency || "every_visit",
        updatedAt: Date.now(),
      };

      await setDoc(doc(db, "users", currentUser.uid), { appLock: nextConfig }, { merge: true });
      manualLockRef.current = false;
      inMemoryUnlockedRef.current = true;
      setLocalAppLock(currentUser.uid, nextConfig);
      markAppLockUnlocked(currentUser.uid);
      setAppLockConfig(nextConfig);
      setIsAppLocked(false);
    },
    [currentUser?.uid, appLockConfig]
  );

  const disableAppLock = useCallback(async () => {
    if (!currentUser?.uid) return;
    const disabledConfig = { enabled: false, updatedAt: Date.now() };
    await setDoc(doc(db, "users", currentUser.uid), { appLock: disabledConfig }, { merge: true });
    manualLockRef.current = false;
    inMemoryUnlockedRef.current = false;
    setLocalAppLock(currentUser.uid, null);
    setAppLockConfig(disabledConfig);
    setIsAppLocked(false);
  }, [currentUser?.uid]);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const signupWithEmail = async (email, password, name, username) => {
    if (username) {
      const formattedUsername = username.startsWith("@") ? username : "@" + username;
      const q = query(collection(db, "users"), where("talklyId", "==", formattedUsername));
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        throw new Error("Username is already taken.");
      }
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(userCredential.user, { displayName: name });

    const userRef = doc(db, "users", userCredential.user.uid);
    try {
      const talklyId = username
        ? username.startsWith("@")
          ? username
          : "@" + username
        : await generateTalklyId();
      await setDoc(
        userRef,
        {
          displayName: name,
          talklyId: talklyId,
        },
        { merge: true }
      );
    } catch (error) {
      console.error("Error updating display name in Firestore", error);
    }

    await sendEmailVerification(userCredential.user);
    return userCredential;
  };

  const loginWithEmail = (email, password) => {
    return signInWithEmailAndPassword(auth, email, password);
  };

  const resetPassword = (email) => {
    return sendPasswordResetEmail(auth, email);
  };

  const sendMagicLink = (email) => {
    const actionCodeSettings = {
      url: window.location.origin,
      handleCodeInApp: true,
    };
    window.localStorage.setItem("emailForSignIn", email);
    return sendSignInLinkToEmail(auth, email, actionCodeSettings);
  };

  const logout = async () => {
    inMemoryUnlockedRef.current = false;
    if (currentUser) {
      clearAppLockSession(currentUser.uid);
      const userStatusDatabaseRef = ref(rtdb, "/status/" + currentUser.uid);
      await set(userStatusDatabaseRef, {
        state: "offline",
        last_changed: rtdbServerTimestamp(),
      }).catch(() => {});
    }
    await signOut(auth);
  };

  const requestResetAppLock = async () => {
    if (currentUser?.uid) {
      try {
        sessionStorage.setItem(RESET_LOCK_UID_KEY, currentUser.uid);
      } catch {
        // ignore storage errors
      }
    }
    await logout();
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isOnline,
        appLockConfig,
        isAppLocked,
        unlockApp,
        lockAppNow,
        saveAppLock,
        disableAppLock,
        verifyCurrentAppLockPassword,
        requestResetAppLock,
        loginWithGoogle,
        signupWithEmail,
        loginWithEmail,
        resetPassword,
        sendMagicLink,
        logout,
      }}
    >
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

