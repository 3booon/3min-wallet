import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";
import { URDecoder, UR } from "@ngraveio/bc-ur";
import { useTranslation } from "react-i18next";
import "./App.css";
import "./QrScannerModal.css";

interface QrScannerModalProps {
  onScan: (text: string, ur?: UR) => void;
  onClose: () => void;
}

export default function QrScannerModal({ onScan, onClose }: QrScannerModalProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const urDecoderRef = useRef<URDecoder>(new URDecoder());
  const [error, setError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState(0);

  useEffect(() => {
    let controls: any = null;
    let isMounted = true;

    async function startCamera() {
      try {
        const codeReader = new BrowserQRCodeReader();
        const videoInputDevices = await BrowserQRCodeReader.listVideoInputDevices();

        if (videoInputDevices.length === 0) {
          throw new Error("No camera found");
        }

        // Ideally use the back camera on mobile, or just the first on desktop
        const selectedDeviceId = videoInputDevices[0].deviceId;

        if (videoRef.current && isMounted) {
          controls = await codeReader.decodeFromVideoDevice(
            selectedDeviceId,
            videoRef.current,
            (result, err) => {
              if (result && isMounted) {
                const text = result.getText().trim();
                const lowerText = text.toLowerCase();
                if (lowerText.startsWith("ur:")) {
                  try {
                      urDecoderRef.current.receivePart(lowerText);
                      setScanProgress(urDecoderRef.current.estimatedPercentComplete());
                      if (urDecoderRef.current.isComplete()) {
                        if (urDecoderRef.current.isSuccess()) {
                          onScan(text, urDecoderRef.current.resultUR());
                        } else {
                          setError(urDecoderRef.current.resultError());
                        }
                      }
                    } catch (e) {
                      // Ignore transient decode errors for UR frames
                      console.debug("Transient UR decode error:", e);
                    }
                  } else {
                    // Static QR code
                    onScan(text);
                  }
              }
              if (err && err.name !== "NotFoundException" && err.name !== "ChecksumException" && err.name !== "FormatException") {
                 console.debug("QR Scan Error:", err);
              }
            }
          );
        }
      } catch (err: any) {
        if (isMounted) {
          setError(t("app.cameraPermissionError", { defaultValue: "Camera access error: " }) + err.message);
        }
      }
    }

    startCamera();

    return () => {
      isMounted = false;
      if (controls) {
        controls.stop();
      }
    };
  }, [onScan, t]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-content qr-modal-content" 
        onClick={(e) => e.stopPropagation()} 
      >
        <button 
          className="modal-close qr-modal-close-btn" 
          onClick={onClose}
        >&times;</button>
        <h2 className="qr-modal-title">{t("app.scanQr", { defaultValue: "Scan QR Code" })}</h2>
        
        {error ? (
          <div className="message error qr-modal-error">
            {error}
          </div>
        ) : (
          <div className="qr-video-container">
             <video 
              ref={videoRef} 
              className="qr-video-element" 
            />
            {/* Simple scanning reticle/overlay */}
            <div className="qr-reticle"></div>
            {scanProgress > 0 && scanProgress < 1 && (
              <div className="qr-scan-progress">
                Reading frames... {Math.round(scanProgress * 100)}%
                <div 
                  className="qr-progress-bar"
                  style={{ width: `${scanProgress * 100}%` }}
                ></div>
              </div>
            )}
          </div>
        )}
        
        <div className="qr-help-text">
          <div>{t("app.qrHelpKeystone")}</div>
          <div>{t("app.qrHelpSeedSigner")}</div>
        </div>

        <button className="submit-btn qr-close-btn-bottom" onClick={onClose}>
          {t("app.closeScanner", { defaultValue: "Close Scanner" })}
        </button>
      </div>
    </div>
  );
}
