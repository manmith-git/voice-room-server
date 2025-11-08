// index.js — with mute/unmute support and ready for Render

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// ✅ Create app and server
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ✅ Serve web-client folder
app.use(express.static(path.join(__dirname, 'web-client')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'web-client', 'index.html'));
});

// -------------------- SOCKET.IO SIGNALING LOGIC --------------------
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
  console.log('🔌 socket connected', socket.id);

  // 🏠 Create a new room
  socket.on('create-room', (name, cb) => {
    let room = genRoomCode();
    while (rooms[room]) room = genRoomCode();
    rooms[room] = { members: {} };
    rooms[room].members[socket.id] = name || 'creator';
    socket.join(room);
    console.log('🆕 room created', room);
    cb({ ok: true, room });
    io.to(room).emit('members', Object.values(rooms[room].members));
  });

  // 🚪 Join existing room
  socket.on('join-room', ({ room, name }, cb) => {
    if (!rooms[room]) return cb({ ok: false, error: 'Room not found' });
    rooms[room].members[socket.id] = name || 'guest';
    socket.join(room);
    cb({ ok: true, room });
    io.to(room).emit('members', Object.values(rooms[room].members));
    console.log(`👤 ${name} joined ${room}`);
  });

  // 🔁 WebRTC signaling (offer/answer/ICE)
  socket.on('signal', ({ room, to, data }) => {
    if (to && io.sockets.sockets.get(to)) {
      io.to(to).emit('signal', { from: socket.id, data });
    } else {
      socket.to(room).emit('signal', { from: socket.id, data });
    }
  });

  // 🔇 Handle mute/unmute events
  socket.on('mute-toggle', (data) => {
    const { room, muted } = data;
    if (rooms[room]) {
      console.log(`🎙️ ${socket.id} ${muted ? 'muted' : 'unmuted'} in ${room}`);
      socket.to(room).emit('user-muted', { from: socket.id, muted });
    }
  });

  // ❌ Handle disconnect and cleanup
  socket.on('disconnecting', () => {
    const joined = Object.keys(socket.rooms).filter(r => r !== socket.id);
    joined.forEach(room => {
      if (rooms[room]) {
        delete rooms[room].members[socket.id];
        io.to(room).emit('members', Object.values(rooms[room].members));
        if (Object.keys(rooms[room].members).length === 0) delete rooms[room];
      }
    });
  });
});

// -------------------------------------------------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('✅ Signaling server running on port', PORT));
