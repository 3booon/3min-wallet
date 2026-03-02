import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { UR } from "@ngraveio/bc-ur";
import { decodeCBORBytes } from "./bitcoinUtils";
import { Buffer } from "buffer";

interface SendBroadcasterProps {
  scannedUR: UR;
  onCancel: () => void;
  onDone: () => void;
}

export default function SendBroadcaster({ scannedUR, onCancel, onDone }: SendBroadcasterProps) {
  const { t } = useTranslation();
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  const handleBroadcast = async () => {
    setIsBroadcasting(true);
    setBroadcastError(null);
    try {
      const cborBody = scannedUR.cbor; 
      const rawPsbtBuffer = decodeCBORBytes(Buffer.from(cborBody));
      const payloadBytes = Array.from(rawPsbtBuffer);
      const txid = await invoke<string>("cmd_broadcast_psbt", { psbtBytes: payloadBytes });
      setBroadcastTxid(txid);
    } catch (e: any) {
      console.error(e);
      setBroadcastError(String(e));
    } finally {
      setIsBroadcasting(false);
    }
  };

  return (
    <main className="send-panel psbt-view">
      <div className="send-header">
        <div className="send-title-row psbt-title-row">
          <button className="back-btn" onClick={onCancel} disabled={isBroadcasting}>
            ← Back
          </button>
          <h2>{t("send.confirmBroadcastTitle")}</h2>
        </div>
      </div>
      <div className="psbt-qr-container result-container psbt-qr-container-wide">
        {isBroadcasting ? (
          <>
            <div className="spinner-lg spinner-lg-custom"></div>
            <h3 className="psbt-qr-title mt-20">{t("send.broadcasting")}</h3>
          </>
        ) : broadcastTxid ? (
          <>
            <div className="success-icon success-icon-lg">✅</div>
            <h3 className="psbt-qr-title green">{t("send.transactionSent")}</h3>
            <p className="psbt-qr-desc mt-10">{t("send.transactionSentDesc")}</p>
            <div className="txid-box">
              <p className="send-label">{t("send.transactionId")}</p>
              <code className="txid-code txid-code-custom">
                {broadcastTxid}
              </code>
            </div>
            
            <button className="send-generate-btn enabled" style={{ marginTop: 20 }} onClick={onDone}>
              {t("send.done")}
            </button>
          </>
        ) : (
          <>
            {broadcastError ? (
              <>
                <div className="error-icon error-icon-lg">❌</div>
                <h3 className="psbt-qr-title red">{t("send.broadcastFailed")}</h3>
                <p className="psbt-qr-desc red">{broadcastError}</p>
              </>
            ) : (
              <>
                <h3 className="psbt-qr-title orange">{t("send.finalReview")}</h3>
                <p className="psbt-qr-desc mb-20">{t("send.broadcastWarning")}</p>
              </>
            )}

            {!broadcastTxid && (
              <div className="action-buttons-flex">
                <button 
                  className="send-generate-btn enabled cancel-broadcast-btn" 
                  onClick={onCancel}
                >
                  {t("send.cancelBroadcast")}
                </button>
                <button 
                  className="send-generate-btn enabled" 
                  onClick={handleBroadcast}
                >
                  {t("send.broadcastTransaction")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
