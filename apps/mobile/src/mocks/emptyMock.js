module.exports = {
  connect: () => ({ on: () => {}, once: () => {}, write: () => {}, end: () => {}, destroy: () => {} }),
  createConnection: () => ({ on: () => {}, once: () => {}, write: () => {}, end: () => {}, destroy: () => {} }),
  Server: class Server { listen() {} close() {} on() {} },
  Socket: class Socket { connect() {} on() {} once() {} write() {} end() {} destroy() {} },
  isIP: () => 0,
  isIPv4: () => false,
  isIPv6: () => false,
};
