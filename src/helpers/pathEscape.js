const pathEscape = (text) => {
  // Rules for quoting: RFC 959 -> Appendix II -> Directory Commands
  // (http://www.w3.org/Protocols/rfc959/A2_DirectoryCommands.html)
  // -> Reply Codes -> search for "embedded double-quotes"
  return text.replace(/"/g, '""');
};

export default pathEscape;
