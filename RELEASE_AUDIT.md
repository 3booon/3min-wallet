# 3min-wallet v0.1.0 Release Audit Report

> 전체 프로젝트를 스캔하여 **보안 취약점**, **기능상 문제**, **리팩토링 대상**을 정리한 보고서입니다.

---

## 📁 스캔 범위

| Layer | Files | Lines |
|-------|-------|-------|
| Rust Backend | `api.rs`, `lib.rs`, `wallet.rs`, `main.rs` | ~1,880 |
| React Frontend | `App.tsx`, `SendPanel.tsx`, `ReceivePanel.tsx` 등 14개 | ~3,200 |
| Config | `tauri.conf.json`, `Cargo.toml`, `package.json` 등 5개 | — |

---

## 🔴 보안 취약점 (Security)

### SEC-1. Testnet 주소 Validation이 Mainnet에서도 통과됨 — **Critical**
- **파일**: [bitcoinUtils.ts](file:///Users/davidnam/toy-project/watch_only_wallet/src/bitcoinUtils.ts#L3-L15)
- `validateBitcoinAddress()`는 `bc1q`, `bc1p`, `1...`, `3...` 만 검사합니다.
- Testnet/Signet 주소 (`tb1q...`, `tb1p...`, `2...`, `m...`, `n...`)를 Mainnet 모드에서 입력하면 **검증을 통과하지 못해 전송이 차단**됩니다.
- 반대로, **Testnet 모드에서** Mainnet 주소(`bc1q...`)를 입력하면 **검증을 통과**하여 잘못된 네트워크로 PSBT가 생성될 수 있습니다.
- **권장**: 현재 네트워크 설정에 따른 주소 prefix 검증 분기 필요

### SEC-2. `addr_to_scriptpubkey`에서 네트워크 검증 없음 — **High**
- **파일**: [api.rs:175-182](file:///Users/davidnam/toy-project/watch_only_wallet/src-tauri/src/api.rs#L175-L182)
- `address.assume_checked()` — 네트워크를 확인하지 않고 스크립트를 추출합니다.
- Mainnet 설정에서 Testnet 주소가 들어오면 그대로 처리됩니다.
- **권장**: 파싱 시 현재 네트워크와 주소 네트워크의 일치 여부를 검증

### SEC-3. Electrum 연결 시 SSL 인증서 검증 부재 — **Medium**
- **파일**: [api.rs:18](file:///Users/davidnam/toy-project/watch_only_wallet/src-tauri/src/api.rs#L18)
- `bdk::electrum_client::Client::new(url)` — BDK의 electrum client는 기본적으로 인증서 검증을 수행하지만, 사용자 정의 Electrum SSL URL에 대한 인증서 pinning이나 추가 보안 옵션은 없습니다.
- **권장**: 연결 시 SSL 검증 옵션을 명시적으로 설정하거나, `ssl://` 프로토콜만 허용하는 UI 가이드 추가

### SEC-4. CSP에 `unsafe-inline` 포함 — **Low**
- **파일**: [tauri.conf.json:21](file:///Users/davidnam/toy-project/watch_only_wallet/src-tauri/tauri.conf.json#L21)
- `style-src 'self' 'unsafe-inline'` — XSS 방어가 약화됩니다.
- Tauri 환경에서는 위험도가 낮으나, 정식 릴리스에서는 빌드 타임 CSS hash/nonce 적용을 권장

### SEC-5. `println!`으로 민감 정보 로깅 — **Low**
- **파일들**: [api.rs:319](file:///Users/davidnam/toy-project/watch_only_wallet/src-tauri/src/api.rs#L319), [api.rs:362](file:///Users/davidnam/toy-project/watch_only_wallet/src-tauri/src/api.rs#L362), [wallet.rs:60](file:///Users/davidnam/toy-project/watch_only_wallet/src-tauri/src/wallet.rs#L60), [lib.rs:84](file:///Users/davidnam/toy-project/watch_only_wallet/src-tauri/src/lib.rs#L84)
- 주소, 키 정보, 설정 값 등이 `println!`으로 stdout에 출력됩니다.
- **권장**: Production 빌드에서는 `log` crate로 교체하고, 릴리스 빌드에서 debug 레벨 비활성화

### SEC-6. Electrum 클라이언트 캐시가 영구적으로 유지됨 — **Low**
- **파일**: [api.rs:10-11](file:///Users/davidnam/toy-project/watch_only_wallet/src-tauri/src/api.rs#L10-L11)
- `ELECTRUM_CLIENTS`와 `ELECTRUM_BLOCKCHAINS`가 `Lazy<Mutex<HashMap>>` 전역 static으로 관리되어 프로세스 생존기간 동안 절대 해제되지 않습니다.
- 사용자가 Electrum URL을 변경해도 이전 연결이 캐시에 남아 메모리 누수 및 잠재적 연결 혼동 가능
- **권장**: 연결 해제 시 또는 URL 변경 시 캐시 클리어 로직 추가

---

## 🟡 기능상 문제 (Functional)

### FUN-1. `handleLoadMore`가 전체 주소를 재요청함 — **Medium**
- **파일**: [useWalletState.ts:113-126](file:///Users/davidnam/toy-project/watch_only_wallet/src/useWalletState.ts#L113-L126)
- "Load More"를 누르면 `cmd_get_addresses(count: nc)`로 **0번부터 nc개**를 통째로 재요청합니다.
- 이미 가진 주소를 재생성하므로 비효율적이며, 주소 수가 많아지면 느려집니다.
- **권장**: 오프셋 기반으로 새 주소만 추가 요청하거나, BDK `Peek` 범위 조절

### FUN-2. Testnet/Signet 네트워크에서 Fee Estimation 하드코딩 — **Medium**
- **파일**: [api.rs:686](file:///Users/davidnam/toy-project/watch_only_wallet/src-tauri/src/api.rs#L686)
- `MEMPOOL_BASE`가 `https://mempool.space/api`로 하드코딩되어 있어, Testnet/Signet에서도 **Mainnet 수수료**가 추정됩니다.
- Electrum fallback는 있지만 `ExternalRest` 모드에서는 항상 mainnet 수수료를 가져옵니다.
- **권장**: 네트워크에 따라 `mempool.space/testnet/api` 또는 `mempool.space/signet/api`로 분기

### FUN-3. `find_first_unused_address` — 모든 주소를 동시에 조회 — **Medium**
- **파일**: [api.rs:256-278](file:///Users/davidnam/toy-project/watch_only_wallet/src-tauri/src/api.rs#L256-L278)
- 20개 주소를 한꺼번에 `join_all`로 병렬 조회합니다.
- Rate limiting이 있는 공개 API(Blockstream)에서는 요청이 거부될 수 있습니다.
- **권장**: Gap limit 방식으로 순차 조회하되, 연속 N개 미사용이면 탐색 종료

### FUN-4. `ReceivePanel`에서 `addrType` 전환 시 `selectedIndex` 동기화 누락 — **Low**
- **파일**: [ReceivePanel.tsx:39-43](file:///Users/davidnam/toy-project/watch_only_wallet/src/ReceivePanel.tsx#L39-L43)
- `useEffect`가 `addrType`를 dependency에 포함하지 않아, 탭 전환 시 `suggestedIndex`가 올바르게 반영되지 않을 수 있습니다.
- `handleTypeChange`에서 직접 세팅하므로 대부분 커버되지만, `suggestedLoading` 상태 변경 시 엣지 케이스가 존재합니다.

### FUN-5. `broadcast_psbt`에서 Watch-Only Wallet의 `sign` 호출 — **Info**
- **파일**: [api.rs:1035-1039](file:///Users/davidnam/toy-project/watch_only_wallet/src-tauri/src/api.rs#L1035-L1039)
- Watch-Only 지갑이므로 `wallet.sign()`은 실제 서명을 추가하지 않으나, `finalize_psbt` 역할을 합니다.
- BDK의 `sign`에 `trust_witness_utxo: true`를 전달하여 finalize만 수행하도록 하고 있으며, 이는 정상 동작이나 주석이 혼란을 줄 수 있습니다.
- **권장**: 주석에 "finalize only, no signing for watch-only" 명기

### FUN-6. Summary Modal의 Total Output 계산에 불일치 가능성 — **Low**
- **파일**: [SendPanel.tsx:997](file:///Users/davidnam/toy-project/watch_only_wallet/src/SendPanel.tsx#L995-L998)
- Max 수신자가 있을 때와 없을 때의 Total Output 계산 분기가 복잡하여 엣지 케이스에서 숫자 불일치가 발생할 수 있습니다.

---

## 🔵 리팩토링 대상 (Refactoring)

### REF-1. `App.tsx` 단일 파일이 745줄로 과도하게 큼
- **파일**: [App.tsx](file:///Users/davidnam/toy-project/watch_only_wallet/src/App.tsx)
- Import 화면, Wallet 화면, UTXO 렌더링, TX 렌더링, 설정 관리가 한 파일에 혼재됩니다.
- **권장**: `ImportScreen`, `WalletScreen` 컴포넌트로 분리, `processInputData`를 별도 유틸로 추출

### REF-2. `SendPanel.tsx`가 1008줄로 가장 큰 단일 컴포넌트
- **파일**: [SendPanel.tsx](file:///Users/davidnam/toy-project/watch_only_wallet/src/SendPanel.tsx)
- UTXO 선택, 수신자 관리, 수수료 설정, Max 금액 계산, Summary 모달, Change 주소 모달이 모두 포함됩니다.
- **권장**: UTXO selector, Fee selector, Summary modal, Change address modal을 별도 컴포넌트로 분리

### REF-3. `api.rs`가 1271줄로 단일 모듈에 모든 API 로직이 집중됨
- **파일**: [api.rs](file:///Users/davidnam/toy-project/watch_only_wallet/src-tauri/src/api.rs)
- REST API 호출, Electrum 호출, PSBT 빌드, Fee 추정, 데이터 구조가 한 파일에 있습니다.
- **권장**: `api/rest.rs`, `api/electrum.rs`, `api/psbt.rs`, `api/fee.rs`로 모듈 분리 (빈 `wallet/` 디렉토리 활용 가능)

### REF-4. 프론트/백엔드 간 주소 타입 추론 로직이 중복됨
- **파일들**: [bitcoinUtils.ts:101-118](file:///Users/davidnam/toy-project/watch_only_wallet/src/bitcoinUtils.ts#L101-L118) vs [api.rs:806-828](file:///Users/davidnam/toy-project/watch_only_wallet/src-tauri/src/api.rs#L806-L828)
- `inferAddressType` (TS) ↔ `get_input_weight`/`get_output_weight` (Rust)가 동일한 주소 접두어 검사를 별도로 구현합니다.
- **권장**: 수수료 추정은 Rust 백엔드에 일원화하고, 프론트는 백엔드 결과를 사용하도록 변경

### REF-5. 수수료 추정 로직이 프론트/백엔드에 이중으로 존재
- **파일들**: [SendPanel.tsx:186-191](file:///Users/davidnam/toy-project/watch_only_wallet/src/SendPanel.tsx#L186-L191) (프론트 추정) vs [api.rs:830-839](file:///Users/davidnam/toy-project/watch_only_wallet/src-tauri/src/api.rs#L830-L839) (Rust 추정)
- 프론트엔드에서 vBytes를 추정하고, 동시에 백엔드에서도 BDK 기반으로 추정합니다.
- 두 값이 약간씩 달라 UI에 "예상 수수료"와 실제 PSBT 수수료 사이에 괴리가 발생합니다.
- **권장**: 프론트엔드 추정은 UX 가이드용으로만 사용하고, 명확히 "approximate" 표기를 강화하거나, 백엔드에서만 계산

### REF-6. CSS 파일들의 총 크기가 과도함 (~80KB)
- `SendPanel.css` (28KB), `App.css` (20KB) 등이 매우 큽니다.
- 상당수 스타일이 중복되거나 공통 테마로 추출 가능합니다.
- **권장**: CSS 변수/공통 클래스 추출, 컴포넌트별 CSS Modules 적용 고려

### REF-7. `let totalAmountSats`의 `let` 사용 — 변수 재할당 패턴
- **파일**: [SendPanel.tsx:164, 260-262](file:///Users/davidnam/toy-project/watch_only_wallet/src/SendPanel.tsx#L164)
- 컴포넌트 본문에서 `let`으로 선언 후 조건에 따라 재할당합니다.
- 렌더링 도중 변수가 변경되는 패턴은 예측하기 어렵고 버그의 원인이 됩니다.
- **권장**: `useMemo`로 관련 값들을 묶어 계산하거나, derived state로 정리

### REF-8. 빈 `src-tauri/src/wallet/` 디렉토리
- 빈 모듈 디렉토리가 남아있습니다.
- **권장**: 불필요하면 삭제, 또는 REF-3의 모듈 분리에 활용

---

## 📋 요약 매트릭스

| 카테고리 | Critical | High | Medium | Low | Info |
|---------|----------|------|--------|-----|------|
| 🔴 보안 | 1 | 1 | 1 | 3 | — |
| 🟡 기능 | — | — | 3 | 2 | 1 |
| 🔵 리팩토링 | — | — | — | 8 | — |

> **릴리스 전 최소 조치**: SEC-1 (네트워크별 주소 검증), SEC-2 (네트워크 불일치 방지), FUN-2 (Testnet Fee)
