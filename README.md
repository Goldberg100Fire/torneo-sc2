# Torneo StarCraft — doble eliminación

Web para gestionar un torneo de StarCraft con cuadro de ganadores, repechaje (losers), preliminares y gran final.

**Producción:** https://torneo-sc2.onrender.com  
- Admin: `/admin.html`  
- Público: `/index.html`

## Archivos

| Archivo | Uso |
|---------|-----|
| `admin.html` | Panel de administración (equipos, sorteo, resultados) |
| `index.html` | Vista pública del cuadro (solo lectura) |
| `tournament-lib.mjs` | Fusión local/nube compartida (admin, index, tests) |
| `server.js` | API, SQLite, invitaciones, Gmail API |
| `iniciar.bat` / `Abrir torneo.bat` | Arrancar servidor local |
| `firebase-config.example.js` | Plantilla Firebase → `firebase-config.local.js` |
| `SETUP-DIA-TORNEO.txt` | Checklist el día del torneo |

## Uso local

1. Copia `firebase-config.example.js` → `firebase-config.local.js` y rellena credenciales (opcional).
2. Ejecuta `iniciar.bat` o `npm start`.
3. Abre `http://localhost:3000/admin.html` (admin) o `index.html` (público).

Los datos se guardan en `localStorage`. Con sesión admin/editor también en **Firestore** (principal entre dispositivos) y **SQLite** en el servidor (respaldo; en Render puede perderse al redeploy sin disco persistente).

## Día del torneo (resumen)

1. Revisa `/api/health` (Firebase + correo OK).
2. Admin logueado; al guardar debe aparecer **Firestore + servidor**.
3. Exporta JSON antes de empezar.
4. Comparte solo `index.html` al público.
5. Guía completa: `SETUP-DIA-TORNEO.txt`.

## Invitaciones por correo

Gmail API (Render) o Resend. Ver `SETUP-GMAIL-API.txt`, `SETUP-EMAIL.txt`, `SETUP-EMAIL-SPAM.txt`.

Firebase: dominios autorizados y reglas en `SETUP-FIREBASE.txt`.

## Tests

```bash
npm test
```

## Seguridad API

- `GET /api/tournament` — público (lectura).
- `PUT /api/tournament` — requiere token Firebase (admin o editor).
- `DELETE /api/tournament` — solo super admin.

## GitHub

```bash
git push origin main
```

Render despliega automáticamente desde `main`.
