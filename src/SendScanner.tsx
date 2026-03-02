import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { UR, URDecoder } from "@ngraveio/bc-ur";
import { BrowserQRCodeReader, IScannerControls } from "@zxing/browser";

interface SendScannerProps {
  onCancel: () => void;
  onScanComplete: (ur: UR) => void;
  onScanError: (error: string) => void;
}

export default function SendScanner({ onCancel, onScanComplete, onScanError }: SendScannerProps) {
  const { t } = useTranslation();
  const [scanProgress, setScanProgress] = useState(0);
  const [scanErrorMsg, setScanErrorMsg] = useState<string | null>(null);
  
  const urDecoderRef = useRef<URDecoder | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);

  useEffect(() => {
    urDecoderRef.current = new URDecoder();
    
    if (videoRef.current && !scannerControlsRef.current) {
      const codeReader = new BrowserQRCodeReader();
      codeReader.decodeFromVideoDevice(undefined, videoRef.current, async (result, _error, controls) => {
        scannerControlsRef.current = controls;

        if (result && urDecoderRef.current) {
          try {
            const qrText = result.getText();
            urDecoderRef.current.receivePart(qrText);
            setScanProgress(urDecoderRef.current.estimatedPercentComplete());
            
            if (urDecoderRef.current.isComplete()) {
              if (urDecoderRef.current.isSuccess()) {
                controls.stop();
                onScanComplete(urDecoderRef.current.resultUR());
              } else {
                setScanErrorMsg(urDecoderRef.current.resultError());
                controls.stop();
                onScanError(urDecoderRef.current.resultError());
              }
            }
          } catch (e: any) {
            console.error("Scan error", e);
          }
        }
      }).catch(err => {
        setScanErrorMsg(t("send.cameraError") + String(err));
      });
    }

    return () => {
      if (scannerControlsRef.current) {
        scannerControlsRef.current.stop();
        scannerControlsRef.current = null;
      }
    };
  }, [onScanComplete, onScanError, t]);

  return (
    <main className="send-panel psbt-view">
      <div className="send-header">
        <div className="send-title-row psbt-title-row">
          <button className="back-btn" onClick={onCancel}>
            ← Cancel Scanning
          </button>
          <h2>Scan Signed PSBT</h2>
        </div>
      </div>
      <div className="psbt-qr-container scan-container">
        <h3 className="psbt-qr-title">Show the Animated QR to your camera</h3>
        <p className="psbt-qr-desc">
          Reading frames... {Math.round(scanProgress * 100)}% complete
        </p>
        {scanErrorMsg && <p className="send-field-error">{scanErrorMsg}</p>}
        
        <div className="camera-box">
          <video ref={videoRef} className="camera-video" autoPlay playsInline muted />
        </div>

        <div className="scan-progress-bar">
          <div className="scan-progress-fill" style={{ width: `${scanProgress * 100}%` }}></div>
        </div>
      </div>
    </main>
  );
}
