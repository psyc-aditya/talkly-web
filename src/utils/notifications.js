const NOTIF_PREF_PREFIX = "talkly_desktop_notifications_";

const TALKLY_LOCKED_ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="16" fill="#2563eb"/>' +
      '<path d="M18 22h28a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H28l-10 8v-8h0a4 4 0 0 1-4-4V26a4 4 0 0 1 4-4z" fill="#ffffff"/>' +
      "</svg>"
  );

export function isNotificationSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotificationPermission() {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.permission;
}

export function getDesktopNotifEnabled(uid) {
  if (!isNotificationSupported() || Notification.permission !== "granted") {
    return false;
  }
  if (!uid) return true;
  try {
    const raw = localStorage.getItem(`${NOTIF_PREF_PREFIX}${uid}`);
    if (raw === "false") return false;
    return true;
  } catch {
    return true;
  }
}

export function setDesktopNotifEnabled(uid, enabled) {
  if (!uid) return;
  try {
    localStorage.setItem(`${NOTIF_PREF_PREFIX}${uid}`, enabled ? "true" : "false");
  } catch {
    // ignore storage errors
  }
}

export async function requestDesktopNotificationPermission(uid) {
  if (!isNotificationSupported()) {
    return { granted: false, permission: "unsupported" };
  }

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }

  const granted = permission === "granted";
  if (uid && granted) {
    setDesktopNotifEnabled(uid, true);
  }
  return { granted, permission };
}

export function showDesktopNotification({
  title,
  body,
  icon,
  tag,
  onClick,
}) {
  if (!isNotificationSupported() || Notification.permission !== "granted") {
    return null;
  }

  try {
    const notification = new Notification(title || "Talkly", {
      body: body || "",
      icon: icon || TALKLY_LOCKED_ICON,
      tag,
      renotify: Boolean(tag),
      silent: false,
    });

    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore focus errors
      }
      if (typeof onClick === "function") {
        onClick();
      }
      notification.close();
    };

    setTimeout(() => {
      try {
        notification.close();
      } catch {
        // ignore close errors
      }
    }, 6500);

    return notification;
  } catch {
    return null;
  }
}

export { TALKLY_LOCKED_ICON };
