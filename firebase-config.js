/**
 * Firebase / Firestore (configuración pública de app web).
 * Las claves de cliente van en el navegador; la seguridad la dan las reglas de Firestore.
 * Para desarrollo local puedes sobreescribir en firebase-config.local.js (no se sube a Git).
 */
window.FIREBASE_SC2_CONFIG = {
  enabled: true,

  firestoreCollection: "torneos_sc2",
  firestoreDocumentId: "principal",

  firebaseConfig: {
    apiKey: "AIzaSyDJNqlQFXQN-1WC-FgqLzmOz7UfH8H_tJA",
    authDomain: "torneo-sc2.firebaseapp.com",
    projectId: "torneo-sc2",
    storageBucket: "torneo-sc2.firebasestorage.app",
    messagingSenderId: "538701679387",
    appId: "1:538701679387:web:8eb70869d12cea5ba2e1be",
  },
};
