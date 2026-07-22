"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const missingEnvVars = [
  typeof process.env.NEXT_PUBLIC_FIREBASE_API_KEY === "string"
    ? null
    : "NEXT_PUBLIC_FIREBASE_API_KEY",
  typeof process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN === "string"
    ? null
    : "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  typeof process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "string"
    ? null
    : "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  typeof process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET === "string"
    ? null
    : "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  typeof process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID === "string"
    ? null
    : "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  typeof process.env.NEXT_PUBLIC_FIREBASE_APP_ID === "string"
    ? null
    : "NEXT_PUBLIC_FIREBASE_APP_ID",
].filter(Boolean);

if (missingEnvVars.length) {
  throw new Error(`Missing Firebase client env vars: ${missingEnvVars.join(", ")}`);
}

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firebaseDb = getFirestore(firebaseApp);
