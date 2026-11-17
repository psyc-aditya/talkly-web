import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { MessageSquare, Mail, Lock, User, ArrowLeft, Search } from "lucide-react";

export default function Login() {
  const { loginWithGoogle, signupWithEmail, loginWithEmail, resetPassword, sendMagicLink } = useAuth();
  const { data } = useChat();
  const [view, setView] = useState("login"); // login, signup, forgot, magic
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  let pendingSearch = data?.pendingSearch || "";
  if (!pendingSearch) {
    try {
      pendingSearch = localStorage.getItem("talkly_pending_search") || "";
    } catch {
      pendingSearch = "";
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      if (view === "signup") {
        await signupWithEmail(email, password, name, username);
        setMessage("Account created! Please check your email for verification.");
      } else if (view === "login") {
        await loginWithEmail(email, password);
      } else if (view === "forgot") {
        await resetPassword(email);
        setMessage("Password reset email sent!");
      } else if (view === "magic") {
        await sendMagicLink(email);
        setMessage("Magic link sent! Check your email.");
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen w-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center p-4 transition-colors duration-200">
      <div className="bg-white dark:bg-gray-900 p-8 rounded-2xl shadow-lg flex flex-col items-center max-w-md w-full text-center border border-gray-100 dark:border-gray-800 relative transition-colors duration-200">
        {view !== "login" && (
          <button 
            onClick={() => { setView("login"); setError(""); setMessage(""); }}
            className="absolute top-6 left-6 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        
        <div className="bg-blue-600 dark:bg-blue-700 p-4 rounded-2xl mb-4 shadow-sm transition-colors">
          <MessageSquare className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Talkly</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm">Connect and chat with anyone, anywhere.</p>

        {pendingSearch && (
          <div className="w-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 p-3 rounded-xl text-sm mb-4 border border-blue-100 dark:border-blue-800/40 flex items-center justify-center gap-2">
            <Search className="w-4 h-4 shrink-0" />
            <span>Sign in to find <strong className="font-semibold">{pendingSearch}</strong></span>
          </div>
        )}
        
        {error && <div className="w-full bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm mb-4 border border-red-100 dark:border-red-800/30">{error}</div>}
        {message && <div className="w-full bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 p-3 rounded-lg text-sm mb-4 border border-green-100 dark:border-green-800/30">{message}</div>}

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
          {view === "signup" && (
            <>
              <div className="relative">
                <User className="w-5 h-5 absolute left-3 top-3 text-gray-400 dark:text-gray-500" />
                <input 
                  type="text" 
                  placeholder="Full Name" 
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400 transition-colors placeholder-gray-400 dark:placeholder-gray-500"
                />
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-gray-400 dark:text-gray-500 font-medium">@</span>
                <input 
                  type="text" 
                  placeholder="Username" 
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                  className="w-full pl-8 pr-4 py-2.5 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400 transition-colors placeholder-gray-400 dark:placeholder-gray-500"
                />
              </div>
            </>
          )}

          <div className="relative">
            <Mail className="w-5 h-5 absolute left-3 top-3 text-gray-400 dark:text-gray-500" />
            <input 
              type="email" 
              placeholder="Email Address" 
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400 transition-colors placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>

          {(view === "login" || view === "signup") && (
            <div className="relative">
              <Lock className="w-5 h-5 absolute left-3 top-3 text-gray-400 dark:text-gray-500" />
              <input 
                type="password" 
                placeholder="Password" 
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400 transition-colors placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>
          )}

          {view === "login" && (
            <div className="flex justify-end">
              <button type="button" onClick={() => setView("forgot")} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                Forgot password?
              </button>
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 dark:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-xl hover:bg-blue-700 dark:hover:bg-blue-600 transition shadow-sm mt-2 disabled:opacity-70"
          >
            {loading ? "Please wait..." : 
              view === "login" ? "Sign In" : 
              view === "signup" ? "Create Account" : 
              view === "forgot" ? "Reset Password" : "Send Magic Link"}
          </button>
        </form>

        {view === "login" && (
          <>
            <div className="w-full flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800"></div>
              <span className="text-sm text-gray-400 dark:text-gray-500">OR</span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800"></div>
            </div>

            <button 
              onClick={loginWithGoogle}
              className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium py-2.5 px-4 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition flex items-center justify-center gap-3 shadow-sm mb-3"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
              Sign in with Google
            </button>

            <button 
              onClick={() => setView("magic")}
              className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium py-2.5 px-4 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition flex items-center justify-center gap-3 shadow-sm"
            >
              <Mail className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              Sign in with Magic Link
            </button>

            <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
              Don't have an account? <button onClick={() => setView("signup")} className="text-blue-600 dark:text-blue-400 font-medium hover:underline">Sign up</button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
