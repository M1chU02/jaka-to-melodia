import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyClI6aEtmv5ou1vkMyE2dAABJKAKWhLMIY",
  authDomain: "jakatomelodia-fa8e1.firebaseapp.com",
  projectId: "jakatomelodia-fa8e1",
  storageBucket: "jakatomelodia-fa8e1.firebasestorage.app",
  messagingSenderId: "792795168809",
  appId: "1:792795168809:web:f125f9d5e10b3b28a2dc38",
  measurementId: "G-BSJ9P83PF6",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
