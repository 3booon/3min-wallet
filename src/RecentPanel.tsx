import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import TxDetailPanel, { Tx } from "./TxDetailPanel";
import "./RecentPanel.css";

export interface RecentTx {
  address: string;
  tx: Tx;
}

interface Props {
  recentTxs: RecentTx[];
  loading: boolean;
  error: string | null;
  allAddresses: string[];  // main + change addresses (자기 이체 판별용)
  onRefresh: () => void;
}

type FilterPeriod = "7d" | "30d";

import { satsToBtc, shortTxid, fmtTimeDateOnly, fmtTimeWithTime } from "./utils";

const PERIOD_SECONDS: Record<FilterPeriod, number> = {
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
};

export default function RecentPanel({ recentTxs, loading, error, allAddresses, onRefresh }: Props) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<FilterPeriod>("7d");
  const [selectedTx, setSelectedTx] = useState<{ tx: Tx; address: string } | null>(null);

  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff = nowSec - PERIOD_SECONDS[period];

  const filtered = useMemo(() => {
    return recentTxs.filter((item) => {
      // pending txs (no block_time) are always shown
      if (!item.tx.status.block_time) return true;
      return item.tx.status.block_time >= cutoff;
    });
  }, [recentTxs, cutoff]);

  function renderContent() {
    if (loading) {
      return (
        <div className="recent-loading">
          <span className="spinner" />
          <span>{t("recent.fetching")}</span>
        </div>
      );
    }
    if (error) {
      return (
        <div className="recent-error">
          <span>⚠️</span>
          <p>{error}</p>
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className="recent-empty">
          <span>📋</span>
          <p>{t("recent.noTxs")}</p>
        </div>
      );
    }

    return (
      <div className="recent-tx-list">
        {filtered.map((item) => {
          const { tx, address } = item;
          const myOutputs = tx.vout.filter((v) => v.scriptpubkey_address === address);
          const myInputs = tx.vin.filter((v) => v.prevout?.scriptpubkey_address === address);
          const received = myOutputs.reduce((s, v) => s + v.value, 0);
          const spent = myInputs.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
          const netChange = received - spent;
          const confs = tx.status.confirmations ?? (tx.status.confirmed ? 6 : 0);

          // TX 종류 판별 — 전체 지갑 주소(잔돈 주소 포함) 기준
          const addrSet = new Set(allAddresses);
          const hasMine_in = tx.vin.some((v) => v.prevout?.scriptpubkey_address && addrSet.has(v.prevout.scriptpubkey_address));
          const hasMine_out = tx.vout.some((v) => v.scriptpubkey_address && addrSet.has(v.scriptpubkey_address));
          const txType: "received" | "sent" | "self" =
            hasMine_in && hasMine_out ? "self"
            : hasMine_out ? "received"
            : "sent";

          const TxIcon = () => {
            if (txType === "received") {
              return (
                <span className="tx-type-icon received" title="Received">
                  {/* 아래쪽 화살표 */}
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                    <path fillRule="evenodd" d="M10 3a.75.75 0 0 1 .75.75v10.638l3.96-4.158a.75.75 0 1 1 1.08 1.04l-5.25 5.5a.75.75 0 0 1-1.08 0l-5.25-5.5a.75.75 0 1 1 1.08-1.04l3.96 4.158V3.75A.75.75 0 0 1 10 3Z" clipRule="evenodd" />
                  </svg>
                </span>
              );
            }
            if (txType === "sent") {
              return (
                <span className="tx-type-icon sent" title="Sent">
                  {/* 위쪽 화살표 */}
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                    <path fillRule="evenodd" d="M10 17a.75.75 0 0 1-.75-.75V5.612L5.29 9.77a.75.75 0 0 1-1.08-1.04l5.25-5.5a.75.75 0 0 1 1.08 0l5.25 5.5a.75.75 0 1 1-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0 1 10 17Z" clipRule="evenodd" />
                  </svg>
                </span>
              );
            }
            // self
            return (
              <span className="tx-type-icon self" title="Self (UTXO consolidation)">
                {/* 회전 화살표 */}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                  <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V3.198a.75.75 0 0 0-1.5 0v2.363l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
                </svg>
              </span>
            );
          };

          return (
            <button
              key={tx.txid}
              className="recent-tx-item"
              onClick={() => setSelectedTx({ tx, address })}
            >
              <div className="recent-tx-top">
                <div className="recent-tx-left">
                  <TxIcon />
                  <code className="recent-tx-txid">{shortTxid(tx.txid)}</code>
                  {(() => {
                    if (confs >= 6) {
                      return <span className="recent-badge confirmed">✓</span>;
                    } else if (confs > 0) {
                      return <span className="recent-badge confirming">{confs}/6</span>;
                    } else {
                      return <span className="recent-badge unconfirmed">⏳</span>;
                    }
                  })()}
                </div>
                {txType === "self" ? (
                  <span className="recent-net-change self">
                    {tx.fee != null
                      ? `fee: ${tx.fee.toLocaleString()} sats`
                      : "Self Transfer"}
                  </span>
                ) : (
                  <span className={`recent-net-change ${netChange >= 0 ? "positive" : "negative"}`}>
                    {netChange >= 0 ? "+" : ""}{satsToBtc(netChange)} BTC
                  </span>
                )}
              </div>

              <div className="recent-tx-bottom">
                <span className="recent-tx-addr" title={address}>
                  {address.slice(0, 12)}…{address.slice(-6)}
                </span>
                {tx.status.block_time ? (
                  <span className="recent-tx-date" title={fmtTimeWithTime(tx.status.block_time)}>
                    {fmtTimeDateOnly(tx.status.block_time)}
                  </span>
                ) : (
                  <span className="recent-tx-date pending">{t("app.pending").replace("⏳ ", "")}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <main className="recent-panel">
      {/* Header */}
      <div className="recent-header">
        <div className="recent-title-row">
          <h2>{t("recent.title")}</h2>
          <span className="recent-count">
            {!loading && !error && `${filtered.length} txs`}
          </span>
        </div>

        {/* Filter tabs + Refresh */}
        <div className="recent-filter-bar">
          {(["7d", "30d"] as FilterPeriod[]).map((p) => (
            <button
              key={p}
              className={`recent-filter-btn ${period === p ? "active" : ""}`}
              onClick={() => setPeriod(p)}
            >
              {t(`recent.filter${p === "7d" ? "7d" : "30d"}`)}
            </button>
          ))}
          <button
            className={`recent-refresh-btn ${loading ? "spinning" : ""}`}
            onClick={onRefresh}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh recent transactions"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
              <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V3.198a.75.75 0 0 0-1.5 0v2.363l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="recent-body">{renderContent()}</div>

      {/* TX Detail modal */}
      {selectedTx && (
        <TxDetailPanel
          tx={selectedTx.tx}
          watchAddress={selectedTx.address}
          onClose={() => setSelectedTx(null)}
        />
      )}
    </main>
  );
}
