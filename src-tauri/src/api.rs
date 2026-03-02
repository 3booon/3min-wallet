use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::str::FromStr;
use bdk::bitcoin::Address;
use once_cell::sync::Lazy;
use std::sync::Arc;

// 전역 공유 HTTP 클라이언트 및 Electrum 클라이언트 캐시
static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| reqwest::Client::new());
static ELECTRUM_CLIENTS: Lazy<Mutex<std::collections::HashMap<String, Arc<Mutex<bdk::electrum_client::Client>>>>> = Lazy::new(|| Mutex::new(std::collections::HashMap::new()));
static ELECTRUM_BLOCKCHAINS: Lazy<Mutex<std::collections::HashMap<String, Arc<bdk::blockchain::ElectrumBlockchain>>>> = Lazy::new(|| Mutex::new(std::collections::HashMap::new()));

fn get_cached_raw_client(url: &str) -> Result<Arc<Mutex<bdk::electrum_client::Client>>, String> {
    let mut cache = ELECTRUM_CLIENTS.lock().map_err(|_| "Failed to lock electrum clients cache")?;
    if let Some(client) = cache.get(url) {
        return Ok(client.clone());
    }
    let client = bdk::electrum_client::Client::new(url)
        .map_err(|e| format!("Electrum connection failed to '{}': {}", url, e))?;
    let wrapped = Arc::new(Mutex::new(client));
    cache.insert(url.to_string(), wrapped.clone());
    Ok(wrapped)
}

fn get_cached_blockchain(url: &str) -> Result<Arc<bdk::blockchain::ElectrumBlockchain>, String> {
    let mut cache = ELECTRUM_BLOCKCHAINS.lock().map_err(|_| "Failed to lock blockchain cache")?;
    if let Some(bc) = cache.get(url) {
        return Ok(bc.clone());
    }
    let client = bdk::electrum_client::Client::new(url)
        .map_err(|e| format!("Electrum connection failed to '{}': {}", url, e))?;
    let bc = Arc::new(bdk::blockchain::ElectrumBlockchain::from(client));
    cache.insert(url.to_string(), bc.clone());
    Ok(bc)
}

pub fn clear_electrum_cache() {
    if let Ok(mut clients) = ELECTRUM_CLIENTS.lock() {
        clients.clear();
    }
    if let Ok(mut blockchains) = ELECTRUM_BLOCKCHAINS.lock() {
        blockchains.clear();
    }
    log::info!("Electrum cache cleared");
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Provider {
    ExternalRest,
    Electrum,
}

impl Default for Provider {
    fn default() -> Self { Provider::ExternalRest }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub provider: Provider,
    pub network: String, // always "bitcoin" for v0.1.0
    pub local_node_url: String,
    pub language: String,
    pub wallet_name: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            provider: Provider::ExternalRest,
            network: "bitcoin".to_string(),
            local_node_url: String::new(),
            language: "en".to_string(),
            wallet_name: "3min wallet".to_string(),
        }
    }
}

use std::collections::HashMap;

pub struct SettingsState {
    pub settings: Mutex<HashMap<String, AppSettings>>,
}

impl SettingsState {
    pub fn new() -> Self {
        SettingsState { settings: Mutex::new(HashMap::new()) }
    }
}

pub struct PsbtState {
    pub psbts: Mutex<HashMap<String, Vec<u8>>>,
}

impl PsbtState {
    pub fn new() -> Self {
        PsbtState { psbts: Mutex::new(HashMap::new()) }
    }
}

// ── 공통 출력 구조 ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UtxoStatus {
    pub confirmed: bool,
    pub block_height: Option<u64>,
    pub block_hash: Option<String>,
    pub block_time: Option<u64>,
    #[serde(default)]
    pub confirmations: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Utxo {
    pub txid: String,
    pub vout: u32,
    pub value: u64,
    pub status: UtxoStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletUtxo {
    pub address: String,
    #[serde(flatten)]
    pub utxo: Utxo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prevout {
    pub scriptpubkey_address: Option<String>,
    pub scriptpubkey_type: Option<String>,
    pub value: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vin {
    pub txid: Option<String>,
    pub vout: Option<u32>,
    pub is_coinbase: Option<bool>,
    pub prevout: Option<Prevout>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vout {
    pub scriptpubkey_address: Option<String>,
    pub scriptpubkey_type: Option<String>,
    pub value: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxStatus {
    pub confirmed: bool,
    pub block_height: Option<u64>,
    pub block_time: Option<u64>,
    #[serde(default)]
    pub confirmations: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tx {
    pub txid: String,
    pub fee: Option<u64>,
    pub size: Option<u32>,
    pub weight: Option<u32>,
    pub status: TxStatus,
    pub vin: Vec<Vin>,
    pub vout: Vec<Vout>,
}

// ── 주소 → scripthash 변환 ──────────────────────────────────

/// Bitcoin 주소를 Electrum용 scripthash (SHA256, reversed) 로 변환합니다.
fn addr_to_scripthash(addr: &str) -> Result<String, String> {
    use sha2::{Sha256, Digest};

    let script = addr_to_scriptpubkey(addr)?;
    let mut hasher = Sha256::new();
    hasher.update(&script);
    let mut hash = hasher.finalize().to_vec();
    hash.reverse();
    Ok(hex::encode(hash))
}

fn addr_to_scriptpubkey(addr_str: &str) -> Result<Vec<u8>, String> {
    // bdk/bitcoin의 Address 타입을 사용하여 모든 네트워크 주소를 파싱합니다.
    let address = Address::from_str(addr_str)
        .map_err(|e| format!("Invalid address '{}': {}", addr_str, e))?;
    
    // 주소의 네트워크를 검증하지 않고 스크립트를 추출합니다.
    Ok(address.assume_checked().script_pubkey().to_bytes())
}


// ── API Base URLs ───────────────────────────────────────────

fn get_external_url(_network: &str) -> String {
    "https://blockstream.info/api".to_string()
}


pub async fn fetch_utxos(settings: &AppSettings, address: &str) -> Result<Vec<Utxo>, String> {
    match settings.provider {
        Provider::ExternalRest => {
            let base_url = get_external_url(&settings.network);
            fetch_utxos_external_rest(&base_url, address).await
        },
        Provider::Electrum => {
            let url = &settings.local_node_url;
            if url.is_empty() { return Err("Electrum server URL is not configured.".into()); }
            tokio::task::spawn_blocking({
                let url = url.clone();
                let addr = address.to_string();
                move || fetch_utxos_electrum_blocking(&url, &addr)
            }).await.map_err(|e| e.to_string())?
        }
    }
}

pub async fn fetch_txs(settings: &AppSettings, address: &str) -> Result<Vec<Tx>, String> {
    match settings.provider {
        Provider::ExternalRest => {
            let base_url = get_external_url(&settings.network);
            fetch_txs_external_rest(&base_url, address).await
        },
        Provider::Electrum => {
            let url = &settings.local_node_url;
            if url.is_empty() { return Err("Electrum server URL is not configured.".into()); }
            tokio::task::spawn_blocking({
                let url = url.clone();
                let addr = address.to_string();
                move || fetch_txs_electrum_blocking(&url, &addr)
            }).await.map_err(|e| e.to_string())?
        }
    }
}

/// 주소의 트랜잭션 총 개수만 조회합니다 (미사용 주소 판단용).
/// tx_count == 0 이면 해당 주소는 한 번도 사용된 적 없는 미사용 주소입니다.
pub async fn fetch_tx_count(settings: &AppSettings, address: &str) -> Result<u64, String> {
    match settings.provider {
        Provider::ExternalRest => {
            let base_url = get_external_url(&settings.network);
            fetch_tx_count_external_rest(&base_url, address).await
        },
        Provider::Electrum => {
            let url = &settings.local_node_url;
            if url.is_empty() { return Err("Electrum server URL is not configured.".into()); }
            tokio::task::spawn_blocking({
                let url = url.clone();
                let addr = address.to_string();
                move || fetch_tx_count_electrum_blocking(&url, &addr)
            }).await.map_err(|e| e.to_string())?
        }
    }
}

/// 주소 목록을 앞에서부터 순서대로 확인하여
/// 트랜잭션 이력이 없는 첫 번째 주소의 index를 반환합니다.
/// 모든 주소가 사용됐으면 주소 목록의 마지막 index + 1을 반환합니다.
pub async fn find_first_unused_address(
    settings: &AppSettings,
    addresses: &[String],
) -> Result<u32, String> {
    use futures::future::join_all;

    // chunk 단위(예: 5개)로 나누어 요청 -> 429 방지 (Gap limit 구현)
    let chunk_size = 5;
    let mut current_index = 0;

    for chunk in addresses.chunks(chunk_size) {
        let futures: Vec<_> = chunk.iter().map(|addr| {
            fetch_tx_count(settings, addr)
        }).collect();

        let results = join_all(futures).await;

        for res in results.into_iter() {
            let count = res?;
            if count == 0 {
                return Ok(current_index);
            }
            current_index += 1;
        }
    }

    // 모두 사용됐으면 마지막 + 1 (더 로드 필요 신호)
    Ok(addresses.len() as u32)
}

/// 최근 트랜잭션 조회 결과 (주소 포함)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentTx {
    pub address: String,
    pub tx: Tx,
}

/// 모든 주소 목록을 받아, 각 주소의 TX를 가져와 txid 기준 중복 제거 후 최신순 정렬합니다.
pub async fn fetch_recent_txs(
    settings: &AppSettings,
    addresses: &[String],
) -> Result<Vec<RecentTx>, String> {
    use std::collections::HashSet;
    use futures::future::join_all;

    let mut seen_txids: HashSet<String> = HashSet::new();
    let mut recent: Vec<RecentTx> = Vec::new();

    // 병렬로 API 조회
    let futures: Vec<_> = addresses.iter().map(|addr| async move {
        let res = fetch_txs(settings, addr).await;
        (addr, res)
    }).collect();

    let results = join_all(futures).await;

    for (addr, res) in results {
        match res {
            Ok(txs) => {
                for tx in txs {
                    if seen_txids.insert(tx.txid.clone()) {
                        recent.push(RecentTx {
                            address: addr.clone(),
                            tx,
                        });
                    }
                }
            }
            Err(e) => {
                log::warn!("fetch_recent_txs failed for {}: {}", addr, e);
            }
        }
    }

    // 최신순 정렬: confirmed TX는 block_time 기준, pending TX는 맨 앞
    recent.sort_by(|a, b| {
        let ta = a.tx.status.block_time.unwrap_or(u64::MAX);
        let tb = b.tx.status.block_time.unwrap_or(u64::MAX);
        tb.cmp(&ta)
    });

    Ok(recent)
}

/// 계정의 전체 주소 목록을 받아 각 주소의 UTXO를 모두 가져와 평탄화합니다.
pub async fn fetch_wallet_utxos(
    settings: &AppSettings,
    addresses: &[String],
) -> Result<Vec<WalletUtxo>, String> {
    use futures::future::join_all;

    let mut wallet_utxos: Vec<WalletUtxo> = Vec::new();

    // 병렬 조회
    let futures: Vec<_> = addresses.iter().map(|addr| async move {
        let res = fetch_utxos(settings, addr).await;
        (addr, res)
    }).collect();

    let results = join_all(futures).await;

    for (addr, res) in results {
        match res {
            Ok(utxos) => {
                for u in utxos {
                    wallet_utxos.push(WalletUtxo {
                        address: addr.clone(),
                        utxo: u,
                    });
                }
            }
            Err(e) => {
                log::warn!("fetch_wallet_utxos failed for {}: {}", addr, e);
            }
        }
    }
    
    // value 기준으로 내림차순 정렬 (원한다면 다른 기준 가능)
    wallet_utxos.sort_by(|a, b| b.utxo.value.cmp(&a.utxo.value));
    Ok(wallet_utxos)
}

// ── Blockstream 구현 ─────────────────────────────────────────

/// Blockstream /address/{addr} → chain_stats + mempool_stats 로 TX 수만 조회
async fn fetch_tx_count_external_rest(base_url: &str, address: &str) -> Result<u64, String> {
    let url = format!("{}/address/{}", base_url, address);
    let resp = HTTP_CLIENT.get(&url).header("User-Agent", "3min-wallet/0.1").send().await
        .map_err(|e| format!("Network error: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Blockstream API error: HTTP {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("JSON parse error: {}", e))?;

    let chain = json["chain_stats"]["tx_count"].as_u64().unwrap_or(0);
    let mempool = json["mempool_stats"]["tx_count"].as_u64().unwrap_or(0);
    Ok(chain + mempool)
}

async fn fetch_utxos_external_rest(base_url: &str, address: &str) -> Result<Vec<Utxo>, String> {
    let tip_height = fetch_tip_height_external_rest(base_url).await;

    let url = format!("{}/address/{}/utxo", base_url, address);
    let resp = HTTP_CLIENT.get(&url).header("User-Agent", "3min-wallet/0.1").send().await
        .map_err(|e| format!("Network error: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Blockstream API error: HTTP {}", resp.status()));
    }
    let mut utxos: Vec<Utxo> = resp.json().await.map_err(|e| format!("JSON parse error: {}", e))?;

    if let Some(tip) = tip_height {
        for u in &mut utxos {
            if let Some(bh) = u.status.block_height {
                u.status.confirmations = Some(tip.saturating_sub(bh) + 1);
            } else {
                u.status.confirmations = Some(0);
            }
        }
    }

    Ok(utxos)
}

/// 현재 체인 tip 블록 높이를 조회합니다 (ExternalRest용)
async fn fetch_tip_height_external_rest(base_url: &str) -> Option<u64> {
    let url = format!("{}/blocks/tip/height", base_url);
    let resp = HTTP_CLIENT.get(&url).header("User-Agent", "3min-wallet/0.1").send().await.ok()?;
    if !resp.status().is_success() { return None; }
    let text = resp.text().await.ok()?;
    text.trim().parse::<u64>().ok()
}

async fn fetch_txs_external_rest(base_url: &str, address: &str) -> Result<Vec<Tx>, String> {
    let tip_height = fetch_tip_height_external_rest(base_url).await;

    let url = format!("{}/address/{}/txs", base_url, address);
    let resp = HTTP_CLIENT.get(&url).header("User-Agent", "3min-wallet/0.1").send().await
        .map_err(|e| format!("Network error: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Blockstream API error: HTTP {}", resp.status()));
    }
    let mut txs: Vec<Tx> = resp.json().await.map_err(|e| format!("JSON parse error: {}", e))?;

    // block_height와 tip_height로 confirmations 계산
    if let Some(tip) = tip_height {
        for tx in &mut txs {
            if let Some(bh) = tx.status.block_height {
                tx.status.confirmations = Some(tip.saturating_sub(bh) + 1);
            } else {
                tx.status.confirmations = Some(0);
            }
        }
    }

    Ok(txs)
}

// ── Electrum 구현 (blocking — spawn_blocking으로 감싸서 사용) ──

/// bdk 0.30.x의 electrum_client::Client를 캐시에서 가져옵니다
fn electrum_client(url: &str) -> Result<Arc<Mutex<bdk::electrum_client::Client>>, String> {
    get_cached_raw_client(url)
}

/// Electrum: scripthash.get_history 결과 길이로 tx 개수를 조회합니다.
fn fetch_tx_count_electrum_blocking(url: &str, address: &str) -> Result<u64, String> {
    use bdk::electrum_client::ElectrumApi;
    let client_auth = electrum_client(url)?;
    let client = client_auth.lock().map_err(|_| "Failed to lock client")?;
    let scripthash = addr_to_scripthash(address)?;

    let result = client.raw_call(
        "blockchain.scripthash.get_history",
        vec![bdk::electrum_client::Param::String(scripthash)],
    ).map_err(|e| format!("get_history error: {}", e))?;

    let count = result.as_array().map(|a| a.len() as u64).unwrap_or(0);
    Ok(count)
}

/// Electrum 서버 연결을 테스트합니다.
/// 성공 시 서버 소프트웨어 이름/버전 문자열 반환, 실패 시 에러 메시지 반환.
pub fn test_electrum_connection(url: &str) -> Result<String, String> {
    use bdk::electrum_client::ElectrumApi;

    let client_auth = electrum_client(url)?;
    let client = client_auth.lock().map_err(|_| "Failed to lock client")?;

    // server.version 호출: 서버 소프트웨어 이름 + 프로토콜 버전 반환
    let result = client.raw_call(
        "server.version",
        vec![
            bdk::electrum_client::Param::String("3min-wallet/0.1".to_string()),
            bdk::electrum_client::Param::String("1.4".to_string()),
        ],
    ).map_err(|e| format!("server.version failed: {}", e))?;

    // 응답은 ["서버명 버전", "프로토콜버전"] 형태
    let server_info = if let Some(arr) = result.as_array() {
        arr.iter()
            .filter_map(|v| v.as_str())
            .collect::<Vec<_>>()
            .join(" / ")
    } else {
        result.to_string()
    };

    Ok(server_info)
}

fn fetch_utxos_electrum_blocking(url: &str, address: &str) -> Result<Vec<Utxo>, String> {
    use bdk::electrum_client::ElectrumApi;

    let client_auth = electrum_client(url)?;
    let client = client_auth.lock().map_err(|_| "Failed to lock client")?;
    let scripthash = addr_to_scripthash(address)
        .map_err(|e| format!("Scripthash error: {}", e))?;

    let result = client.raw_call("blockchain.scripthash.listunspent",
        vec![bdk::electrum_client::Param::String(scripthash)])
        .map_err(|e| format!("Electrum RPC error: {}", e))?;

    // 현재 tip 높이 조회 (confirmations 계산용)
    let tip_height: Option<u64> = client.raw_call(
        "blockchain.headers.subscribe",
        vec![],
    ).ok().and_then(|v| v["height"].as_u64());

    let items = result.as_array().ok_or("Expected array response")?;
    let utxos = items.iter().map(|item| {
        let height = item["height"].as_u64().unwrap_or(0);
        let confirmations = tip_height
            .filter(|_| height > 0)
            .map(|tip| tip.saturating_sub(height) + 1);
        Utxo {
            txid: item["tx_hash"].as_str().unwrap_or("").to_string(),
            vout: item["tx_pos"].as_u64().unwrap_or(0) as u32,
            value: item["value"].as_u64().unwrap_or(0),
            status: UtxoStatus {
                confirmed: height > 0,
                block_height: if height > 0 { Some(height) } else { None },
                block_hash: None,
                block_time: None,
                confirmations,
            },
        }
    }).collect();

    Ok(utxos)
}


fn fetch_txs_electrum_blocking(url: &str, address: &str) -> Result<Vec<Tx>, String> {
    use bdk::electrum_client::ElectrumApi;
    use std::collections::HashMap;

    let client_auth = electrum_client(url)?;
    let client = client_auth.lock().map_err(|_| "Failed to lock client")?;
    let scripthash = addr_to_scripthash(address)?;

    // 1. 트랜잭션 히스토리 조회
    let history = client.raw_call("blockchain.scripthash.get_history",
        vec![bdk::electrum_client::Param::String(scripthash)])
        .map_err(|e| format!("get_history error: {}", e))?;

    let items = match history.as_array() {
        Some(arr) if !arr.is_empty() => arr.clone(),
        _ => return Ok(vec![]),
    };

    // 2. 각 TX verbose 조회 (최신 25건)
    let mut tx_raws: Vec<(serde_json::Value, i64)> = Vec::new();
    for item in items.iter().take(25) {
        let txid = item["tx_hash"].as_str().unwrap_or("").to_string();
        let height = item["height"].as_i64().unwrap_or(0);
        if let Ok(tx_json) = client.raw_call("blockchain.transaction.get",
            vec![
                bdk::electrum_client::Param::String(txid),
                bdk::electrum_client::Param::Bool(true),
            ]) {
            tx_raws.push((tx_json, height));
        }
    }

    // 3. 모든 input의 prevout txid 수집 후 일괄 조회
    let mut prevout_txids: std::collections::HashSet<String> = Default::default();
    for (tx_raw, _) in &tx_raws {
        if let Some(vins) = tx_raw["vin"].as_array() {
            for v in vins {
                if v.get("coinbase").is_none() {
                    if let Some(ptxid) = v["txid"].as_str() {
                        prevout_txids.insert(ptxid.to_string());
                    }
                }
            }
        }
    }

    let mut prevout_map: HashMap<String, serde_json::Value> = HashMap::new();
    for ptxid in prevout_txids {
        if let Ok(ptx) = client.raw_call("blockchain.transaction.get",
            vec![
                bdk::electrum_client::Param::String(ptxid.clone()),
                bdk::electrum_client::Param::Bool(true),
            ]) {
            prevout_map.insert(ptxid, ptx);
        }
    }

    // 4. 파싱
    let txs = tx_raws.iter()
        .filter_map(|(tx_raw, height)| parse_electrum_tx(tx_raw, *height, &prevout_map))
        .collect();

    Ok(txs)
}

fn parse_electrum_tx(
    json: &serde_json::Value,
    history_height: i64,
    prevout_map: &std::collections::HashMap<String, serde_json::Value>,
) -> Option<Tx> {
    let txid = json["txid"].as_str()?.to_string();
    let confirmations = json["confirmations"].as_u64();
    let confirmed = confirmations.unwrap_or(0) > 0 || history_height > 0;
    let block_height = if history_height > 0 { Some(history_height as u64) } else { None };
    let block_time = json["blocktime"].as_u64();

    let size = json["vsize"].as_u64().or_else(|| json["size"].as_u64()).map(|s| s as u32);
    let weight = json["weight"].as_u64().map(|w| w as u32);

    let vin: Vec<Vin> = json["vin"].as_array().map(|arr| {
        arr.iter().map(|v| {
            let is_coinbase = v.get("coinbase").is_some();
            let in_txid = if is_coinbase { None } else { v["txid"].as_str().map(String::from) };
            let in_vout = v["vout"].as_u64().map(|n| n as u32);

            // prevout 조회
            let prevout = if !is_coinbase {
                in_txid.as_ref().and_then(|ptxid| {
                    let pvout_n = in_vout.unwrap_or(0) as usize;
                    prevout_map.get(ptxid).and_then(|ptx| {
                        ptx["vout"].as_array().and_then(|vouts| vouts.get(pvout_n)).map(|po| {
                            let value_btc = po["value"].as_f64().unwrap_or(0.0);
                            let addr = po["scriptPubKey"]["address"].as_str().map(String::from)
                                .or_else(|| po["scriptPubKey"]["addresses"].as_array()
                                    .and_then(|a| a.first())
                                    .and_then(|a| a.as_str())
                                    .map(String::from));
                            Prevout {
                                scriptpubkey_address: addr,
                                scriptpubkey_type: po["scriptPubKey"]["type"].as_str().map(String::from),
                                value: Some((value_btc * 1e8).round() as u64),
                            }
                        })
                    })
                })
            } else { None };

            Vin { txid: in_txid, vout: in_vout, is_coinbase: Some(is_coinbase), prevout }
        }).collect()
    }).unwrap_or_default();

    // fee 계산: total_in - total_out (prevout 있을 때만)
    let total_in: u64 = vin.iter().filter_map(|v| v.prevout.as_ref()?.value).sum();
    let vout_parsed: Vec<Vout> = json["vout"].as_array().map(|arr| {
        arr.iter().map(|v| {
            let val = (v["value"].as_f64().unwrap_or(0.0) * 1e8).round() as u64;
            let addr = v["scriptPubKey"]["address"].as_str().map(String::from)
                .or_else(|| v["scriptPubKey"]["addresses"].as_array()
                    .and_then(|a| a.first()).and_then(|a| a.as_str()).map(String::from));
            Vout {
                scriptpubkey_address: addr,
                scriptpubkey_type: v["scriptPubKey"]["type"].as_str().map(String::from),
                value: val,
            }
        }).collect()
    }).unwrap_or_default();

    let total_out: u64 = vout_parsed.iter().map(|v| v.value).sum();
    let fee = if total_in > total_out && total_in > 0 { Some(total_in - total_out) } else { None };

    Some(Tx {
        txid,
        fee,
        size,
        weight,
        status: TxStatus { confirmed, block_height, block_time, confirmations },
        vin,
        vout: vout_parsed,
    })
}

// ── Fee 추정 (mempool.space) ──────────────────────────────────

const MEMPOOL_BASE: &str = "https://mempool.space/api";

/// Low / Medium / High fee rate (sat/vB)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeeEstimates {
    pub low: f64,
    pub medium: f64,
    pub high: f64,
}

/// provider에 관계없이 mempool.space /api/v1/fees/recommended 를 사용합니다.
/// Electrum 모드라도 fee rate 추정은 공개 API가 더 정확합니다.
/// mempool.space 실패 시 Electrum 모드에서는 estimatefee으로 fallback합니다.
pub async fn get_fee_estimates(settings: &AppSettings) -> Result<FeeEstimates, String> {
    // 1차: mempool.space
    if let Ok(est) = get_fee_estimates_mempool().await {
        return Ok(est);
    }
    // 2차 fallback: Electrum estimatefee (Electrum 모드일 때만)
    if settings.provider == Provider::Electrum && !settings.local_node_url.is_empty() {
        let url = settings.local_node_url.clone();
        return tokio::task::spawn_blocking(move || get_fee_estimates_electrum_blocking(&url))
            .await
            .map_err(|e| e.to_string())?;
    }
    Err("Fee rate 조회 실패: mempool.space에 연결할 수 없습니다.".into())
}

/// mempool.space GET /api/v1/fees/recommended
/// → { "fastestFee": N, "halfHourFee": N, "hourFee": N, "minimumFee": N }
async fn get_fee_estimates_mempool() -> Result<FeeEstimates, String> {
    let url = format!("{}/v1/fees/recommended", MEMPOOL_BASE);
    let resp = HTTP_CLIENT
        .get(&url)
        .header("User-Agent", "3min-wallet/0.1")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("mempool.space API error: HTTP {}", resp.status()));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("JSON parse error: {}", e))?;

    let rate = |key: &str| json[key].as_f64().unwrap_or(1.0);

    Ok(FeeEstimates {
        high:   rate("fastestFee"),   // 다음 블록
        medium: rate("halfHourFee"),  // ~30분
        low:    rate("hourFee"),      // ~1시간
    })
}

/// Electrum fallback: blockchain.estimatefee N → BTC/kB → sat/vB 환산
fn get_fee_estimates_electrum_blocking(url: &str) -> Result<FeeEstimates, String> {
    use bdk::electrum_client::ElectrumApi;

    let estimate = |blocks: usize| -> f64 {
        electrum_client(url)
            .ok()
            .and_then(|wrapped| {
                if let Ok(c) = wrapped.lock() {
                    c.raw_call(
                        "blockchain.estimatefee",
                        vec![bdk::electrum_client::Param::Usize(blocks)],
                    ).ok()
                } else {
                    None
                }
            })
            .and_then(|v| v.as_f64())
            .map(|btc_per_kb| (btc_per_kb * 1e8 / 1000.0).max(1.0))
            .unwrap_or(1.0)
    };

    Ok(FeeEstimates {
        high:   estimate(1),
        medium: estimate(6),
        low:    estimate(144),
    })
}

// ── PSBT 생성 ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsbtRecipient {
    pub address: String,
    pub amount_sats: u64,
    #[serde(default)]
    pub is_max: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsbtUtxo {
    pub txid: String,
    pub vout: u32,
    pub value: u64,
    pub address: String,
}

/// 잔여 Max 수령액 계산 (프론트엔드의 로직을 Rust로 완전히 이관)
pub fn calculate_max_amount_inner(
    selected_utxos: &[PsbtUtxo],
    recipients: &[PsbtRecipient],
    draft_address: &str,
    fee_rate: f64,
) -> Result<u64, String> {
    if selected_utxos.is_empty() {
        return Ok(0);
    }

    let total_in: u64 = selected_utxos.iter().map(|u| u.value).sum();
    let total_fixed_out: u64 = recipients.iter().map(|r| r.amount_sats).sum();

    let get_input_weight = |addr_str: &str| -> u64 {
        if addr_str.starts_with("bc1p") || addr_str.starts_with("tb1p") {
            58
        } else if addr_str.starts_with("bc1q") || addr_str.starts_with("tb1q") {
            68
        } else if addr_str.starts_with('3') || addr_str.starts_with('2') {
            91
        } else {
            148
        }
    };

    let get_output_weight = |addr_str: &str| -> u64 {
        if addr_str.starts_with("bc1p") || addr_str.starts_with("tb1p") {
            43
        } else if addr_str.starts_with("bc1q") || addr_str.starts_with("tb1q") {
            31
        } else if addr_str.starts_with('3') || addr_str.starts_with('2') {
            32
        } else {
            34
        }
    };

    let mut total_vbytes = 10.5;
    for u in selected_utxos {
        total_vbytes += get_input_weight(&u.address) as f64;
    }
    for r in recipients {
        total_vbytes += get_output_weight(&r.address) as f64;
    }
    total_vbytes += get_output_weight(draft_address) as f64; // Max output

    let fee = (total_vbytes * fee_rate).ceil() as u64;

    let sum_deductions = total_fixed_out.saturating_add(fee);
    if total_in < sum_deductions {
        return Err(format!("Insufficient funds: Total Input ({}) is less than deductions ({})", total_in, sum_deductions));
    }

    let max_amount = total_in - sum_deductions;
    const DUST_LIMIT: u64 = 546;

    if max_amount <= DUST_LIMIT {
        return Err(format!("Remaining amount is too small (dust). Amount: {} sats", max_amount));
    }

    Ok(max_amount)
}

fn get_electrum_url(settings: &AppSettings) -> String {
    if settings.provider == Provider::Electrum && !settings.local_node_url.is_empty() {
        settings.local_node_url.clone()
    } else {
        "ssl://electrum.blockstream.info:50002".to_string()
    }
}

fn sync_and_build_psbt(
    label: &str,
    wallet_state: &crate::wallet::WalletState,
    url: &str,
    selected_utxos: Vec<PsbtUtxo>,
    recipients: Vec<PsbtRecipient>,
    fee_rate: f64,
) -> Result<(bdk::bitcoin::psbt::PartiallySignedTransaction, u64), String> {
    use bdk::SyncOptions;

    let blockchain = get_cached_blockchain(url)?;

    let mut wallet_guard = wallet_state
        .wallets
        .lock()
        .map_err(|_| "Wallet lock failed".to_string())?;
    let wallet = wallet_guard
        .get_mut(label)
        .ok_or("Wallet not initialized")?;

    wallet
        .sync(&*blockchain, SyncOptions::default())
        .map_err(|e| format!("Wallet sync failed: {}", e))?;

    build_psbt_inner(wallet, selected_utxos, recipients, fee_rate)
}

pub async fn generate_psbt(
    label: &str,
    wallet_state: &crate::wallet::WalletState,
    psbt_state: &PsbtState,
    settings: &AppSettings,
    selected_utxos: Vec<PsbtUtxo>,
    recipients: Vec<PsbtRecipient>,
    fee_rate: f64,
) -> Result<Vec<u8>, String> {
    let url = get_electrum_url(settings);

    tokio::task::block_in_place(|| {
        let (psbt, _exact_fee) =
            sync_and_build_psbt(label, wallet_state, &url, selected_utxos, recipients, fee_rate)?;

        // 5. Save to state and return
        let psbt_bytes = psbt.serialize();
        let mut original_guard = psbt_state
            .psbts
            .lock()
            .map_err(|_| "PSBT state lock failed".to_string())?;
        original_guard.insert(label.to_string(), psbt_bytes.clone());

        Ok(psbt_bytes)
    })
}

/// PSBT 빌드 로직 (테스트 가능하도록 분리)
/// (PSBT, exact_fee_sats) 형태의 튜플을 반환합니다.
fn build_psbt_inner(
    wallet: &bdk::Wallet<bdk::database::MemoryDatabase>,
    selected_utxos: Vec<PsbtUtxo>,
    recipients: Vec<PsbtRecipient>,
    fee_rate: f64,
) -> Result<(bdk::bitcoin::psbt::PartiallySignedTransaction, u64), String> {
    use bdk::FeeRate;
    use bdk::bitcoin::{OutPoint, Txid, Address};
    use std::str::FromStr;

    let mut builder = wallet.build_tx();

    // UTXOs
    let mut outpoints = Vec::new();
    for u in selected_utxos {
        let txid = Txid::from_str(&u.txid).map_err(|e| format!("Invalid txid: {}", e))?;
        outpoints.push(OutPoint::new(txid, u.vout));
    }
    builder.manually_selected_only(); // 선택한 것만 사용
    builder.add_utxos(&outpoints).map_err(|e| format!("Failed to add UTXOs: {}", e))?;

    // Options
    builder.fee_rate(FeeRate::from_sat_per_vb(fee_rate as f32));

    // Max 수신자가 있으면 drain_to 사용 (BDK가 수수료를 자동 차감한 잔액 전액을 해당 주소로 전송)
    let max_recipient = recipients.iter().find(|r| r.is_max);
    let fixed_recipients: Vec<&PsbtRecipient> = recipients.iter().filter(|r| !r.is_max).collect();

    for r in fixed_recipients {
        let address = Address::from_str(&r.address).map_err(|e| format!("Invalid recipient address: {}", e))?;
        builder.add_recipient(address.assume_checked().script_pubkey(), r.amount_sats);
    }

    if let Some(max_r) = max_recipient {
        let address = Address::from_str(&max_r.address).map_err(|e| format!("Invalid drain address: {}", e))?;
        builder.drain_to(address.assume_checked().script_pubkey());
        builder.drain_wallet();
    }

    let (psbt, details) = builder.finish().map_err(|e| format!("Failed to build TX: {}", e))?;
    // BDK TransactionDetails.fee: Option<u64> — 정확한 수수료 (sats)
    let exact_fee = details.fee.unwrap_or(0);
    Ok((psbt, exact_fee))
}

/// 미리보기용 PSBT 빌드 결과 (serde를 통해 프론트엔드로 전달)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsbtPreviewResult {
    pub psbt_bytes: Vec<u8>,
    pub fee_sats: u64,
}

/// 미리보기용 PSBT 빌드: Electrum 싱크 → PSBT 빌드 → 정확한 fee 반환
/// (실제 broadcast에는 사용하지 않으며, 생성된 PSBT는 state에 저장하지 않습니다)
pub async fn build_preview_psbt(
    label: &str,
    wallet_state: &crate::wallet::WalletState,
    settings: &AppSettings,
    selected_utxos: Vec<PsbtUtxo>,
    recipients: Vec<PsbtRecipient>,
    fee_rate: f64,
) -> Result<PsbtPreviewResult, String> {
    let url = get_electrum_url(settings);

    tokio::task::block_in_place(|| {
        let (psbt, exact_fee) = sync_and_build_psbt(label, wallet_state, &url, selected_utxos, recipients, fee_rate)?;
        Ok(PsbtPreviewResult {
            psbt_bytes: psbt.serialize(),
            fee_sats: exact_fee,
        })
    })
}

pub async fn broadcast_psbt(
    label: &str,
    wallet_state: &crate::wallet::WalletState,
    psbt_state: &PsbtState,
    settings: &AppSettings,
    signed_psbt_bytes: Vec<u8>,
) -> Result<String, String> {
    let url = get_electrum_url(settings);

    tokio::task::block_in_place(|| {
        use bdk::bitcoin::psbt::PartiallySignedTransaction;
        use bdk::SignOptions;

        // 1. Decode Signed PSBT bytes
        let signed_psbt = PartiallySignedTransaction::deserialize(&signed_psbt_bytes)
            .map_err(|e| format!("Failed to decode signed PSBT: {}", e))?;

        // 2. Retrieve Original PSBT and Merge
        let mut final_psbt = {
            let original_guard = psbt_state.psbts.lock().map_err(|_| "PSBT state lock failed".to_string())?;
            if let Some(original_bytes) = original_guard.get(label) {
                let mut original_psbt = PartiallySignedTransaction::deserialize(original_bytes)
                    .map_err(|e| format!("Failed to decode original PSBT: {}", e))?;
                
                // Combine signed PSBT into original (restores metadata)
                original_psbt.combine(signed_psbt)
                    .map_err(|e| format!("Failed to merge PSBTs: {}", e))?;
                original_psbt
            } else {
                // Fallback: If original is missing, use signed one (Method B style)
                signed_psbt
            }
        };

        // 3. Finalize PSBT
        let mut wallet_guard = wallet_state.wallets.lock().map_err(|_| "Wallet lock failed".to_string())?;
        let wallet = wallet_guard.get_mut(label).ok_or("Wallet not initialized")?;
        
        wallet.sign(&mut final_psbt, SignOptions {
            trust_witness_utxo: true,
            ..Default::default()
        })
            .map_err(|e| format!("Failed to finalize PSBT: {}", e))?;

        // 4. Extract final transaction
        let tx = final_psbt.extract_tx();

        // 3. Broadcast using Electrum
        use bdk::electrum_client::ElectrumApi;
        let client_auth = get_cached_raw_client(&url)?;
        let client = client_auth.lock().map_err(|_| "Failed to lock client")?;
        let txid = client.transaction_broadcast(&tx)
            .map_err(|e| format!("Broadcast failed: {}", e))?;

        Ok(txid.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_addr_to_scriptpubkey() {
        // P2WPKH (Mainnet)
        let addr = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
        let script = addr_to_scriptpubkey(addr).unwrap();
        // Just verify successful decoding
        assert!(!script.is_empty());

        // P2PKH (Mainnet)
        let addr = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
        let script = addr_to_scriptpubkey(addr).unwrap();
        assert_eq!(hex::encode(script), "76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac");

        // P2SH (Mainnet)
        let addr = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
        let script = addr_to_scriptpubkey(addr).unwrap();
        assert_eq!(hex::encode(script), "a914b472a266d0bd89c13706a4132ccfb16f7c3b9fcb87");

        // P2WPKH (Testnet)
        let addr = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
        let script = addr_to_scriptpubkey(addr).unwrap();
        assert!(!script.is_empty());

        // P2TR (Mainnet - Taproot)
        let addr_tr = "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297";
        let tr_script = addr_to_scriptpubkey(addr_tr);
        assert!(tr_script.is_ok(), "Taproot address should parse successfully");
    }

    #[test]
    fn test_addr_to_scripthash() {
        let addr = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
        let sh = addr_to_scripthash(addr).unwrap();
        assert!(!sh.is_empty());
    }

    #[test]
    fn test_parse_electrum_tx() {
        let tx_json = serde_json::json!({
            "txid": "test_txid",
            "confirmations": 6,
            "blocktime": 1600000000,
            "vsize": 140,
            "vin": [
                {
                    "txid": "prev_txid",
                    "vout": 0,
                    "sequence": 0xffffffffu64,
                    "scriptSig": { "asm": "", "hex": "" }
                }
            ],
            "vout": [
                {
                    "value": 0.001,
                    "n": 0,
                    "scriptPubKey": {
                        "address": "addr1",
                        "type": "witness_v0_keyhash"
                    }
                },
                {
                    "value": 0.0005,
                    "n": 1,
                    "scriptPubKey": {
                        "address": "addr2",
                        "type": "witness_v0_keyhash"
                    }
                }
            ]
        });

        let prev_tx_json = serde_json::json!({
            "txid": "prev_txid",
            "vout": [
                {
                    "value": 0.002,
                    "n": 0,
                    "scriptPubKey": { "address": "addr0", "type": "p2pkh" }
                }
            ]
        });

        let mut prevout_map = std::collections::HashMap::new();
        prevout_map.insert("prev_txid".to_string(), prev_tx_json);

        let tx = parse_electrum_tx(&tx_json, 12, &prevout_map).unwrap();

        assert_eq!(tx.txid, "test_txid");
        assert_eq!(tx.status.confirmed, true);
        assert_eq!(tx.status.block_height, Some(12));
        assert_eq!(tx.vin.len(), 1);
        assert_eq!(tx.vin[0].prevout.as_ref().unwrap().value, Some(200000));
        assert_eq!(tx.vout.len(), 2);
        assert_eq!(tx.vout[0].value, 100000);
        assert_eq!(tx.vout[1].value, 50000);
        
        // Fee = 0.002 - (0.001 + 0.0005) = 0.0005 BTC = 50000 sats
        assert_eq!(tx.fee, Some(50000));
    }

    #[test]
    fn test_parse_electrum_tx_invalid() {
        let prevout_map = std::collections::HashMap::new();
        // Missing txid, invalid types
        let json = serde_json::json!({
            "not_txid": "abc",
            "vin": "not an array"
        });
        let tx = parse_electrum_tx(&json, 0, &prevout_map);
        // Should safely handle malformed JSON and return None, without panicking
        assert!(tx.is_none());
    }

    #[test]
    fn test_invalid_address() {
        assert!(addr_to_scriptpubkey("invalid").is_err());
        assert!(addr_to_scriptpubkey("bc1qinvalid").is_err());
    }

    #[test]
    fn test_build_psbt_inner() {
        use crate::wallet::import_wallet;
        use bdk::bitcoin::Network;
        use bdk::bitcoin::secp256k1::Secp256k1;
        use bdk::bitcoin::bip32::{ExtendedPrivKey, ExtendedPubKey};

        // 1. Setup dummy wallet using valid dynamic xpub
        let secp = Secp256k1::new();
        let seed = [0u8; 32];
        let xprv = ExtendedPrivKey::new_master(Network::Bitcoin, &seed).unwrap();
        let xpub_obj = ExtendedPubKey::from_priv(&secp, &xprv);
        let xpub = xpub_obj.to_string();
        let fp = xpub_obj.fingerprint().to_string();
        let wallet = import_wallet(&xpub, &fp, Network::Bitcoin, "native").unwrap();

        // 2. Prepare parameters
        let selected_utxos = vec![
            PsbtUtxo {
                txid: "0000000000000000000000000000000000000000000000000000000000000000".to_string(),
                vout: 0,
                value: 100000,
                address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4".to_string(),
            }
        ];
        let recipients = vec![
            PsbtRecipient {
                address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
                amount_sats: 50000,
                is_max: false,
            }
        ];
        let fee_rate = 1.0;

        // 3. Call builder (expect failure because UTXOs are not in internal DB)
        let result = build_psbt_inner(&wallet.0, selected_utxos.clone(), recipients.clone(), fee_rate);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Failed to add UTXOs") || err.contains("UnknownUnit") || err.contains("InsufficientFunds"));

        // 4. Test missing recipients or dust
        let empty_recipients: Vec<PsbtRecipient> = vec![];
        let err_empty = build_psbt_inner(&wallet.0, selected_utxos.clone(), empty_recipients, fee_rate).unwrap_err();
        // Depends on BDK version exact error, but should fail
        assert!(!err_empty.is_empty());

        let dust_recipients = vec![
            PsbtRecipient {
                address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
                amount_sats: 10, // Dust amount
                is_max: false,
            }
        ];
        let err_dust = build_psbt_inner(&wallet.0, selected_utxos.clone(), dust_recipients, fee_rate).unwrap_err();
        assert!(!err_dust.is_empty(), "Dust output should trigger an error");
    }

    #[test]
    fn test_calculate_max_amount_normal() {
        let utxos = vec![
            PsbtUtxo { txid: "".to_string(), vout: 0, value: 100000, address: "bc1qv0".to_string() } // 68 vB
        ];
        let recipients = vec![];
        let draft_addr = "bc1qv0"; // 31 vB
        let fee_rate = 1.0;
        
        // 10.5 + 68 + 31 = 109.5 -> ceil(109.5 * 1.0) = 110 sats
        let max = calculate_max_amount_inner(&utxos, &recipients, draft_addr, fee_rate).unwrap();
        assert_eq!(max, 100000 - 110);
    }

    #[test]
    fn test_calculate_max_amount_dust() {
        let utxos = vec![
            PsbtUtxo { txid: "".to_string(), vout: 0, value: 600, address: "bc1qv0".to_string() }
        ];
        // Fee 110 sats -> Remaining 490 sats <= 546 (Error)
        let result = calculate_max_amount_inner(&utxos, &[], "bc1qv0", 1.0);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("dust"));
    }

    #[test]
    fn test_calculate_max_amount_negative() {
        let utxos = vec![
            PsbtUtxo { txid: "".to_string(), vout: 0, value: 100, address: "bc1qv0".to_string() }
        ];
        // Fee is ~110 > 100 (Insufficient funds)
        let result = calculate_max_amount_inner(&utxos, &[], "bc1qv0", 1.0);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Insufficient funds"));
    }
}
