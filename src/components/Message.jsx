import { useAuth } from "../context/AuthContext";
import { Check, CheckCheck } from "lucide-react";

export default function Message({ message }) {
  const { currentUser } = useAuth();
  const isOwner = message.senderId === currentUser.uid;

  const formatTime = (timestamp) => {
    if (!timestamp) return "";
    const date = timestamp.toDate();
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={`flex ${isOwner ? "justify-end" : "justify-start"} mb-1`}>
      <div 
        className={`max-w-[85%] md:max-w-[65%] flex flex-col px-3 py-2 rounded-2xl shadow-sm relative transition-colors duration-200 ${
          isOwner ? "bg-blue-600 dark:bg-blue-700 text-white rounded-tr-sm" : "bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded-tl-sm"
        }`}
      >
        <div className="flex flex-wrap items-end gap-2">
          <p className={`text-[14.2px] leading-snug break-words flex-1 pr-2 ${isOwner ? "text-white" : "text-gray-900 dark:text-gray-100"}`}>
            {message.text}
          </p>
          <div className="flex items-center gap-1 ml-auto mt-1">
            <span className={`text-[11px] whitespace-nowrap ${isOwner ? "text-blue-200 dark:text-blue-300" : "text-gray-500 dark:text-gray-400"}`}>
              {formatTime(message.timestamp)}
            </span>
            {isOwner && (
              <span className="text-blue-200 dark:text-blue-300">
                {message.status === 'sent' && <Check className="w-3.5 h-3.5" />}
                {message.status === 'delivered' && <CheckCheck className="w-3.5 h-3.5" />}
                {message.status === 'read' && <CheckCheck className="w-3.5 h-3.5 text-white" />}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
