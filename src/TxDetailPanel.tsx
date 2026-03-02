import "./TxDetailPanel.css";
import { useTranslation } from "react-i18next";

interface Prevout {
  scriptpubkey_address?: string | null;
  scriptpubkey_type?: string | null;
  value?: number | null;
}

interface Vin {
  txid?: string | null;
  vout?: number | null;
  is_coinbase?: boolean | null;
  prevout?: Prevout | null;
}

interface Vout {
  scriptpubkey_address?: string | null;
  scriptpubkey_type?: string | null;
  value: number;
}

interface TxStatus {
  confirmed: boolean;
  block_height?: number | null;
  block_time?: number | null;
  confirmations?: number | null;
}

export interface Tx {
  txid: string;
  fee?: number | null;
  size?: number | null;
  weight?: number | null;
  status: TxStatus;
  vin: Vin[];
  vout: Vout[];
}

interface Props {
  tx: Tx;
  watchAddress: string;
  network?: string;
  onClose: () => void;
}

import { satsToBtc, shortAddr, fmtTimeWithTime } from "./utils";

export default function TxDetailPanel({ tx, watchAddress, network = "bitcoin", onClose }: Props) {
  const { t } = useTranslation();
  const totalIn = tx.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
  const totalOut = tx.vout.reduce((s, v) => s + v.value, 0);

  return (
    <div className="txpanel-overlay" onClick={onClose}>
      <div className="txpanel" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="txpanel-header">
          <div>
            <div className="txpanel-label">Transaction</div>
            <code className="txpanel-txid">{tx.txid}</code>
          </div>
          <button className="txpanel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* ── Status row ── */}
        <div className="txpanel-meta-row">
          {(() => {
            const confs = tx.status.confirmations ?? (tx.status.confirmed ? 6 : 0);
            if (confs >= 6) {
              return <span className="tx-badge confirmed">{t("app.confirmedStatus")}</span>;
            } else if (confs > 0) {
              return <span className="tx-badge confirming">{t("app.confirmingStatus", { conf: confs })}</span>;
            } else {
              return <span className="tx-badge unconfirmed">{t("app.pendingStatus")}</span>;
            }
          })()}
          {tx.status.block_height && (
            <span className="txpanel-meta-item">Block #{tx.status.block_height.toLocaleString()}</span>
          )}
          {tx.fee != null && (
            <span className="txpanel-meta-item">{tx.fee.toLocaleString()} sats fee</span>
          )}
          {tx.size != null && (
            <span className="txpanel-meta-item">{tx.size} vB</span>
          )}
          <span className="txpanel-meta-item">🕐 {fmtTimeWithTime(tx.status.block_time)}</span>
        </div>

        {/* ── Scrollable body ── */}
        <div className="txpanel-body">

          {/* ── Inputs & Outputs ── */}
          <div className="txpanel-section">
            <div className="txpanel-section-title">{t("app.inputs")} &amp; {t("app.outputs")}</div>

            <div className="io-grid">
              {/* Inputs column */}
              <div className="io-col">
                <div className="io-col-header">
                  <span>{t("app.inputs")}</span>
                  <span className="io-total">{satsToBtc(totalIn)} BTC</span>
                </div>
                {tx.vin.map((v, i) => (
                  <div
                    key={i}
                    className={`io-item input ${v.prevout?.scriptpubkey_address === watchAddress ? "watch" : ""}`}
                  >
                    <div className="io-addr">
                      {v.is_coinbase
                        ? <span className="io-tag coinbase">{t("app.coinbase")}</span>
                        : shortAddr(v.prevout?.scriptpubkey_address)}
                    </div>
                    <div className="io-val">
                      {v.prevout?.value != null ? `${satsToBtc(v.prevout.value)} BTC` : "—"}
                    </div>
                  </div>
                ))}
              </div>

              {/* Arrow */}
              <div className="io-arrow">→</div>

              {/* Outputs column */}
              <div className="io-col">
                <div className="io-col-header">
                  <span>{t("app.outputs")}</span>
                  <span className="io-total">{satsToBtc(totalOut)} BTC</span>
                </div>
                {tx.vout.map((v, i) => (
                  <div
                    key={i}
                    className={`io-item output ${v.scriptpubkey_address === watchAddress ? "watch" : ""}`}
                  >
                    <div className="io-addr">
                      {shortAddr(v.scriptpubkey_address)}
                      {v.scriptpubkey_address === watchAddress && (
                        <span className="io-tag mine">{t("app.mine")}</span>
                      )}
                    </div>
                    <div className="io-val">{satsToBtc(v.value)} BTC</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── External Explorer link ── */}
          <div className="txpanel-footer">
            <a
              href={`https://mempool.space/${network === 'bitcoin' ? '' : network + '/'}tx/${tx.txid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="txpanel-external-link"
            >
              {t("app.explorer", "View on Block Explorer")} ↗
            </a>
          </div>

        </div>{/* end .txpanel-body */}
      </div>
    </div>
  );
}

