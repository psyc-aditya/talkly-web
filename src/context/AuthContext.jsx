import { createContext, useContext, useEffect, useState } from "react";
import { auth, db, rtdb } from "../firebase";
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  updateProfile
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp, collection, query, where, getDocs } from "firebase/firestore";
import { ref, onValue, onDisconnect, set } from "firebase/database";
import { handleFirestoreError, OperationType } from "../utils/errorHandler";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const generateTalklyId = async (baseId = "") => {
    let isUnique = false;
    let newId = baseId;
    
    if (newId) {
      // Check if provided ID is unique
      const q = query(collection(db, "users"), where("talklyId", "==", newId));
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) return newId;
    }

    // Generate random if not provided or not unique
    while (!isUnique) {
      newId = "@" + Math.random().toString(36).substr(2, 8);
      const q = query(collection(db, "users"), where("talklyId", "==", newId));
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) {
        isUnique = true;
      }
    }
    return newId;
  };

  useEffect(() => {
    // Check for magic link sign-in
    if (isSignInWithEmailLink(auth, window.location.href)) {
      let email = window.localStorage.getItem('emailForSignIn');
      if (!email) {
        email = window.prompt('Please provide your email for confirmation');
      }
      if (email) {
        signInWithEmailLink(auth, email, window.location.href)
          .then((result) => {
            window.localStorage.removeItem('emailForSignIn');
            window.history.replaceState(null, '', window.location.pathname);
          })
          .catch((error) => console.error("Error signing in with email link", error));
      }
    }

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Save user to Firestore
        const userRef = doc(db, "users", user.uid);
        try {
          const userSnap = await getDoc(userRef);
          
          if (!userSnap.exists()) {
            const talklyId = await generateTalklyId();
            await setDoc(userRef, {
              uid: user.uid,
              displayName: user.displayName || user.email.split('@')[0],
              email: user.email,
              photoURL: user.photoURL || "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png",
              about: "Hey there! I am using Talkly.",
              talklyId: talklyId,
              blockedUsers: []
            });
          } else {
            // Ensure existing users have a talklyId and blockedUsers array
            const data = userSnap.data();
            let updates = {};
            if (!data.talklyId) {
              updates.talklyId = await generateTalklyId();
            }
            if (!data.blockedUsers) {
              updates.blockedUsers = [];
            }
            if (Object.keys(updates).length > 0) {
              await setDoc(userRef, updates, { merge: true });
            }
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
        }
        
        setCurrentUser(user);

        // RTDB Presence
        const userStatusDatabaseRef = ref(rtdb, '/status/' + user.uid);
        const isOfflineForDatabase = {
            state: 'offline',
            last_changed: serverTimestamp(),
        };
        const isOnlineForDatabase = {
            state: 'online',
            last_changed: serverTimestamp(),
        };

        const connectedRef = ref(rtdb, '.info/connected');
        onValue(connectedRef, (snap) => {
            if (snap.val() === false) {
                return;
            }
            onDisconnect(userStatusDatabaseRef).set(isOfflineForDatabase).then(() => {
                set(userStatusDatabaseRef, isOnlineForDatabase);
            });
        });

      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const signupWithEmail = async (email, password, name, username) => {
    // Check username uniqueness first
    if (username) {
      const formattedUsername = username.startsWith('@') ? username : '@' + username;
      const q = query(collection(db, "users"), where("talklyId", "==", formattedUsername));
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        throw new Error("Username is already taken.");
      }
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(userCredential.user, { displayName: name });
    
    // Update the document directly to ensure the name is correct
    const userRef = doc(db, "users", userCredential.user.uid);
    try {
      const talklyId = username ? (username.startsWith('@') ? username : '@' + username) : await generateTalklyId();
      await setDoc(userRef, { 
        displayName: name,
        talklyId: talklyId
      }, { merge: true });
    } catch (error) {
      console.error("Error updating display name in Firestore", error);
    }
    
    await sendEmailVerification(userCredential.user);
    return userCredential;
  };

  const loginWithEmail = (email, password) => {
    return signInWithEmailAndPassword(auth, email, password);
  };

  const resetPassword = (email) => {
    return sendPasswordResetEmail(auth, email);
  };

  const sendMagicLink = (email) => {
    const actionCodeSettings = {
      url: window.location.origin,
      handleCodeInApp: true,
    };
    window.localStorage.setItem('emailForSignIn', email);
    return sendSignInLinkToEmail(auth, email, actionCodeSettings);
  };

  const logout = async () => {
    if (currentUser) {
      const userStatusDatabaseRef = ref(rtdb, '/status/' + currentUser.uid);
      await set(userStatusDatabaseRef, {
          state: 'offline',
          last_changed: serverTimestamp(),
      });
    }
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ 
      currentUser, 
      loginWithGoogle, 
      signupWithEmail,
      loginWithEmail,
      resetPassword,
      sendMagicLink,
      logout 
    }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
