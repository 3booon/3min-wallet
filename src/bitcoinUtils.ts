import { Buffer } from "buffer";

export function validateBitcoinAddress(addr: string): string | null {
  if (!addr) return null;
  const lower = addr.toLowerCase();
  // bech32 (P2WPKH): bc1q...
  if (lower.startsWith("bc1q") && addr.length >= 42 && addr.length <= 62) return null;
  // bech32m (P2TR): bc1p...
  if (lower.startsWith("bc1p") && addr.length >= 62 && addr.length <= 64) return null;
  // P2PKH: 1...
  if (addr.startsWith("1") && addr.length >= 25 && addr.length <= 34) return null;
  // P2SH: 3...
  if (addr.startsWith("3") && addr.length >= 25 && addr.length <= 34) return null;
  return "send.invalidAddress";
}

export function validateAmount(val: string): string | null {
  const n = parseFloat(val);
  if (val && (isNaN(n) || n <= 0)) return "send.invalidAmount";
  return null;
}

// ── CBOR 인코딩 헬퍼 ──────────────────────────────────────────
export function encodeCBORBytes(buffer: Buffer): Buffer {
  const len = buffer.length;
  let header: Buffer;
  if (len <= 23) {
    header = Buffer.from([0x40 + len]);
  } else if (len <= 255) {
    header = Buffer.from([0x58, len]);
  } else if (len <= 65535) {
    header = Buffer.alloc(3);
    header[0] = 0x59;
    header.writeUInt16BE(len, 1);
  } else if (len <= 4294967295) {
    header = Buffer.alloc(5);
    header[0] = 0x5a;
    header.writeUInt32BE(len, 1);
  } else {
    throw new Error("Buffer too large");
  }
  return Buffer.concat([header, buffer]);
}

// ── CBOR 디코딩 헬퍼 ──────────────────────────────────────────
export function decodeCBORBytes(cborBuffer: Buffer): Buffer {
  if (cborBuffer.length === 0) return cborBuffer;
  const typeAndArg = cborBuffer[0];
  const majorType = typeAndArg >> 5;
  if (majorType !== 2) {
    return cborBuffer;
  }

  const arg = typeAndArg & 0x1f;
  let offset = 1;

  if (arg <= 23) {
    // length is arg
  } else if (arg === 24) {
    offset += 1;
  } else if (arg === 25) {
    offset += 2;
  } else if (arg === 26) {
    offset += 4;
  } else if (arg === 27) {
    offset += 8;
  } else {
    throw new Error("Invalid CBOR byte string length format");
  }

  return Buffer.from(cborBuffer.subarray(offset));
}

// ── 트랜잭션 vBytes 추정 상수 ─────────────────────────────────
export type AddressType = "P2PKH" | "P2SH" | "P2WPKH" | "P2WSH" | "P2TR";

export const INPUT_WEIGHTS: Record<AddressType, number> = {
  P2PKH: 148,
  P2SH: 91,    // Nested Segwit (P2SH-P2WPKH)
  P2WPKH: 68,  // Native Segwit
  P2WSH: 105,  // Native Segwit Multisig
  P2TR: 58,    // Taproot (keypath)
};

export const OUTPUT_WEIGHTS: Record<AddressType, number> = {
  P2PKH: 34,
  P2SH: 32,    // Nested Segwit (P2SH-P2WPKH)
  P2WPKH: 31,  // Native Segwit
  P2WSH: 43,   // Native Segwit Multisig
  P2TR: 43,    // Taproot
};

export const BASE_TX_WEIGHT = 11;

export function estimateVbytes(inputTypes: AddressType[], outputTypes: AddressType[]): number {
  const inputsWeight = inputTypes.reduce((sum, type) => sum + (INPUT_WEIGHTS[type] || INPUT_WEIGHTS.P2WPKH), 0);
  const outputsWeight = outputTypes.reduce((sum, type) => sum + (OUTPUT_WEIGHTS[type] || OUTPUT_WEIGHTS.P2WPKH), 0);
  return BASE_TX_WEIGHT + inputsWeight + outputsWeight;
}

export function inferAddressType(addr: string): AddressType {
  if (!addr) return "P2WPKH";
  const lower = addr.toLowerCase();
  
  if (lower.startsWith("bc1q") && addr.length >= 42 && addr.length <= 62) {
    return addr.length > 42 ? "P2WSH" : "P2WPKH";
  }
  if (lower.startsWith("bc1p") && addr.length >= 62 && addr.length <= 64) {
    return "P2TR";
  }
  if (addr.startsWith("3") && addr.length >= 25 && addr.length <= 34) {
    return "P2SH";
  }
  if (addr.startsWith("1") && addr.length >= 25 && addr.length <= 34) {
    return "P2PKH";
  }
  return "P2WPKH";
}
