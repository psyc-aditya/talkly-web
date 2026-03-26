import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useTheme } from "../context/ThemeContext";
import { db, auth } from "../firebase";
import { collection, query, where, getDocs, onSnapshot, doc, setDoc, serverTimestamp, getDoc, updateDoc, limit } from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import { Share2, Settings, ArrowLeft, Sun, Moon, X, MessageSquarePlus, MoreVertical, LogOut, Search } from "lucide-react";
import { handleFirestoreError, OperationType } from "../utils/errorHandler";

export default function Sidebar() {
  const { currentUser, logout } = useAuth();
  const { dispatch } = useChat();
  const { darkMode, toggleTheme } = useTheme();
  const [chats, setChats] = useState([]);
  const [searchUsername, setSearchUsername] = useState("");
  const [allUsers, setAllUsers] = useState([]);
  const [showContacts, setShowContacts] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [newName, setNewName] = useState(currentUser.displayName || "");
  const [newAbout, setNewAbout] = useState("");
  const [myProfile, setMyProfile] = useState(null);
  const [blockedUsersList, setBlockedUsersList] = useState([]);

  const [newTalklyId, setNewTalklyId] = useState("");
  const [showMainMenu, setShowMainMenu] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const fetchMe = async () => {
      try {
        const d = await getDoc(doc(db, "users", currentUser.uid));
        if(d.exists()) {
          const data = d.data();
          setMyProfile(data);
          setNewAbout(data.about || "Hey there! I am using Talkly.");
          setNewName(data.displayName || currentUser.displayName);
          setNewTalklyId(data.talklyId?.replace('@', '') || "");
        }
      } catch(e) {
        console.error(e);
      }
    }
    if (currentUser?.uid) fetchMe();
  }, [currentUser]);

  useEffect(() => {
    const fetchBlockedUsers = async () => {
      if (showProfile && myProfile?.blockedUsers?.length > 0) {
        try {
          const q = query(collection(db, "users"), where("uid", "in", myProfile.blockedUsers));
          const querySnapshot = await getDocs(q);
          const users = [];
          querySnapshot.forEach((doc) => {
            users.push(doc.data());
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
      const updatedBlockedUsers = myProfile.blockedUsers.filter(id => id !== userIdToUnblock);
      await updateDoc(doc(db, "users", currentUser.uid), {
        blockedUsers: updatedBlockedUsers
      });
      setMyProfile(prev => ({ ...prev, blockedUsers: updatedBlockedUsers }));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  const handleSaveProfile = async () => {
    try {
      const formattedId = newTalklyId ? (newTalklyId.startsWith('@') ? newTalklyId : '@' + newTalklyId) : myProfile.talklyId;
      
      // Check if new talklyId is unique
      if (formattedId !== myProfile.talklyId) {
        const q = query(collection(db, "users"), where("talklyId", "==", formattedId));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          alert("Username is already taken.");
          return;
        }
      }

      await updateProfile(auth.currentUser, { displayName: newName });
      await updateDoc(doc(db, "users", currentUser.uid), {
        displayName: newName,
        about: newAbout,
        talklyId: formattedId
      });
      setMyProfile(prev => ({ ...prev, displayName: newName, about: newAbout, talklyId: formattedId }));
      setShowProfile(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  const handleShareProfile = () => {
    const profileUrl = `${window.location.origin}/u/${myProfile?.talklyId?.replace('@', '')}`;
    if (navigator.share) {
      navigator.share({
        title: 'My Talkly Profile',
        text: `Chat with me on Talkly! My ID is ${myProfile?.talklyId}`,
        url: profileUrl,
      }).catch(console.error);
    } else {
      navigator.clipboard.writeText(profileUrl);
      alert("Profile link copied to clipboard!");
    }
    setShowMainMenu(false);
  };

  // Fetch users only when searching
  useEffect(() => {
    const fetchUsers = async () => {
      if (!searchUsername.trim()) {
        setAllUsers([]);
        setIsSearching(false);
        return;
      }
      setIsSearching(true);
      try {
        const searchLower = searchUsername.toLowerCase();
        // Optimize: Fetch only a limited number of users to reduce reads
        // Since Firestore doesn't support full-text search natively, we'll fetch a limited batch
        // and filter client-side, or use prefix matching if possible.
        const q = query(collection(db, "users"), limit(50));
        const querySnapshot = await getDocs(q);
        const users = [];
        const blocked = myProfile?.blockedUsers || [];
        querySnapshot.forEach((doc) => {
          const userData = doc.data();
          const hasBlockedMe = userData.blockedUsers?.includes(currentUser.uid);
          if (userData.uid !== currentUser.uid && !blocked.includes(userData.uid) && !hasBlockedMe) {
            if (userData.displayName?.toLowerCase().includes(searchLower) || 
                userData.talklyId?.toLowerCase().includes(searchLower)) {
              users.push(userData);
            }
          }
        });
        setAllUsers(users);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, "users");
      } finally {
        setIsSearching(false);
      }
    };
    
    const timeoutId = setTimeout(() => {
      if (currentUser?.uid && myProfile) {
        fetchUsers();
      }
    }, 500); // debounce search
    
    return () => clearTimeout(timeoutId);
  }, [searchUsername, currentUser?.uid, myProfile]);

  useEffect(() => {
    if (!currentUser?.uid || !myProfile) return;
    const q = query(
      collection(db, "chats"),
      where("members", "array-contains", currentUser.uid)
    );

    const unsub = onSnapshot(q, async (querySnapshot) => {
      const chatsData = [];
      const blocked = myProfile?.blockedUsers || [];
      for (const d of querySnapshot.docs) {
        const data = d.data();
        const otherUserId = data.members.find((id) => id !== currentUser.uid);
        if (otherUserId && !blocked.includes(otherUserId)) {
          // Fetch other user info
          const userDoc = await getDocs(query(collection(db, "users"), where("uid", "==", otherUserId)));
          if (!userDoc.empty) {
            const userInfo = userDoc.docs[0].data();
            const hasBlockedMe = userInfo.blockedUsers?.includes(currentUser.uid);
            if (!hasBlockedMe) {
              chatsData.push({
                id: d.id,
                ...data,
                userInfo,
              });
            }
          }
        }
      }
      // Sort client-side to avoid needing a composite index in Firestore
      chatsData.sort((a, b) => (b.updatedAt?.toMillis() || 0) - (a.updatedAt?.toMillis() || 0));
      setChats(chatsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "chats");
    });

    return () => unsub();
  }, [currentUser.uid, myProfile]);

  const handleSelect = async (u) => {
    // Check if chat exists
    const combinedId = [currentUser.uid, u.uid].sort().join("_");
    try {
      const q = query(collection(db, "chats"), where("members", "==", [currentUser.uid, u.uid].sort()));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        // Create new chat
        await setDoc(doc(db, "chats", combinedId), {
          members: [currentUser.uid, u.uid].sort(),
          updatedAt: serverTimestamp(),
          lastMessage: null,
          status: 'pending',
          senderId: currentUser.uid
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `chats/${combinedId}`);
    }
    setSearchUsername("");
    setShowContacts(false);
    dispatch({ type: "CHANGE_USER", payload: u });
  };

  const filteredUsers = allUsers;

  const pendingRequests = chats.filter(c => c.status === 'pending' && c.senderId !== currentUser.uid);
  const activeChats = chats.filter(c => c.status === 'accepted' || !c.status || (c.status === 'pending' && c.senderId === currentUser.uid));

  if (showProfile) {
    return (
      <div className="flex flex-col w-full h-full bg-white dark:bg-gray-900 transition-colors duration-200">
        {/* Profile Header */}
        <div className="h-[65px] bg-blue-600 dark:bg-blue-800 flex items-center px-4 py-2 text-white">
          <ArrowLeft className="w-6 h-6 cursor-pointer mr-4" onClick={() => setShowProfile(false)} />
          <h1 className="text-xl font-medium">Profile</h1>
        </div>
        
        {/* Profile Content */}
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950 flex flex-col items-center py-8 px-4 transition-colors duration-200">
          <img 
            src={currentUser.photoURL || "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"} 
            alt="Profile" 
            className="w-40 h-40 rounded-full object-cover mb-4 shadow-md" 
          />
          {myProfile?.talklyId && (
            <p className="text-blue-600 dark:text-blue-400 font-medium mb-8 bg-blue-50 dark:bg-blue-900/30 px-4 py-1 rounded-full">{myProfile.talklyId}</p>
          )}
          
          <div className="w-full max-w-md bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 mb-6 transition-colors duration-200">
            <label className="block text-sm font-medium text-blue-600 dark:text-blue-400 mb-2">Your Name</label>
            <input 
              type="text" 
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full border-b-2 border-gray-200 dark:border-gray-700 focus:border-blue-600 dark:focus:border-blue-400 bg-transparent outline-none py-2 text-lg text-gray-800 dark:text-gray-100 transition-colors"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">This is not your username or pin. This name will be visible to your Talkly contacts.</p>
          </div>

          <div className="w-full max-w-md bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 mb-6 transition-colors duration-200">
            <label className="block text-sm font-medium text-blue-600 dark:text-blue-400 mb-2">Username (Talkly ID)</label>
            <div className="flex items-center border-b-2 border-gray-200 dark:border-gray-700 focus-within:border-blue-600 dark:focus-within:border-blue-400 transition-colors">
              <span className="text-gray-500 dark:text-gray-400 text-lg mr-1">@</span>
              <input 
                type="text" 
                value={newTalklyId}
                onChange={(e) => setNewTalklyId(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                className="w-full bg-transparent outline-none py-2 text-lg text-gray-800 dark:text-gray-100"
              />
            </div>
          </div>

          <div className="w-full max-w-md bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 mb-8 transition-colors duration-200">
            <label className="block text-sm font-medium text-blue-600 dark:text-blue-400 mb-2">About</label>
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

          {/* Blocked Users Section */}
          <div className="w-full max-w-md bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 mb-8 transition-colors duration-200">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Blocked Users</h3>
            {blockedUsersList.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No blocked users.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {blockedUsersList.map(user => (
                  <div key={user.uid} className="flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors">
                    <div className="flex items-center gap-3">
                      <img src={user.photoURL || "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"} alt="" className="w-10 h-10 rounded-full object-cover" />
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{user.displayName}</span>
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
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-white dark:bg-gray-900 transition-colors duration-200">
      {/* Header */}
      <div className="h-[65px] bg-white dark:bg-gray-900 flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800 transition-colors duration-200">
        <img 
          src={currentUser.photoURL || "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"} 
          alt="" 
          className="w-10 h-10 rounded-full object-cover cursor-pointer hover:opacity-80 transition" 
          onClick={() => setShowProfile(true)}
          title="Edit Profile"
        />
        <div className="flex gap-4 text-gray-500 dark:text-gray-400 relative">
          <button onClick={toggleTheme} className="hover:text-blue-600 dark:hover:text-blue-400 transition" title="Toggle Theme">
            {darkMode ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
          </button>
          {showContacts ? (
            <X className="w-6 h-6 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition" onClick={() => setShowContacts(false)} title="Close Contacts" />
          ) : (
            <MessageSquarePlus className="w-6 h-6 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition" onClick={() => setShowContacts(true)} title="New Chat" />
          )}
          <MoreVertical 
            className="w-6 h-6 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition" 
            onClick={() => setShowMainMenu(!showMainMenu)}
          />
          {showMainMenu && (
            <div className="absolute right-8 top-8 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-lg rounded-lg py-2 w-48 z-50">
              <button 
                onClick={() => { setShowProfile(true); setShowMainMenu(false); }}
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
                onClick={() => { setShowMainMenu(false); alert("Settings coming soon!"); }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Settings
              </button>
            </div>
          )}
          <LogOut className="w-6 h-6 cursor-pointer text-red-500 hover:text-red-600 dark:hover:text-red-400 transition" onClick={logout} title="Logout" />
        </div>
      </div>

      {/* Search */}
      <div className="bg-white dark:bg-gray-900 p-3 border-b border-gray-200 dark:border-gray-800 transition-colors duration-200">
        <div className="bg-gray-100 dark:bg-gray-800 flex items-center rounded-full px-4 py-2 transition-colors duration-200">
          <Search className="w-5 h-5 text-gray-500 dark:text-gray-400 mr-3" />
          <input 
            type="text" 
            placeholder="Search or start new chat" 
            className="bg-transparent outline-none w-full text-sm placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-gray-100"
            value={searchUsername}
            onChange={(e) => setSearchUsername(e.target.value)}
          />
        </div>
      </div>

      {/* Chat List / Search Results */}
      <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-900 transition-colors duration-200">
        {(searchUsername || showContacts) ? (
          // Show search results
          <>
            <div className="px-4 py-2 text-sm text-blue-600 dark:text-blue-400 font-medium">Contacts</div>
            {isSearching ? (
              <span className="p-4 text-sm text-gray-500 dark:text-gray-400">Searching...</span>
            ) : filteredUsers.length === 0 ? (
              <span className="p-4 text-sm text-gray-500 dark:text-gray-400">No users found</span>
            ) : (
              filteredUsers.map((user) => (
                <div 
                  key={user.uid}
                  className="flex items-center p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors" 
                  onClick={() => handleSelect(user)}
                >
                  <img src={user.photoURL || "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"} alt="" className="w-12 h-12 rounded-full object-cover mr-4" />
                  <div className="flex-1 border-b border-gray-100 dark:border-gray-800 pb-2">
                    <span className="text-lg text-gray-900 dark:text-gray-100">{user.displayName}</span>
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{user.about || "Hey there! I am using Talkly."}</p>
                  </div>
                </div>
              ))
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
                <img src={chat.userInfo?.photoURL || "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"} alt="" className="w-12 h-12 rounded-full object-cover mr-4" />
                <div className="flex-1 border-b border-gray-100 dark:border-gray-800 pb-3 pt-1 flex flex-col justify-center">
                  <div className="flex justify-between items-center">
                    <span className="text-[17px] text-gray-900 dark:text-gray-100 font-medium">{chat.userInfo?.displayName}</span>
                    {chat.updatedAt && (
                      <span className="text-xs text-blue-600 dark:text-blue-400">
                        {new Date(chat.updatedAt.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-blue-600 dark:text-blue-400 truncate mt-0.5">Wants to connect with you</p>
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
              <div 
                className="flex items-center p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors" 
                key={chat.id} 
                onClick={() => dispatch({ type: "CHANGE_USER", payload: chat.userInfo })}
              >
                <img src={chat.userInfo?.photoURL || "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"} alt="" className="w-12 h-12 rounded-full object-cover mr-4" />
                <div className="flex-1 border-b border-gray-100 dark:border-gray-800 pb-3 pt-1 flex flex-col justify-center">
                  <div className="flex justify-between items-center">
                    <span className="text-[17px] text-gray-900 dark:text-gray-100">{chat.userInfo?.displayName}</span>
                    {chat.updatedAt && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(chat.updatedAt.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    {chat.status === 'pending' ? "Waiting for response..." : (chat.lastMessage?.text || "Started a chat")}
                  </p>
                </div>
              </div>
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
