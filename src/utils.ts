export function satsToBtc(sats: number): string {
  return (sats / 1e8).toFixed(8);
}

export function shortTxid(txid: string): string {
  if (!txid) return "";
  if (txid.length < 16) return txid;
  return `${txid.slice(0, 8)}...${txid.slice(-8)}`;
}

export function shortAddr(addr?: string | null): string {
  if (!addr) return "Unknown";
  // If we want to shorten it: return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
  // But previously TxDetailPanel returned the full address. 
  // Let's return the full address for now, or maybe the name implies shortening?
  // Let's shorten it, as the name is shortAddr.
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
}

export function fmtTimeDateOnly(ts?: number | null): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString();
}

export function fmtTimeWithTime(ts?: number | null): string {
  if (!ts) return "Pending";
  return new Date(ts * 1000).toLocaleString();
}
