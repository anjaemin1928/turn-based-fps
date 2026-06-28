import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCNWzmDDT0cjIN3kUkUTWhD9EDU1ISK-Kc",
  authDomain: "battle-6fae4.firebaseapp.com",
  databaseURL: "https://battle-6fae4-default-rtdb.firebaseio.com",
  projectId: "battle-6fae4",
  storageBucket: "battle-6fae4.firebasestorage.app",
  messagingSenderId: "326771712375",
  appId: "1:326771712375:web:8df641d52329a05fc10172",
  measurementId: "G-96TJRYFNLN"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore Database
export const db = getFirestore(app);

// Initialize Authentication
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
