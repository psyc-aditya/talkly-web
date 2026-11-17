import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Check, CheckCheck, Clock, Eye, Flame, Timer, Pencil, Trash2, X } from "lucide-react";

const AFTER_SEEN_MS = 10000;

export default function Message({
  message,
  isLastOutgoing,
  disappearingMode = "off",
  nowMs,
  fallbackReadAtMs,
  disappearDeadlineMs,
  disappearDurationMs,
  isTimerPaused = false,
  onEditMessage,
  onDeleteMessage,
}) {
  const { currentUser } = useAuth();
  const [showDetails, setShowDetails] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text || "");
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isOwner = message.senderId === currentUser.uid;

  const formatTime = (timestamp) => {
    if (!timestamp || typeof timestamp.toDate !== "function") return "";
    return timestamp.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const startEditing = (e) => {
    e?.stopPropagation();
    setEditText(message.text || "");
    setIsEditing(true);
    setConfirmDelete(false);
    setShowDetails(false);
  };

  const requestDelete = (e) => {
    e?.stopPropagation();
    setConfirmDelete(true);
    setShowDetails(false);
  };

  const handleConfirmDelete = async (e) => {
    e?.stopPropagation();
    if (!onDeleteMessage || deleting) return;
    setDeleting(true);
    try {
      await onDeleteMessage(message);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const cancelEditing = (e) => {
    e?.stopPropagation();
    setIsEditing(false);
    setEditText(message.text || "");
  };

  const saveEdit = async (e) => {
    e?.stopPropagation();
    const trimmed = editText.trim();
    if (!trimmed || savingEdit) return;
    if (trimmed === message.text) {
      setIsEditing(false);
      return;
    }
    if (!onEditMessage) {
      setIsEditing(false);
      return;
    }
    setSavingEdit(true);
    try {
      await onEditMessage(message, trimmed);
      setIsEditing(false);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleEditKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveEdit(e);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing(e);
    }
  };

  const isAfterSeen = message.disappearMode === "after_seen";
  const isSeen = message.status === "read";
  const isDelivered = message.status === "delivered";
  const isPending = !message.timestamp;

  let remainingSec = null;
  let progressPct = 100;
  if (isAfterSeen && isSeen) {
    const currentMs = nowMs || Date.now();
    const totalDuration = disappearDurationMs || AFTER_SEEN_MS;
    let remainingMs = totalDuration;
    if (typeof disappearDeadlineMs === "number") {
      remainingMs = Math.max(0, disappearDeadlineMs - currentMs);
    } else {
      const readAtMs = message.readAt?.toMillis
        ? message.readAt.toMillis()
        : fallbackReadAtMs || currentMs;
      const elapsed = Math.max(0, currentMs - readAtMs);
      remainingMs = Math.max(0, totalDuration - elapsed);
    }
    remainingSec = Math.ceil(remainingMs / 1000);
    progressPct =
      remainingMs >= totalDuration
        ? 100
        : Math.max(0, Math.min(100, (remainingMs / totalDuration) * 100));
  }

  const effectiveTimerMode = message.disappearMode || disappearingMode;

  return (
    <div className={`flex flex-col w-full ${isOwner ? "items-end" : "items-start"} mb-1 group`}>
      <div className={`flex items-center gap-1.5 w-full ${isOwner ? "justify-end" : "justify-start"}`}>
        {isOwner && !isEditing && !isPending && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
            <button
              type="button"
              onClick={startEditing}
              title="Edit message"
              aria-label="Edit message"
              className="p-1.5 rounded-full text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-200/70 dark:hover:bg-gray-800 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={requestDelete}
              title="Delete message"
              aria-label="Delete message"
              className="p-1.5 rounded-full text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div
          onClick={() => isOwner && !isEditing && setShowDetails((prev) => !prev)}
          title={isOwner && !isEditing ? "Click for options & receipt details" : undefined}
          className={`${isEditing ? "w-full max-w-[420px] min-w-[240px]" : "max-w-[82%] md:max-w-[70%]"} flex flex-col px-3.5 py-2 rounded-2xl shadow-sm relative overflow-hidden transition-all duration-200 ${
            isOwner && !isEditing ? "cursor-pointer" : ""
          } ${
            isAfterSeen
              ? isOwner
                ? "bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-tr-sm ring-1 ring-amber-400/50"
                : "bg-white dark:bg-gray-800 border border-amber-300/70 dark:border-amber-500/40 text-gray-900 dark:text-gray-100 rounded-tl-sm"
              : isOwner
              ? "bg-blue-600 dark:bg-blue-700 text-white rounded-tr-sm"
              : "bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded-tl-sm"
          }`}
        >
          {isAfterSeen && (
            <div className="flex items-center justify-between gap-2 mb-1 pb-1 border-b border-black/10 dark:border-white/10">
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${
                  isOwner ? "text-amber-200" : "text-amber-600 dark:text-amber-400"
                }`}
              >
                <Flame className="w-3 h-3 shrink-0" />
                {isSeen
                  ? isTimerPaused
                    ? `Paused • ${remainingSec}s`
                    : `Vanishes in ${remainingSec}s`
                  : "Seen & Disappear"}
              </span>
            </div>
          )}

          {isEditing ? (
            <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={handleEditKeyDown}
                autoFocus
                disabled={savingEdit}
                className="w-full bg-white/15 dark:bg-black/25 text-white placeholder-blue-200 text-[14.2px] px-2.5 py-1.5 rounded-lg outline-none border border-white/25 focus:border-white/60"
                placeholder="Edit message..."
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={savingEdit}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-black/20 hover:bg-black/30 text-blue-100 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={!editText.trim() || savingEdit}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white text-blue-700 hover:bg-blue-50 disabled:opacity-60 transition-colors"
                >
                  <Check className="w-3 h-3" />
                  {savingEdit ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end justify-between gap-x-2.5 gap-y-0.5">
              <p
                className={`text-[14.2px] leading-snug break-words min-w-0 whitespace-pre-wrap ${
                  isOwner ? "text-white" : "text-gray-900 dark:text-gray-100"
                }`}
              >
                {message.text}
              </p>
              <div className="flex items-center gap-1.5 ml-auto shrink-0">
                {!isAfterSeen && effectiveTimerMode && effectiveTimerMode !== "off" && (
                  <Timer
                    className={`w-3 h-3 ${
                      isOwner ? "text-blue-200/80" : "text-gray-400 dark:text-gray-500"
                    }`}
                    title={`Disappears after ${effectiveTimerMode}`}
                  />
                )}
                {message.edited && (
                  <span
                    className={`text-[10px] italic ${
                      isOwner ? "text-blue-100/80" : "text-gray-400 dark:text-gray-500"
                    }`}
                  >
                    Edited
                  </span>
                )}
                <span
                  className={`text-[11px] whitespace-nowrap ${
                    isOwner ? "text-blue-100/90" : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {formatTime(message.timestamp) || "Sending"}
                </span>
              </div>
            </div>
          )}

          {/* Countdown progress bar for Seen & Disappear */}
          {isAfterSeen && isSeen && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/15 dark:bg-white/10">
              <div
                className="h-full bg-amber-400 transition-all duration-1000 ease-linear"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Inline Delete Confirmation */}
      {isOwner && confirmDelete && !isEditing && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-1 px-3 py-1.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/60 text-xs flex items-center gap-2.5 shadow-xs"
        >
          <span className="text-red-700 dark:text-red-300 font-medium">Delete this message?</span>
          <button
            type="button"
            disabled={deleting}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(false);
            }}
            className="px-2 py-0.5 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={handleConfirmDelete}
            className="px-2.5 py-0.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-60"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      )}

      {/* Interactive Detailed Receipt, Edit & Delete Info */}
      {isOwner && showDetails && !isEditing && !confirmDelete && (
        <div className="mt-1 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800/90 border border-gray-200 dark:border-gray-700 text-[11px] text-gray-600 dark:text-gray-300 flex flex-wrap items-center gap-3 shadow-xs">
          <span>Sent: {formatTime(message.timestamp) || "Pending"}</span>
          {message.deliveredAt && <span>Delivered: {formatTime(message.deliveredAt)}</span>}
          {message.readAt && (
            <span className="text-blue-600 dark:text-blue-400 font-medium">
              Seen: {formatTime(message.readAt)}
            </span>
          )}
          {!isPending && (
            <>
              <button
                type="button"
                onClick={startEditing}
                className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
              <button
                type="button"
                onClick={requestDelete}
                className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 hover:underline font-medium"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {/* Last Outgoing Message Live Receipt Line */}
      {isOwner && isLastOutgoing && !showDetails && !isEditing && (
        <div className="mt-0.5 mr-1 flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
          {isPending ? (
            <>
              <Clock className="w-3 h-3" />
              <span>Sending...</span>
            </>
          ) : isSeen ? (
            <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
              <Eye className="w-3 h-3" />
              Seen{message.readAt ? ` • ${formatTime(message.readAt)}` : ""}
            </span>
          ) : isDelivered ? (
            <span className="inline-flex items-center gap-1">
              <CheckCheck className="w-3 h-3" />
              Delivered{message.deliveredAt ? ` • ${formatTime(message.deliveredAt)}` : ""}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Check className="w-3 h-3" />
              Sent
            </span>
          )}
        </div>
      )}
    </div>
  );
}
