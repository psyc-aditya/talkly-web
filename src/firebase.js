import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database"; 

const firebaseConfig = {
  apiKey: "AIzaSyDjsf_tEY-WQHkVN57SfylkBTXW8ndJw6E",
  authDomain: "auth-talkly.firebaseapp.com",
  databaseURL: "https://auth-talkly-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "auth-talkly",
  storageBucket: "auth-talkly.firebasestorage.app",
  messagingSenderId: "233117498125",
  appId: "1:233117498125:web:9b232f39d6851814be8e44",
  measurementId: "G-JXTWWVE5WL"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});
export const rtdb = getDatabase(app); 
