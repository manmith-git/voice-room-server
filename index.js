// server/index.js — Base64 Int16 Audio Relay (Python + Web)
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e7
});

// Serve optional web-client for testing
app.use(express.static(path.join(__dirname, "web-client")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "web-client", "index.html"));
});

const rooms = {};

function genRoomCode() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 9; i++) {
    if (i === 3 || i === 6) code += "-";
    else code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  // CREATE ROOM
  socket.on("create-room", (name, cb) => {
    let room = genRoomCode();
    while (rooms[room]) room = genRoomCode();
    rooms[room] = { members: {} };

    rooms[room].members[socket.id] = name || "creator";
    socket.join(room);
    console.log("🆕 Room created:", room);

    cb && cb({ ok: true, room });
    io.to(room).emit("members", Object.values(rooms[room].members));
  });

  // JOIN ROOM
  socket.on("join-room", ({ room, name }, cb) => {
    if (!rooms[room]) {
      console.log("❌ Room not found:", room);
      cb && cb({ ok: false, error: "no-room" });
      return;
    }

    rooms[room].members[socket.id] = name || "guest";
    socket.join(room);
    console.log(`👤 ${name} joined ${room}`);

    cb && cb({ ok: true, room });
    io.to(room).emit("members", Object.values(rooms[room].members));
  });

  // SIGNALING passthrough (if you use it)
  socket.on("signal", ({ room, to, data }) => {
    if (to && io.sockets.sockets.get(to)) {
      io.to(to).emit("signal", { from: socket.id, data });
    } else {
      socket.to(room).emit("signal", { from: socket.id, data });
    }
  });

  // MUTE relay (optional)
  socket.on("mute-toggle", ({ room, muted }) => {
    socket.to(room).emit("user-muted", { from: socket.id, muted });
  });

  // AUDIO-CHUNK relay (base64 int16 payload)
  // payload = { room, data: "<base64>", sample_rate, channels }
  socket.on("audio-chunk", (payload) => {
    if (!payload) return;
    const { room, data, sample_rate, channels } = payload;
    if (!room || !data) return;

    // forward JSON payload to others in the room
    socket.to(room).emit("audio-chunk", {
      sender: socket.id,
      data,
      sample_rate,
      channels
    });
  });

  // DISCONNECT handling
  socket.on("disconnecting", () => {
    const joined = [...socket.rooms].filter((r) => r !== socket.id);
    joined.forEach((room) => {
      if (rooms[room]) {
        delete rooms[room].members[socket.id];
        io.to(room).emit("members", Object.values(rooms[room].members));
        if (Object.keys(rooms[room].members).length === 0) {
          console.log("🗑️ Room deleted:", room);
          delete rooms[room];
        }
      }
    });
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
