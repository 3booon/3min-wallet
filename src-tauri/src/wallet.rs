use bdk::{
    KeychainKind, Wallet,
    wallet::AddressIndex,
    bitcoin::{
        Network,
        base58,
        bip32::{ExtendedPubKey, Fingerprint},
    },
    database::MemoryDatabase,
    template::{Bip49Public, Bip84Public, Bip86Public},
};
use std::str::FromStr;
use std::sync::Mutex;

use std::collections::HashMap;

pub struct WalletState {
    pub wallets: Mutex<HashMap<String, Wallet<MemoryDatabase>>>,
    pub active_xpubs: Mutex<HashMap<String, String>>,
}

impl WalletState {
    pub fn new() -> Self {
        WalletState {
            wallets: Mutex::new(HashMap::new()),
            active_xpubs: Mutex::new(HashMap::new()),
        }
    }
}

/// zpub/ypub 등 SLIP-0132 포맷을 xpub(Bitcoin Core 표준)으로 변환합니다.
/// 내부 키 데이터는 동일하고, 앞 4바이트 버전만 교체합니다.
fn normalize_to_xpub(input: &str) -> Result<String, String> {
    // xpub / tpub은 이미 표준 포맷이므로 그대로 반환
    if input.starts_with("xpub") || input.starts_with("tpub") {
        return Ok(input.to_string());
    }

    // base58check 디코딩
    let mut data = base58::decode_check(input)
        .map_err(|e| format!("base58 decode error: {}", e))?;

    // 앞 4바이트를 xpub 버전으로 교체
    // xpub: [0x04, 0x88, 0xB2, 0x1E] (Mainnet)
    // tpub: [0x04, 0x35, 0x87, 0xCF] (Testnet) - zpub/vpub 등 testnet 계열
    let (new_version, label) = match input.get(..4) {
        Some("zpub") | Some("Zpub") => ([0x04u8, 0x88, 0xB2, 0x1E], "zpub→xpub"),
        Some("ypub") | Some("Ypub") => ([0x04u8, 0x88, 0xB2, 0x1E], "ypub→xpub"),
        Some("vpub") | Some("Vpub") => ([0x04u8, 0x35, 0x87, 0xCF], "vpub→tpub"),
        Some("upub") | Some("Upub") => ([0x04u8, 0x35, 0x87, 0xCF], "upub→tpub"),
        _ => return Err(format!("Unsupported key prefix: '{}'", &input[..4])),
    };

    data[0] = new_version[0];
    data[1] = new_version[1];
    data[2] = new_version[2];
    data[3] = new_version[3];

    let result = base58::encode_check(&data);
    log::debug!("Key normalized: {} ({})", label, &result[..8]);
    Ok(result)
}

/// xpub/zpub/ypub 등을 받아 BDK Wallet을 생성합니다.
/// script_type: "nested" (BIP49 P2SH-P2WPKH), "native" (BIP84 P2WPKH), "taproot" (BIP86 P2TR)
pub fn import_wallet(xpub: &str, mfp: &str, network: Network, script_type: &str) -> Result<(Wallet<MemoryDatabase>, String), String> {
    // 0. Server-side validation of xpub prefix vs script_type
    let prefix = xpub.get(..4).unwrap_or("").to_lowercase();
    match script_type {
        "nested" => {
            if !["ypub", "upub", "xpub", "tpub"].contains(&prefix.as_str()) {
                return Err(format!("Invalid key prefix '{}' for Nested Segwit. Expected ypub/upub.", prefix));
            }
        }
        "taproot" => {
            // bdk bip86 uses xpub/tpub standard, but some wallets might use something else? 
            // strictly xpub/tpub for taproot in standard implementations
            if !["xpub", "tpub"].contains(&prefix.as_str()) {
                return Err(format!("Invalid key prefix '{}' for Taproot. Expected xpub/tpub.", prefix));
            }
        }
        _ => { // native
            if !["zpub", "vpub", "xpub", "tpub"].contains(&prefix.as_str()) {
                return Err(format!("Invalid key prefix '{}' for Native Segwit. Expected zpub/vpub.", prefix));
            }
        }
    }

    // 1. zpub/ypub 등 비표준 접두어(SLIP-0132)를 xpub으로 변환
    let normalized_xpub = normalize_to_xpub(xpub)?;

    // 2. ExtendedPubKey 파싱
    let key = ExtendedPubKey::from_str(&normalized_xpub)
        .map_err(|e| format!("Invalid xpub: {}", e))?;
    let fp = Fingerprint::from_str(mfp)
        .map_err(|e| format!("Invalid fingerprint: {}", e))?;

    // 2.5 Extract the account number if at account depth (m/purpose'/coin_type'/account')
    let account_str = if key.depth == 3 {
        key.child_number.to_string() // usually format like "0'"
    } else {
        "0'".to_string()
    };

    // 3. Descriptor 생성 (script_type에 따라 선택)
    let database = MemoryDatabase::default();
    let wallet = match script_type {
        "nested" => {
            // BIP49: P2SH-P2WPKH (ypub) — addresses start with '3'
            let desc = Bip49Public(key, fp, KeychainKind::External);
            let change = Bip49Public(key, fp, KeychainKind::Internal);
            Wallet::new(desc, Some(change), network, database)
        }
        "taproot" => {
            // BIP86: P2TR (xpub) — addresses start with 'bc1p'
            let desc = Bip86Public(key, fp, KeychainKind::External);
            let change = Bip86Public(key, fp, KeychainKind::Internal);
            Wallet::new(desc, Some(change), network, database)
        }
        _ => {
            // default: BIP84: P2WPKH (zpub) — addresses start with 'bc1q'
            let desc = Bip84Public(key, fp, KeychainKind::External);
            let change = Bip84Public(key, fp, KeychainKind::Internal);
            Wallet::new(desc, Some(change), network, database)
        }
    };

    wallet.map(|w| (w, account_str)).map_err(|e| format!("Failed to create wallet: {}", e))
}

/// State에서 꺼낸 Wallet 레퍼런스를 받아 offset부터 count개의 주소를 반환합니다.
pub fn get_addresses(wallet: &Wallet<MemoryDatabase>, offset: u32, count: u32) -> Result<Vec<String>, String> {
    (offset..offset + count)
        .map(|i| {
            wallet
                .get_address(AddressIndex::Peek(i))
                .map(|info| info.address.to_string())
                .map_err(|e| format!("Failed to get address at index {}: {}", i, e))
        })
        .collect()
}

/// State에서 꺼낸 Wallet 레퍼런스를 받아 offset부터 count개의 잔돈(change) 주소를 반환합니다.
pub fn get_change_addresses(wallet: &Wallet<MemoryDatabase>, offset: u32, count: u32) -> Result<Vec<String>, String> {
    (offset..offset + count)
        .map(|i| {
            wallet
                .get_internal_address(AddressIndex::Peek(i))
                .map(|info| info.address.to_string())
                .map_err(|e| format!("Failed to get change address at index {}: {}", i, e))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use bdk::bitcoin::bip32::{ExtendedPrivKey, ExtendedPubKey};
    use bdk::bitcoin::Network;
    use bdk::bitcoin::secp256k1::Secp256k1;
    use bdk::bitcoin::base58;

    fn get_test_xpub() -> (String, String) {
        let secp = Secp256k1::new();
        let seed = [1u8; 32];
        let xprv = ExtendedPrivKey::new_master(Network::Bitcoin, &seed).unwrap();
        let xpub = ExtendedPubKey::from_priv(&secp, &xprv);
        let fp = xpub.fingerprint().to_string();
        (xpub.to_string(), fp)
    }

    fn get_test_tpub() -> String {
        let secp = Secp256k1::new();
        let seed = [1u8; 32];
        let tprv = ExtendedPrivKey::new_master(Network::Testnet, &seed).unwrap();
        let tpub = ExtendedPubKey::from_priv(&secp, &tprv);
        tpub.to_string()
    }

    #[test]
    fn test_normalize_to_xpub() {
        let (xpub, _) = get_test_xpub();
        assert_eq!(normalize_to_xpub(&xpub).unwrap(), xpub);

        let tpub = get_test_tpub();
        assert_eq!(normalize_to_xpub(&tpub).unwrap(), tpub);

        // zpub -> xpub
        let mut zpub_data = base58::decode_check(&xpub).unwrap();
        zpub_data[0] = 0x04;
        zpub_data[1] = 0xb2;
        zpub_data[2] = 0x47;
        zpub_data[3] = 0x46; // zpub prefix
        let zpub = base58::encode_check(&zpub_data);
        assert_eq!(normalize_to_xpub(&zpub).unwrap(), xpub);

        // ypub -> xpub
        let mut ypub_data = base58::decode_check(&xpub).unwrap();
        ypub_data[0] = 0x04;
        ypub_data[1] = 0x9d;
        ypub_data[2] = 0x7c;
        ypub_data[3] = 0xb2; // ypub prefix
        let ypub = base58::encode_check(&ypub_data);
        assert_eq!(normalize_to_xpub(&ypub).unwrap(), xpub);

        // vpub -> tpub
        let mut vpub_data = base58::decode_check(&tpub).unwrap();
        vpub_data[0] = 0x04;
        vpub_data[1] = 0x5f;
        vpub_data[2] = 0x1c;
        vpub_data[3] = 0xf6; // vpub prefix
        let vpub = base58::encode_check(&vpub_data);
        assert_eq!(normalize_to_xpub(&vpub).unwrap(), tpub);

        // upub -> tpub
        let mut upub_data = base58::decode_check(&tpub).unwrap();
        upub_data[0] = 0x04;
        upub_data[1] = 0x4a;
        upub_data[2] = 0x52;
        upub_data[3] = 0x62; // upub prefix
        let upub = base58::encode_check(&upub_data);
        assert_eq!(normalize_to_xpub(&upub).unwrap(), tpub);
    }

    #[test]
    fn test_normalize_to_xpub_invalid() {
        assert!(normalize_to_xpub("invalid_pub_key").is_err());
        assert!(normalize_to_xpub("apubabcde").is_err());
    }

    #[test]
    fn test_import_wallet_valid() {
        let (xpub, fp) = get_test_xpub();
        // Native SegWit (default)
        assert!(import_wallet(&xpub, &fp, Network::Bitcoin, "native").is_ok());
        // Taproot
        assert!(import_wallet(&xpub, &fp, Network::Bitcoin, "taproot").is_ok());
        // Nested SegWit
        assert!(import_wallet(&xpub, &fp, Network::Bitcoin, "nested").is_ok());
    }

    #[test]
    fn test_import_wallet_invalid() {
        let (xpub, _) = get_test_xpub();
        assert!(import_wallet(&xpub, "invalid_fp", Network::Bitcoin, "native").is_err());
        assert!(import_wallet("invalid_xpub", "73c5da0a", Network::Bitcoin, "native").is_err());
    }

    fn get_deterministic_xpub() -> (String, String) {
        // Known test vector for deterministic output
        // Seed: all zeros
        let secp = Secp256k1::new();
        let seed = [0u8; 32];
        let xprv = ExtendedPrivKey::new_master(Network::Bitcoin, &seed).unwrap();
        let xpub = ExtendedPubKey::from_priv(&secp, &xprv);
        let fp = xpub.fingerprint().to_string();
        (xpub.to_string(), fp)
    }

    #[test]
    fn test_get_addresses() {
        let (xpub, fp) = get_deterministic_xpub();
        let (wallet, _) = import_wallet(&xpub, &fp, Network::Bitcoin, "native").unwrap();
        
        let empty = get_addresses(&wallet, 0, 0).unwrap();
        assert!(empty.is_empty());

        let addresses = get_addresses(&wallet, 0, 5).unwrap();
        let expected = vec![
            "bc1qltfy6gm2zyw2tdvr32u9mvkyhk4t0sa736p0wz",
            "bc1qzls08wmrz2mr3chdxge62qu56e7cgz56dyusds",
            "bc1qndc0w7rn50tdmnr5883stdvjcwcsvw8k5ldmz3",
            "bc1q5yvsd0sgqf8gv2ahd5a0pe3z5re388534hvzmn",
            "bc1qc485p0zqp99ylu8csxc5k57g9krzc65wjk3mvz",
        ];
        assert_eq!(addresses, expected);
    }

    #[test]
    fn test_get_addresses_taproot() {
        let (xpub, fp) = get_deterministic_xpub();
        let (wallet, _) = import_wallet(&xpub, &fp, Network::Bitcoin, "taproot").unwrap();
        let addresses = get_addresses(&wallet, 0, 3).unwrap();
        // All taproot addresses must start with "bc1p"
        for addr in &addresses {
            assert!(addr.starts_with("bc1p"), "Expected taproot (bc1p) address, got: {}", addr);
        }
    }

    #[test]
    fn test_get_addresses_nested() {
        let (xpub, fp) = get_deterministic_xpub();
        let (wallet, _) = import_wallet(&xpub, &fp, Network::Bitcoin, "nested").unwrap();
        let addresses = get_addresses(&wallet, 0, 3).unwrap();
        // All nested segwit addresses must start with "3"
        for addr in &addresses {
            assert!(addr.starts_with('3'), "Expected nested segwit (3...) address, got: {}", addr);
        }
    }

    #[test]
    fn test_get_change_addresses() {
        let (xpub, fp) = get_deterministic_xpub();
        let (wallet, _) = import_wallet(&xpub, &fp, Network::Bitcoin, "native").unwrap();
        
        let change_addresses = get_change_addresses(&wallet, 0, 3).unwrap();
        let expected = vec![
            "bc1q9jdytaxjdh5t5d4j6e94m4k4j825mtzzyz9lzq",
            "bc1qu0hp0l4d4hcgut35602qrp0hcrgumj9qdsd6wx",
            "bc1qwhja6n6ddua35wsw7cvly6k62y0l5jx5m5nlkg",
        ];
        assert_eq!(change_addresses, expected);
    }
}