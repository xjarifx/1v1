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

const TICK_RATE = 20; // 60 → 20
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

// delta encoder
function makeDelta(old, cur) {
  const d = {};
  if (old.players[0].x !== cur.players[0].x) d.p0x = cur.players[0].x;
  if (old.players[0].y !== cur.players[0].y) d.p0y = cur.players[0].y;
  if (old.players[1].x !== cur.players[1].x) d.p1x = cur.players[1].x;
  if (old.players[1].y !== cur.players[1].y) d.p1y = cur.players[1].y;
  if (old.players[0].hp !== cur.players[0].hp) d.p0h = cur.players[0].hp;
  if (old.players[1].hp !== cur.players[1].hp) d.p1h = cur.players[1].hp;
  if (old.players[0].basicCD !== cur.players[0].basicCD)
    d.p0b = cur.players[0].basicCD;
  if (old.players[1].basicCD !== cur.players[1].basicCD)
    d.p1b = cur.players[1].basicCD;
  if (old.players[0].fastCD !== cur.players[0].fastCD)
    d.p0f = cur.players[0].fastCD;
  if (old.players[1].fastCD !== cur.players[1].fastCD)
    d.p1f = cur.players[1].fastCD;
  if (JSON.stringify(old.missiles) !== JSON.stringify(cur.missiles))
    d.m = cur.missiles;
  return Object.keys(d).length ? d : null;
}

io.on("connection", (socket) => {
  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    if (!rooms[roomId])
      rooms[roomId] = { players: [], state: createRoomState() };
    const room = rooms[roomId];
    if (room.players.length >= 2) return socket.emit("roomFull");
    socket.playerIndex = room.players.push(socket.id) - 1;
    socket.emit("init", { playerIndex: socket.playerIndex, state: room.state });
    if (room.players.length === 2) io.to(roomId).emit("startGame", room.state);
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

// game loop
setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    const state = room.state;

    // physics
    state.players.forEach((p, i) => {
      const inp = p.input || {};
      if (inp.up) p.y -= PLAYER_SPEED;
      if (inp.down) p.y += PLAYER_SPEED;
      if (inp.left) p.x -= PLAYER_SPEED;
      if (inp.right) p.x += PLAYER_SPEED;
      p.x = Math.max(0, Math.min(GAME_WIDTH - p.width, p.x));
      p.y = Math.max(0, Math.min(GAME_HEIGHT - p.height, p.y));
      p.basicCD = Math.max(0, p.basicCD - 1 / TICK_RATE);
      p.fastCD = Math.max(0, p.fastCD - 1 / TICK_RATE);

      if (inp.fire && p.basicCD <= 0) {
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
      if (inp.fastFire && p.fastCD <= 0) {
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

    // missiles
    for (let i = state.missiles.length - 1; i >= 0; i--) {
      const m = state.missiles[i];
      m.x += m.speed;
      if (m.x < 0 || m.x > GAME_WIDTH) state.missiles.splice(i, 1);
      else {
        const tgt = state.players[1 - m.from];
        if (
          m.x < tgt.x + tgt.width &&
          m.x + m.w > tgt.x &&
          m.y < tgt.y + tgt.height &&
          m.y + m.h > tgt.y
        ) {
          tgt.hp = Math.max(0, tgt.hp - 10);
          state.missiles.splice(i, 1);
          if (tgt.hp <= 0) io.to(roomId).emit("gameOver", { winner: m.from });
        }
      }
    }

    // send delta
    if (!room.last) room.last = JSON.parse(JSON.stringify(state));
    const delta = makeDelta(room.last, state);
    room.last = JSON.parse(JSON.stringify(state));
    if (delta) io.to(roomId).emit("update", { t: Date.now(), d: delta });
  }
}, 1000 / TICK_RATE);

server.listen(3000, () => console.log("Server on :3000"));
