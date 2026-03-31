# ⚡ VIBMON — Monitor de Vibraciones Industrial

App web completa para monitoreo de vibraciones con login seguro, base de datos SQLite, gráficas de tendencia X/Y/Z, exportación a PDF y análisis con IA.

## 🚀 DESPLEGAR EN RENDER.COM (GRATIS, 5 MINUTOS)

### Paso 1 — Subir a GitHub
1. Crea cuenta en [github.com](https://github.com) si no tienes
2. Crea repositorio nuevo (puede ser privado)
3. Sube todos estos archivos:
   ```
   Arrastra la carpeta vibmon/ completa al repositorio
   ```

### Paso 2 — Conectar con Render
1. Ve a [render.com](https://render.com) → Sign up (gratis)
2. Dashboard → **New +** → **Web Service**
3. Conecta tu cuenta de GitHub
4. Selecciona el repositorio `vibmon`
5. Render detecta automáticamente la configuración

### Paso 3 — Variables de entorno
En Render, sección **Environment**, añade:
| Variable | Valor |
|---|---|
| `JWT_SECRET` | (genera uno largo aleatorio, ej: `abc123xyz...`) |
| `ADMIN_USER` | `admin` (o el usuario que quieras) |
| `ADMIN_PASS` | Tu contraseña segura |
| `DB_PATH` | `/opt/render/project/src/vibmon.db` |
| `UPLOAD_DIR` | `/opt/render/project/src/uploads` |

### Paso 4 — Deploy
Click en **Create Web Service** → espera 2-3 minutos → ¡listo!

Render te dará una URL como: `https://vibmon-xxxx.onrender.com`

---

## 🔧 DESARROLLO LOCAL

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar configuración
cp .env.example .env
# Edita .env con tus valores

# 3. Iniciar servidor
npm start
# o con recarga automática:
npm run dev  # requiere: npm install -g nodemon

# 4. Abrir en navegador
# http://localhost:3000
```

**Credenciales por defecto:**
- Usuario: `admin`
- Contraseña: `vibmon2024`

---

## 📋 CARACTERÍSTICAS

- ✅ Login seguro con JWT + bcrypt (contraseñas hasheadas)
- ✅ Base de datos SQLite persistente
- ✅ Valores X / Y / Z por medición (mm/s ISO)
- ✅ Gráficas de tendencia con zonas de color ISO 10816
- ✅ Exportación a PDF por medición y por máquina completa
- ✅ Análisis de espectros con IA (Anthropic Claude)
- ✅ Zonas → Máquinas → Componentes → Mediciones
- ✅ Subida de múltiples imágenes por medición
- ✅ Diseño responsive (móvil, tablet, escritorio)
- ✅ Rate limiting y protección contra ataques
- ✅ Modo solo lectura para visitantes

## 📡 API REST

```
POST /api/auth/login          Login
GET  /api/auth/me             Usuario actual

GET  /api/zones               Listar zonas
POST /api/zones               Crear zona (admin)
PUT  /api/zones/:id           Editar zona (admin)
DELETE /api/zones/:id         Eliminar zona (admin)

GET  /api/zones/:id/machines  Máquinas de una zona
POST /api/zones/:id/machines  Crear máquina (admin)
PUT  /api/machines/:id        Editar máquina (admin)
DELETE /api/machines/:id      Eliminar máquina (admin)

GET  /api/components/:id/measurements  Mediciones de un componente
POST /api/components/:id/measurements  Nueva medición (admin, multipart)
DELETE /api/measurements/:id           Eliminar medición (admin)

GET  /api/measurements/:id/pdf         PDF de una medición
GET  /api/machines/:id/pdf             PDF completo de máquina
GET  /api/measurements/alerts          Alertas recientes
```

## ⚠️ NOTA SOBRE RENDER GRATUITO

El plan gratuito de Render:
- Se **duerme** tras 15 min de inactividad (tarda ~30s en despertar)
- Almacenamiento efímero → las imágenes se pierden al reiniciar
- Para persistencia de imágenes en producción, usa **Cloudinary** (gratis) o **Render Persistent Disk** (de pago)
- La base de datos SQLite persiste en el disco del servicio

Para uso en empresa con datos críticos, considera el plan **Starter** de Render ($7/mes) o un VPS propio.
