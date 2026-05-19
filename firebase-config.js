/**
 * Firebase opcional para guardar el torneo en la nube (Firestore).
 *
 * Pasos rápidos:
 * 1) https://console.firebase.google.com → Crear proyecto (o usar uno existente).
 * 2) Añadir app Web → copia los valores del objeto firebaseConfig.
 * 3) Firestore Database → crear base en modo producción → Reglas:
 *    (solo pruebas locales) permite lectura/escritura temporal;
 *    en producción usa Firebase Authentication y reglas restringidas.
 * 4) Copia firebase-config.example.js → firebase-config.local.js
 * 5) Pon enabled: true y rellena firebaseConfig en firebase-config.local.js
 *
 * Guía completa: SETUP-FIREBASE.txt
 * IMPORTANTE: no subas firebase-config.local.js a un repo público.
 */
window.FIREBASE_SC2_CONFIG = window.FIREBASE_SC2_CONFIG || {
  enabled: false,

  /** Colección y documento donde se guardará el mismo JSON que en localStorage */
  firestoreCollection: "torneos_sc2",
  firestoreDocumentId: "principal",

  firebaseConfig: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
  },
};
