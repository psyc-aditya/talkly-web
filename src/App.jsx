import { useState, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Sidebar from "./components/Sidebar";
import Chat from "./components/Chat";
import Login from "./components/Login";
import PublicProfile from "./components/PublicProfile";
import AppLockScreen from "./components/AppLockScreen";
import { useChat } from "./context/ChatContext";
import { MessageSquare, Mail } from "lucide-react";
import { sendEmailVerification } from "firebase/auth";
import { auth } from "./firebase";

function extractSearchQueryFromLocation(pathname, search) {
  const decodedPath = decodeURIComponent(pathname || "");
  if (decodedPath.startsWith("/search=")) {
    return decodedPath.slice("/search=".length).trim();
  }
  if (decodedPath.startsWith("/seach=")) {
    return decodedPath.slice("/seach=".length).trim();
  }
  if (decodedPath.startsWith("/search/")) {
    return decodedPath.slice("/search/".length).trim();
  }
  const params = new URLSearchParams(search || "");
  const q = params.get("search");
  return q ? q.trim() : "";
}

function SearchLinkCapture() {
  const location = useLocation();
  const { dispatch } = useChat();
  const extracted = extractSearchQueryFromLocation(location.pathname, location.search);

  useEffect(() => {
    if (!extracted) return;
    try {
      localStorage.setItem("talkly_pending_search", extracted);
    } catch {
      // ignore storage errors
    }
    dispatch({ type: "SET_PENDING_SEARCH", payload: extracted });
  }, [extracted, dispatch]);

  return <Navigate to="/" replace />;
}

function MainApp() {
  const { data, dispatch } = useChat();
  const { currentUser, logout, isAppLocked } = useAuth();
  const [verifyNotice, setVerifyNotice] = useState("");
  const location = useLocation();

  useEffect(() => {
    const q = extractSearchQueryFromLocation(location.pathname, location.search);
    if (q) {
      try {
        localStorage.setItem("talkly_pending_search", q);
      } catch {
        // ignore storage errors
      }
      dispatch({ type: "SET_PENDING_SEARCH", payload: q });
    }
  }, [location.pathname, location.search, dispatch]);

  if (currentUser && !currentUser.emailVerified) {
    return (
      <div className="h-screen w-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center p-4 transition-colors duration-200">
        <div className="bg-white dark:bg-gray-900 p-8 rounded-2xl shadow-lg flex flex-col items-center max-w-md w-full text-center border border-gray-100 dark:border-gray-800 transition-colors duration-200">
          <div className="bg-blue-100 dark:bg-blue-900/30 p-4 rounded-full mb-6">
            <Mail className="w-12 h-12 text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Verify your email</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Please verify your email address ({currentUser.email}) to start chatting. Check your inbox for the verification link.
          </p>
          {verifyNotice && (
            <p className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-4 py-2 rounded-xl mb-4 w-full">
              {verifyNotice}
            </p>
          )}
          <button 
            onClick={() => {
              sendEmailVerification(auth.currentUser)
                .then(() => setVerifyNotice("Verification email sent! Please check your inbox."))
                .catch(err => setVerifyNotice(err.message));
            }}
            className="w-full bg-blue-600 dark:bg-blue-700 text-white font-medium py-3 px-4 rounded-xl hover:bg-blue-700 dark:hover:bg-blue-600 transition shadow-sm mb-4"
          >
            Resend Verification Email
          </button>
          <button 
            onClick={logout}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 font-medium transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (isAppLocked) {
    return <AppLockScreen />;
  }

  return (
    <div className="h-screen w-screen bg-white dark:bg-gray-900 flex overflow-hidden transition-colors duration-200">
      {/* Sidebar - Hidden on mobile if a chat is selected */}
      <div className={`w-full md:w-[350px] lg:w-[400px] h-full flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 ${data.isMobileView ? 'hidden md:flex' : 'flex'}`}>
        <Sidebar />
      </div>

      {/* Chat Area - Hidden on mobile if no chat is selected */}
      <div className={`w-full md:flex-1 h-full bg-gray-50 dark:bg-gray-950 relative ${!data.isMobileView ? 'hidden md:flex' : 'flex'}`}>
        {data.chatId === "null" ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 transition-colors duration-200">
            <div className="bg-blue-100 dark:bg-blue-900/30 p-6 rounded-full mb-6">
              <MessageSquare className="w-16 h-16 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-3xl font-semibold text-gray-800 dark:text-gray-100 mb-3">Welcome to Talkly</h1>
            <p className="text-gray-500 dark:text-gray-400 text-base max-w-md text-center px-4">
              Select a contact from the sidebar to start chatting, or search for new people to connect with.
            </p>
          </div>
        ) : (
          <Chat />
        )}
      </div>
    </div>
  );
}

function App() {
  const { currentUser } = useAuth();
  const location = useLocation();
  const hasSearchRoute = Boolean(extractSearchQueryFromLocation(location.pathname, location.search));

  if (hasSearchRoute && location.pathname !== "/") {
    return <SearchLinkCapture />;
  }

  return (
    <Routes>
      <Route path="/u/:talklyId" element={<PublicProfile />} />
      <Route 
        path="/" 
        element={currentUser ? <MainApp /> : <Login />} 
      />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default App;
