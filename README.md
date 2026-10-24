# Catálogo Maestro — Módulo de validación de datos

Aplicación web en tiempo real (Node.js + Socket.io) camuflada con interfaz
tipo Excel. Uso interno / recreativo.

---

## Requisitos

- Node.js 18 o superior instalado en la PC que hará de servidor
- Todos los participantes en la misma red (o acceso configurado, ver
  sección VLAN más abajo)

Verificar Node instalado:

```
node -v
npm -v
```

Si no está instalado: https://nodejs.org (versión LTS).

---

## Estructura del proyecto

```
lotes/
  server.js          <- backend (Express + Socket.io)
  package.json
  public/
    index.html        <- frontend (interfaz camuflada)
```

Los tres archivos deben respetar exactamente esta estructura de carpetas;
`index.html` va dentro de `public/`, no al mismo nivel que `server.js`.

---

## Instalación (una sola vez)

Abrir una terminal dentro de la carpeta `lotes` y ejecutar:

```
npm install
```

Esto crea la carpeta `node_modules` con las dependencias (`express`,
`socket.io`). Puede tardar uno o dos minutos.

---

## Ejecutar el servidor

Desde la misma carpeta:

```
npm start
```

Si todo está bien, la consola muestra:

```
Modulo de validacion activo en http://0.0.0.0:3000
```

Dejar esa ventana de terminal abierta — si se cierra, el servidor se
detiene y nadie más puede conectarse.

---

## Acceder desde tu propia PC

Abrir el navegador en:

```
http://localhost:3000
```

---

## Acceder desde las PCs de tus compañeros

1. Averiguar la IP local de la PC que hace de servidor:

   ```
   ipconfig
   ```

   Buscar la línea `Dirección IPv4` (algo como `10.0.10.42`).

2. Cada compañero abre en su navegador:

   ```
   http://10.0.10.42:3000
   ```

   (reemplazando por la IP real).

### Si no cargan la página

Casi siempre es el Firewall de Windows bloqueando el puerto 3000 en la
PC servidor. Solución — abrir **Firewall de Windows Defender con
seguridad avanzada** → **Reglas de entrada** → **Nueva regla** →
**Puerto** → TCP → puerto específico `3000` → **Permitir la conexión**.

Para confirmar que es un tema de firewall y no de red, desde la PC de
un compañero:

```
Test-NetConnection 10.0.10.42 -Port 3000
```

`TcpTestSucceeded : False` con firewall cerrado; si da `True` y aun así
no carga nada en el navegador, revisar que la URL tenga `http://` y el
puerto `:3000`.

### Si están en VLANs distintas

Si algunos compañeros no llegan aunque el firewall esté abierto, es
probable que el switch/router de la empresa aísle las VLANs entre sí.
Opciones:

- Hostear el servidor en una máquina que ya sea accesible desde todas
  las VLANs (un servidor interno compartido).
- Publicarlo a internet con Cloudflare Tunnel (ver sección siguiente).
- Pedir al área de redes una regla que permita el puerto 3000 entre
  VLANs.

---

## Publicarlo a internet con Cloudflare Tunnel (opcional)

Para que cualquiera con la URL entre sin importar la VLAN, sin abrir
puertos en el router:

```
winget install --id Cloudflare.cloudflared --exact
cloudflared tunnel --url http://localhost:3000
```

Esto genera una URL temporal tipo `https://algo.trycloudflare.com`,
válida mientras el comando siga corriendo. Se debe ejecutar en una
segunda terminal, en paralelo a `npm start` (no lo reemplaza).

---

## Uso básico

1. Cada participante entra a la URL e ingresa su nombre.
2. En la pantalla de espera, cada quien pulsa "Marcar como revisado".
   Cuando todos están marcados, la ronda arranca sola.
3. Se completan los campos con la letra asignada. El primero que
   termina pulsa "Guardar y validar" para cerrar la ronda a todos.
4. En la pestaña de validación se revisan las respuestas cruzadas y se
   confirma con "Aplicar filtros".
5. La pestaña de resumen muestra el puntaje. Desde ahí se vuelve a la
   sala de espera para la siguiente ronda.
6. El panel de "Comentarios" en la cinta abre un chat con emojis.

### Tecla de pánico

`Esc` reemplaza toda la pantalla por una hoja de cálculo estática e
inocua. Se quita con `Esc` de nuevo o doble clic en cualquier parte.

---

## Detener el servidor

Volver a la terminal donde corre `npm start` y presionar `Ctrl + C`.

---

## Reiniciar marcadores

El botón "Borrar formato" de la cinta pone todos los puntajes en cero
y reinicia el ciclo de letras usadas.

---

## Publicar en internet (Render)

GitHub Pages no sirve para este proyecto porque necesita un servidor Node
(Socket.io). Se publica en Render, que despliega desde este repositorio:

1. Entrar a https://render.com e iniciar sesión con GitHub.
2. **New → Blueprint**, elegir este repositorio (`render.yaml` ya trae la
   configuración: `npm ci`, `npm start`, plan free).
3. Al terminar el deploy, el juego queda en `https://<nombre>.onrender.com`.

Cada `git push` a `main` vuelve a desplegar automáticamente.

Plan gratuito: el servicio se duerme tras 15 min sin tráfico y tarda ~1 min
en despertar; al dormirse se pierden puntajes y chat (todo está en memoria).
