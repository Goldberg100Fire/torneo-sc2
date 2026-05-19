# Torneo StarCraft — doble eliminación

Web para gestionar un torneo de StarCraft con cuadro de ganadores, repechaje (losers), preliminares y gran final.

## Archivos

| Archivo | Uso |
|---------|-----|
| `admin.html` | Panel de administración (equipos, sorteo, resultados) |
| `index.html` | Vista pública del cuadro |
| `iniciar.bat` / `Abrir torneo.bat` | Arrancar servidor local |
| `firebase-config.example.js` | Plantilla de Firebase (copiar a `firebase-config.local.js`) |

## Uso local

1. Copia `firebase-config.example.js` → `firebase-config.local.js` y rellena tus credenciales (opcional).
2. Ejecuta `iniciar.bat` o `npm start`.
3. Abre `http://localhost:3000/admin.html` (admin) o `index.html` (público).

Los datos se guardan en `localStorage` y, si hay sesión admin, en Firestore.

## GitHub

```bash
cd torneo-sc2
git remote add origin https://github.com/TU_USUARIO/torneo-sc2.git
git branch -M main
git push -u origin main
```

Crea antes el repositorio vacío en GitHub (sin README) con el nombre `torneo-sc2`.
