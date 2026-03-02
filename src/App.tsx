import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import "./App.css";
import customLogo from "./assets/app-icon.png";
import SettingsModal, { Settings, NetworkType } from "./SettingsModal";
import TxDetailPanel from "./TxDetailPanel";
import ReceivePanel from "./ReceivePanel";
import SendPanel from "./SendPanel";
import RecentPanel from "./RecentPanel";
import DashboardPanel from "./DashboardPanel";
import QrScannerModal from "./QrScannerModal";
import { CryptoAccount } from "@keystonehq/bc-ur-registry";
import bs58check from "bs58check";
import { Buffer } from "buffer";

import { Screen, Status, ScriptType } from "./types";
import { useWalletState } from "./useWalletState";

const DEFAULT_SETTINGS: Settings = {
  provider: "externalRest",
  network: "bitcoin",
  localNodeUrl: "",
  electrumHost: "",
  electrumPort: "50001",
  electrumSsl: false,
  language: "en",
  walletName: "Set Your Wallet Name",
};

function getSettingsKey(): string {
  try {
    const label = getCurrentWindow().label;
    if (label && label !== "main") {
      return `wallet_settings_${label}`;
    }
  } catch { /* ignore */ }
  return "wallet_settings";
}

function loadLocalSettings(): Settings {
  try {
    const raw = localStorage.getItem(getSettingsKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      // Backward-compat: parse legacy localNodeUrl into host/port/ssl fields
      let host = parsed.electrumHost || "";
      let port = parsed.electrumPort || "50001";
      let ssl = parsed.electrumSsl ?? false;
      if (!host && parsed.localNodeUrl) {
        const m = parsed.localNodeUrl.match(/^(ssl|tcp):\/\/([^:/]+):?(\d+)?$/);
        if (m) {
          ssl = m[1] === "ssl";
          host = m[2];
          port = m[3] || (ssl ? "50002" : "50001");
        }
      }
      return {
        provider: parsed.provider || DEFAULT_SETTINGS.provider,
        network: parsed.network || DEFAULT_SETTINGS.network,
        localNodeUrl: parsed.localNodeUrl || DEFAULT_SETTINGS.localNodeUrl,
        electrumHost: host,
        electrumPort: port,
        electrumSsl: ssl,
        language: parsed.language || DEFAULT_SETTINGS.language,
        walletName: parsed.walletName || DEFAULT_SETTINGS.walletName,
      };
    }
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}
function saveLocalSettings(s: Settings) {
  localStorage.setItem(getSettingsKey(), JSON.stringify(s));
}
async function syncSettingsToRust(s: Settings) {
  try {
    await invoke("cmd_save_settings", {
      settings: {
        // Rust serde(rename_all = "camelCase") expects camelCase: "externalRest" / "electrum"
        provider: s.provider,
        network: s.network,
        localNodeUrl: s.localNodeUrl,
        language: s.language,
        walletName: s.walletName,
      },
    });
  } catch (e) {
    console.error("Failed to sync settings to Rust:", e);
  }
}
import { satsToBtc, shortTxid, fmtTimeDateOnly } from "./utils";

function App() {
  const { t } = useTranslation();
  const [screen, setScreen] = useState<Screen>("import");
  const [xpub, setXpub] = useState("");
  const [mfp, setMfp] = useState("");
  const [account, setAccount] = useState("0'");
  
  const [network, setNetwork] = useState<NetworkType>("bitcoin");

  const [scriptType, setScriptType] = useState<ScriptType>("native");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [showScanner, setShowScanner] = useState(false);

  // Auto-Detect & Parse Logic (Runs on Camera Scan OR Textarea Paste)
  const processInputData = (text: string, ur?: any) => {
      const trimmed = text.trim();
      try {
          if (ur && ur.type === "crypto-account") {
              const account = CryptoAccount.fromCBOR(ur.cbor);
              const mfpBuf = account.getMasterFingerprint();
              if (mfpBuf) {
                  const mfpHex = mfpBuf.toString("hex");
                  if (mfpHex) setMfp(mfpHex);
              }
              const descriptors = account.getOutputDescriptors();
              if (descriptors && descriptors.length > 0) {
                  const hdKey = descriptors[0].getHDKey();
                  if (hdKey) {
                      let versionHex = '0488B21E'; // xpub
                      let newScriptType: ScriptType = scriptType;

                      const path = hdKey.getOrigin()?.getPath();
                      if (path) {
                          if (path.includes("86'/")) { newScriptType = "taproot"; versionHex = '0488B21E'; }
                          else if (path.includes("84'/")) { newScriptType = "native"; versionHex = '04B24746'; } // zpub
                          else if (path.includes("49'/")) { newScriptType = "nested"; versionHex = '049D7CB2'; } // ypub
                      }
                      setScriptType(newScriptType);

                      const version = Buffer.from(versionHex, 'hex');
                      let depthVal = 0;
                      let parentFingerprintVal = Buffer.alloc(4, 0);
                      let indexVal = 0;

                      try {
                          const components = hdKey.getOrigin()?.getComponents();
                          if (components && components.length > 0) {
                              depthVal = components.length;
                              const last = components[components.length - 1];
                              indexVal = last.isHardened() ? last.getIndex() + 0x80000000 : last.getIndex();
                          }
                          const parentFp = hdKey.getParentFingerprint();
                          if (parentFp && parentFp.length === 4) {
                              parentFingerprintVal = Buffer.from(parentFp);
                          }
                      } catch (e) {
                          // Ignore library internal errors reading components
                      }

                      const depth = Buffer.alloc(1, depthVal);
                      const index = Buffer.alloc(4);
                      index.writeUInt32BE(indexVal >>> 0, 0);

                      const chainCode = hdKey.getChainCode();
                      const key = hdKey.getKey(); 
                      if (chainCode && key) {
                          const payload = Buffer.concat([version, depth, parentFingerprintVal, index, chainCode, key]);
                          setXpub(bs58check.encode(payload));
                          return;
                      } else {
                          console.error("Missing chainCode or key in scanned HDKey");
                      }
                  } else {
                      console.debug("HDKey is missing from descriptor");
                  }
              } else {
                  console.debug("No Output Descriptors found in CryptoAccount");
              }
          } else if (trimmed.startsWith("{")) {
              const parsed = JSON.parse(trimmed);
              if (parsed.xfp) setMfp(parsed.xfp);
              if (parsed.xpub) setXpub(parsed.xpub);
              else if (parsed.bip84 && parsed.bip84.xpub) {
                  setXpub(parsed.bip84.xpub);
                  setScriptType("native");
              } else if (parsed.bip49 && parsed.bip49.xpub) {
                  setXpub(parsed.bip49.xpub);
                  setScriptType("nested");
              } else if (parsed.bip86 && parsed.bip86.xpub) {
                  setXpub(parsed.bip86.xpub);
                  setScriptType("taproot");
              }
              return;
          } else if (trimmed.startsWith("[")) {
              const match = trimmed.match(/^\[([0-9a-fA-F]{8})\/[^\]]+\](.*)$/);
              if (match) {
                  setMfp(match[1]);
                  setXpub(match[2]);
                  if (trimmed.includes("86'/")) setScriptType("taproot");
                  else if (trimmed.includes("84'/")) setScriptType("native");
                  else if (trimmed.includes("49'/")) setScriptType("nested");
                  return;
              }
          } else if (trimmed.toLowerCase().startsWith("ur:crypto-account")) {
              // Direct paste of UR string (fallback to text area paste scenario)
              // If it's pasted, it's not a UR object yet. Try to decode it synchronously if it's a single part?
              // Actually, multi-part pasted UR can't be decoded easily without the fountain decoder state. 
              // We'll just leave it and let the user scan it via QR, or they must paste a complete object.
          }
      } catch (e: any) {
          console.error("Failed to parsed input data:", e);
      }
      // Fallback
      setXpub(trimmed);
  };

  // xpub prefix validation per script type
  function validateXpub(val: string, type: ScriptType): string | null {
    const v = val.trim();
    if (!v) return null; // empty — don't show error yet
    switch (type) {
      case "nested":
        if (!v.startsWith("ypub") && !v.startsWith("Ypub"))
          return "Nested SegWit requires a ypub key (starts with 'ypub').";
        return null;
      case "native":
        if (!v.startsWith("zpub") && !v.startsWith("Zpub"))
          return "Native SegWit requires a zpub key (starts with 'zpub').";
        return null;
      case "taproot":
        if (!v.startsWith("xpub") && !v.startsWith("Xpub") && !v.startsWith("tpub"))
          return "Taproot requires an xpub key (starts with 'xpub').";
        return null;
    }
  }

  const xpubError = validateXpub(xpub, scriptType);

  const [settings, setSettings] = useState<Settings>(loadLocalSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const {
    mainAddresses, setMainAddresses,
    changeAddresses, setChangeAddresses,
    mainCount, setMainCount,
    changeCount, setChangeCount,
    loadingMore,
    activeTab,
    selectedIndex, setSelectedIndex,
    walletView, setWalletView,
    suggestedMainIndex, setSuggestedMainIndex,
    suggestedChangeIndex, setSuggestedChangeIndex,
    suggestedLoading, setSuggestedLoading,
    utxos, utxoLoading, utxoError,
    txs, txLoading, txError, selectedTx, setSelectedTx,
    walletUtxos, walletUtxosLoading, walletUtxosError, fetchWalletUtxos,
    recentTxs, recentLoading, recentError, recentFetched, fetchRecentTxs,
    addresses, selected,
    handleLoadMore, handleTabChange, resetState
  } = useWalletState(settings.provider);

  useEffect(() => { 
    const initialSettings = loadLocalSettings();
    syncSettingsToRust(initialSettings);
    setNetwork("bitcoin");
    
    import("./i18n").then(({ default: i18n }) => {
      if (i18n.language !== initialSettings.language) {
        i18n.changeLanguage(initialSettings.language);
      }
    });
  }, []);


  async function handleSaveSettings(s: Settings) {
    setSettings(s);
    saveLocalSettings(s);
    await syncSettingsToRust(s);
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading"); setErrorMsg("");
    try {
      // Sync initial network to settings
      const newSettings = { ...settings, network };
      setSettings(newSettings);
      await syncSettingsToRust(newSettings);

      const accStr = await invoke<string>("cmd_import_wallet", { xpub, mfp, network, scriptType });
      setAccount(accStr);

      // 이전 지갑 캐시 초기화 — 새 지갑 임포트 시 항상 리셋
      resetState();
      
      const PAGE_SIZE = 20;

      const [main, change] = await Promise.all([
        invoke<string[]>("cmd_get_addresses", { offset: 0, count: PAGE_SIZE }),
        invoke<string[]>("cmd_get_change_addresses", { offset: 0, count: PAGE_SIZE }),
      ]);
      setMainAddresses(main); setChangeAddresses(change);
      setMainCount(PAGE_SIZE); setChangeCount(PAGE_SIZE);
      handleTabChange("main");

      setScreen("wallet");

      // 미사용 주소 탐색 (백그라운드)
      setSuggestedLoading(true);
      Promise.all([
        invoke<number>("cmd_find_first_unused_address", { addresses: main }),
        invoke<number>("cmd_find_first_unused_address", { addresses: change }),
      ]).then(([mi, ci]) => {
        setSuggestedMainIndex(mi);
        setSuggestedChangeIndex(ci);
      }).catch((e) => {
        console.warn("Failed to find unused address:", e);
        setSuggestedMainIndex(0);
        setSuggestedChangeIndex(0);
      }).finally(() => setSuggestedLoading(false));

      setStatus("idle");
    } catch (err) { setStatus("error"); setErrorMsg(String(err)); }
  }

  const currentCount = activeTab === "main" ? mainCount : changeCount;



  const gearButton = (
    <button className={`gear-btn ${settings.provider}`} onClick={() => setSettingsOpen(true)} aria-label="Open settings" title="Settings">
      <span className="provider-dot" />
      <span>{settings.provider === "externalRest" ? "External API" : "Electrum"}</span>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
        <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.92c.04-.34.07-.67.07-1.08s-.03-.74-.07-1.08l2.32-1.82c.21-.16.27-.46.13-.7l-2.2-3.8c-.14-.24-.43-.32-.67-.24l-2.74 1.1c-.57-.44-1.18-.8-1.85-1.07L14.04 2.3A.54.54 0 0 0 13.5 2h-3a.54.54 0 0 0-.54.46L9.67 5.1c-.67.27-1.28.63-1.85 1.07L5.08 5.07c-.24-.08-.53 0-.67.24L2.21 9.11c-.14.24-.08.54.13.7l2.32 1.82c-.04.34-.07.68-.07 1.08s.03.74.07 1.08L2.34 15.81c-.21.16-.27.46-.13.7l2.2 3.8c.14.24.43.32.67.24l2.74-1.1c.57.44 1.18.8 1.85 1.07l.29 2.8c.06.27.28.46.54.46h3c.26 0 .48-.19.54-.46l.29-2.8c.67-.27 1.28-.63 1.85-1.07l2.74 1.1c.24.08.53 0 .67-.24l2.2-3.8c.14-.24.08-.54-.13-.7l-2.32-1.82Z" />
      </svg>
    </button>
  );

  // ── UTXO render ───────────────────────────────────────────
  function renderUtxos() {
    if (utxoLoading) return <div className="utxo-loading"><span className="spinner" /><span>{t("app.fetchingUtxos")}</span></div>;
    if (utxoError) return <div className="utxo-error"><span>⚠️</span><p>{utxoError}</p></div>;
    if (utxos.length === 0) return <div className="empty-state"><span>🔍</span><p>{t("app.noUtxos")}</p></div>;
    const totalSats = utxos.reduce((s, u) => s + u.value, 0);
    return (
      <>
        <div className="utxo-summary">
          <span className="utxo-count">{utxos.length} UTXO{utxos.length !== 1 ? "s" : ""}</span>
          <span className="utxo-total">{satsToBtc(totalSats)} BTC</span>
        </div>
        <div className="utxo-list">
          {utxos.map((u) => (
            <div key={`${u.txid}-${u.vout}`} className="utxo-item">
              <div className="utxo-row">
                <code className="utxo-txid">{u.txid.slice(0, 12)}…{u.txid.slice(-8)}:{u.vout}</code>
                {(() => {
                  const confs = u.status.confirmations ?? (u.status.confirmed ? 6 : 0);
                  if (confs >= 6) {
                    return <span className="utxo-confirm-badge confirmed">{t("app.confirmed")}</span>;
                  } else if (confs > 0) {
                    return <span className="utxo-confirm-badge confirming">{confs}/6</span>;
                  } else {
                    return <span className="utxo-confirm-badge unconfirmed">{t("app.pending")}</span>;
                  }
                })()}
              </div>
              <div className="utxo-row">
                <span className="utxo-value">{satsToBtc(u.value)} BTC</span>
                <span className="utxo-sats">{u.value.toLocaleString()} sats</span>
              </div>
              {u.status.block_height && <div className="utxo-block">{t("app.block", { height: u.status.block_height.toLocaleString() })}</div>}
            </div>
          ))}
        </div>
      </>
    );
  }

  // ── TX render ─────────────────────────────────────────────
  function renderTxs() {
    if (txLoading) return <div className="utxo-loading"><span className="spinner" /><span>{t("app.fetchingTxs")}</span></div>;
    if (txError) return <div className="utxo-error"><span>⚠️</span><p>{txError}</p></div>;
    if (txs.length === 0) return <div className="empty-state"><span>📋</span><p>{t("app.noTxs")}</p></div>;

    return (
      <div className="tx-list">
        {txs.map((tx) => {
          const totalOut = tx.vout.reduce((s, v) => s + v.value, 0);
          const myOutputs = tx.vout.filter((v) => v.scriptpubkey_address === selected);
          const myInputs  = tx.vin.filter((v) => v.prevout?.scriptpubkey_address === selected);
          const received  = myOutputs.reduce((s, v) => s + v.value, 0);
          const spent     = myInputs.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
          const netChange = received - spent;

          return (
            <button key={tx.txid} className="tx-item" onClick={() => setSelectedTx(tx)}>
              <div className="tx-item-top">
                <code className="tx-item-txid">{shortTxid(tx.txid)}</code>
                <div className="tx-item-right">
                  <span className={`net-change ${netChange >= 0 ? "positive" : "negative"}`}>
                    {netChange >= 0 ? "+" : ""}{satsToBtc(netChange)} BTC
                  </span>
                </div>
              </div>
              <div className="tx-item-bottom">
                <span className={`tx-badge-sm ${tx.status.confirmed ? "confirmed" : "unconfirmed"}`}>
                  {tx.status.confirmed ? "✓" : "⏳"} {tx.status.confirmed ? t("app.block", { height: tx.status.block_height?.toLocaleString() }) : t("app.pending").replace("⏳ ", "")}
                </span>
                <span className="tx-meta-sm">
                  {t("app.txIn", { count: tx.vin.length })} · {t("app.txOut", { count: tx.vout.length })} · {satsToBtc(totalOut)} BTC
                  {tx.fee != null && ` · ${t("app.feeSats", { fee: tx.fee })}`}
                </span>
                <span className="tx-date-sm">{fmtTimeDateOnly(tx.status.block_time)}</span>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  // ── Import Screen ─────────────────────────────────────────
  if (screen === "import") {
    return (
      <main className="import-screen">
        {gearButton}
        <div className="import-card">
          <div className="import-header">
            <img src={customLogo} alt="3min Logo" className="bitcoin-icon app-logo-nav" />
            <p className="subtitle">{t("app.subtitle")}</p>
          </div>
          <form onSubmit={handleImport} className="import-form">
            {/* Script Type Selector */}
            <div className="field">
              <label>
                {t("app.addressTypeLabel")}{" "}
                <span className="app-logo-text-muted">
                  {t("app.singleSigOnly")}
                </span>
              </label>
              <div className="script-type-selector">
                <button
                  type="button"
                  className={`script-type-btn nested ${scriptType === "nested" ? "active" : ""}`}
                  onClick={() => { setScriptType("nested"); }}
                >
                  <span className="script-type-label">Nested SegWit</span>
                  <span className="script-type-hint">3… (ypub)</span>
                </button>
                <button
                  type="button"
                  className={`script-type-btn native ${scriptType === "native" ? "active" : ""}`}
                  onClick={() => { setScriptType("native"); }}
                >
                  <span className="script-type-label">Native SegWit</span>
                  <span className="script-type-hint">bc1q… (zpub)</span>
                </button>
                <button
                  type="button"
                  className={`script-type-btn taproot ${scriptType === "taproot" ? "active" : ""}`}
                  onClick={() => { setScriptType("taproot"); }}
                >
                  <span className="script-type-label">Taproot</span>
                  <span className="script-type-hint">bc1p… (xpub)</span>
                </button>
              </div>
              {scriptType === "taproot" && (
                <p className="taproot-warning">
                  ⚠️ {t("app.taprootWarning")}
                </p>
              )}
            </div>

            <div className="field">
              <label htmlFor="xpub-input" className="xpub-label-flex">
                <span>
                  {scriptType === "nested" ? "ypub" : scriptType === "taproot" ? "xpub (BIP86)" : "zpub"}
                </span>
                <button
                  type="button"
                  className="qr-scan-btn qr-scan-btn-custom"
                  onClick={() => setShowScanner(true)}
                  title={t("app.scanQr")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M0 .5A.5.5 0 0 1 .5 0h3a.5.5 0 0 1 0 1H1v2.5a.5.5 0 0 1-1 0v-3Zm12 0a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0V1h-2.5a.5.5 0 0 1-.5-.5ZM.5 15a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 1 0V14h2.5a.5.5 0 0 1 0 1h-3Zm15-.5a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1 0-1H15v-2.5a.5.5 0 0 1 1 0v3ZM8 1.5A1.5 1.5 0 0 1 9.5 3v2A1.5 1.5 0 0 1 8 6.5A1.5 1.5 0 0 1 6.5 5V3A1.5 1.5 0 0 1 8 1.5Zm0 1A.5.5 0 0 0 7.5 3v2a.5.5 0 0 0 1 0V3a.5.5 0 0 0-.5-.5ZM8 8.5A1.5 1.5 0 0 1 9.5 10v2A1.5 1.5 0 0 1 8 13.5A1.5 1.5 0 0 1 6.5 12v-2A1.5 1.5 0 0 1 8 8.5Zm0 1A.5.5 0 0 0 7.5 10v2a.5.5 0 0 0 1 0v-2a.5.5 0 0 0-.5-.5Z"/>
                  </svg>
                  {t("app.scanQr")}
                </button>
              </label>
              <textarea
                id="xpub-input"
                value={xpub}
                onChange={(e) => {
                   const val = e.currentTarget.value;
                   processInputData(val);
                }}
                placeholder={
                  scriptType === "nested" ? "ypub1..." :
                  scriptType === "taproot" ? "xpub6... (from m/86'/0'/0')" :
                  "zpub6..."
                }
                rows={3}
                required
                style={xpubError ? { borderColor: "rgba(239,68,68,0.5)", boxShadow: "0 0 0 3px rgba(239,68,68,0.1)" } : {}}
              />
              {xpubError && <p className="xpub-error">{xpubError}</p>}
            </div>
            <div className="field">
              <label htmlFor="mfp-input">{t("app.mfpLabel")}</label>
              <input id="mfp-input" type="text" value={mfp} onChange={(e) => setMfp(e.currentTarget.value)} placeholder={t("app.mfpPlaceholder")} maxLength={8} required />
              <p className="field-hint">⚠️ {t("app.mfpHint")}</p>
            </div>
            <button type="submit" className={`submit-btn ${status === "loading" ? "loading" : ""}`} disabled={status === "loading" || !!xpubError}>
              {status === "loading" ? t("app.connecting") : t("app.connectWallet")}
            </button>
          </form>
          {errorMsg && <div className="message error">❌ {errorMsg}</div>}
        </div>
        
        {showScanner && (
          <QrScannerModal
            onScan={(text: string, ur?: any) => {
               processInputData(text, ur);
               setShowScanner(false);
            }}
            onClose={() => setShowScanner(false)}
          />
        )}

        {settingsOpen && <SettingsModal settings={settings} onSave={handleSaveSettings} onClose={() => setSettingsOpen(false)} />}
      </main>
    );

  }

  // ── Wallet Screen ─────────────────────────────────────────
  return (
    <div className="wallet-screen">
      {gearButton}

      <aside className={`sidebar ${isSidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-header">
          <img src={customLogo} alt="3min Logo" className="sidebar-logo app-logo-sidebar" />
          <div className="sidebar-title-container">
            <div className="sidebar-title">{settings.walletName}</div>
          </div>
          <button 
            className="sidebar-toggle-btn" 
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        {/* View switcher — 세로 5칸 */}
        <nav className="view-nav">
          <button
            className={`view-nav-btn dashboard ${walletView === "dashboard" ? "active" : ""}`}
            onClick={() => setWalletView("dashboard")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
            </svg>
            <span>{t("app.dashboard")}</span>
          </button>
          <button
            className={`view-nav-btn recent ${walletView === "recent" ? "active" : ""}`}
            onClick={() => {
              setWalletView("recent");
              if (!recentFetched) fetchRecentTxs();
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .207.082.393.22.53l2.75 2.75a.75.75 0 1 0 1.06-1.06L10.75 9.69V5Z" clipRule="evenodd" />
            </svg>
            <span>{t("recent.title")}</span>
          </button>
          <button
            className={`view-nav-btn ${walletView === "explorer" ? "active" : ""}`}
            onClick={() => setWalletView("explorer")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
              <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" clipRule="evenodd" />
            </svg>
            <span>{t("app.explorer")}</span>
          </button>
          <button
            className={`view-nav-btn receive ${walletView === "receive" ? "active" : ""}`}
            onClick={() => setWalletView("receive")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.25a.75.75 0 0 0-1.5 0v4.59L7.3 9.24a.75.75 0 0 0-1.1 1.02l3.25 3.5a.75.75 0 0 0 1.1 0l3.25-3.5a.75.75 0 1 0-1.1-1.02l-1.95 2.1V6.75Z" clipRule="evenodd" />
            </svg>
            <span>{t("app.receive")}</span>
          </button>
          <button
            className={`view-nav-btn send ${walletView === "send" ? "active" : ""}`}
            onClick={() => setWalletView("send")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-4.75a.75.75 0 0 0-1.5 0v-4.59L7.3 10.76a.75.75 0 0 0-1.1-1.02l3.25-3.5a.75.75 0 0 0 1.1 0l3.25 3.5a.75.75 0 1 0-1.1 1.02l-1.95-2.1v4.59Z" clipRule="evenodd" />
            </svg>
            <span>{t("app.send")}</span>
          </button>
          
          <div className="view-nav-divider sidebar-divider" />
          
          <button
            className="view-nav-btn split-view"
            onClick={async () => {
              try {
                await invoke("cmd_open_new_window");
              } catch (e) {
                console.error("Failed to open new window:", e);
              }
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path stroke="none" d="M11 2h4.5A1.5 1.5 0 0117 3.5v4A1.5 1.5 0 0115.5 9h-3A1.5 1.5 0 0111 7.5v-4zm0 9h4.5A1.5 1.5 0 0117 12.5v4a1.5 1.5 0 01-1.5 1.5h-3a1.5 1.5 0 01-1.5-1.5v-4zm-8-9h4.5A1.5 1.5 0 019 3.5v4A1.5 1.5 0 017.5 9h-3A1.5 1.5 0 013 7.5v-4zm0 9h4.5A1.5 1.5 0 019 12.5v4A1.5 1.5 0 017.5 18h-3A1.5 1.5 0 013 16.5v-4z" />
            </svg>
            <span>{t("app.newWindow", "New Split Window")}</span>
          </button>
        </nav>

        {/* Address tabs — Explorer 뷰에서만 표시 */}
        {walletView === "explorer" && (
          <>
            <div className="tab-bar">
              <button className={`tab-btn ${activeTab === "main" ? "active" : ""}`} onClick={() => handleTabChange("main")}>{t("app.receiving")}</button>
              <button className={`tab-btn ${activeTab === "change" ? "active" : ""}`} onClick={() => handleTabChange("change")}>{t("app.change")}</button>
            </div>
            <div className="address-list">
              {addresses.map((addr, i) => (
                <button key={addr} className={`address-item ${selectedIndex === i ? "active" : ""}`} onClick={() => setSelectedIndex(i)}>
                  <span className="address-index">#{i}</span>
                  <span className="address-short">{addr}</span>
                </button>
              ))}
              <button className={`load-more-btn ${loadingMore ? "loading" : ""}`} onClick={() => handleLoadMore()} disabled={loadingMore}>
                {loadingMore ? t("app.loading") : t("app.loadMore", { count: currentCount })}
              </button>
            </div>
          </>
        )}

        <button className="disconnect-btn" onClick={() => {
          setScreen("import");
          setWalletView("dashboard");
          handleTabChange("main");
          
          setMainAddresses([]);
          setChangeAddresses([]);
          resetState();

          invoke("cmd_disconnect_wallet").catch(console.error);
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clipRule="evenodd" />
            <path fillRule="evenodd" d="M19 10a.75.75 0 0 0-.75-.75H8.704l1.048-1.043a.75.75 0 1 0-1.06-1.06l-2.31 2.302a.846.846 0 0 0-.106.12l-.004.008a.75.75 0 0 0-.172.473c0 .179.065.343.172.473l.004.008c.032.042.067.083.106.12l2.31 2.302a.75.75 0 1 0 1.06-1.06l-1.048-1.043h9.546A.75.75 0 0 0 19 10Z" clipRule="evenodd" />
          </svg>
          <span>{t("app.disconnect")}</span>
        </button>
      </aside>

      {walletView === "dashboard" ? (
        <DashboardPanel
          walletUtxos={walletUtxos}
          walletUtxosLoading={walletUtxosLoading}
          walletUtxosError={walletUtxosError}
          onNavigate={(view) => setWalletView(view)}
        />
      ) : walletView === "recent" ? (
        <RecentPanel
          recentTxs={recentTxs}
          loading={recentLoading}
          error={recentError}
          allAddresses={[...mainAddresses, ...changeAddresses]}
          onRefresh={() => fetchRecentTxs(true)}
        />
      ) : walletView === "receive" ? (
        <ReceivePanel
          scriptType={scriptType}
          account={account}
          mainAddresses={mainAddresses}
          changeAddresses={changeAddresses}
          suggestedMainIndex={suggestedMainIndex >= 0 ? suggestedMainIndex : 0}
          suggestedChangeIndex={suggestedChangeIndex >= 0 ? suggestedChangeIndex : 0}
          suggestedLoading={suggestedLoading}
          onLoadMore={handleLoadMore}
          loadingMore={loadingMore}
        />
      ) : walletView === "send" ? (
        <SendPanel 
          scriptType={scriptType}
          account={account}
          walletUtxos={walletUtxos}
          walletUtxosLoading={walletUtxosLoading}
          walletUtxosError={walletUtxosError}
          onFetchWalletUtxos={fetchWalletUtxos}
          changeAddresses={changeAddresses}
          suggestedChangeIndex={suggestedChangeIndex >= 0 ? suggestedChangeIndex : 0}
          suggestedLoading={suggestedLoading}
          onLoadMoreChange={() => handleLoadMore("change")}
          loadingMoreChange={loadingMore}
        />
      ) : (
        <main className="detail-panel">
          {selected ? (
            <>
              <div className="detail-header">
                <div className="detail-title-row">
                  <h2>{t("app.addressTitle", { type: activeTab === "main" ? t("app.receiving") : t("app.change"), index: selectedIndex })}</h2>
                  <span className={`address-badge ${activeTab}`}>
                    m/{scriptType === "taproot" ? "86'" : scriptType === "nested" ? "49'" : "84'"}/0'/{account}/{activeTab === "main" ? "0/" : "1/"}{selectedIndex}
                  </span>
                </div>
                <code className="detail-address">{selected}</code>
              </div>

              <div className="detail-sections">
                <section className="detail-section">
                  <h3>UTXOs</h3>
                  {renderUtxos()}
                </section>

                <section className="detail-section">
                  <h3>Transactions</h3>
                  {renderTxs()}
                </section>
              </div>
            </>
          ) : (
            <div className="empty-state centered">
              <span>👈</span>
              <p>{t("app.selectAddress")}</p>
            </div>
          )}
        </main>
      )}

      {/* TX Detail Panel */}
      {selectedTx && (
        <TxDetailPanel
          tx={selectedTx}
          watchAddress={selected ?? ""}
          network={network}
          onClose={() => setSelectedTx(null)}
        />
      )}

      {settingsOpen && (
        <SettingsModal settings={settings} onSave={handleSaveSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

export default App;
