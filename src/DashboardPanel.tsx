import { useState } from "react";
import { useTranslation } from "react-i18next";
import { WalletUtxo } from "./types";
import "./DashboardPanel.css";

interface DashboardPanelProps {
  walletUtxos: WalletUtxo[] | null;
  walletUtxosLoading: boolean;
  walletUtxosError: string | null;
  onNavigate: (view: "receive" | "send" | "explorer") => void;
}

export default function DashboardPanel({
  walletUtxos,
  walletUtxosLoading,
  walletUtxosError,
  onNavigate,
}: DashboardPanelProps) {
  const { t } = useTranslation();
  const [showBalance, setShowBalance] = useState(false);

  const totalSats = walletUtxos?.reduce((sum, u) => sum + u.value, 0) || 0;
  const totalBtc = (totalSats / 1e8).toFixed(8);

  return (
    <main className="dashboard-panel">
      <div className="balance-card" onClick={() => setShowBalance(!showBalance)}>
        <h2 className="balance-title">{t("dashboard.totalBalance")}</h2>
        <div className="balance-amount">
          {walletUtxosLoading ? (
            <span className="amount-loading"><span className="spinner"></span></span>
          ) : walletUtxosError ? (
            <span className="amount-error">⚠️ Error</span>
          ) : showBalance ? (
            <span className="amount-btc">{totalBtc} <span className="unit">BTC</span></span>
          ) : (
            <span className="amount-hidden">{t("dashboard.balanceHidden", "••••••••")}</span>
          )}
        </div>
        <p className="balance-hint">
          {showBalance ? t("dashboard.tapToHide") : t("dashboard.tapToSee")}
        </p>
      </div>

      <div className="dashboard-actions">
        <button className="action-btn receive" onClick={() => onNavigate("receive")}>
          <div className="icon-wrapper">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="24" height="24">
              <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.25a.75.75 0 0 0-1.5 0v4.59L7.3 9.24a.75.75 0 0 0-1.1 1.02l3.25 3.5a.75.75 0 0 0 1.1 0l3.25-3.5a.75.75 0 1 0-1.1-1.02l-1.95 2.1V6.75Z" clipRule="evenodd" />
            </svg>
          </div>
          <span>{t("dashboard.receiveBtn")}</span>
        </button>
        <button className="action-btn send" onClick={() => onNavigate("send")}>
          <div className="icon-wrapper">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="24" height="24">
              <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-4.75a.75.75 0 0 0-1.5 0v-4.59L7.3 10.76a.75.75 0 0 0-1.1-1.02l3.25-3.5a.75.75 0 0 0 1.1 0l3.25 3.5a.75.75 0 1 0-1.1 1.02l-1.95-2.1v4.59Z" clipRule="evenodd" />
            </svg>
          </div>
          <span>{t("dashboard.sendBtn")}</span>
        </button>
        <button className="action-btn explorer" onClick={() => onNavigate("explorer")}>
          <div className="icon-wrapper">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="24" height="24">
              <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
              <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" clipRule="evenodd" />
            </svg>
          </div>
          <span>{t("dashboard.explorerBtn")}</span>
        </button>
      </div>
    </main>
  );
}
