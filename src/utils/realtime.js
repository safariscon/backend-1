const { Server } = require("socket.io");
const { clearCache } = require("./cache");

let io = null;

const REALTIME_EVENTS = {
  CATALOG_CHANGED: "catalog:changed",
  HOTEL_CHANGED: "hotel:changed",
  SERVICE_CHANGED: "service:changed",
  ROOM_CHANGED: "room:changed",
  BOOKING_CHANGED: "booking:changed",
  NOTIFICATION: "notification:new",
};

const initRealtime = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || "*",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  });

  io.on("connection", (socket) => {
    socket.emit("realtime:ready", { connectedAt: new Date().toISOString() });

    socket.on("hotel:join", (hotelId) => {
      if (hotelId) socket.join(`hotel:${hotelId}`);
    });

    socket.on("user:join", (userId) => {
      if (userId) socket.join(`user:${userId}`);
    });

    socket.on("admin:join", () => {
      socket.join("admins");
    });
  });

  return io;
};

const emitRealtime = (event, payload = {}) => {
  if (!io) return;

  if (
    [
      REALTIME_EVENTS.CATALOG_CHANGED,
      REALTIME_EVENTS.HOTEL_CHANGED,
      REALTIME_EVENTS.SERVICE_CHANGED,
      REALTIME_EVENTS.ROOM_CHANGED,
    ].includes(event)
  ) {
    clearCache("public:");
  }

  io.emit(event, {
    ...payload,
    emittedAt: new Date().toISOString(),
  });
};

const emitHotelRealtime = (hotelId, event, payload = {}) => {
  emitRealtime(event, payload);
  if (io && hotelId) {
    io.to(`hotel:${hotelId}`).emit(event, {
      ...payload,
      emittedAt: new Date().toISOString(),
    });
  }
};

const emitUserRealtime = (userId, event, payload = {}) => {
  if (io && userId) {
    io.to(`user:${userId}`).emit(event, {
      ...payload,
      emittedAt: new Date().toISOString(),
    });
  }
  emitRealtime(event, payload);
};

module.exports = {
  REALTIME_EVENTS,
  initRealtime,
  emitRealtime,
  emitHotelRealtime,
  emitUserRealtime,
};
