// Loaded with `node --import`. Every network entry point records
// NETWORK_ATTEMPT on stderr and throws, so a test can prove nothing leaves the machine.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';

function blocked(what) {
  return function blockedCall() {
    process.stderr.write(`NETWORK_ATTEMPT ${what}\n`);
    throw new Error(`network blocked: ${what}`);
  };
}

net.Socket.prototype.connect = blocked('net.Socket.connect');
net.connect = blocked('net.connect');
net.createConnection = blocked('net.createConnection');
tls.connect = blocked('tls.connect');
http.request = blocked('http.request');
http.get = blocked('http.get');
https.request = blocked('https.request');
https.get = blocked('https.get');
dns.lookup = blocked('dns.lookup');
dns.promises.lookup = blocked('dns.promises.lookup');
globalThis.fetch = blocked('fetch');
syncBuiltinESMExports();
