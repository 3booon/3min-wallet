export type Screen = "import" | "wallet";
export type Status = "idle" | "loading" | "error";
export type Tab = "main" | "change";
export type WalletView = "dashboard" | "recent" | "explorer" | "receive" | "send";
export type ScriptType = "nested" | "native" | "taproot";

export interface UtxoStatus {
  confirmed: boolean;
  block_height: number | null;
  block_hash: string | null;
  block_time: number | null;
  confirmations?: number | null;
}

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: UtxoStatus;
}

export interface WalletUtxo {
  address: string;
  txid: string;
  vout: number;
  value: number;
  status: UtxoStatus;
}
