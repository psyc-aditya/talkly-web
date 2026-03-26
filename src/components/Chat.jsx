import { useState, useEffect, useRef } from "react";
import { useChat } from "../context/ChatContext";
import { useAuth } from "../context/AuthContext";
import { db, rtdb } from "../firebase";
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, orderBy, doc, updateDoc, writeBatch, deleteDoc, getDoc } from "firebase/firestore";
import { ref as rtdbRef, onValue, set } from "firebase/database";
import { Search, MoreVertical, Smile, Mic, Send, ArrowLeft, Check, X } from "lucide-react";
import Message from "./Message";
import EmojiPicker from 'emoji-picker-react';
import { handleFirestoreError, OperationType } from "../utils/errorHandler";

export default function Chat() {
  const { data, dispatch } = useChat();
  const { currentUser } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [userStatus, setUserStatus] = useState("offline");
  const [chatMeta, setChatMeta] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const endRef = useRef(null);
  const typingTimeout = useRef(null);

  const [showMenu, setShowMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const handleDeleteChat = async () => {
    if (!window.confirm("Are you sure you want to delete this chat? This action cannot be undone.")) return;
    try {
      // Delete messages
      const batch = writeBatch(db);
      messages.forEach(m => {
        batch.delete(doc(db, "messages", m.id));
      });
      await batch.commit();
      
      // Delete chat document
      await deleteDoc(doc(db, "chats", data.chatId));
      
      setShowMenu(false);
      dispatch({ type: "CHANGE_USER", payload: null });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `chats/${data.chatId}`);
    }
  };

  const handleToggleDisappearing = async () => {
    try {
      const newStatus = !chatMeta?.disappearing;
      await updateDoc(doc(db, "chats", data.chatId), {
        disappearing: newStatus
      });
      setShowMenu(false);
      alert(newStatus ? "Disappearing messages enabled." : "Disappearing messages disabled.");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `chats/${data.chatId}`);
    }
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleBlockUser = async () => {
    try {
      const userRef = doc(db, "users", currentUser.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const blockedUsers = userSnap.data().blockedUsers || [];
        if (!blockedUsers.includes(data.user.uid)) {
          await updateDoc(userRef, {
            blockedUsers: [...blockedUsers, data.user.uid]
          });
        }
      }
      setShowMenu(false);
      dispatch({ type: "CHANGE_USER", payload: null });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  useEffect(() => {
    if (data.chatId === "null") return;

    const unsubMeta = onSnapshot(doc(db, "chats", data.chatId), (docSnap) => {
      if (docSnap.exists()) {
        setChatMeta(docSnap.data());
      } else {
        setChatMeta(null);
      }
    });

    const q = query(
      collection(db, "messages"),
      where("chatId", "==", data.chatId)
    );

    const unsubMsgs = onSnapshot(q, (snapshot) => {
      const msgs = [];
      snapshot.forEach((doc) => {
        msgs.push({ id: doc.id, ...doc.data() });
      });
      
      // Sort client-side to avoid needing a composite index in Firestore
      msgs.sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
      
      setMessages(msgs);
      
      // Mark as read
      const unreadMsgs = msgs.filter(m => m.senderId !== currentUser.uid && m.status !== 'read');
      if (unreadMsgs.length > 0) {
        const batch = writeBatch(db);
        unreadMsgs.forEach(m => {
          const msgRef = doc(db, "messages", m.id);
          batch.update(msgRef, { status: 'read' });
        });
        batch.commit().catch(err => handleFirestoreError(err, OperationType.UPDATE, "messages"));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "messages");
    });

    return () => {
      unsubMeta();
      unsubMsgs();
    };
  }, [data.chatId, currentUser.uid]);

  // Handle disappearing messages
  useEffect(() => {
    if (chatMeta?.disappearing && messages.length > 0) {
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;
      const toDelete = messages.filter(m => m.timestamp && (now - m.timestamp.toMillis() > oneDay));
      
      if (toDelete.length > 0) {
        const deleteBatch = writeBatch(db);
        toDelete.forEach(m => {
          deleteBatch.delete(doc(db, "messages", m.id));
        });
        deleteBatch.commit().catch(err => console.error("Error deleting disappearing messages:", err));
      }
    }
  }, [messages, chatMeta?.disappearing]);

  useEffect(() => {
    if (!data.user?.uid) return;
    const statusRef = rtdbRef(rtdb, `/status/${data.user.uid}`);
    const unsubStatus = onValue(statusRef, (snapshot) => {
      const statusData = snapshot.val();
      if (statusData) {
        if (statusData.state === 'online') {
          setUserStatus('Online');
        } else {
          const date = new Date(statusData.last_changed);
          setUserStatus(`Last seen ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`);
        }
      } else {
        setUserStatus('Offline');
      }
    });

    const typingRef = rtdbRef(rtdb, `typing/${data.chatId}/${data.user.uid}`);
    const unsubTyping = onValue(typingRef, (snapshot) => {
      setIsTyping(snapshot.val() || false);
    });

    return () => {
      unsubStatus();
      unsubTyping();
    };
  }, [data.chatId, data.user?.uid]);

  const handleAccept = async () => {
    try {
      await updateDoc(doc(db, "chats", data.chatId), {
        status: 'accepted',
        updatedAt: serverTimestamp()
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

  const isPending = chatMeta?.status === 'pending';
  const isReceiver = isPending && chatMeta?.senderId !== currentUser.uid;
  const isSender = isPending && chatMeta?.senderId === currentUser.uid;

  const handleSend = async () => {
    if (!text) return;
    
    const messageData = {
      chatId: data.chatId,
      senderId: currentUser.uid,
      text,
      timestamp: serverTimestamp(),
      status: 'sent'
    };

    try {
      await addDoc(collection(db, "messages"), messageData);
      await updateDoc(doc(db, "chats", data.chatId), {
        lastMessage: { text },
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "messages");
    }

    setText("");
    setShowEmoji(false);
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
    setText(prev => prev + emojiObject.emoji);
  };

  return (
    <div className="flex flex-col w-full h-full bg-white dark:bg-gray-900 relative transition-colors duration-200">
      {/* Header */}
      <div className="h-[65px] bg-white dark:bg-gray-900 flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800 z-10 transition-colors duration-200">
        {showSearch ? (
          <div className="flex items-center w-full gap-3 bg-gray-100 dark:bg-gray-800 rounded-full px-4 py-2 transition-colors duration-200">
            <ArrowLeft className="w-5 h-5 text-gray-500 dark:text-gray-400 cursor-pointer" onClick={() => { setShowSearch(false); setSearchQuery(""); }} />
            <input 
              type="text" 
              placeholder="Search messages..." 
              className="bg-transparent outline-none w-full text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && <X className="w-5 h-5 text-gray-500 dark:text-gray-400 cursor-pointer" onClick={() => setSearchQuery("")} />}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <ArrowLeft className="w-6 h-6 text-gray-500 dark:text-gray-400 md:hidden cursor-pointer" onClick={() => dispatch({type: "BACK_TO_SIDEBAR"})} />
              <img src={data.user?.photoURL} alt="" className="w-10 h-10 rounded-full object-cover" />
              <div className="flex flex-col">
                <span className="text-[16px] text-gray-900 dark:text-gray-100 font-medium">{data.user?.displayName}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {isTyping ? <span className="text-blue-600 dark:text-blue-400 font-medium">typing...</span> : userStatus}
                </span>
              </div>
            </div>
            <div className="flex gap-4 text-gray-500 dark:text-gray-400 relative items-center">
              <Search className="w-5 h-5 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition" onClick={() => setShowSearch(true)} />
              
              <div 
                className={`p-2 rounded-full cursor-pointer transition-colors ${showMenu ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                onClick={() => setShowMenu(!showMenu)}
              >
                {showMenu ? <X className="w-5 h-5" /> : <MoreVertical className="w-5 h-5" />}
              </div>

              {showMenu && (
                <div className="absolute right-0 top-12 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-xl rounded-xl py-2 w-56 z-50 overflow-hidden">
                  <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700 mb-1">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Chat Settings</p>
                  </div>
                  <button 
                    onClick={handleToggleDisappearing}
                    className="w-full text-left px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-between"
                  >
                    <span>Disappearing Messages</span>
                    {chatMeta?.disappearing && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                  </button>
                  <button 
                    onClick={handleDeleteChat}
                    className="w-full text-left px-4 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    Delete Chat
                  </button>
                  <button 
                    onClick={handleBlockUser}
                    className="w-full text-left px-4 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    Block User
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col gap-2 bg-gray-50 dark:bg-gray-950 transition-colors duration-200">
        <div className="z-10 flex flex-col gap-2">
          {messages
            .filter(m => !searchQuery || m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
            .map((m) => (
              <Message message={m} key={m.id} />
          ))}
          {searchQuery && messages.filter(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
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
          <img src={data.user?.photoURL} alt="" className="w-24 h-24 rounded-full object-cover mb-4 shadow-lg border-4 border-white dark:border-gray-800" />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">{data.user?.displayName}</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-8 max-w-sm">
            Wants to connect with you. Accepting this request will allow them to send you messages.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xs">
            <button onClick={handleAccept} className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 dark:bg-blue-700 text-white font-medium rounded-xl hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors shadow-sm">
              <Check className="w-5 h-5" /> Accept Request
            </button>
            <button onClick={handleReject} className="flex-1 flex items-center justify-center gap-2 px-6 py-3 text-red-600 dark:text-red-400 font-medium border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/20 rounded-xl hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">
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
          <button onClick={() => dispatch({type: "BACK_TO_SIDEBAR"})} className="mt-8 text-blue-600 dark:text-blue-400 font-medium hover:underline">
            Go Back
          </button>
        </div>
      ) : (
        <div className="min-h-[70px] bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex items-end px-4 py-3 gap-3 relative z-20 transition-colors duration-200">
          {showEmoji && (
            <div className="absolute bottom-[80px] left-4 z-50 shadow-xl rounded-lg">
              <EmojiPicker onEmojiClick={onEmojiClick} width={300} height={400} />
            </div>
          )}
          <div className="flex gap-4 text-gray-500 dark:text-gray-400 mb-2">
            <Smile className="w-6 h-6 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition" onClick={() => setShowEmoji(!showEmoji)} />
          </div>
          
          <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center px-4 py-2 transition-colors duration-200">
            <input 
              type="text" 
              placeholder="Type a message" 
              className="w-full bg-transparent outline-none text-[15px] text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
              value={text}
              onChange={handleTyping}
              onKeyDown={handleKey}
            />
          </div>
          
          <div className="mb-1 text-gray-500 dark:text-gray-400">
            {text ? (
              <Send className="w-6 h-6 cursor-pointer text-blue-600 dark:text-blue-400" onClick={handleSend} />
            ) : (
              <Mic className="w-6 h-6 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
