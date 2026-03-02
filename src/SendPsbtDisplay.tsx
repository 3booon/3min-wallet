import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { UR, UREncoder } from "@ngraveio/bc-ur";
import { QRCodeSVG } from "qrcode.react";
import { encodeCBORBytes } from "./bitcoinUtils";
import { Buffer } from "buffer";

type QrDensity = "low" | "medium" | "high";

interface SendPsbtDisplayProps {
  currentPsbtBytes: number[];
  onCancel: () => void;
  onScanClick: () => void;
}

export default function SendPsbtDisplay({ currentPsbtBytes, onCancel, onScanClick }: SendPsbtDisplayProps) {
  const { t } = useTranslation();
  const [qrDensity, setQrDensity] = useState<QrDensity>("medium");
  const [qrFrameIndex, setQrFrameIndex] = useState(0);
  const [currentQrFrame, setCurrentQrFrame] = useState<string>("");
  const [totalQrFrames, setTotalQrFrames] = useState(1);
  const urEncoderRef = useRef<UREncoder | null>(null);

  useEffect(() => {
    if (currentPsbtBytes) {
      const psbtBuffer = Buffer.from(currentPsbtBytes);
      const cborBuffer = encodeCBORBytes(psbtBuffer);
      const ur = new UR(cborBuffer, "crypto-psbt");
      
      const fragmentSize = qrDensity === "low" ? 50 : qrDensity === "medium" ? 120 : 250;
      const encoder = new UREncoder(ur, fragmentSize);
      
      urEncoderRef.current = encoder;
      setCurrentQrFrame(encoder.nextPart());
      setTotalQrFrames(encoder.fragmentsLength);
      setQrFrameIndex(0);
    }
  }, [currentPsbtBytes, qrDensity]);

  useEffect(() => {
    if (urEncoderRef.current) {
      const interval = setInterval(() => {
        const part = urEncoderRef.current!.nextPart();
        setCurrentQrFrame(part);
        setQrFrameIndex((prev) => (prev + 1) % totalQrFrames);
      }, 600);
      return () => clearInterval(interval);
    }
  }, [totalQrFrames, qrDensity]);

  return (
    <main className="send-panel psbt-view">
      <div className="send-header">
        <div className="send-title-row psbt-title-row">
          <button className="back-btn" onClick={onCancel}>
            ← Back
          </button>
          <h2>{t("send.scanWithHardware")}</h2>
        </div>
      </div>
      <div className="psbt-qr-container">
        <div className="qr-density-controls">
          <span className="density-label">QR Density:</span>
          <button className={`density-btn ${qrDensity === "low" ? "active" : ""}`} onClick={() => setQrDensity("low")}>Low</button>
          <button className={`density-btn ${qrDensity === "medium" ? "active" : ""}`} onClick={() => setQrDensity("medium")}>Med</button>
          <button className={`density-btn ${qrDensity === "high" ? "active" : ""}`} onClick={() => setQrDensity("high")}>High</button>
        </div>
        
        <div className="qr-wrapper">
          <QRCodeSVG 
            value={currentQrFrame} 
            size={qrDensity === "low" ? 280 : qrDensity === "medium" ? 340 : 400} 
            level="L" 
            includeMargin={true}
            bgColor="#ffffff"
            fgColor="#000000"
          />
        </div>
        <p className="qr-frame-indicator">{qrFrameIndex + 1} / {totalQrFrames}</p>
        <p className="psbt-help-text">{t("send.scanThisQR")}</p>

        <button className="scan-btn scan-signed-btn" onClick={onScanClick}>
          {t("send.scanSignedResult")}
        </button>
      </div>
    </main>
  );
}
