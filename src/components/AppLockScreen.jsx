import { useState } from "react";
import { Lock, Eye, EyeOff, LogOut, ShieldCheck, RotateCcw } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { getFrequencyLabel } from "../utils/appLock";

export default function AppLockScreen() {
  const { currentUser, appLockConfig, unlockApp, logout, requestResetAppLock } = useAuth();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) {
      setError("Please enter your opening password.");
      return;
    }
    setError("");
    setChecking(true);
    try {
      const ok = await unlockApp(password);
      if (!ok) {
        setError("Incorrect password. Please try again.");
      } else {
        setPassword("");
      }
    } catch {
      setError("Unable to verify password. Please try again.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4 transition-colors duration-200">
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl shadow-xl max-w-md w-full p-8 text-center">
        <div className="relative inline-flex items-center justify-center mb-4">
          <img
            src={
              currentUser?.photoURL ||
              "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
            }
            alt={currentUser?.displayName || "User"}
            className="w-20 h-20 rounded-full object-cover border-4 border-white dark:border-gray-800 shadow-md"
          />
          <span className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-blue-600 dark:bg-blue-700 text-white flex items-center justify-center border-2 border-white dark:border-gray-900 shadow-sm">
            <Lock className="w-4 h-4" />
          </span>
        </div>

        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Talkly is Locked
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {currentUser?.displayName || currentUser?.email}
        </p>

        <div className="inline-flex items-center gap-1.5 mt-3 mb-6 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>{getFrequencyLabel(appLockConfig?.frequency)}</span>
        </div>

        {error && (
          <div className="w-full mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Lock className="w-4 h-4 text-gray-400 dark:text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError("");
              }}
              placeholder="Enter opening password"
              autoFocus
              className="w-full pl-10 pr-11 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <button
            type="submit"
            disabled={checking}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-60 text-white font-semibold rounded-xl text-sm transition-colors shadow-sm"
          >
            {checking ? "Verifying..." : "Unlock Talkly"}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-gray-100 dark:border-gray-800 space-y-3">
          {!confirmReset ? (
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="text-blue-600 dark:text-blue-400 hover:underline font-medium inline-flex items-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Forgot password?
              </button>
              <button
                type="button"
                onClick={logout}
                className="text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 font-medium inline-flex items-center gap-1 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          ) : (
            <div className="bg-blue-50/80 dark:bg-slate-800/70 border border-blue-200/80 dark:border-slate-700 rounded-2xl p-4 text-left space-y-3">
              <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                To reset your opening password, sign out and log back in with your Talkly account. Your chats will remain safe.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={requestResetAppLock}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Sign Out &amp; Reset
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
