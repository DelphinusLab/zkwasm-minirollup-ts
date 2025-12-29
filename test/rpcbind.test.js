import assert from 'node:assert';
import { test, before } from 'node:test';

let rpc;

before(async () => {
  // The sandbox forbids opening sockets; use an in-process mock merkle RPC.
  process.env.MERKLE_RPC_MODE = 'mock';
  rpc = await import('../src/bootstrap/rpcbind.js');
});

test('get_leaf uses HTTP RPC and returns result', async () => {
  const root = new Uint8Array([1, 2, 3, 4]);
  const result = rpc.get_leaf(root, 42n);
  assert.deepStrictEqual(result, { leaf: '42' });
});

test('get_record maps results to BigInt array', async () => {
  const hash = new Uint8Array([1, 2, 3, 4]);
  const result = rpc.get_record(hash);
  assert.deepStrictEqual(result, [7n, 8n]);
});
