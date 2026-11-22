import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useContextMenu } from "../context/ContextMenuContext";
import {
  Check,
  CheckCheck,
  Clock,
  Eye,
  Pencil,
  Trash2,
  X,
  Copy,
  Reply,
  Info,
  MoreHorizontal,
} from "lucide-react";

import { isEmojiOnlyMessage } from "../utils/emojiEffects";

const AFTER_SEEN_MS = 10000;

export default function Message({
  message,
  isLastOutgoing,
  disappearingMode = "off",
  nowMs,
  fallbackReadAtMs,
  disappearDeadlineMs,
  disappearDurationMs,
  otherUserName = "",
  isHighlighted = false,
  isKeyboardSelected = false,
  onEditMessage,
  onDeleteMessage,
  onDeleteForMe,
  onCopyMessage,
  onReplyMessage,
  onJumpToMessage,
  onTriggerEmojiEffect,
}) {
  const { currentUser } = useAuth();
  const { openContextMenu } = useContextMenu();
  const [showDetails, setShowDetails] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text || "");
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const isOwner = message.senderId === currentUser.uid;

  const rawText = message.text || "";
  const lineCount = rawText.split("\n").length;
  const isLongMessage = rawText.length > 420 || lineCount > 9;
  const displayedText =
    isLongMessage && !isExpanded
      ? (() => {
          const lines = rawText.split("\n");
          const sliced = lines.length > 9 ? lines.slice(0, 9).join("\n") : rawText;
          return sliced.length > 420 ? `${sliced.slice(0, 420).trimEnd()}…` : `${sliced}…`;
        })()
      : rawText;

  const formatTime = (timestamp) => {
    if (!timestamp || typeof timestamp.toDate !== "function") return "";
    return timestamp.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const handleCopy = (e) => {
    e?.stopPropagation();
    if (onCopyMessage) {
      onCopyMessage(message);
    } else if (message.text) {
      navigator.clipboard?.writeText(message.text).catch(() => {});
    }
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 1600);
  };

  const handleReply = (e) => {
    e?.stopPropagation();
    setShowDetails(false);
    setConfirmDelete(false);
    onReplyMessage?.(message);
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
  }

  const effectiveTimerMode = message.disappearMode || disappearingMode;
  const hasDisappearTimer = isAfterSeen || (effectiveTimerMode && effectiveTimerMode !== "off");
  const isJumboEmoji = !isEditing && isEmojiOnlyMessage(message.text);

  const openMessageMenu = (x, y) => {
    if (isEditing) return;
    const preview =
      message.text && message.text.length > 44
        ? `${message.text.slice(0, 44)}...`
        : message.text || "Message";

    openContextMenu({
      x,
      y,
      header: {
        title: isOwner ? "You" : otherUserName || "Message",
        subtitle: preview,
      },
      items: [
        {
          id: "reply",
          label: "Reply",
          icon: Reply,
          disabled: isPending,
          onClick: () => handleReply(),
        },
        {
          id: "copy",
          label: "Copy Text",
          icon: Copy,
          disabled: !message.text,
          onClick: () => handleCopy(),
        },
        {
          id: "edit",
          label: "Edit Message",
          icon: Pencil,
          hidden: !isOwner,
          disabled: isPending,
          onClick: () => startEditing(),
        },
        {
          id: "info",
          label: showDetails ? "Hide Info" : "Message Info",
          icon: Info,
          onClick: () => {
            setConfirmDelete(false);
            setShowDetails((prev) => !prev);
          },
        },
        { type: "divider" },
        isOwner
          ? {
              id: "delete",
              label: "Delete Message",
              icon: Trash2,
              danger: true,
              disabled: isPending,
              onClick: () => requestDelete(),
            }
          : {
              id: "delete-for-me",
              label: "Delete for Me",
              icon: Trash2,
              danger: true,
              onClick: () => onDeleteForMe?.(message),
            },
      ],
    });
  };

  const handleContextMenu = (e) => {
    if (isEditing) return;
    e.preventDefault();
    e.stopPropagation();
    openMessageMenu(e.clientX, e.clientY);
  };

  const handleMoreButtonClick = (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    openMessageMenu(isOwner ? rect.left - 180 : rect.left, rect.bottom + 6);
  };

  const handleBubbleClick = () => {
    if (isEditing) return;
    const selectedText = typeof window !== "undefined" ? window.getSelection()?.toString() : "";
    if (selectedText) return;
    if (isJumboEmoji && onTriggerEmojiEffect) {
      onTriggerEmojiEffect(message.text, isOwner ? "outgoing" : "incoming");
    }
    setShowDetails((prev) => !prev);
  };

  const quickActionBar = !isEditing && !isPending && (
    <div className="hidden sm:flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
      <button
        type="button"
        onClick={handleReply}
        title="Reply"
        aria-label="Reply to message"
        className="p-1.5 rounded-full text-gray-400 hover:text-blue-600 dark:hover:text-sky-400 hover:bg-gray-200/70 dark:hover:bg-gray-800 transition-colors"
      >
        <Reply className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={handleCopy}
        title={justCopied ? "Copied" : "Copy"}
        aria-label="Copy message"
        className="p-1.5 rounded-full text-gray-400 hover:text-blue-600 dark:hover:text-sky-400 hover:bg-gray-200/70 dark:hover:bg-gray-800 transition-colors"
      >
        {justCopied ? (
          <Check className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
      {isOwner && (
        <button
          type="button"
          onClick={startEditing}
          title="Edit"
          aria-label="Edit message"
          className="p-1.5 rounded-full text-gray-400 hover:text-blue-600 dark:hover:text-sky-400 hover:bg-gray-200/70 dark:hover:bg-gray-800 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={handleMoreButtonClick}
        title="More options"
        aria-label="More message options"
        className="p-1.5 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/70 dark:hover:bg-gray-800 transition-colors"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return (
    <div
      data-msg-id={message.id}
      className={`flex flex-col w-full ${isOwner ? "items-end" : "items-start"} mb-1 group rounded-2xl transition-all duration-200 ${
        isKeyboardSelected
          ? "bg-blue-50/90 dark:bg-sky-900/30 ring-1 ring-blue-400/70 dark:ring-sky-400/60 py-1.5 -mx-2.5 px-2.5"
          : isHighlighted
          ? "bg-sky-100/70 dark:bg-sky-900/30 py-1 -mx-2 px-2"
          : ""
      }`}
    >
      <div className={`flex items-center gap-1.5 w-full min-w-0 ${isOwner ? "justify-end" : "justify-start"}`}>
        {isOwner && quickActionBar}

        <div
          onClick={handleBubbleClick}
          onContextMenu={handleContextMenu}
          title={
            !isEditing
              ? isJumboEmoji
                ? "Click to replay effect • Right-click for options"
                : "Click for details • Right-click for options"
              : undefined
          }
          className={`${
            isEditing
              ? "w-full max-w-[420px] min-w-0"
              : "max-w-[86%] sm:max-w-[74%] md:max-w-[68%] min-w-0"
          } flex flex-col ${
            isJumboEmoji ? "px-3 py-2" : "px-3.5 py-2"
          } rounded-2xl shadow-sm relative overflow-hidden transition-all duration-200 ${
            !isEditing ? "cursor-pointer" : ""
          } ${
            isOwner
              ? "bg-blue-600 dark:bg-blue-700 text-white rounded-tr-sm"
              : "bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded-tl-sm"
          }`}
        >
          {/* Quoted Reply Preview */}
          {message.replyTo && !isEditing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (message.replyTo?.id) {
                  onJumpToMessage?.(message.replyTo.id);
                }
              }}
              className={`mb-1.5 px-2.5 py-1.5 rounded-lg text-left transition-colors border max-w-full min-w-0 overflow-hidden ${
                isOwner
                  ? "bg-white/12 hover:bg-white/18 border-white/15 text-blue-50"
                  : "bg-slate-50 dark:bg-gray-900/70 hover:bg-slate-100 dark:hover:bg-gray-900 border-slate-200/80 dark:border-gray-700 text-gray-700 dark:text-gray-300"
              }`}
            >
              <p
                className={`text-[11px] font-semibold truncate ${
                  isOwner ? "text-sky-100" : "text-blue-600 dark:text-sky-400"
                }`}
              >
                {message.replyTo.senderId === currentUser.uid
                  ? "You"
                  : message.replyTo.senderName || otherUserName || "User"}
              </p>
              <p
                className={`text-xs line-clamp-2 [overflow-wrap:anywhere] ${
                  isOwner ? "text-blue-100/85" : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {message.replyTo.text}
              </p>
            </button>
          )}

          {isEditing ? (
            <div className="flex flex-col gap-2 min-w-0" onClick={(e) => e.stopPropagation()}>
              <textarea
                rows={Math.min(5, Math.max(2, editText.split("\n").length))}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={handleEditKeyDown}
                autoFocus
                disabled={savingEdit}
                className="w-full min-w-0 bg-white/15 dark:bg-black/25 text-white placeholder-blue-200 text-[16px] md:text-[14.2px] leading-snug px-2.5 py-1.5 rounded-lg outline-none border border-white/25 focus:border-white/60 resize-none max-h-[140px] overflow-y-auto [overflow-wrap:anywhere]"
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
            <div className="flex flex-wrap items-end justify-between gap-x-2.5 gap-y-1 min-w-0 max-w-full">
              <div className="min-w-0 max-w-full flex-1">
                <p
                  className={`${
                    isJumboEmoji
                      ? "text-[34px] leading-tight tracking-wide animate-emoji-pop"
                      : "text-[14.5px] leading-snug"
                  } min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${
                    isOwner ? "text-white" : "text-gray-900 dark:text-gray-100"
                  }`}
                >
                  {displayedText}
                </p>
                {isLongMessage && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsExpanded((prev) => !prev);
                    }}
                    className={`mt-1 text-xs font-semibold hover:underline ${
                      isOwner
                        ? "text-sky-100"
                        : "text-blue-600 dark:text-sky-400"
                    }`}
                  >
                    {isExpanded ? "Show less" : "Read more"}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 ml-auto shrink-0">
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
                  className={`text-[11px] whitespace-nowrap tabular-nums ${
                    isOwner ? "text-blue-100/90" : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {formatTime(message.timestamp) || "Sending"}
                </span>
                {hasDisappearTimer && (
                  <span
                    title={
                      isAfterSeen
                        ? isSeen
                          ? `Disappears in ${remainingSec}s`
                          : "Disappears after seen"
                        : `Disappears after ${effectiveTimerMode}`
                    }
                    className={`inline-flex items-center gap-0.5 text-[10px] font-medium whitespace-nowrap tabular-nums ${
                      isOwner
                        ? "text-sky-100/95"
                        : "text-blue-600/85 dark:text-sky-400/90"
                    }`}
                  >
                    <Clock className="w-3 h-3 shrink-0" />
                    {isAfterSeen && isSeen && remainingSec !== null && (
                      <span>{remainingSec}s</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {!isOwner && quickActionBar}
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

      {/* Interactive Detailed Receipt & Quick Actions (both own and received messages) */}
      {showDetails && !isEditing && !confirmDelete && (
        <div className="mt-1 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800/90 border border-gray-200 dark:border-gray-700 text-[11px] text-gray-600 dark:text-gray-300 flex flex-wrap items-center gap-3 shadow-xs">
          <span className="tabular-nums">
            {isOwner ? "Sent" : "Received"}: {formatTime(message.timestamp) || "Pending"}
          </span>
          {isOwner && message.deliveredAt && (
            <span className="tabular-nums">Delivered: {formatTime(message.deliveredAt)}</span>
          )}
          {message.readAt && (
            <span className="text-blue-600 dark:text-blue-400 font-medium tabular-nums">
              Seen: {formatTime(message.readAt)}
            </span>
          )}
          {!isPending && (
            <>
              <button
                type="button"
                onClick={handleReply}
                className="inline-flex items-center gap-1 text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-sky-400 font-medium"
              >
                <Reply className="w-3 h-3" />
                Reply
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-sky-400 font-medium"
              >
                <Copy className="w-3 h-3" />
                Copy
              </button>
              {isOwner ? (
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
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteForMe?.(message);
                  }}
                  className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 hover:underline font-medium"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete for me
                </button>
              )}
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
            <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium tabular-nums">
              <Eye className="w-3 h-3" />
              Seen{message.readAt ? ` • ${formatTime(message.readAt)}` : ""}
            </span>
          ) : isDelivered ? (
            <span className="inline-flex items-center gap-1 tabular-nums">
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
