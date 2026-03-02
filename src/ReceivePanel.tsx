import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import "./ReceivePanel.css";

type AddressType = "main" | "change";

interface ReceivePanelProps {
  scriptType: string;
  account: string;
  mainAddresses: string[];
  changeAddresses: string[];
  /** 미사용 주소 index (백엔드 연동 후 채울 예정) */
  suggestedMainIndex?: number;
  suggestedChangeIndex?: number;
  /** 미사용 주소 탐색 중 여부 */
  suggestedLoading?: boolean;
  onLoadMore?: (type: AddressType) => Promise<void>;
  loadingMore?: boolean;
}

export default function ReceivePanel({
  scriptType,
  account,
  mainAddresses,
  changeAddresses,
  suggestedMainIndex = 0,
  suggestedChangeIndex = 0,
  suggestedLoading = false,
  onLoadMore,
  loadingMore = false,
}: ReceivePanelProps) {
  const { t } = useTranslation();
  const [addrType, setAddrType] = useState<AddressType>("main");
  const [selectedIndex, setSelectedIndex] = useState<number>(suggestedMainIndex);
  const [copied, setCopied] = useState(false);

  // 로딩 완료 후 suggestedIndex가 확정되면 selectedIndex를 자동 업데이트
  useEffect(() => {
    if (!suggestedLoading) {
      setSelectedIndex(addrType === "main" ? suggestedMainIndex : suggestedChangeIndex);
    }
  }, [suggestedLoading, suggestedMainIndex, suggestedChangeIndex]);

  // 처음 Receive 탭 진입 시 선택 주소로 한 번만 스크롤
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const hasScrolled = useRef(false);

  useEffect(() => {
    if (hasScrolled.current) return;         // 이미 스크롤했으면 무시
    if (suggestedLoading) return;            // 탐색 완료 전엔 대기
    const el = itemRefs.current[selectedIndex];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    hasScrolled.current = true;
  }, [suggestedLoading, selectedIndex]);

  const addresses = addrType === "main" ? mainAddresses : changeAddresses;
  const suggested = addrType === "main" ? suggestedMainIndex : suggestedChangeIndex;
  const address = addresses[selectedIndex] ?? null;

  function handleTypeChange(type: AddressType) {
    setAddrType(type);
    setSelectedIndex(type === "main" ? suggestedMainIndex : suggestedChangeIndex);
    setCopied(false);
  }

  function handleCopy() {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const derivPath =
    addrType === "main"
      ? `m/${scriptType === "taproot" ? "86'" : scriptType === "nested" ? "49'" : "84'"}/0'/${account}/0/`
      : `m/${scriptType === "taproot" ? "86'" : scriptType === "nested" ? "49'" : "84'"}/0'/${account}/1/`;

  return (
    <main className="receive-panel">
      {/* ── Header ── */}
      <div className="receive-header">
        <div className="receive-title-row">
          <h2>{t("receive.title")}</h2>
          <span className="receive-subtitle">
            {t("receive.subtitle")}
          </span>
        </div>

        <div className="receive-type-toggle">
          <button
            className={`rtt-btn ${addrType === "main" ? "active" : ""}`}
            onClick={() => handleTypeChange("main")}
          >
            {t("receive.typeMain")}
          </button>
          <button
            className={`rtt-btn ${addrType === "change" ? "active" : ""}`}
            onClick={() => handleTypeChange("change")}
          >
            {t("receive.typeChange")}
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="receive-body">
        {/* QR code container */}
        <div className="qr-card">
          {address ? (
            <div className="qr-bg-white">
              <QRCodeSVG
                value={`bitcoin:${address}`}
                size={176}
                bgColor={"#ffffff"}
                fgColor={"#000000"}
                level={"M"}
                marginSize={1}
              />
            </div>
          ) : (
            <div className="qr-placeholder">
              <div className="qr-inner">
                <span className="qr-icon">⬛</span>
                <span className="qr-label">{t("receive.qrCode")}</span>
                <span className="qr-note">{t("receive.loadingAddress")}</span>
              </div>
            </div>
          )}

          {/* Address display */}
          <div className="receive-address-box">
            {address ? (
              <code className="receive-address-text">{address}</code>
            ) : (
              <span className="receive-address-empty">
                {t("receive.pleaseSelect")}
              </span>
            )}
          </div>

          {/* Copy button */}
          <button
            className={`copy-btn ${copied ? "copied" : ""}`}
            onClick={handleCopy}
            disabled={!address}
          >
            {copied ? (
              <>
                <span className="copy-icon">✓</span> {t("receive.copied")}
              </>
            ) : (
              <>
                <span className="copy-icon">⎘</span> {t("receive.copyAddress")}
              </>
            )}
          </button>
        </div>

        {/* ── Address selector ── */}
        <div className="address-selector-card">
          <div className="as-header">
            <span className="as-title">{t("receive.selectAddress")}</span>
            <span className="as-deriv">{derivPath}*</span>
          </div>

          {/* Address list */}
          <div className="as-list">
            {addresses.length === 0 ? (
              <div className="as-empty">{t("receive.loadingAddresses")}</div>
            ) : (
              addresses.map((addr, i) => (
                <button
                  key={addr}
                  ref={(el) => { itemRefs.current[i] = el; }}
                  className={`as-item ${selectedIndex === i ? "active" : ""}`}
                  onClick={() => { setSelectedIndex(i); setCopied(false); }}
                >
                  <span className="as-item-index">#{i}</span>
                  {!suggestedLoading && (
                    i < suggested
                      ? <span className="as-item-badge used">{t("receive.used")}</span>
                      : <span className="as-item-badge unused">{t("receive.unused")}</span>
                  )}
                  <code className="as-item-addr">
                    {addr}
                  </code>
                  {selectedIndex === i && (
                    <span className="as-item-check">✓</span>
                  )}
                </button>
              ))
            )}
            {onLoadMore && (
              <div 
                className="as-load-more"
              >
                <button 
                  className={`load-more-btn ${loadingMore ? "loading" : ""}`} 
                  onClick={() => onLoadMore(addrType)} 
                  disabled={loadingMore}
                >
                  {loadingMore ? t("app.loading") : t("receive.loadMoreAddresses")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
