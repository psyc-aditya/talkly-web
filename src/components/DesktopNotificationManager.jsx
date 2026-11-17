import { useEffect, useRef } from "react";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import {
  getDesktopNotifEnabled,
  showDesktopNotification,
  TALKLY_LOCKED_ICON,
} from "../utils/notifications";

export default function DesktopNotificationManager() {
  const { currentUser, isAppLocked } = useAuth();
  const { data, dispatch } = useChat();

  const isLockedRef = useRef(isAppLocked);
  const activeChatIdRef = useRef(data.chatId);
  const initializedRef = useRef(false);
  const prevChatStatesRef = useRef(new Map());
  const userCacheRef = useRef(new Map());
  const myBlockedUsersRef = useRef(new Set());

  useEffect(() => {
    isLockedRef.current = isAppLocked;
  }, [isAppLocked]);

  useEffect(() => {
    activeChatIdRef.current = data.chatId;
  }, [data.chatId]);

  // Keep current user's blockedUsers list synced so blocked accounts never notify
  useEffect(() => {
    if (!currentUser?.uid) {
      myBlockedUsersRef.current = new Set();
      return;
    }
    const unsubMe = onSnapshot(
      doc(db, "users", currentUser.uid),
      (snap) => {
        if (snap.exists()) {
          const list = snap.data()?.blockedUsers || [];
          myBlockedUsersRef.current = new Set(Array.isArray(list) ? list : []);
        }
      },
      () => {}
    );
    return () => unsubMe();
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid || !currentUser.emailVerified) {
      initializedRef.current = false;
      prevChatStatesRef.current.clear();
      return;
    }

    initializedRef.current = false;
    prevChatStatesRef.current.clear();

    const q = query(collection(db, "chats"), where("members", "array-contains", currentUser.uid));

    const getSenderProfile = async (senderId) => {
      if (!senderId) return null;
      const cached = userCacheRef.current.get(senderId);
      if (cached) return cached;
      try {
        const snap = await getDoc(doc(db, "users", senderId));
        if (snap.exists()) {
          const u = snap.data();
          userCacheRef.current.set(senderId, u);
          return u;
        }
      } catch {
        // ignore lookup errors
      }
      return null;
    };

    const unsub = onSnapshot(
      q,
      async (snapshot) => {
        if (!initializedRef.current) {
          snapshot.docs.forEach((d) => {
            const chatData = d.data();
            const lm = chatData.lastMessage;
            prevChatStatesRef.current.set(d.id, {
              unread: chatData.unreadCounts?.[currentUser.uid] || 0,
              updatedAtMs: chatData.updatedAt?.toMillis?.() || 0,
              lastSenderId: lm?.senderId || "",
              lastText: lm?.text || "",
              status: chatData.status || "",
            });
          });
          initializedRef.current = true;
          return;
        }

        const changes = snapshot.docChanges();
        for (const change of changes) {
          const chatId = change.doc.id;
          if (change.type === "removed") {
            prevChatStatesRef.current.delete(chatId);
            continue;
          }

          const chatData = change.doc.data();
          const prev = prevChatStatesRef.current.get(chatId);
          const lm = chatData.lastMessage;
          const myUnread = chatData.unreadCounts?.[currentUser.uid] || 0;
          const updatedAtMs = chatData.updatedAt?.toMillis?.() || 0;

          prevChatStatesRef.current.set(chatId, {
            unread: myUnread,
            updatedAtMs,
            lastSenderId: lm?.senderId || "",
            lastText: lm?.text || "",
            status: chatData.status || "",
          });

          const otherUserId = (chatData.members || []).find((id) => id !== currentUser.uid);
          if (!otherUserId || myBlockedUsersRef.current.has(otherUserId)) {
            continue;
          }

          // Determine if this snapshot change represents a genuine NEW incoming message or request
          // (Explicitly ignores status updates like 'delivered'/'read', reading-chat indicators, or disappeared/cleared updates)
          const isIncomingNewMessage =
            Boolean(lm) &&
            !lm.disappeared &&
            lm.senderId === otherUserId &&
            ((!prev && myUnread > 0) ||
              (Boolean(prev) && myUnread > prev.unread) ||
              (Boolean(prev) &&
                Boolean(lm.text) &&
                myUnread > 0 &&
                updatedAtMs > prev.updatedAtMs &&
                (lm.text !== prev.lastText || lm.senderId !== prev.lastSenderId)));

          const isNewIncomingRequest =
            !prev && chatData.status === "pending" && chatData.senderId === otherUserId;

          if (!isIncomingNewMessage && !isNewIncomingRequest) {
            continue;
          }

          const isActivelyReadingThisChat =
            !isLockedRef.current &&
            activeChatIdRef.current === chatId &&
            typeof document !== "undefined" &&
            document.visibilityState === "visible" &&
            document.hasFocus();

          // Never show desktop notification if user is already actively reading this chat
          if (isActivelyReadingThisChat) {
            continue;
          }

          if (!getDesktopNotifEnabled(currentUser.uid)) {
            continue;
          }

          if (isLockedRef.current) {
            // App is locked: generic alert without exposing sender or message text
            showDesktopNotification({
              title: "Talkly",
              body: "A new message appeared. Unlock Talkly to view.",
              icon: TALKLY_LOCKED_ICON,
              tag: "talkly-locked-message",
            });
          } else {
            const sender = await getSenderProfile(otherUserId);
            if (!sender) continue;
            if (sender.blockedUsers?.includes(currentUser.uid)) continue;

            const title = sender.displayName || "New message";
            const body = isNewIncomingRequest
              ? "Sent you a chat request"
              : lm?.text || "New message";

            showDesktopNotification({
              title,
              body,
              icon: sender.photoURL || TALKLY_LOCKED_ICON,
              tag: `talkly-chat-${chatId}`,
              onClick: () => {
                dispatch({ type: "CHANGE_USER", payload: sender });
              },
            });
          }
        }
      },
      () => {}
    );

    return () => unsub();
  }, [currentUser?.uid, currentUser?.emailVerified, dispatch]);

  return null;
}
