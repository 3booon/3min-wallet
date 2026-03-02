import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import "./SettingsModal.css";

export type ApiProvider = "externalRest" | "electrum";

export type NetworkType = "bitcoin";

export interface Settings {
  provider: "externalRest" | "electrum";
  network: NetworkType;
  localNodeUrl: string;       // composed: ssl://host:port or tcp://host:port
  electrumHost: string;
  electrumPort: string;
  electrumSsl: boolean;
  language: "en" | "ko";
  walletName: string;
}


interface Props {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

type TestStatus = "idle" | "testing" | "ok" | "error";

type SettingsTab = "datasource" | "language" | "appearance";

export default function SettingsModal({ settings, onSave, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("datasource");
  const [localSettings, setLocalSettings] = useState<Settings>({ ...settings });
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testMessage, setTestMessage] = useState("");

  const handleProviderChange = (p: ApiProvider) => {
    setLocalSettings({ ...localSettings, provider: p });
    setTestStatus("idle");
    setTestMessage("");
  };



  const handleHostChange = (val: string) => {
    const composed = buildElectrumUrl(val, localSettings.electrumPort, localSettings.electrumSsl);
    setLocalSettings({ ...localSettings, electrumHost: val, localNodeUrl: composed });
    setTestStatus("idle");
    setTestMessage("");
  };

  const handlePortChange = (val: string) => {
    const composed = buildElectrumUrl(localSettings.electrumHost, val, localSettings.electrumSsl);
    setLocalSettings({ ...localSettings, electrumPort: val, localNodeUrl: composed });
    setTestStatus("idle");
    setTestMessage("");
  };

  const handleSslToggle = (ssl: boolean) => {
    const defaultPort = ssl ? "50002" : "50001";
    const port = localSettings.electrumPort || defaultPort;
    const composed = buildElectrumUrl(localSettings.electrumHost, port, ssl);
    setLocalSettings({ ...localSettings, electrumSsl: ssl, electrumPort: port, localNodeUrl: composed });
    setTestStatus("idle");
    setTestMessage("");
  };

  async function handleTestConnection() {
    if (!localSettings.electrumHost.trim()) {
      setTestStatus("error");
      setTestMessage("Please enter a server host first.");
      return;
    }
    const url = buildElectrumUrl(localSettings.electrumHost, localSettings.electrumPort, localSettings.electrumSsl);
    setTestStatus("testing");
    setTestMessage("");
    try {
      const info = await invoke<string>("cmd_test_electrum_connection", { url });
      setTestStatus("ok");
      setTestMessage(info || "Connection successful");
    } catch (e) {
      setTestStatus("error");
      setTestMessage(String(e));
    }
  }

  const handleSave = () => {
    i18n.changeLanguage(localSettings.language);
    onSave(localSettings);
    onClose();
  };

  // Helper: SSL 토글 변경 시 기본 포트 자동 세팅
  function buildElectrumUrl(host: string, port: string, ssl: boolean): string {
    if (!host.trim()) return "";
    const p = port.trim() || (ssl ? "50002" : "50001");
    return `${ssl ? "ssl" : "tcp"}://${host.trim()}:${p}`;
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="settings-header">
          <div className="settings-title-row">
            <span className="settings-icon">⚙</span>
            <h2>{t("settings.title")}</h2>
          </div>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="settings-tab-bar">
          <button 
            className={`settings-tab-btn ${activeTab === "datasource" ? "active" : ""}`}
            onClick={() => setActiveTab("datasource")}
          >
            {t("settings.tabDataSource")}
          </button>
          <button 
            className={`settings-tab-btn ${activeTab === "language" ? "active" : ""}`}
            onClick={() => setActiveTab("language")}
          >
            {t("settings.tabLanguage")}
          </button>
          <button 
            className={`settings-tab-btn ${activeTab === "appearance" ? "active" : ""}`}
            onClick={() => setActiveTab("appearance")}
          >
            {t("settings.tabAppearance", { defaultValue: "Appearance" })}
          </button>
        </div>

        {/* Tab Content: Data Source */}
        {activeTab === "datasource" && (
          <>
            <div className="settings-section">
          <div className="settings-section-label">{t("settings.dataSource")}</div>

          <div
            className={`provider-option ${localSettings.provider === "externalRest" ? "active" : ""}`}
            onClick={() => handleProviderChange("externalRest")}
          >
            <div className="provider-radio">
              <div className={`radio-dot ${localSettings.provider === "externalRest" ? "on" : ""}`} />
            </div>
            <div className="provider-info">
              <div className="provider-name">{t("settings.externalApi")}</div>
              <div className="provider-desc">
                {t("settings.externalApiDesc")}
              </div>
            </div>
            <span className="provider-badge external">{t("settings.public")}</span>
          </div>

          <div
            className={`provider-option ${localSettings.provider === "electrum" ? "active" : ""}`}
            onClick={() => handleProviderChange("electrum")}
          >
            <div className="provider-radio">
              <div className={`radio-dot ${localSettings.provider === "electrum" ? "on" : ""}`} />
            </div>
            <div className="provider-info">
              <div className="provider-name">{t("settings.customElectrum")}</div>
              <div className="provider-desc">
                {t("settings.customElectrumDesc")}
              </div>
            </div>
            <span className="provider-badge local">{t("settings.selfHosted")}</span>
          </div>
        </div>

        {/* Electrum Host + Port + SSL Toggle */}
        {localSettings.provider === "electrum" && (
          <div className="settings-section">
            <div className="settings-section-label">{t("settings.electrumServer")}</div>

            {/* SSL Toggle */}
            <div className="ssl-toggle-row">
              <span className="ssl-toggle-label">{t("settings.sslEnabled")}</span>
              <button
                type="button"
                className={`ssl-toggle-btn ${localSettings.electrumSsl ? "on" : "off"}`}
                onClick={() => handleSslToggle(!localSettings.electrumSsl)}
                aria-pressed={localSettings.electrumSsl}
              >
                <span className="ssl-toggle-track">
                  <span className="ssl-toggle-thumb" />
                </span>
                <span className="ssl-toggle-text">{localSettings.electrumSsl ? "SSL" : "TCP"}</span>
              </button>
            </div>

            {/* Host + Port */}
            <div className="electrum-host-row">
              <div className="node-url-field electrum-host-field">
                <span className="node-url-icon">⚡</span>
                <input
                  type="text"
                  value={localSettings.electrumHost}
                  onChange={(e) => handleHostChange(e.currentTarget.value)}
                  placeholder={t("settings.electrumHostPlaceholder")}
                  className="node-url-input"
                  spellCheck={false}
                />
              </div>
              <div className="node-url-field electrum-port-field">
                <input
                  type="text"
                  value={localSettings.electrumPort}
                  onChange={(e) => handlePortChange(e.currentTarget.value)}
                  placeholder={localSettings.electrumSsl ? "50002" : "50001"}
                  className="node-url-input"
                  spellCheck={false}
                  maxLength={5}
                />
              </div>
            </div>

            {/* Composed URL preview */}
            {localSettings.electrumHost.trim() && (
              <div className="node-url-hint url-preview">
                🔗 {buildElectrumUrl(localSettings.electrumHost, localSettings.electrumPort, localSettings.electrumSsl)}
              </div>
            )}
            {!localSettings.electrumHost.trim() && (
              <div className="node-url-hint">{t("settings.electrumHostHint")}</div>
            )}

            {/* Test Connection */}
            <div className="test-connection-row">
              <button
                className="test-connection-btn"
                onClick={handleTestConnection}
                disabled={testStatus === "testing"}
              >
                {testStatus === "testing" ? t("settings.testing") : t("settings.testConnection")}
              </button>
              {testStatus === "ok" && (
                <span className="test-result ok">✓ {testMessage === "Connection successful" ? t("settings.connectionSuccessful") : testMessage}</span>
              )}
              {testStatus === "error" && (
                <span className="test-result error">✕ {testMessage}</span>
              )}
            </div>
          </div>
        )}
        </>
        )}

        {/* Tab Content: Language */}
        {activeTab === "language" && (
          <div className="settings-section">
          <div className="settings-section-label">{t("settings.language")}</div>

          <div
            className={`provider-option ${localSettings.language === "en" ? "active" : ""}`}
            onClick={() => setLocalSettings({ ...localSettings, language: "en" })}
          >
            <div className="provider-radio">
              <div className={`radio-dot ${localSettings.language === "en" ? "on" : ""}`} />
            </div>
            <div className="provider-info">
              <div className="provider-name">{t("settings.english")}</div>
            </div>
          </div>

          <div
            className={`provider-option ${localSettings.language === "ko" ? "active" : ""}`}
            onClick={() => setLocalSettings({ ...localSettings, language: "ko" })}
          >
            <div className="provider-radio">
              <div className={`radio-dot ${localSettings.language === "ko" ? "on" : ""}`} />
            </div>
            <div className="provider-info">
              <div className="provider-name">{t("settings.korean")}</div>
            </div>
          </div>
        </div>
        )}

        {/* Tab Content: Appearance */}
        {activeTab === "appearance" && (
          <div className="settings-section">
            <div className="settings-section-label">{t("settings.walletName", { defaultValue: "Wallet Name" })}</div>
            <div className="node-url-field">
              <span className="node-url-icon">🏷️</span>
              <input
                type="text"
                value={localSettings.walletName}
                onChange={(e) => setLocalSettings({ ...localSettings, walletName: e.currentTarget.value })}
                placeholder="Set Your Wallet Name"
                className="node-url-input"
                spellCheck={false}
                maxLength={20}
              />
            </div>
            <div className="node-url-hint">
              {t("settings.walletNameDesc", { defaultValue: "Customize the name displayed in the sidebar." })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="settings-actions">
          <button className="settings-cancel-btn" onClick={onClose}>
            {t("settings.cancel")}
          </button>
          <button className="settings-save-btn" onClick={handleSave}>
            {t("settings.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
