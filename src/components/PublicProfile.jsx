import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { collection, query, where, getDocs, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { MessageSquare, ArrowLeft } from "lucide-react";

export default function PublicProfile() {
  const { talklyId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { dispatch } = useChat();
  const [profileUser, setProfileUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const q = query(collection(db, "users"), where("talklyId", "==", talklyId));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          setProfileUser(querySnapshot.docs[0].data());
        } else {
          setError("User not found");
        }
      } catch (err) {
        setError("Error loading profile");
      }
      setLoading(false);
    };
    fetchUser();
  }, [talklyId]);

  const handleMessage = async () => {
    if (!currentUser) {
      // Redirect to login
      navigate("/");
      return;
    }

    if (currentUser.uid === profileUser.uid) {
      navigate("/");
      return;
    }

    try {
      // Check for blocks
      const myDoc = await getDocs(query(collection(db, "users"), where("uid", "==", currentUser.uid)));
      if (!myDoc.empty) {
        const myData = myDoc.docs[0].data();
        if (myData.blockedUsers?.includes(profileUser.uid) || profileUser.blockedUsers?.includes(currentUser.uid)) {
          setError("You cannot message this user.");
          return;
        }
      }

      // Check if chat exists or create one
      const combinedId = [currentUser.uid, profileUser.uid].sort().join("_");
      const q = query(collection(db, "chats"), where("members", "==", [currentUser.uid, profileUser.uid].sort()));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        await setDoc(doc(db, "chats", combinedId), {
          members: [currentUser.uid, profileUser.uid].sort(),
          updatedAt: serverTimestamp(),
          lastMessage: null,
          status: 'pending',
          senderId: currentUser.uid
        });
      }
      
      dispatch({ type: "CHANGE_USER", payload: profileUser });
      navigate("/");
    } catch (err) {
      console.error(err);
      setError("An error occurred. Please try again.");
    }
  };

  if (loading) {
    return <div className="h-screen w-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors duration-200">Loading...</div>;
  }

  if (error || !profileUser) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 transition-colors duration-200">
        <p className="text-xl text-gray-600 dark:text-gray-400 mb-4">{error || "User not found"}</p>
        <button onClick={() => navigate("/")} className="text-blue-600 dark:text-blue-400 hover:underline">Go to Home</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center p-4 transition-colors duration-200">
      <div className="bg-white dark:bg-gray-900 p-8 rounded-3xl shadow-lg flex flex-col items-center max-w-md w-full text-center border border-gray-100 dark:border-gray-800 relative transition-colors duration-200">
        <button 
          onClick={() => navigate("/")}
          className="absolute top-6 left-6 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>

        <img 
          src={profileUser.photoURL || "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"} 
          alt={profileUser.displayName} 
          className="w-32 h-32 rounded-full object-cover mb-4 shadow-md border-4 border-white dark:border-gray-800"
        />
        
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{profileUser.displayName}</h1>
        <p className="text-blue-600 dark:text-blue-400 font-medium mb-4">{profileUser.talklyId}</p>
        
        <div className="bg-gray-50 dark:bg-gray-950 w-full p-4 rounded-xl mb-8 transition-colors duration-200">
          <p className="text-gray-600 dark:text-gray-400 italic">"{profileUser.about || "Hey there! I am using Talkly."}"</p>
        </div>

        <button 
          onClick={handleMessage}
          className="w-full bg-blue-600 dark:bg-blue-700 text-white font-medium py-3 px-4 rounded-xl hover:bg-blue-700 dark:hover:bg-blue-600 transition flex items-center justify-center gap-2 shadow-sm"
        >
          <MessageSquare className="w-5 h-5" />
          {currentUser ? "Message" : "Login to Message"}
        </button>
      </div>
    </div>
  );
}
