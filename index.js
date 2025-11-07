const express = require('express');
const http = require('http');
const path = require('path');

// Serve the web-client folder at "/"
app.use(express.static(path.join(__dirname, 'web-client')));

// Optional redirect for root "/"
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'web-client', 'index.html'));
});

const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Serve web-client statically (optional)
app.use('/web-client', express.static(require('path').join(__dirname, '..', 'web-client')));

const rooms = {}; // roomId -> { ownerSocketId, members: { socketId: name } }

function genRoomCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 9; i++) {
    if (i === 3 || i === 6) { code += '-'; continue; }
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('create-room', (name, cb) => {
    let room = genRoomCode();
    while (rooms[room]) room = genRoomCode();
    rooms[room] = { ownerSocketId: socket.id, members: {} };
    rooms[room].members[socket.id] = name || 'creator';
    socket.join(room);
    console.log('room created', room);
    cb({ ok: true, room });
    io.to(room).emit('members', Object.values(rooms[room].members));
  });

  socket.on('join-room', ({ room, name }, cb) => {
    if (!rooms[room]) return cb({ ok: false, error: 'Room not found' });
    rooms[room].members[socket.id] = name || 'guest';
    socket.join(room);
    cb({ ok: true, room });
    io.to(room).emit('members', Object.values(rooms[room].members));
    console.log(`${name} joined ${room}`);
  });

  // signaling messages: { to: '', data: {...} }
  socket.on('signal', ({ room, to, data }) => {
    // forward to the target socket id
    if (to && io.sockets.sockets.get(to)) {
      io.to(to).emit('signal', { from: socket.id, data });
    } else {
      // broadcast to room except sender
      socket.to(room).emit('signal', { from: socket.id, data });
    }
  });

  socket.on('disconnecting', () => {
    const roomsLeft = Object.keys(socket.rooms).filter(r => r !== socket.id);
    roomsLeft.forEach(room => {
      if (rooms[room]) {
        delete rooms[room].members[socket.id];
        io.to(room).emit('members', Object.values(rooms[room].members));
        // if room empty, delete it
        if (Object.keys(rooms[room].members).length === 0) delete rooms[room];
      }
    });
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Signaling server running on port', PORT));