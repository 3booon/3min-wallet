import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tab, WalletView, Utxo, WalletUtxo } from "./types";
import { Tx } from "./TxDetailPanel";
import { RecentTx } from "./RecentPanel";

const PAGE_SIZE = 20;

export function useWalletState(provider: string) {
  const [mainAddresses, setMainAddresses] = useState<string[]>([]);
  const [changeAddresses, setChangeAddresses] = useState<string[]>([]);
  const [mainCount, setMainCount] = useState(PAGE_SIZE);
  const [changeCount, setChangeCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>("main");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [walletView, setWalletView] = useState<WalletView>("dashboard");

  const [suggestedMainIndex, setSuggestedMainIndex] = useState<number>(-1);
  const [suggestedChangeIndex, setSuggestedChangeIndex] = useState<number>(-1);
  const [suggestedLoading, setSuggestedLoading] = useState(false);

  const [utxos, setUtxos] = useState<Utxo[]>([]);
  const [utxoLoading, setUtxoLoading] = useState(false);
  const [utxoError, setUtxoError] = useState<string | null>(null);

  const [txs, setTxs] = useState<Tx[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<Tx | null>(null);

  const [walletUtxos, setWalletUtxos] = useState<WalletUtxo[] | null>(null);
  const [walletUtxosLoading, setWalletUtxosLoading] = useState(false);
  const [walletUtxosError, setWalletUtxosError] = useState<string | null>(null);

  const [recentTxs, setRecentTxs] = useState<RecentTx[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentFetched, setRecentFetched] = useState(false);

  const addresses = activeTab === "main" ? mainAddresses : changeAddresses;
  const selected = addresses[selectedIndex] ?? null;

  const fetchWalletUtxos = useCallback(async (force: boolean = false) => {
    if (walletUtxos !== null && !force) return;

    const allAddrs = [...mainAddresses, ...changeAddresses];
    if (allAddrs.length === 0) return;

    setWalletUtxosLoading(true);
    setWalletUtxosError(null);
    try {
      const fetchedUtxos = await invoke<WalletUtxo[]>("cmd_fetch_wallet_utxos", { addresses: allAddrs });
      setWalletUtxos(fetchedUtxos);
    } catch (e) {
      setWalletUtxosError(String(e));
    } finally {
      setWalletUtxosLoading(false);
    }
  }, [mainAddresses, changeAddresses, walletUtxos]);

  const fetchRecentTxs = useCallback(async (force: boolean = false) => {
    const allAddrs = [...mainAddresses, ...changeAddresses];
    if (allAddrs.length === 0) return;

    if (force) setRecentFetched(false);

    setRecentLoading(true);
    setRecentError(null);
    try {
      const fetchedTxs = await invoke<RecentTx[]>("cmd_fetch_recent_txs", { addresses: allAddrs });
      setRecentTxs(fetchedTxs);
      setRecentFetched(true);
    } catch (e) {
      setRecentError(String(e));
    } finally {
      setRecentLoading(false);
    }
  }, [mainAddresses, changeAddresses]);

  useEffect(() => {
    if (mainAddresses.length > 0) {
      if (!recentFetched) fetchRecentTxs();
      if (walletUtxos === null) fetchWalletUtxos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainAddresses]);

  useEffect(() => {
    if (!selected) {
      setUtxos([]); setUtxoError(null);
      setTxs([]);   setTxError(null);
      return;
    }
    let cancelled = false;

    setUtxoLoading(true); setUtxoError(null); setUtxos([]);
    invoke<Utxo[]>("cmd_fetch_utxos", { address: selected })
      .then((r) => { if (!cancelled) setUtxos(r); })
      .catch((e) => { if (!cancelled) setUtxoError(String(e)); })
      .finally(() => { if (!cancelled) setUtxoLoading(false); });

    setTxLoading(true); setTxError(null); setTxs([]); setSelectedTx(null);
    invoke<Tx[]>("cmd_fetch_txs", { address: selected })
      .then((r) => { if (!cancelled) setTxs(r); })
      .catch((e) => { if (!cancelled) setTxError(String(e)); })
      .finally(() => { if (!cancelled) setTxLoading(false); });

    return () => { cancelled = true; };
  }, [selected, provider]);

  const handleLoadMore = async (tabToLoad: Tab = activeTab) => {
    setLoadingMore(true);
    try {
      if (tabToLoad === "main") {
        const offset = mainAddresses.length;
        const newAddrs = await invoke<string[]>("cmd_get_addresses", { offset, count: PAGE_SIZE });
        setMainAddresses(prev => [...prev, ...newAddrs]); 
        setMainCount(prev => prev + PAGE_SIZE);
      } else {
        const offset = changeAddresses.length;
        const newAddrs = await invoke<string[]>("cmd_get_change_addresses", { offset, count: PAGE_SIZE });
        setChangeAddresses(prev => [...prev, ...newAddrs]); 
        setChangeCount(prev => prev + PAGE_SIZE);
      }
    } finally { setLoadingMore(false); }
  };

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab); 
    setSelectedIndex(0);
  };

  const resetState = () => {
    setRecentFetched(false);
    setRecentTxs([]);
    setRecentError(null);
    setWalletUtxos(null);
    setWalletUtxosError(null);
    setUtxos([]); 
    setUtxoError(null);
    setTxs([]); 
    setTxError(null); 
    setSelectedTx(null);
  };

  return {
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
  };
}
