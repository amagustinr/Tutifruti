const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
  usuarios: new Map(),   // socketId -> { id, nombre, area, puntaje, listo }
  registros: new Map(),
  votos: new Map(),
  chat: []               // { nombre, texto, hora }
};

function usuariosPublicos() {
  return [...estado.usuarios.values()].map(u => ({
    id: u.id,
    nombre: u.nombre,
    area: u.area,
    puntaje: u.puntaje,
    listo: u.listo
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

function nombreDe(socketId) {
  const u = estado.usuarios.get(socketId);
  return u ? u.nombre : 'Usuario retirado';
}

function limpiarListos() {
  for (const u of estado.usuarios.values()) u.listo = false;
}

// ---------------------------------------------------------------
// Chat
// ---------------------------------------------------------------

function publicarChat(socketId, texto) {
  const u = estado.usuarios.get(socketId);
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
  if (estado.usuarios.size === 0) return false;
  return [...estado.usuarios.values()].every(u => u.listo);
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
  limpiarListos();

  sistemaChat('Lote ' + String(estado.lote).padStart(4, '0') +
              ' abierto. Clasificacion: ' + estado.letra);
  difundir();
}

function cerrarLote(socketId) {
  if (estado.fase !== FASES.CAPTURA) return;

  estado.fase = FASES.AUDITORIA;
  estado.cerradoPor = nombreDe(socketId);
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

function votar(socketId, usuarioId, campoId, rechaza) {
  if (estado.fase !== FASES.AUDITORIA) return;
  if (usuarioId === socketId) return;

  const clave = `${usuarioId}:${campoId}`;
  if (!estado.votos.has(clave)) estado.votos.set(clave, new Set());
  const set = estado.votos.get(clave);

  if (rechaza) set.add(socketId);
  else set.delete(socketId);
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
  io.emit('resultados', { letra: estado.letra, filas: calcularResultados() });
  difundir();
}

function volverAEspera() {
  estado.fase = FASES.ESPERA;
  estado.letra = null;
  estado.registros.clear();
  estado.votos.clear();
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
  sistemaChat('Periodo reiniciado. Marcadores en cero.');
  difundir();
}

// ---------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------

io.on('connection', socket => {

  socket.on('acceder', ({ nombre, area }) => {
    const limpio = String(nombre || '').trim().slice(0, 24);
    if (!limpio) {
      socket.emit('errorAcceso', 'Ingrese un nombre de usuario.');
      return;
    }
    estado.usuarios.set(socket.id, {
      id: socket.id,
      nombre: limpio,
      area: String(area || '').trim().slice(0, 32) || 'Sin area',
      puntaje: 0,
      listo: false
    });
    socket.emit('acceso', { id: socket.id });
    socket.emit('chatHistorial', estado.chat);
    sistemaChat(limpio + ' abrio el libro.');
    difundir();
    if (estado.fase === FASES.AUDITORIA) socket.emit('auditoria', construirAuditoria());
  });

  socket.on('alternarListo', () => {
    const u = estado.usuarios.get(socket.id);
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

  socket.on('guardarRegistro', datos => {
    if (estado.fase !== FASES.CAPTURA) return;
    if (!estado.usuarios.has(socket.id)) return;
    const limpio = {};
    for (const campo of CAMPOS) {
      limpio[campo.id] = String((datos || {})[campo.id] || '').trim().slice(0, 40);
    }
    estado.registros.set(socket.id, limpio);
  });

  socket.on('cerrarLote', datos => {
    if (!estado.usuarios.has(socket.id)) return;
    if (estado.fase !== FASES.CAPTURA) return;
    const limpio = {};
    for (const campo of CAMPOS) {
      limpio[campo.id] = String((datos || {})[campo.id] || '').trim().slice(0, 40);
    }
    estado.registros.set(socket.id, limpio);
    cerrarLote(socket.id);
  });

  socket.on('votar', ({ usuarioId, campoId, rechaza }) => {
    if (!estado.usuarios.has(socket.id)) return;
    votar(socket.id, usuarioId, campoId, !!rechaza);
  });

  socket.on('confirmarAuditoria', () => {
    if (!estado.usuarios.has(socket.id)) return;
    confirmarAuditoria();
  });

  socket.on('mensaje', texto => {
    publicarChat(socket.id, texto);
  });

  socket.on('reiniciar', () => {
    if (!estado.usuarios.has(socket.id)) return;
    reiniciarTodo();
  });

  socket.on('disconnect', () => {
    const nombre = nombreDe(socket.id);
    const existia = estado.usuarios.has(socket.id);
    estado.usuarios.delete(socket.id);
    estado.registros.delete(socket.id);
    for (const clave of [...estado.votos.keys()]) {
      if (clave.startsWith(socket.id + ':')) estado.votos.delete(clave);
      else estado.votos.get(clave).delete(socket.id);
    }
    if (estado.usuarios.size === 0) {
      estado.fase = FASES.ESPERA;
      estado.letra = null;
    }
    if (existia) sistemaChat(nombre + ' cerro el libro.');
    difundir();
    evaluarInicio();
  });
});

// ---------------------------------------------------------------

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/salud', (req, res) => {
  res.json({ ok: true, fase: estado.fase, conectados: estado.usuarios.size });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Modulo de validacion activo en http://0.0.0.0:${PORT}`);
});
