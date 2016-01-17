const Constants = {
  CONCURRENT_STAT_CALLS: 5,

  // Alphabetized list of all commands that have a corresponding "__" prefixed
  // method (basically, all commands we support).
  COMMANDS_SUPPORTED: {
    ALLO: true,
    ACCT: true,
    APPE: true,
    AUTH: true,
    CDUP: true,
    CWD: true,
    DELE: true,
    EPRT: true,
    EPSV: true,
    FEAT: true,
    LIST: true,
    MDTM: true,
    MKD: true,
    NLST: true,
    NOOP: true,
    OPTS: true,
    PASS: true,
    PASV: true,
    PBSZ: true,
    PORT: true,
    PROT: true,
    PWD: true,
    QUIT: true,
    RETR: true,
    RMD: true,
    RNFR: true,
    RNTO: true,
    SIZE: true,
    STAT: true,
    STOR: true,
    SYST: true,
    TYPE: true,
    USER: true,
  },

  // List of all commands which don't require authentication.
  // All other commands sent by unauthorized users will be rejected by default.
  COMMANDS_NO_AUTH: {
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

  // List of all commands which can't be issued unless a PASV/PORT command has
  // been received and the corresponding data socket is not in an error state.
  COMMANDS_REQUIRE_DATA_SOCKET: {
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

export default Constants;
