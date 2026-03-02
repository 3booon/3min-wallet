import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { satsToBtc } from "./utils";
import { invoke } from "@tauri-apps/api/core";
import { WalletUtxo } from "./types";
import { UR } from "@ngraveio/bc-ur";
import "./SendPanel.css";
import SendScanner from "./SendScanner";
import SendBroadcaster from "./SendBroadcaster";
import SendPsbtDisplay from "./SendPsbtDisplay";

// ── 타입 ──────────────────────────────────────────────────────

interface FeeEstimates {
  low: number;
  medium: number;
  high: number;
}

type FeePreset = "low" | "medium" | "high" | "custom";

interface Recipient {
  id: string;
  address: string;
  amountBtc: string;
  isMax?: boolean;
}

import {
  validateBitcoinAddress,
  validateAmount,
  inferAddressType,
  estimateVbytes,
  AddressType
} from "./bitcoinUtils";

// ── 컴포넌트 ──────────────────────────────────────────────────

interface SendPanelProps {
  scriptType: string;
  account: string;
  walletUtxos: WalletUtxo[] | null;
  walletUtxosLoading: boolean;
  walletUtxosError: string | null;
  onFetchWalletUtxos: (force?: boolean) => Promise<void>;
  changeAddresses: string[];
  suggestedChangeIndex: number;
  suggestedLoading: boolean;
  onLoadMoreChange?: () => Promise<void>;
  loadingMoreChange?: boolean;
}

export default function SendPanel({ 
  scriptType,
  account,
  walletUtxos,
  walletUtxosLoading,
  walletUtxosError,
  onFetchWalletUtxos,
  changeAddresses,
  suggestedChangeIndex,
  suggestedLoading,
  onLoadMoreChange,
  loadingMoreChange = false,
}: SendPanelProps) {
  const { t } = useTranslation();
  // 확정된 받는 사람 목록
  const [recipients, setRecipients] = useState<Recipient[]>([]);

  // 현재 입력 중인 수신자 (Draft)
  const [draftAddress, setDraftAddress] = useState("");
  const [draftAddressTouched, setDraftAddressTouched] = useState(false);
  const [draftAmount, setDraftAmount] = useState("");
  const [draftIsMax, setDraftIsMax] = useState(false);
  const [amountUnit, setAmountUnit] = useState<"BTC" | "sats">("BTC");

  // Rust Backend Max Amount State
  const [activeMaxSats, setActiveMaxSats] = useState<number>(0);
  const [isMaxDustError, setIsMaxDustError] = useState<boolean>(false);

  // UTXO 목록 (Global 캐시 기반)
  const [selectedUtxos, setSelectedUtxos] = useState<WalletUtxo[]>([]);

  // 화면에 렌더링할 All UTXOs (선택된 것들 제외)
  const displayAllUtxos = useMemo(() => {
    if (!walletUtxos) return [];
    const selectedIds = new Set(selectedUtxos.map(u => `${u.txid}:${u.vout}`));
    return walletUtxos.filter(u => !selectedIds.has(`${u.txid}:${u.vout}`));
  }, [walletUtxos, selectedUtxos]);

  // Fee
  const [feeEstimates, setFeeEstimates] = useState<FeeEstimates | null>(null);
  const [feeLoading, setFeeLoading] = useState(true);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [feePreset, setFeePreset] = useState<FeePreset>("medium");
  const [customFeeRate, setCustomFeeRate] = useState("");

  // Change Address
  const [selectedChangeIndex, setSelectedChangeIndex] = useState(suggestedChangeIndex);
  const [isChangeModalOpen, setIsChangeModalOpen] = useState(false);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  /// BDK가 실제로 계산한 정확한 수수료 (sat). Summary 모달이 열릴 때 채워집니다.
  const [previewFeeSats, setPreviewFeeSats] = useState<number | null>(null);
  /// BDK fee로부터 역산된 정확한 Max 수령액. 모달에서 추정치 대신 사용.
  const [previewMaxSats, setPreviewMaxSats] = useState<number | null>(null);

  // PSBT View State
  const [isGeneratingPsbt, setIsGeneratingPsbt] = useState(false);
  const [psbtGenerationError, setPsbtGenerationError] = useState<string | null>(null);
  const [isPsbtView, setIsPsbtView] = useState(false);
  const [currentPsbtBytes, setCurrentPsbtBytes] = useState<number[] | null>(null);

  // Broadcaster & Scanner View State
  const [isScanning, setIsScanning] = useState(false);
  const [isConfirmingBroadcast, setIsConfirmingBroadcast] = useState(false);
  const [scannedUR, setScannedUR] = useState<UR | null>(null);

  useEffect(() => {
    if (!suggestedLoading) {
      setSelectedChangeIndex(suggestedChangeIndex);
    }
  }, [suggestedLoading, suggestedChangeIndex]);

  useEffect(() => {
    onFetchWalletUtxos(false); // 마운트 시 캐시 없으면 조회 작동
  }, [onFetchWalletUtxos]);

  // Fee rate 로드
  const fetchFees = useCallback(async () => {
    setFeeLoading(true);
    setFeeError(null);
    try {
      const estimates = await invoke<FeeEstimates>("cmd_get_fee_estimates");
      setFeeEstimates(estimates);
    } catch (e) {
      setFeeError(String(e));
    } finally {
      setFeeLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFees();
  }, [fetchFees]);

  // 현재 선택된 fee rate (sat/vB)
  const selectedFeeRate: number | null = (() => {
    if (feePreset === "custom") {
      const v = parseFloat(customFeeRate);
      return isNaN(v) || v <= 0 ? null : v;
    }
    if (!feeEstimates) return null;
    return feeEstimates[feePreset];
  })();

  // 고정 금액을 받는 수신자들(Max 제외)의 총합
  const fixedRecipientsTotalSats = recipients
    .filter(r => !r.isMax)
    .reduce((sum, r) => sum + Math.round(parseFloat(r.amountBtc) * 1e8), 0);

  // 모든 수신자의 총합 (추후 동적으로 재계산됨)
  // 기존 로직 유지를 위해 우선 계산해놓지만, 뒤에서 Max 여부에 따라 재정의됩니다.
  let totalAmountSats = recipients.reduce((sum, r) => sum + Math.round(parseFloat(r.amountBtc) * 1e8), 0);
  const selectedUtxosTotalSats = selectedUtxos.reduce((sum, u) => sum + u.value, 0);

  // 이미 리스트에 Max 수신자가 있는지 확인
  const hasMaxRecipientInList = recipients.some(r => r.isMax);
  // 현재 전체 상태(리스트 + 드래프트)에서 Max가 켜져있는지 확인
  const isMaxActive = hasMaxRecipientInList || draftIsMax;

  // 예상 수수료 및 잔돈(Change) 계산
  // 입력: 현재 선택된 UTXO들의 주소 타입 (없으면 최소 1개의 기본 P2WPKH 가정)
  const estimatedInputTypes: AddressType[] = selectedUtxos.length > 0 
    ? selectedUtxos.map(u => inferAddressType(u.address))
    : ["P2WPKH"];

  // 출력: 확정된 수신자들 + 임시 작성중인 수신자
  const baseOutputTypes: AddressType[] = recipients.map(r => inferAddressType(r.address));
  if (draftAddress || draftAmount || draftIsMax) {
    baseOutputTypes.push(inferAddressType(draftAddress));
  }
  
  // 1. 잔돈이 있는 경우 (vbytes = ins + outs + 1 Change(P2WPKH))
  // Max가 활성화되어 있으면 무조건 잔돈이 없음.
  const estimatedVbytesWithChange = estimateVbytes(estimatedInputTypes, [...baseOutputTypes, "P2WPKH"]);
  const estimatedFeeWithChange = selectedFeeRate != null ? Math.ceil(selectedFeeRate * estimatedVbytesWithChange) : null;
  
  // 2. 잔돈이 없는 경우 (vbytes = ins + outs)
  const estimatedVbytesNoChange = estimateVbytes(estimatedInputTypes, baseOutputTypes);
  const estimatedFeeNoChange = selectedFeeRate != null ? Math.ceil(selectedFeeRate * estimatedVbytesNoChange) : null;

  // --- 동적 Max 금액 계산 (Rust) ---
  useEffect(() => {
    if (!isMaxActive || selectedFeeRate == null || selectedUtxos.length === 0) {
      setActiveMaxSats(0);
      setIsMaxDustError(false);
      return;
    }

    const runMaxCalc = async () => {
      try {
        const upsbt = selectedUtxos.map(u => ({ txid: u.txid, vout: u.vout, value: u.value, address: u.address }));
        const rpsbt = recipients.filter(r => !r.isMax).map(r => ({ address: r.address, amountSats: Math.round(parseFloat(r.amountBtc) * 1e8) }));
        
        let targetAddr = draftAddress;
        if (hasMaxRecipientInList) {
          const m = recipients.find(r => r.isMax);
          if (m) targetAddr = m.address;
        }

        const maxSats = await invoke<number>("cmd_calculate_max_amount", {
          selectedUtxos: upsbt,
          recipients: rpsbt,
          draftAddress: targetAddr || "bc1q", // fallback address if empty
          feeRate: selectedFeeRate
        });

        setActiveMaxSats(maxSats);
        setIsMaxDustError(false);
      } catch (err: any) {
        setActiveMaxSats(0);
        if (typeof err === "string" && err.includes("dust")) {
          setIsMaxDustError(true);
        } else {
          setIsMaxDustError(false);
        }
      }
    };
    
    runMaxCalc();
  }, [isMaxActive, selectedFeeRate, selectedUtxos, recipients, draftAddress, hasMaxRecipientInList]);

  const dustLimitSats = 546;

  // 드래프트가 Max인 경우 Amount 오버라이드
  if (draftIsMax) {
    // Note: 렌더링 시 값만 덮어쓰는 용도로 쓰이며, 실제 state를 즉시 바꾸지 않음. 
    // 표시 및 나중에 Recipient 추가 시 이 계산된 값을 씁니다.
  }

  // Amount Input 파싱 (표시용)
  const draftAmtSats = draftIsMax 
    ? (activeMaxSats > 0 ? activeMaxSats : 0)
    : (draftAmount 
      ? (amountUnit === "BTC" 
        ? Math.round(parseFloat(draftAmount) * 1e8) 
        : parseInt(draftAmount, 10))
      : 0);
  
  const draftAmtBtc = draftIsMax
    ? (activeMaxSats > 0 ? (activeMaxSats / 1e8).toFixed(8).replace(/\.?0+$/, "") : "0")
    : (draftAmount
      ? (amountUnit === "BTC"
        ? draftAmount
        : (parseInt(draftAmount, 10) / 1e8).toFixed(8).replace(/\.?0+$/, ""))
      : "");

  // 리스트 내에 Max 수신자가 있다면 해당 수신자의 금액도 동적 계산값으로 덮어씀
  if (hasMaxRecipientInList && activeMaxSats > 0) {
    totalAmountSats = fixedRecipientsTotalSats + activeMaxSats;
  }

  // 잔돈 유무 판단:
  // (총 선택된 UTXO 금액)과 (보낼 총액 + 잔돈 없는 수수료 + draftAmount)의 차이가 0에 가까우면 잔돈 없음 처리
  // Max가 켜져 있으면 잔돈은 절대 발생하지 않습니다.
  const requiredSatsNoChange = totalAmountSats + (draftIsMax ? 0 : draftAmtSats) + (estimatedFeeNoChange || 0);
  
  // 만약 선택된 금액이 (보낼금액+잔돈없는수수료)와 정확히 일치하거나 더 작으면(dust) 잔돈 없음으로 간주
  // 여기서는 단순히 정확히 일치하거나 남는 금액이 546 sats(dust) 이하인 경우 잔돈 없는 것으로 처리
  const hasChange = isMaxActive 
    ? false 
    : (selectedUtxosTotalSats > requiredSatsNoChange && (selectedUtxosTotalSats - requiredSatsNoChange > dustLimitSats));

  const displayedVbytes = hasChange ? estimatedVbytesWithChange : estimatedVbytesNoChange;
  let displayedFeeSats: number | null = hasChange ? estimatedFeeWithChange : estimatedFeeNoChange;
  
  // Rust 백엔드에서 반환한 정확한 Max 금액과의 오차 방지를 위해 역연산으로 수수료를 표시
  if (isMaxActive && activeMaxSats > 0) {
    displayedFeeSats = selectedUtxosTotalSats - fixedRecipientsTotalSats - activeMaxSats;
  }
  
  // 전체 필요 금액 (현재 draft 포함하지 않은, 이미 확정된 recipients 기준)
  const requiredSats = totalAmountSats + (displayedFeeSats || 0);
  // Max 모드가 아닐 때의 잔액 부족 여부
  const isSufficientFunds = isMaxActive 
    ? (!isMaxDustError && activeMaxSats > 0) 
    : (selectedUtxosTotalSats >= requiredSats);
  const changeAmountSats = hasChange ? selectedUtxosTotalSats - (totalAmountSats + (displayedFeeSats || 0)) : 0;

  // Max 금액 핸들러 (이제는 토글 방식으로 작동함)
  const handleMaxClick = () => {
    if (hasMaxRecipientInList) return; // 리스트에 이미 있으면 드래프트에서 켤 수 없음
    
    if (draftIsMax) {
      setDraftIsMax(false);
      setDraftAmount("");
    } else {
      setDraftIsMax(true);
      setDraftAmount(""); // 수동 입력값 무시
    }
  };

  // Recipient 추가
  const handleAddRecipient = () => {
    if (validateBitcoinAddress(draftAddress) !== null) return;
    if (!draftIsMax && validateAmount(draftAmtBtc) !== null) return;
    if (!draftAddress || (!draftIsMax && !draftAmount)) return;

    setRecipients(prev => [
      ...prev,
      { 
        id: Math.random().toString(36).substring(2), 
        address: draftAddress, 
        amountBtc: draftAmtBtc, // draftIsMax일 경우 동계산된 값이 저장됨. 어차피 렌더 시 덮어씀.
        isMax: draftIsMax 
      }
    ]);
    
    // 입력창 초기화
    setDraftAddress("");
    setDraftAddressTouched(false);
    setDraftAmount("");
    setDraftIsMax(false);
  };

  const removeRecipient = (id: string) => {
    setRecipients(prev => prev.filter(r => r.id !== id));
  };

  const draftAddrErrorKey = validateBitcoinAddress(draftAddress);
  const draftAddrError = draftAddrErrorKey ? t(draftAddrErrorKey) : null;
  const draftAmtErrorKey = !draftIsMax ? validateAmount(draftAmtBtc) : null; // Btc 기준으로 검증
  const draftAmtError = draftAmtErrorKey ? t(draftAmtErrorKey) : null;
  
  const isDraftValid = draftAddress.length > 0 && draftAddrError === null &&
                       (draftIsMax ? !isMaxDustError : (draftAmount.length > 0 && draftAmtError === null && draftAmtSats > 0));

  // Unit 변경 핸들러
  const toggleUnit = () => {
    if (amountUnit === "BTC") {
      setAmountUnit("sats");
      if (draftAmount && !isNaN(parseFloat(draftAmount))) {
        setDraftAmount(Math.round(parseFloat(draftAmount) * 1e8).toString());
      }
    } else {
      setAmountUnit("BTC");
      if (draftAmount && !isNaN(parseFloat(draftAmount))) {
        // preserve visual formatting a bit, but basically x / 1e8
        setDraftAmount((parseInt(draftAmount, 10) / 1e8).toFixed(8).replace(/\.?0+$/, ""));
      }
    }
  };

  // UTXO 선택 토글
  const toggleUtxo = (utxo: WalletUtxo, isSelected: boolean) => {
    if (isSelected) {
      // 선택 -> 해제
      setSelectedUtxos(prev => prev.filter(u => `${u.txid}:${u.vout}` !== `${utxo.txid}:${utxo.vout}`));
    } else {
      // 해제 -> 선택
      setSelectedUtxos(prev => {
        const next = [...prev, utxo];
        next.sort((a, b) => b.value - a.value);
        return next;
      });
    }
  };

  // 다음 단계 진행 가능 여부 (최소 1명의 확정된 수신자가 있어야 함, 선택된 UTXO 금액 >= 전송 금액 + 예상 수수료)
  const canProceed = recipients.length > 0 && selectedFeeRate != null && isSufficientFunds;

  // Summary 버튼 클릭: 먼저 PSBT를 미리 빌드해서 정확한 수수료를 가져온 뒤 모달을 엽니다.
  const handleOpenSummary = async () => {
    if (!canProceed) return;
    setIsSummaryLoading(true);
    try {
      const payload = {
        selectedUtxos: selectedUtxos.map(u => ({ txid: u.txid, vout: u.vout, value: u.value, address: u.address })),
        recipients: recipients.map(r => ({
          address: r.address,
          amountSats: r.isMax ? activeMaxSats : Math.round(parseFloat(r.amountBtc) * 1e8),
          isMax: r.isMax ?? false,
        })),
        feeRate: selectedFeeRate!
      };
      const result = await invoke<{ psbtBytes: number[]; feeSats: number }>("cmd_build_preview_psbt", payload);
      setPreviewFeeSats(result.feeSats);
      // Max 수신자의 정확한 금액 = 정확한 수수료를 귻히고 남는 잔액
      if (hasMaxRecipientInList) {
        setPreviewMaxSats(selectedUtxosTotalSats - fixedRecipientsTotalSats - result.feeSats);
      } else {
        setPreviewMaxSats(null);
      }
    } catch (e) {
      // 미리보기 빌드 실패 시에도 모달을 열되, 수수료는 추정치 사용
      setPreviewFeeSats(null);
      setPreviewMaxSats(null);
    } finally {
      setIsSummaryLoading(false);
      setIsSummaryModalOpen(true);
    }
  };

  const handleGeneratePsbt = async () => {
    if (!canProceed) return;
    setIsGeneratingPsbt(true);
    setPsbtGenerationError(null);
    try {
      // API expects: selectedUtxos, recipients, feeRate
      const payload = {
        selectedUtxos: selectedUtxos.map(u => ({
          txid: u.txid, vout: u.vout, value: u.value, address: u.address
        })),
        recipients: recipients.map(r => ({
          address: r.address,
          amountSats: r.isMax ? activeMaxSats : Math.round(parseFloat(r.amountBtc) * 1e8),
          isMax: r.isMax ?? false,
        })),
        feeRate: selectedFeeRate!
      };
      
      const psbtBytes = await invoke<number[]>("cmd_generate_psbt", payload);
      setCurrentPsbtBytes(psbtBytes);
      setIsPsbtView(true);
    } catch (e: any) {
      console.error(e);
      setPsbtGenerationError(String(e));
    } finally {
      setIsGeneratingPsbt(false);
    }
  };



  const startScanning = async () => {
    setIsScanning(true);
    setIsConfirmingBroadcast(false);
    setScannedUR(null);
  };

  const stopScanning = () => {
    setIsScanning(false);
  };

  if (isScanning) {
    return (
      <SendScanner 
        onCancel={stopScanning}
        onScanComplete={(ur) => {
          setScannedUR(ur);
          setIsConfirmingBroadcast(true);
          setIsScanning(false);
        }}
        onScanError={(err) => console.error("Scan Error: ", err)}
      />
    );
  }

  if (isConfirmingBroadcast && scannedUR) {
    return (
      <SendBroadcaster 
        scannedUR={scannedUR}
        onCancel={() => {
          setIsConfirmingBroadcast(false);
          setScannedUR(null);
          setIsPsbtView(true);
        }}
        onDone={() => {
          setIsConfirmingBroadcast(false);
          setScannedUR(null);
          setIsPsbtView(false);
          setRecipients([]);
          setDraftAddress("");
          setDraftAmount("");
          setDraftIsMax(false);
          setSelectedUtxos([]);
          onFetchWalletUtxos(true);
        }}
      />
    );
  }

  if (isPsbtView && currentPsbtBytes) {
    return (
      <SendPsbtDisplay 
        currentPsbtBytes={currentPsbtBytes}
        onCancel={() => setIsPsbtView(false)}
        onScanClick={startScanning}
      />
    );
  }

  return (
    <main className="send-panel">
      {/* Header */}
      <div className="send-header">
        <div className="send-title-row">
          <h2>{t("send.title")}</h2>
          <span className="send-subtitle">
            {t("send.subtitle")}
          </span>
        </div>
      </div>

      <div className="send-body split">
        
        {/* ── Left Column: UTXOs ── */}
        <div className="send-col left">
          <div className="send-section utxo-section">
            <span className="send-section-title">{t("send.selectedUtxos")}</span>
            <div className={`utxo-list-placeholder ${selectedUtxos.length > 0 ? "has-items" : ""}`}>
              {selectedUtxos.length === 0 ? (
                <span className="empty-text">{t("send.noUtxosSelected")}</span>
              ) : (
                selectedUtxos.map(u => (
                  <div key={`${u.txid}:${u.vout}`} className="utxo-pick-item selected" title={t("send.selectedItemTitle")}>
                    <div className="utxo-pick-top">
                      <code>{u.address}</code>
                      <button className="cr-remove-btn cr-remove-btn-custom" onClick={() => toggleUtxo(u, true)} title={t("send.deselectTitle")}>✕</button>
                    </div>
                    <div className="utxo-pick-bottom">
                      <span className="utxo-pick-value">{satsToBtc(u.value)} BTC</span>
                      <span className={`utxo-pick-badge ${u.status.confirmed ? 'confirmed' : 'pending'}`}>
                        {u.status.confirmed ? '✓ Confirmed' : '⏳ Pending'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="utxo-summary-row highlight">
              <span>{t("send.selectedTotal")}</span>
              <span className={isSufficientFunds ? 'sufficient' : 'insufficient'}>
                {selectedUtxosTotalSats.toLocaleString()} sats
              </span>
            </div>
          </div>

          <div className="send-section utxo-section flex-fill">
            <div className="send-section-header">
              <span className="send-section-title">{t("send.allUtxos")}</span>
              <button 
                className={`fee-refresh-btn ${walletUtxosLoading ? 'loading' : ''}`}
                onClick={() => onFetchWalletUtxos(true)}
                disabled={walletUtxosLoading}
                title="Refresh UTXOs (Force)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                  <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.399Zm-12.934-2.85a5.5 5.5 0 0 1 9.201-2.466l.312.311h-2.433a.75.75 0 0 0 0 1.5H16.01a.75.75 0 0 0 .75-.75V1.427a.75.75 0 0 0-1.5 0v2.43l-.31-.31a7 7 0 0 0-11.712 3.138.75.75 0 1 0 1.449.399Z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            
            <div className={`utxo-list-placeholder scrollable ${displayAllUtxos.length > 0 ? "has-items" : ""}`}>
              {walletUtxosLoading ? (
                 <span className="empty-text">{t("send.loading")}</span>
              ) : walletUtxosError ? (
                 <span className="empty-text error">{t("send.fetchError")} {walletUtxosError}</span>
              ) : displayAllUtxos.length === 0 ? (
                <span className="empty-text">{t("send.noAvailableUtxos")}</span>
              ) : (
                displayAllUtxos.map((u: WalletUtxo) => (
                  <button key={`${u.txid}:${u.vout}`} className="utxo-pick-item" onClick={() => toggleUtxo(u, false)} title={t("send.selectUtxoTitle")}>
                    <div className="utxo-pick-top">
                      <code>{u.address}</code>
                    </div>
                    <div className="utxo-pick-bottom">
                      <span className="utxo-pick-value">{satsToBtc(u.value)} BTC</span>
                      <span className={`utxo-pick-badge ${u.status.confirmed ? 'confirmed' : 'pending'}`}>
                        {u.status.confirmed ? '✓ Confirmed' : '⏳ Pending'}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* ── Transaction Summary Button ── */}
          <button
            className={`send-generate-btn summary-btn${canProceed && !isSummaryLoading ? " enabled" : ""}`}
            disabled={!canProceed || isSummaryLoading}
            onClick={handleOpenSummary}
          >
            {isSummaryLoading ? "Loading..." : t("send.transactionSummary")}
          </button>
        </div>

        {/* ── Right Column: Outputs & Fees ── */}
        <div className="send-col right">
          
          {/* Section 1: Recipients */}
          <div className="send-section recipients-section">
            <span className="send-section-title">{t("send.recipients")}</span>
            
            {/* 확정된 수신자 목록 */}
            <div className={`confirmed-recipients-list ${recipients.length === 0 ? "empty" : ""}`}>
              {recipients.map((r, i) => (
                <div key={r.id} className="confirmed-recipient-row">
                  <span className="cr-index">#{i + 1}</span>
                  <span className="cr-address" title={r.address}>
                    {r.address}
                  </span>
                  <span className="cr-amount">
                    {r.isMax ? (
                      <span className="max-tag">MAX</span>
                    ) : null}
                    {r.isMax && activeMaxSats > 0 ? satsToBtc(activeMaxSats) : r.amountBtc} BTC
                  </span>
                  <button className="cr-remove-btn" onClick={() => removeRecipient(r.id)} title={t("send.remove")}>✕</button>
                </div>
              ))}
              {recipients.length === 0 && (
                <div className="cr-empty-text">{t("send.pleaseAddRecipient")}</div>
              )}
            </div>
            
            {/* 새로운 수신자 입력 폼 */}
            <div className="draft-recipient-card">
              <div className="send-field">
                <label className="send-label">{t("send.toAddress")}</label>
                <input
                  className={`send-input monospace${draftAddrError && draftAddressTouched ? " input-error" : ""}${
                    draftAddressTouched && !draftAddrError && draftAddress ? " input-ok" : ""
                  }`}
                  type="text"
                  placeholder="bc1q… / bc1p… / 1… / 3…"
                  value={draftAddress}
                  onChange={(e) => setDraftAddress(e.currentTarget.value)}
                  onBlur={() => setDraftAddressTouched(true)}
                  spellCheck={false}
                  autoComplete="off"
                />
                {draftAddrError && draftAddressTouched && (
                  <span className="send-field-error">⚠ {draftAddrError}</span>
                )}
              </div>

              <div className="send-field">
                <div className="send-amount-header">
                  <label className="send-label">{t("send.amount")}</label>
                  <div className="send-label-actions">
                    <button className="unit-toggle-btn" onClick={toggleUnit} title={t("send.changeUnit")}>
                      ⇄ {amountUnit === "BTC" ? "BTC" : "sats"}
                    </button>
                    <button 
                      className={`max-btn ${draftIsMax ? 'active' : ''}`} 
                      onClick={handleMaxClick} 
                      disabled={selectedUtxosTotalSats === 0 || hasMaxRecipientInList}
                    >
                      {t("send.max")}
                    </button>
                  </div>
                </div>
                <div className="send-amount-row">
                  <input
                    className={`send-input amount-input${draftAmtError && !draftIsMax ? " input-error" : ""}${draftIsMax ? " is-max" : ""}`}
                    type={draftIsMax ? "text" : "number"}
                    placeholder={amountUnit === "BTC" ? "0.00000000" : "0"}
                    min="0"
                    step={amountUnit === "BTC" ? "0.00000001" : "1"}
                    value={draftIsMax ? (activeMaxSats > 0 ? (amountUnit === "BTC" ? (activeMaxSats / 1e8).toFixed(8) : activeMaxSats.toString()) : "") : draftAmount}
                    onChange={(e) => {
                      if (!draftIsMax) setDraftAmount(e.currentTarget.value);
                    }}
                    disabled={draftIsMax}
                  />
                  <span className="send-unit">{amountUnit}</span>
                </div>
                {draftAmtError && !draftIsMax && (
                  <span className="send-field-error">⚠ {draftAmtError}</span>
                )}
                {isMaxDustError && (
                  <span className="send-field-error send-field-error-red">⚠ {t("send.maxDustError", "Remaining amount is too small (dust).")}</span>
                )}
                <div className="draft-amount-row-bottom">
                  {(draftAmount || (draftIsMax && activeMaxSats > 0)) && (!draftAmtError || draftIsMax) && !isMaxDustError ? (
                    <span className="send-amount-sats">
                      {amountUnit === "BTC" 
                        ? `= ${draftAmtSats.toLocaleString()} sats` 
                        : `= ${(draftAmtSats / 1e8).toFixed(8)} BTC`}
                    </span>
                  ) : <span />}
                  
                  <button 
                    className={`add-recipient-btn ${isDraftValid ? 'active' : ''}`} 
                    onClick={handleAddRecipient}
                    disabled={!isDraftValid}
                  >
                    {t("send.addBtn")}
                  </button>
                </div>
              </div>
            </div>
            
            <div className="recipients-total">
              <span>{t("send.totalOutputAmount")}</span>
              <span className="total-val">
                {totalAmountSats > 0 ? `${totalAmountSats.toLocaleString()} sats` : "—"}
              </span>
            </div>

            {/* Change Output (Auto) */}
            <div className={`change-output-card ${!hasChange ? "disabled" : ""}`}>
              <div className="co-header">
                <span className="co-title">{t("send.changeOutputAuto")}</span>
                {hasChange && <button className="co-edit-btn" onClick={() => setIsChangeModalOpen(true)}>{t("send.edit")}</button>}
              </div>
              <div className="co-body">
                {hasChange ? (
                  <>
                    <span className="co-address" title={changeAddresses[selectedChangeIndex]}>
                      {changeAddresses[selectedChangeIndex] || t("send.loading")}
                    </span>
                    <span className="co-amount">
                      {isSufficientFunds
                        ? `${changeAmountSats.toLocaleString()} sats` 
                        : "—"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="co-address disabled-text">{t("send.maxAmountNoChange")}</span>
                    <span className="co-amount">&nbsp;</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Fee Rate */}
          <div className="send-section fee-section">
            <div className="send-fee-header">
              <div className="send-fee-title-row">
                <span className="send-section-title">{t("send.feeRate")}</span>
                <button 
                  className={`fee-refresh-btn${feeLoading ? " loading" : ""}`}
                  onClick={() => fetchFees()}
                  disabled={feeLoading}
                  title="Refresh fee rates"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                    <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.399Zm-12.934-2.85a5.5 5.5 0 0 1 9.201-2.466l.312.311h-2.433a.75.75 0 0 0 0 1.5H16.01a.75.75 0 0 0 .75-.75V1.427a.75.75 0 0 0-1.5 0v2.43l-.31-.31a7 7 0 0 0-11.712 3.138.75.75 0 1 0 1.449.399Z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              {feeLoading ? (
                <span className="fee-loading">
                  <span className="spinner-sm" /> {t("send.fetchingRates")}
                </span>
              ) : feeError ? (
                <span className="fee-fetch-error" title={feeError}>
                  {t("send.networkError")}
                </span>
              ) : null}
            </div>

            {/* Preset 버튼 */}
            <div className="fee-presets">
              {(["low", "medium", "high"] as const).map((preset) => {
                const rate = feeEstimates?.[preset];
                const labels: Record<typeof preset, string> = {
                  low: t("send.feeLow"),
                  medium: t("send.feeMedium"),
                  high: t("send.feeHigh"),
                };
                return (
                  <button
                    key={preset}
                    className={`fee-preset-btn${feePreset === preset ? " active" : ""}`}
                    onClick={() => setFeePreset(preset)}
                    disabled={feeLoading || !!feeError}
                  >
                    <span className="fee-preset-label">{labels[preset]}</span>
                    <span className="fee-preset-rate">
                      {rate != null ? `${rate.toFixed(1)} sat/vB` : "—"}
                    </span>
                  </button>
                );
              })}

              {/* Custom */}
              <button
                className={`fee-preset-btn custom${feePreset === "custom" ? " active" : ""}`}
                onClick={() => setFeePreset("custom")}
              >
                <span className="fee-preset-label">Custom</span>
                <span className="fee-preset-rate">
                  {feePreset === "custom" && customFeeRate
                    ? `${customFeeRate} sat/vB`
                    : t("send.customInput")}
                </span>
              </button>
            </div>

            {/* Custom 직접 입력 */}
            {feePreset === "custom" && (
              <div className="fee-custom-row">
                <input
                  className="send-input custom-fee-input"
                  type="number"
                  placeholder={t("send.customPlaceholder")}
                  min="1"
                  step="0.1"
                  value={customFeeRate}
                  onChange={(e) => setCustomFeeRate(e.currentTarget.value)}
                />
                <span className="send-unit">sat/vB</span>
              </div>
            )}

            {/* 예상 수수료 */}
            <div className="fee-summary">
              <div className="fee-summary-row">
                <span className="fee-summary-label">{t("send.selectedFeeRate")}</span>
                <span className="fee-summary-val">
                  {selectedFeeRate != null
                    ? `${selectedFeeRate.toFixed(1)} sat/vB`
                    : "—"}
                </span>
              </div>
              <div className="fee-summary-row">
                <span className="fee-summary-label">{t("send.estimatedSize")}</span>
                <span className="fee-summary-val">
                  ~{displayedVbytes} vB
                  <span className="fee-summary-note">
                    {t("send.feeAssumption", { in: Math.max(1, selectedUtxos.length), out: recipients.length + (hasChange ? 1 : 0) + (draftAmount ? 1 : 0) })}
                  </span>
                </span>
              </div>
              <div className="fee-summary-row highlight">
                <span className="fee-summary-label">{t("send.finalFee")}</span>
                <span className="fee-summary-val fee-total">
                  {displayedFeeSats != null
                    ? `${displayedFeeSats.toLocaleString()} sats`
                    : "—"}
                </span>
              </div>
              <p className="fee-estimate-note">{t("send.feeEstimateNote")}</p>
            </div>
          </div>

          {/* ── Generate PSBT 버튼 ── */}
          {psbtGenerationError && (
            <div className="psbt-error">
              {t("send.psbtGenError")}{psbtGenerationError}
            </div>
          )}
          <button
            className={`send-generate-btn${canProceed && !isGeneratingPsbt ? " enabled" : ""}`}
            disabled={!canProceed || isGeneratingPsbt}
            onClick={handleGeneratePsbt}
          >
            {isGeneratingPsbt ? t("send.generatingPsbt") : t("send.generatePsbt")}
            {!isGeneratingPsbt && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                width="16"
                height="16"
              >
                <path
                  fillRule="evenodd"
                  d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>
        </div>

      </div>

      {/* 잔돈 주소 선택 모달 */}
      {isChangeModalOpen && (
        <div className="modal-overlay" onClick={() => setIsChangeModalOpen(false)}>
          <div className="modal-content change-address-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t("send.changeAddressModalTitle")}</h2>
              <button className="close-btn" onClick={() => setIsChangeModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="as-header">
                <span className="as-title">{t("send.addressList")}</span>
                <span className="as-deriv">m/{scriptType === "taproot" ? "86'" : scriptType === "nested" ? "49'" : "84'"}/0'/{account}/1/*</span>
              </div>
              <div className="as-list">
                {changeAddresses.length === 0 ? (
                  <div className="as-empty">{t("send.loading")}</div>
                ) : (
                  changeAddresses.map((addr, i) => (
                    <button
                      key={addr}
                      className={`as-item ${selectedChangeIndex === i ? "active" : ""}`}
                      onClick={() => {
                        setSelectedChangeIndex(i);
                        setIsChangeModalOpen(false);
                      }}
                    >
                      <span className="as-item-index">#{i}</span>
                      {!suggestedLoading && (
                        i < suggestedChangeIndex
                          ? <span className="as-item-badge used">{t("receive.used")}</span>
                          : <span className="as-item-badge unused">{t("receive.unused")}</span>
                      )}
                      <code className="as-item-addr">
                        {addr}
                      </code>
                      {selectedChangeIndex === i && (
                        <span className="as-item-check">✓</span>
                      )}
                    </button>
                  ))
                )}
                {onLoadMoreChange && (
                  <div className="as-load-more">
                    <button 
                      className={`load-more-btn ${loadingMoreChange ? "loading" : ""}`} 
                      onClick={() => onLoadMoreChange()} 
                      disabled={loadingMoreChange}
                    >
                      {loadingMoreChange ? "Loading..." : "Load next 20 addresses"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Summary Modal */}
      {isSummaryModalOpen && (
        <div className="modal-overlay" onClick={() => setIsSummaryModalOpen(false)}>
          <div className="modal-content summary-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t("send.transactionSummary")}</h2>
              <button className="close-btn" onClick={() => setIsSummaryModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body summary-modal-body">
              <div className="summary-left">
                <h3 className="summary-col-title">Inputs</h3>
                <div className="summary-list">
                  {selectedUtxos.map(u => (
                    <div key={`${u.txid}:${u.vout}`} className="summary-item">
                      <span className="summary-item-addr" title={u.address}>{u.address}</span>
                      <span className="summary-item-val">{satsToBtc(u.value)} BTC</span>
                    </div>
                  ))}
                </div>
                <div className="summary-total">
                  <span>Total Input:</span>
                  <span className="summary-total-val">{satsToBtc(selectedUtxosTotalSats)} BTC</span>
                </div>
              </div>

              <div className="summary-arrow">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                  <path fillRule="evenodd" d="M12.97 3.97a.75.75 0 0 1 1.06 0l7.5 7.5a.75.75 0 0 1 0 1.06l-7.5 7.5a.75.75 0 1 1-1.06-1.06l6.22-6.22H3a.75.75 0 0 1 0-1.5h16.19l-6.22-6.22a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                </svg>
              </div>

              <div className="summary-right">
                <h3 className="summary-col-title">Outputs</h3>
                <div className="summary-list">
                  {recipients.map(r => (
                    <div key={r.id} className="summary-item">
                      <span className="summary-item-addr" title={r.address}>
                        {r.address}
                        {r.isMax ? <span className="summary-badge max">{t("send.max")}</span> : null}
                        <span className="summary-badge receiver">{t("send.badgeReceiver")}</span>
                      </span>
                      <span className="summary-item-val">
                        {r.isMax && (previewMaxSats ?? activeMaxSats) > 0 ? satsToBtc(previewMaxSats ?? activeMaxSats) : r.amountBtc} BTC
                      </span>
                    </div>
                  ))}
                  {hasChange && isSufficientFunds && (
                    <div className="summary-item">
                      <span className="summary-item-addr" title={changeAddresses[selectedChangeIndex]}>
                        {changeAddresses[selectedChangeIndex] || "Change Address"} <span className="summary-badge change">Change</span>
                      </span>
                      <span className="summary-item-val">{satsToBtc(changeAmountSats)} BTC</span>
                    </div>
                  )}
                  {(previewFeeSats ?? displayedFeeSats) != null && (
                    <div className="summary-item fee">
                      <span className="summary-item-addr">Miner Fee <span className="summary-badge fee">Fee</span></span>
                      <span className="summary-item-val">{satsToBtc(previewFeeSats ?? displayedFeeSats ?? 0)} BTC</span>
                    </div>
                  )}
                </div>
                <div className="summary-total">
                  <span>{t("send.totalOutput")}</span>
                  <span className="summary-total-val">{satsToBtc(previewMaxSats != null ? selectedUtxosTotalSats : totalAmountSats + (previewFeeSats ?? displayedFeeSats ?? 0))} BTC</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
