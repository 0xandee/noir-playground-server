export default () => ({
  port: parseInt(process.env.PORT || "4000", 10) || 4000,
  noir: {
    dataPath: process.env.NOIR_DATA_PATH || "/data/noir-profiler",
    backendPath: process.env.NOIR_BACKEND_PATH || "/usr/local/bin/bb",
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  debug: {
    timeouts: {
      // DAP protocol request timeout (default: 5 seconds)
      dapRequest: parseInt(process.env.DAP_REQUEST_TIMEOUT || "5000", 10),
      // DAP disconnect timeout - longer to allow graceful shutdown (default: 2 seconds)
      dapDisconnect: parseInt(process.env.DAP_DISCONNECT_TIMEOUT || "2000", 10),
      // Wait for initialized event timeout (default: 10 seconds)
      initialized: parseInt(process.env.DAP_INITIALIZED_TIMEOUT || "10000", 10),
      // Wait for stopped event timeout (default: 10 seconds)
      stopped: parseInt(process.env.DAP_STOPPED_TIMEOUT || "10000", 10),
      // Nargo compilation timeout (default: 60 seconds)
      compilation: parseInt(process.env.COMPILATION_TIMEOUT || "60000", 10),
    },
  },
});
