// server/index.js — Final Version with signaling + audio relay FIXED

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Allow all origins
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e7 // allow larger audio chunks (~10 MB)
});

// Serve static files (browser client)
app.use(express.static(path.join(__dirname, 'web-client')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'web-client', 'index.html'));
});

// -------------------- SOCKET.IO SIGNALING --------------------
const rooms = {};

function genRoomCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 9; i++) {
    if (i === 3 || i === 6) code += '-';
    else code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

io.on('connection', (socket) => {
  console.log('🟢 New socket connected:', socket.id);

  // CREATE ROOM
  socket.on('create-room', (name, cb) => {
    let room = genRoomCode();
    while (rooms[room]) room = genRoomCode();

    rooms[room] = { members: {} };
    rooms[room].members[socket.id] = name || 'creator';
    socket.join(room);

    console.log(`🆕 Room created: ${room}`);
    if (cb) cb({ ok: true, room });
    io.to(room).emit('members', Object.values(rooms[room].members));
  });

  // JOIN ROOM
  socket.on('join-room', ({ room, name }, cb) => {
    if (!rooms[room]) {
      console.log(`❌ Room not found: ${room}`);
      if (cb) cb({ ok: false, error: 'Room not found' });
      return;
    }

    rooms[room].members[socket.id] = name || 'guest';
    socket.join(room);
    console.log(`👤 ${name} joined room ${room}`);

    if (cb) cb({ ok: true, room });
    io.to(room).emit('members', Object.values(rooms[room].members));
  });

  // SIGNALING (WebRTC exchange)
  socket.on('signal', ({ room, to, data }) => {
    if (to && io.sockets.sockets.get(to)) {
      io.to(to).emit('signal', { from: socket.id, data });
    } else {
      socket.to(room).emit('signal', { from: socket.id, data });
    }
  });

  // MUTE/UNMUTE relay
  socket.on('mute-toggle', ({ room, muted }) => {
    socket.to(room).emit('user-muted', { from: socket.id, muted });
  });

  // ------------------------------------------------------------
  // 🎙️ AUDIO STREAM RELAY — FIXED FOR PYTHON
  // ------------------------------------------------------------
  socket.on('audio-chunk', (chunk) => {

    // Python sends: { type:'Buffer', data:[...] }
    if (chunk && chunk.data) {
      chunk = Buffer.from(chunk.data);
    }

    // Browser sends ArrayBuffer, convert too
    if (chunk instanceof ArrayBuffer) {
      chunk = Buffer.from(chunk);
    }

    const roomsJoined = Array.from(socket.rooms).filter((r) => r !== socket.id);

    roomsJoined.forEach((room) => {
      socket.to(room).emit('audio-play', chunk); // relay binary
    });
  });

  // DISCONNECT handling
  socket.on('disconnecting', () => {
    const joined = Object.keys(socket.rooms).filter(r => r !== socket.id);
    joined.forEach(room => {
      if (rooms[room]) {
        delete rooms[room].members[socket.id];
        io.to(room).emit('members', Object.values(rooms[room].members));
        if (Object.keys(rooms[room].members).length === 0) {
          console.log(`🗑️ Room deleted: ${room}`);
          delete rooms[room];
        }
      }
    });
  });
});

// --------------------------------------------------------------

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
