import assert from 'node:assert';
import { once } from 'node:events';
import http from 'node:http';
import { test, before, after } from 'node:test';

let server;
let rpc;
const requests = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push(parsed);
      let result;
      switch (parsed.method) {
        case 'get_leaf':
          result = { leaf: parsed.params.index };
          break;
        case 'get_record':
          result = ['7', '8'];
          break;
        default:
          result = { ok: true };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  process.env.MERKLE_SERVER = `http://127.0.0.1:${port}`;
  rpc = await import('../src/bootstrap/rpcbind.js');
});

after(async () => {
  server.close();
  await once(server, 'close');
});

test('get_leaf uses HTTP RPC and returns result', () => {
  const root = new BigUint64Array([1n, 2n, 3n, 4n]);
  const result = rpc.get_leaf(root, 42n);
  assert.deepStrictEqual(result, { leaf: '42' });
  assert.strictEqual(requests.at(-1).method, 'get_leaf');
});

test('get_record maps results to BigInt array', () => {
  const hash = new Uint8Array([1, 2, 3, 4]);
  const result = rpc.get_record(hash);
  assert.deepStrictEqual(result, [7n, 8n]);
  assert.strictEqual(requests.at(-1).method, 'get_record');
});
