module.exports = {
  // Whitelist of commands which don't require authentication.
  // All other commands sent by unauthorized users will be rejected by default.
  DOES_NOT_REQUIRE_AUTH: {
    AUTH: true,
    FEAT: true,
    NOOP: true,
    PASS: true,
    PBSZ: true,
    PROT: true,
    QUIT: true,
    TYPE: true,
    SYST: true,
    USER: true,
  },
  // Commands which can't be issued until a PASV/PORT command has been sent
  // without an intervening data connection error.
  REQUIRES_CONFIGURED_DATA: {
    LIST: true,
    NLST: true,
    RETR: true,
    STOR: true,
  },
  LOG_LEVELS: {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
    TRACE: 4,
  },
};
