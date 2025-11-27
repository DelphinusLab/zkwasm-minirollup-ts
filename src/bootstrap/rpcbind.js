import fetch from 'sync-fetch';
let url = 'http://127.0.0.1:3030';
import dotenv from 'dotenv';
dotenv.config();

// Load environment variables from .env file
if (process.env.MERKLE_SERVER) {
  url = process.env.MERKLE_SERVER;
}

console.log("rpc bind merkle server:", url);

function hash2array(hash) {
  const hasharray = [];
  for (let v of hash) {
    hasharray.push(v);
  }
  return hasharray;
}

function bigintArray2array(hash) {
  const hasharray = [];
  for (let v of hash) {
    hasharray.push(v.toString());
  }
  return hasharray;
}

function callMerkle(method, params) {
  const requestData = {
    jsonrpc: '2.0',
    method,
    params,
    id: 1
  };
  const response = fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(requestData)
  });
  if (!response.ok) {
    throw Error(`Merkle RPC failed: ${response.statusText}`);
  }
  const json = response.json();
  if (json.error) {
    throw Error(`Merkle RPC error: ${JSON.stringify(json.error)}`);
  }
  return json.result;
}

function async_get_leaf(root, index) {
  const roothash = hash2array(root);
  return callMerkle('get_leaf', {root: roothash, index: index.toString()});
}

export function get_leaf(root, index) {
  const start = performance.now();
  const data = async_get_leaf(root, index);
  const end = performance.now();
  const lag = end - start;
  //console.log("bench-log: get_leaf", lag);
  return data;
}

function async_update_leaf(root, index, data) {
  const roothash = hash2array(root);
  const datahash = hash2array(data);
  return callMerkle('update_leaf', {root: roothash, index: index.toString(), data: datahash});
}
export function update_leaf(root, index, data) {
  const start = performance.now();
  const r = async_update_leaf(root, index, data);
  const end = performance.now();
  const lag = end - start;
  //console.log("bench-log: update_leaf", lag);
  return r;
}

function async_update_record(hash, data) {
  const roothash = hash2array(hash);
  const datavec = bigintArray2array(data);
  return callMerkle('update_record', {hash: roothash, data: datavec});
}

export function update_record(hash, data) {
  const start = performance.now();
  const r = async_update_record(hash, data);
  const end = performance.now();
  const lag = end - start;
  //console.log("bench-log: update_record", lag);
  return r;
}

function async_get_record(hash) {
  const hasharray = hash2array(hash);
  const response = callMerkle('get_record', {hash: hasharray});
  return response.map((x) => BigInt(x));
}

export function get_record(hash) {
  const start = performance.now();
  const r = async_get_record(hash);
  const end = performance.now();
  const lag = end - start;
  //console.log("bench-log: update_record", lag);
  return r;
}

