const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://1v1-cyan.vercel.app", "http://localhost:5173"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(express.static(__dirname + "/../client"));

const TICK_RATE = 60;
const PLAYER_SPEED = 7;
const MISSILE_SPEED_BASIC = 15;
const MISSILE_SPEED_FAST = 25;
const COOLDOWN_BASIC = 0.5;
const COOLDOWN_FAST = 6;
const GAME_WIDTH = 780;
const GAME_HEIGHT = 300;

let rooms = {};

function createRoomState() {
  return {
    players: [
      {
        x: 100,
        y: 150,
        width: 60,
        height: 60,
        color: "#00ffff",
        hp: 50,
        basicCD: 0,
        fastCD: 0,
        input: {},
      },
      {
        x: GAME_WIDTH - 160,
        y: 150,
        width: 60,
        height: 60,
        color: "#ff9933",
        hp: 50,
        basicCD: 0,
        fastCD: 0,
        input: {},
      },
    ],
    missiles: [],
  };
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    if (!rooms[roomId])
      rooms[roomId] = { players: [], state: createRoomState() };
    const room = rooms[roomId];
    if (room.players.length >= 2) {
      socket.emit("roomFull");
      return;
    }
    room.players.push(socket.id);
    socket.playerIndex = room.players.indexOf(socket.id);
    socket.emit("init", { playerIndex: socket.playerIndex, state: room.state });

    if (room.players.length === 2) {
      io.to(roomId).emit("startGame", room.state);
    }
  });

  socket.on("input", ({ roomId, input }) => {
    const room = rooms[roomId];
    if (!room) return;
    const p = room.state.players[socket.playerIndex];
    if (p) p.input = input;
  });

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const idx = room.players.indexOf(socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        io.to(roomId).emit("playerLeft");
      }
      if (room.players.length === 0) delete rooms[roomId];
    }
  });
});

// Game loop
setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    const state = room.state;

    state.players.forEach((p, i) => {
      const input = p.input || {};
      // movement
      if (input.up) p.y -= PLAYER_SPEED;
      if (input.down) p.y += PLAYER_SPEED;
      if (input.left) p.x -= PLAYER_SPEED;
      if (input.right) p.x += PLAYER_SPEED;
      p.x = Math.max(0, Math.min(GAME_WIDTH - p.width, p.x));
      p.y = Math.max(0, Math.min(GAME_HEIGHT - p.height, p.y));
      // cooldowns
      p.basicCD = Math.max(0, p.basicCD - 1 / TICK_RATE);
      p.fastCD = Math.max(0, p.fastCD - 1 / TICK_RATE);
      // missiles
      if (input.fire && p.basicCD <= 0) {
        state.missiles.push({
          x: p.x + (i === 0 ? p.width : -12),
          y: p.y + 15,
          w: 12,
          h: 30,
          speed: i === 0 ? MISSILE_SPEED_BASIC : -MISSILE_SPEED_BASIC,
          from: i,
        });
        p.basicCD = COOLDOWN_BASIC;
      }
      if (input.fastFire && p.fastCD <= 0) {
        state.missiles.push({
          x: p.x + (i === 0 ? p.width : -40),
          y: p.y + 10,
          w: 40,
          h: 40,
          speed: i === 0 ? MISSILE_SPEED_FAST : -MISSILE_SPEED_FAST,
          from: i,
        });
        p.fastCD = COOLDOWN_FAST;
      }
    });

    // Update missiles
    for (let i = state.missiles.length - 1; i >= 0; i--) {
      const m = state.missiles[i];
      m.x += m.speed;
      if (m.x < 0 || m.x > GAME_WIDTH) state.missiles.splice(i, 1);
      else {
        const target = state.players[1 - m.from];
        if (
          m.x < target.x + target.width &&
          m.x + m.w > target.x &&
          m.y < target.y + target.height &&
          m.y + m.h > target.y
        ) {
          target.hp = Math.max(0, target.hp - 10);
          state.missiles.splice(i, 1);

          // Optional: Check for game over
          if (target.hp <= 0) {
            io.to(roomId).emit("gameOver", { winner: m.from });
            // Reset or end game logic here
          }
        }
      }
    }

    io.to(roomId).emit("update", state);
  }
}, 1000 / TICK_RATE);

// vercel deploy link: https://1v1-cyan.vercel.app/
// render deploy link: https://onev1-h4qx.onrender.com

server.listen(3000, () =>
  console.log("Server running on http://localhost:3000")
);
