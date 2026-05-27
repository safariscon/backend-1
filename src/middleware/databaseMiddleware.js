const mongoose = require("mongoose");

const dbState = {
  ready: false,
  lastError: "",
};

const setDbReady = (ready, error = "") => {
  dbState.ready = ready;
  dbState.lastError = error ? String(error) : "";
};

const getDbState = () => ({
  ready: dbState.ready && mongoose.connection.readyState === 1,
  readyState: mongoose.connection.readyState,
  lastError: dbState.lastError,
});

const requireDatabase = (req, res, next) => {
  const state = getDbState();
  if (state.ready) return next();

  return res.status(503).json({
    message:
      "Database is not connected. Check MongoDB Atlas username/password and IP access list.",
    database: {
      ready: false,
      readyState: state.readyState,
      lastError: state.lastError,
    },
  });
};

module.exports = {
  getDbState,
  requireDatabase,
  setDbReady,
};
