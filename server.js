const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
// Tolera cortes breves (pantalla bloqueada, cambio de app) antes de dar el socket por muerto.
const io = new Server(server, { pingInterval: 25000, pingTimeout: 60000 });

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------
// Configuracion del "lote"
// ---------------------------------------------------------------

const CAMPOS = [
  { id: 'responsable',  label: 'Responsable asignado - Nombre' },
  { id: 'apellido',     label: 'Apellido del responsable - Apellido' },
  { id: 'razonSocial',  label: 'Razon social del proveedor - Empresa' },
  { id: 'cromatico',    label: 'Atributo cromatico - Color' },
  { id: 'perecible',    label: 'Insumo perecible - Fruta' },
  { id: 'semoviente',   label: 'Bien semoviente - Animal' },
  { id: 'origen',       label: 'Origen / pais de procedencia - Pais' },
  { id: 'descripcion',  label: 'Descripcion del bien - Cosa/Objeto' },
  { id: 'deporte',  label: 'Descripcion del activo - Deporte' }
];

// Sin K, Q, W, X, Y, Z: en espanol dan rondas frustrantes.
const LETRAS = 'ABCDEFGHIJLMNOPRSTUV'.split('');

const PUNTOS = { UNICO: 100, REPETIDO: 50, VACIO: 0 };

const FASES = {
  ESPERA:    'espera',
  CAPTURA:   'captura',
  AUDITORIA: 'auditoria',
  CIERRE:    'cierre'
};

const MAX_CHAT = 60;

// Tiempo que se conserva a un usuario desconectado antes de retirarlo del libro.
const GRACIA_MS = Number(process.env.GRACIA_MS) || 120000;

// ---------------------------------------------------------------
// Estado en memoria
// ---------------------------------------------------------------

const estado = {
  fase: FASES.ESPERA,
  lote: 141,
  letra: null,
  letrasUsadas: [],
  iniciadoEn: null,
  cerradoPor: null,
  // La clave es un token propio de cada navegador (no el socket.id, que cambia en cada reconexion).
  usuarios: new Map(),   // uid -> { id, socketId, nombre, area, puntaje, listo, conectado, timer }
  registros: new Map(),  // uid -> { campoId: valor }
  votos: new Map(),
  ultimosResultados: null,
  chat: []               // { nombre, texto, hora }
};

const socketAUid = new Map();   // socket.id -> uid

function uidDe(socket) { return socketAUid.get(socket.id) || null; }

function usuariosPublicos() {
  return [...estado.usuarios.values()].map(u => ({
    id: u.id,
    nombre: u.nombre,
    area: u.area,
    puntaje: u.puntaje,
    listo: u.listo,
    conectado: u.conectado
  }));
}

function snapshot() {
  return {
    fase: estado.fase,
    lote: estado.lote,
    letra: estado.letra,
    campos: CAMPOS,
    iniciadoEn: estado.iniciadoEn,
    cerradoPor: estado.cerradoPor,
    usuarios: usuariosPublicos()
  };
}

function difundir() {
  io.emit('estado', snapshot());
}

function nombreDe(uid) {
  const u = estado.usuarios.get(uid);
  return u ? u.nombre : 'Usuario retirado';
}

function limpiarListos() {
  for (const u of estado.usuarios.values()) u.listo = false;
}

// ---------------------------------------------------------------
// Chat
// ---------------------------------------------------------------

function publicarChat(uid, texto) {
  const u = estado.usuarios.get(uid);
  if (!u) return;
  const limpio = String(texto || '').trim().slice(0, 200);
  if (!limpio) return;

  const msg = {
    nombre: u.nombre,
    texto: limpio,
    hora: new Date().toTimeString().slice(0, 5)
  };
  estado.chat.push(msg);
  if (estado.chat.length > MAX_CHAT) estado.chat.shift();
  io.emit('chat', msg);
}

function sistemaChat(texto) {
  const msg = { nombre: null, texto, hora: new Date().toTimeString().slice(0, 5) };
  estado.chat.push(msg);
  if (estado.chat.length > MAX_CHAT) estado.chat.shift();
  io.emit('chat', msg);
}

// ---------------------------------------------------------------
// Ciclo de la ronda
// ---------------------------------------------------------------

function todosListos() {
  // Un jugador con el celular bloqueado no debe trabar la partida.
  const conectados = [...estado.usuarios.values()].filter(u => u.conectado);
  if (conectados.length === 0) return false;
  return conectados.every(u => u.listo);
}

function evaluarInicio() {
  if (estado.fase === FASES.CAPTURA) return;
  if (!todosListos()) return;
  iniciarRonda();
}

function iniciarRonda() {
  let disponibles = LETRAS.filter(l => !estado.letrasUsadas.includes(l));
  if (disponibles.length === 0) {
    estado.letrasUsadas = [];
    disponibles = LETRAS.slice();
  }

  estado.letra = disponibles[Math.floor(Math.random() * disponibles.length)];
  estado.letrasUsadas.push(estado.letra);
  estado.fase = FASES.CAPTURA;
  estado.iniciadoEn = Date.now();
  estado.cerradoPor = null;
  estado.registros.clear();
  estado.votos.clear();
  estado.ultimosResultados = null;
  limpiarListos();

  sistemaChat('Lote ' + String(estado.lote).padStart(4, '0') +
              ' abierto. Clasificacion: ' + estado.letra);
  difundir();
}

function cerrarLote(uid) {
  if (estado.fase !== FASES.CAPTURA) return;

  estado.fase = FASES.AUDITORIA;
  estado.cerradoPor = nombreDe(uid);
  limpiarListos();

  for (const id of estado.usuarios.keys()) {
    if (!estado.registros.has(id)) estado.registros.set(id, {});
  }

  sistemaChat(estado.cerradoPor + ' cerro el lote.');
  io.emit('auditoria', construirAuditoria());
  difundir();
}

function construirAuditoria() {
  const filas = CAMPOS.map(campo => ({
    campoId: campo.id,
    label: campo.label,
    entradas: [...estado.usuarios.keys()].map(id => ({
      usuarioId: id,
      nombre: nombreDe(id),
      valor: (estado.registros.get(id) || {})[campo.id] || ''
    }))
  }));
  return { letra: estado.letra, filas };
}

function votar(uid, usuarioId, campoId, rechaza) {
  if (estado.fase !== FASES.AUDITORIA) return;
  if (usuarioId === uid) return;

  const clave = `${usuarioId}:${campoId}`;
  if (!estado.votos.has(clave)) estado.votos.set(clave, new Set());
  const set = estado.votos.get(clave);

  if (rechaza) set.add(uid);
  else set.delete(uid);
}

function esRechazado(usuarioId, campoId) {
  const set = estado.votos.get(`${usuarioId}:${campoId}`);
  if (!set) return false;
  const otros = Math.max(estado.usuarios.size - 1, 1);
  return set.size > otros / 2;
}

function normalizar(v) {
  return (v || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function calcularResultados() {
  const detalle = new Map();
  for (const id of estado.usuarios.keys()) detalle.set(id, { total: 0, campos: {} });

  for (const campo of CAMPOS) {
    const conteo = new Map();
    for (const id of estado.usuarios.keys()) {
      const valor = normalizar((estado.registros.get(id) || {})[campo.id] || '');
      const valida = valor.length > 0
        && valor.startsWith(estado.letra.toLowerCase())
        && !esRechazado(id, campo.id);
      if (valida) conteo.set(valor, (conteo.get(valor) || 0) + 1);
    }

    for (const id of estado.usuarios.keys()) {
      const bruto = (estado.registros.get(id) || {})[campo.id] || '';
      const valor = normalizar(bruto);
      let puntos = PUNTOS.VACIO;

      if (valor.length > 0
          && valor.startsWith(estado.letra.toLowerCase())
          && !esRechazado(id, campo.id)) {
        puntos = conteo.get(valor) > 1 ? PUNTOS.REPETIDO : PUNTOS.UNICO;
      }

      detalle.get(id).campos[campo.id] = { valor: bruto, puntos };
      detalle.get(id).total += puntos;
    }
  }

  for (const [id, d] of detalle.entries()) {
    const u = estado.usuarios.get(id);
    if (u) u.puntaje += d.total;
  }

  return [...detalle.entries()].map(([id, d]) => ({
    usuarioId: id,
    nombre: nombreDe(id),
    total: d.total,
    acumulado: estado.usuarios.get(id) ? estado.usuarios.get(id).puntaje : 0,
    campos: d.campos
  })).sort((a, b) => b.total - a.total);
}

function confirmarAuditoria() {
  if (estado.fase !== FASES.AUDITORIA) return;
  estado.fase = FASES.CIERRE;
  estado.lote += 1;
  limpiarListos();
  estado.ultimosResultados = { letra: estado.letra, filas: calcularResultados() };
  io.emit('resultados', estado.ultimosResultados);
  difundir();
}

function volverAEspera() {
  estado.fase = FASES.ESPERA;
  estado.letra = null;
  estado.registros.clear();
  estado.votos.clear();
  estado.ultimosResultados = null;
  limpiarListos();
  difundir();
}

function reiniciarTodo() {
  for (const u of estado.usuarios.values()) { u.puntaje = 0; u.listo = false; }
  estado.letrasUsadas = [];
  estado.lote = 141;
  estado.fase = FASES.ESPERA;
  estado.letra = null;
  estado.registros.clear();
  estado.votos.clear();
  estado.ultimosResultados = null;
  sistemaChat('Periodo reiniciado. Marcadores en cero.');
  difundir();
}

function retirarUsuario(uid) {
  const u = estado.usuarios.get(uid);
  if (!u || u.conectado) return;
  clearTimeout(u.timer);
  estado.usuarios.delete(uid);
  estado.registros.delete(uid);
  for (const clave of [...estado.votos.keys()]) {
    if (clave.startsWith(uid + ':')) estado.votos.delete(clave);
    else estado.votos.get(clave).delete(uid);
  }
  if (estado.usuarios.size === 0) {
    estado.fase = FASES.ESPERA;
    estado.letra = null;
    estado.ultimosResultados = null;
  }
  sistemaChat(u.nombre + ' cerro el libro.');
  difundir();
  evaluarInicio();
}

function limpiarToken(t) {
  return String(t || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

// ---------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------

io.on('connection', socket => {

  socket.on('acceder', datos => {
    const { nombre, area, token } = (datos && typeof datos === 'object') ? datos : {};
    const limpio = String(nombre || '').trim().slice(0, 24);
    if (!limpio) {
      socket.emit('errorAcceso', 'Ingrese un nombre de usuario.');
      return;
    }
    const uid = limpiarToken(token) || socket.id;
    const areaLimpia = String(area || '').trim().slice(0, 32) || 'Sin area';

    let u = estado.usuarios.get(uid);
    const reconexion = !!u;

    if (u) {
      // Mismo navegador que vuelve (celular que se desperto, recarga, etc.): conserva todo.
      clearTimeout(u.timer);
      u.timer = null;
      if (u.socketId && u.socketId !== socket.id) socketAUid.delete(u.socketId);
      u.socketId = socket.id;
      u.conectado = true;
      u.nombre = limpio;
      u.area = areaLimpia;
    } else {
      u = {
        id: uid, socketId: socket.id, nombre: limpio, area: areaLimpia,
        puntaje: 0, listo: false, conectado: true, timer: null
      };
      estado.usuarios.set(uid, u);
    }
    socketAUid.set(socket.id, uid);

    socket.emit('acceso', { id: uid });
    socket.emit('chatHistorial', estado.chat);
    if (!reconexion) sistemaChat(limpio + ' abrio el libro.');
    difundir();

    // Se reenvia lo que el cliente se perdio mientras estaba desconectado.
    // Va despues de difundir() para que el cliente ya conozca la fase y los campos.
    if (estado.fase === FASES.CAPTURA && estado.registros.has(uid)) {
      socket.emit('miRegistro', estado.registros.get(uid));
    }
    if (estado.fase === FASES.AUDITORIA) socket.emit('auditoria', construirAuditoria());
    if (estado.fase === FASES.CIERRE && estado.ultimosResultados) {
      socket.emit('resultados', estado.ultimosResultados);
    }
    if (reconexion) evaluarInicio();
  });

  socket.on('alternarListo', () => {
    const uid = uidDe(socket);
    const u = uid && estado.usuarios.get(uid);
    if (!u) return;
    if (estado.fase === FASES.CAPTURA) return;

    // Desde el cierre, marcar listo devuelve a la sala de espera.
    if (estado.fase === FASES.CIERRE || estado.fase === FASES.AUDITORIA) {
      volverAEspera();
    }

    u.listo = !u.listo;
    difundir();
    evaluarInicio();
  });

  function registroLimpio(datos) {
    const limpio = {};
    for (const campo of CAMPOS) {
      limpio[campo.id] = String((datos || {})[campo.id] || '').trim().slice(0, 40);
    }
    return limpio;
  }

  socket.on('guardarRegistro', datos => {
    const uid = uidDe(socket);
    if (estado.fase !== FASES.CAPTURA || !uid) return;
    estado.registros.set(uid, registroLimpio(datos));
  });

  socket.on('cerrarLote', datos => {
    const uid = uidDe(socket);
    if (!uid || estado.fase !== FASES.CAPTURA) return;
    estado.registros.set(uid, registroLimpio(datos));
    cerrarLote(uid);
  });

  socket.on('votar', datos => {
    const { usuarioId, campoId, rechaza } = (datos && typeof datos === 'object') ? datos : {};
    const uid = uidDe(socket);
    if (!uid) return;
    votar(uid, usuarioId, campoId, !!rechaza);
  });

  socket.on('confirmarAuditoria', () => {
    if (!uidDe(socket)) return;
    confirmarAuditoria();
  });

  socket.on('mensaje', texto => {
    const uid = uidDe(socket);
    if (uid) publicarChat(uid, texto);
  });

  socket.on('reiniciar', () => {
    if (!uidDe(socket)) return;
    reiniciarTodo();
  });

  socket.on('disconnect', () => {
    const uid = socketAUid.get(socket.id);
    socketAUid.delete(socket.id);
    if (!uid) return;
    const u = estado.usuarios.get(uid);
    // Si el usuario ya se reasocio a otro socket, este corte no cuenta.
    if (!u || u.socketId !== socket.id) return;

    u.conectado = false;
    u.socketId = null;
    // No se borra: se le da un margen para volver (el celular suele cortar el socket al bloquearse).
    u.timer = setTimeout(() => retirarUsuario(uid), GRACIA_MS);
    difundir();
    evaluarInicio();
  });
});

// ---------------------------------------------------------------

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/salud', (req, res) => {
  res.json({ ok: true, fase: estado.fase, conectados: [...estado.usuarios.values()].filter(u => u.conectado).length });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Modulo de validacion activo en http://0.0.0.0:${PORT}`);
});
