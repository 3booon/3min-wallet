mod wallet;
mod api;

use wallet::{WalletState, import_wallet, get_addresses, get_change_addresses};
use api::{SettingsState, PsbtState, AppSettings, Utxo, WalletUtxo, Tx, RecentTx, fetch_utxos, fetch_wallet_utxos, fetch_txs, fetch_recent_txs, find_first_unused_address, test_electrum_connection, FeeEstimates, get_fee_estimates, clear_electrum_cache};
use api::PsbtPreviewResult;

// ── 기존 커맨드 ──────────────────────────────────────────────

#[tauri::command]
fn cmd_import_wallet(
    app_handle: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<WalletState>,
    xpub: String,
    mfp: String,
    _network: String,
    script_type: String,
) -> Result<String, String> {
    let bdk_network = bdk::bitcoin::Network::Bitcoin;
    let mut xpubs_guard = state.active_xpubs.lock().map_err(|_| "Failed to lock active_xpubs".to_string())?;
    
    use tauri::Manager;
    for (w_label, existing_xpub) in xpubs_guard.iter() {
        // If same xpub && different window && that window is still alive
        if existing_xpub == &xpub && w_label != window.label() {
            if app_handle.get_webview_window(w_label).is_some() {
                return Err("This wallet is already open in another window.".to_string());
            }
        }
    }

    let (wallet, account_str) = import_wallet(&xpub, &mfp, bdk_network, &script_type)?;
    
    xpubs_guard.insert(window.label().to_string(), xpub.clone());
    let mut w_guard = state.wallets.lock().map_err(|_| "Failed to lock wallets".to_string())?;
    w_guard.insert(window.label().to_string(), wallet);
    Ok(account_str)
}

#[tauri::command]
fn cmd_disconnect_wallet(window: tauri::Window, state: tauri::State<WalletState>) {
    if let Ok(mut w) = state.wallets.lock() {
        w.remove(window.label());
    }
    if let Ok(mut x) = state.active_xpubs.lock() {
        x.remove(window.label());
    }
    // SEC-6: clear the static electrum client caches specifically linked to this app session on disconnect
    clear_electrum_cache();
}

#[tauri::command]
fn cmd_get_addresses(window: tauri::Window, state: tauri::State<WalletState>, offset: u32, count: u32) -> Result<Vec<String>, String> {
    let w_guard = state.wallets.lock().map_err(|_| "Failed to lock wallets".to_string())?;
    match w_guard.get(window.label()) {
        Some(wallet) => get_addresses(wallet, offset, count),
        None => Err("Wallet not initialized. Please import a wallet first.".to_string()),
    }
}

#[tauri::command]
fn cmd_get_change_addresses(window: tauri::Window, state: tauri::State<WalletState>, offset: u32, count: u32) -> Result<Vec<String>, String> {
    let w_guard = state.wallets.lock().map_err(|_| "Failed to lock wallets".to_string())?;
    match w_guard.get(window.label()) {
        Some(wallet) => get_change_addresses(wallet, offset, count),
        None => Err("Wallet not initialized. Please import a wallet first.".to_string()),
    }
}

// ── 설정 커맨드 ──────────────────────────────────────────────

/// FE에서 설정을 저장할 때 호출 — Rust AppState에 단일 윈도우 키로 반영합니다.
#[tauri::command]
fn cmd_save_settings(
    window: tauri::Window,
    state: tauri::State<SettingsState>,
    settings: AppSettings,
) -> Result<(), String> {
    let mut guard = state.settings.lock().map_err(|_| "Failed to lock settings".to_string())?;
    log::debug!("settings saved for window {}: provider={:?}", window.label(), settings.provider);
    guard.insert(window.label().to_string(), settings);

    // SEC-6: clear the static electrum cache when settings change (like when switching electrum URLs)
    clear_electrum_cache();

    Ok(())
}

/// 현재 윈도우용으로 캐시/저장된 설정을 FE에 반환합니다.
#[tauri::command]
fn cmd_load_settings(window: tauri::Window, state: tauri::State<SettingsState>) -> AppSettings {
    let guard = state.settings.lock().unwrap_or_else(|e| e.into_inner());
    guard.get(window.label()).cloned().unwrap_or_default()
}

// ── API 커맨드 ───────────────────────────────────────────────

/// 주소 배열을 앞에서부터 순서대로 확인하여 tx 이력이 없는 첫 번째 주소의 index를 반환합니다.
/// 모든 주소가 사용됐으면 addresses.len()을 반환합니다 (주소 더 로드 필요 신호).
#[tauri::command]
async fn cmd_find_first_unused_address(
    window: tauri::Window,
    state: tauri::State<'_, SettingsState>,
    addresses: Vec<String>,
) -> Result<u32, String> {
    let settings = state.settings.lock()
        .map_err(|_| "Failed to lock settings".to_string())?
        .get(window.label()).cloned().unwrap_or_default();
    find_first_unused_address(&settings, &addresses).await
}

/// 주소에 대한 UTXO 목록을 현재 설정된 데이터 소스에서 가져옵니다.
#[tauri::command]
async fn cmd_fetch_utxos(
    window: tauri::Window,
    state: tauri::State<'_, SettingsState>,
    address: String,
) -> Result<Vec<Utxo>, String> {
    let settings = state.settings.lock()
        .map_err(|_| "Failed to lock settings".to_string())?
        .get(window.label()).cloned().unwrap_or_default();
    fetch_utxos(&settings, &address).await
}

/// 여러 주소에 대한 통합 UTXO 목록을 현재 설정된 데이터 소스에서 가져옵니다.
#[tauri::command]
async fn cmd_fetch_wallet_utxos(
    window: tauri::Window,
    state: tauri::State<'_, SettingsState>,
    addresses: Vec<String>,
) -> Result<Vec<WalletUtxo>, String> {
    let settings = state.settings.lock()
        .map_err(|_| "Failed to lock settings".to_string())?
        .get(window.label()).cloned().unwrap_or_default();
    fetch_wallet_utxos(&settings, &addresses).await
}

/// 주소의 트랜잭션 목록을 현재 설정된 데이터 소스에서 가져옵니다 (최신 25건).
#[tauri::command]
async fn cmd_fetch_txs(
    window: tauri::Window,
    state: tauri::State<'_, SettingsState>,
    address: String,
) -> Result<Vec<Tx>, String> {
    let settings = state.settings.lock()
        .map_err(|_| "Failed to lock settings".to_string())?
        .get(window.label()).cloned().unwrap_or_default();
    fetch_txs(&settings, &address).await
}

/// 모든 주소의 최근 트랜잭션을 중복 없이 최신순으로 가져옵니다.
#[tauri::command]
async fn cmd_fetch_recent_txs(
    window: tauri::Window,
    state: tauri::State<'_, SettingsState>,
    addresses: Vec<String>,
) -> Result<Vec<RecentTx>, String> {
    let settings = state.settings.lock()
        .map_err(|_| "Failed to lock settings".to_string())?
        .get(window.label()).cloned().unwrap_or_default();
    fetch_recent_txs(&settings, &addresses).await
}

/// Electrum 서버 연결을 테스트합니다. 성공 시 서버 정보 문자열 반환.
#[tauri::command]
async fn cmd_test_electrum_connection(url: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || test_electrum_connection(&url))
        .await
        .map_err(|e| e.to_string())?
}

/// 현재 네트워크의 Low / Medium / High fee rate (sat/vB)를 반환합니다.
#[tauri::command]
async fn cmd_get_fee_estimates(
    window: tauri::Window,
    state: tauri::State<'_, SettingsState>,
) -> Result<FeeEstimates, String> {
    let settings = state.settings.lock()
        .map_err(|_| "Failed to lock settings".to_string())?
        .get(window.label()).cloned().unwrap_or_default();
    get_fee_estimates(&settings).await
}

#[tauri::command]
async fn cmd_build_preview_psbt(
    window: tauri::Window,
    state_wallet: tauri::State<'_, WalletState>,
    state_settings: tauri::State<'_, SettingsState>,
    selected_utxos: Vec<api::PsbtUtxo>,
    recipients: Vec<api::PsbtRecipient>,
    fee_rate: f64,
) -> Result<PsbtPreviewResult, String> {
    let settings = state_settings.settings.lock()
        .map_err(|_| "Failed to lock settings".to_string())?
        .get(window.label()).cloned().unwrap_or_default();
    let label = window.label().to_string();
    api::build_preview_psbt(&label, &state_wallet, &settings, selected_utxos, recipients, fee_rate).await
}

#[tauri::command]
async fn cmd_calculate_max_amount(
    selected_utxos: Vec<api::PsbtUtxo>,
    recipients: Vec<api::PsbtRecipient>,
    draft_address: String,
    fee_rate: f64,
) -> Result<u64, String> {
    api::calculate_max_amount_inner(&selected_utxos, &recipients, &draft_address, fee_rate)
}

#[tauri::command]
async fn cmd_generate_psbt(
    window: tauri::Window,
    state_wallet: tauri::State<'_, WalletState>,
    state_settings: tauri::State<'_, SettingsState>,
    state_psbt: tauri::State<'_, PsbtState>,
    selected_utxos: Vec<api::PsbtUtxo>,
    recipients: Vec<api::PsbtRecipient>,
    fee_rate: f64,
) -> Result<Vec<u8>, String> {
    let settings = state_settings.settings.lock()
        .map_err(|_| "Failed to lock settings".to_string())?
        .get(window.label()).cloned().unwrap_or_default();
    let label = window.label().to_string();
    api::generate_psbt(&label, &state_wallet, &state_psbt, &settings, selected_utxos, recipients, fee_rate).await
}

#[tauri::command]
async fn cmd_broadcast_psbt(
    window: tauri::Window,
    state_wallet: tauri::State<'_, WalletState>,
    state_settings: tauri::State<'_, SettingsState>,
    state_psbt: tauri::State<'_, PsbtState>,
    psbt_bytes: Vec<u8>,
) -> Result<String, String> {
    let settings = state_settings.settings.lock()
        .map_err(|_| "Failed to lock settings".to_string())?
        .get(window.label()).cloned().unwrap_or_default();
    let label = window.label().to_string();
    api::broadcast_psbt(&label, &state_wallet, &state_psbt, &settings, psbt_bytes).await
}

#[tauri::command]
async fn cmd_open_new_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    let window_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let label = format!("window_{}", window_id);

    tauri::WebviewWindowBuilder::new(
        &app_handle,
        label.clone(),
        tauri::WebviewUrl::App("index.html".into())
    )
    .title("3min-wallet")
    .inner_size(1280.0, 900.0)
    .build()
    .map_err(|e| format!("Failed to build window: {}", e))?;

    Ok(())
}

// ── 앱 진입점 ────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(WalletState::new())
        .manage(SettingsState::new())
        .manage(PsbtState::new())
        .invoke_handler(tauri::generate_handler![
            cmd_import_wallet,
            cmd_get_addresses,
            cmd_get_change_addresses,
            cmd_save_settings,
            cmd_load_settings,
            cmd_fetch_utxos,
            cmd_fetch_wallet_utxos,
            cmd_fetch_txs,
            cmd_fetch_recent_txs,
            cmd_find_first_unused_address,
            cmd_test_electrum_connection,
            cmd_get_fee_estimates,
            cmd_build_preview_psbt,
            cmd_calculate_max_amount,
            cmd_generate_psbt,
            cmd_broadcast_psbt,
            cmd_open_new_window,
            cmd_disconnect_wallet,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
