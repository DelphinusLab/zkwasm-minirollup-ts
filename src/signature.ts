import { LeHexBN } from "zkwasm-minirollup-rpc";

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function hexLeToU64Array(hex: string, wordCount: number): BigUint64Array {
  let raw = strip0x(hex);
  if (raw.length % 2 !== 0) {
    raw = `0${raw}`;
  }

  const out = new BigUint64Array(wordCount);
  for (let i = 0; i < wordCount; i++) {
    const chunk = raw.slice(i * 16, i * 16 + 16);
    if (!chunk) break;
    const buf = Buffer.from(chunk.padEnd(16, "0"), "hex");
    out[i] = buf.readBigUint64LE(0);
  }
  return out;
}

export function signatureToU64ArrayCompat(value: any): BigUint64Array {
  const msgHex = strip0x(value.msg ?? "");
  const msgWordCount = Math.ceil(msgHex.length / 16);

  const msg = new LeHexBN(value.msg).toU64Array(msgWordCount);
  const pkx = new LeHexBN(value.pkx).toU64Array();
  const pky = new LeHexBN(value.pky).toU64Array();
  const sigx = new LeHexBN(value.sigx).toU64Array();
  const sigy = new LeHexBN(value.sigy).toU64Array();
  const sigr = new LeHexBN(value.sigr).toU64Array();

  const u64array = new BigUint64Array(20 + msgWordCount);
  u64array.set(pkx, 0);
  u64array.set(pky, 4);
  u64array.set(sigx, 8);
  u64array.set(sigy, 12);
  u64array.set(sigr, 16);
  u64array.set(msg, 20);
  const cmdLength = (msg[0] >> 8n) & 0xffn;
  if (Number(cmdLength) !== msg.length) {
    throw Error("Wrong Command Size");
  }
  return u64array;
}

export function signatureToU64ArrayFast(value: any): BigUint64Array {
  const msgHex = strip0x(value.msg ?? "");
  const msgWordCount = Math.ceil(msgHex.length / 16);

  const msg = hexLeToU64Array(value.msg, msgWordCount);
  const pkx = hexLeToU64Array(value.pkx, 4);
  const pky = hexLeToU64Array(value.pky, 4);
  const sigx = hexLeToU64Array(value.sigx, 4);
  const sigy = hexLeToU64Array(value.sigy, 4);
  const sigr = hexLeToU64Array(value.sigr, 4);

  const u64array = new BigUint64Array(20 + msgWordCount);
  u64array.set(pkx, 0);
  u64array.set(pky, 4);
  u64array.set(sigx, 8);
  u64array.set(sigy, 12);
  u64array.set(sigr, 16);
  u64array.set(msg, 20);
  const cmdLength = (msg[0] >> 8n) & 0xffn;
  if (Number(cmdLength) !== msg.length) {
    throw Error("Wrong Command Size");
  }
  return u64array;
}

export function signature_to_u64array(value: any): BigUint64Array {
  if (process.env.SIG_U64_PARSER === "compat") {
    return signatureToU64ArrayCompat(value);
  }
  return signatureToU64ArrayFast(value);
}
