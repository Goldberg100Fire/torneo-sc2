/**
 * Copia este archivo como firebase-config.local.js y rellena tus datos.
 * (firebase-config.local.js no se sube a Git si usas el .gitignore del proyecto)
 */
window.FIREBASE_SC2_CONFIG = {
  enabled: true,

  firestoreCollection: "torneos_sc2",
  firestoreDocumentId: "principal",

  /** Correos que serán admin principal (pueden invitar editores). Añade el tuyo en minúsculas. */
  bootstrapSuperAdminEmails: ["tu-correo@gmail.com"],

  firebaseConfig: {
    apiKey: "AIza...",
    authDomain: "TU-PROYECTO.firebaseapp.com",
    projectId: "tu-proyecto-id",
    storageBucket: "tu-proyecto-id.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef",
  },
};
