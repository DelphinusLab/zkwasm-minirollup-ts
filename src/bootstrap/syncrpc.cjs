const DEFAULT_URL = process.env.MERKLE_SERVER || "http://127.0.0.1:3030";

/**
 * Async JSON-RPC client for merkle db service.
 * Returns parsed JSON payload; throws on HTTP or RPC error.
 */
async function requestMerkleData(requestData) {
  const response = await fetch(DEFAULT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestData),
  });

  if (!response.ok) {
    throw new Error(`Merkle RPC failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(`Merkle RPC error: ${JSON.stringify(json.error)}`);
  }
  return json;
}

module.exports = requestMerkleData;
