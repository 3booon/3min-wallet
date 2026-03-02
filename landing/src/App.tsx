import { useState } from 'react';
import './index.css';
import { Download, Monitor, ShieldCheck, Zap, Bitcoin, Github, EyeOff, Terminal, Info } from 'lucide-react';
import customLogo from './assets/app-icon.png';
import previewImage from './assets/3min_wallet_preview.png';

function App() {
  const [guideLang, setGuideLang] = useState<'kr' | 'en'>('kr');

  const handleDownload = (os: 'mac-arm' | 'mac-intel' | 'windows') => {
    const version = 'v0.1.0';
    let url = '';
    
    // GitHub Releases download URL structure
    const baseUrl = `https://github.com/3booon/3min-wallet/releases/download/app-${version}`;
    
    if (os === 'mac-arm') {
      url = `${baseUrl}/3min-wallet_${version.replace('v', '')}_aarch64.dmg`;
    } else if (os === 'mac-intel') {
      url = `${baseUrl}/3min-wallet_${version.replace('v', '')}_x64.dmg`;
    } else {
      url = `${baseUrl}/3min-wallet_${version.replace('v', '')}_x64_ko-KR.msi`;
    }

    window.location.href = url;
  };

  return (
    <div className="app-container">
      {/* Navigation */}
      <nav className="navbar">
        <div className="nav-logo">
          {/* 3B Custom Logo */}
          <img src={customLogo} alt="3min Logo" style={{ width: '28px', height: '28px' }} />
          <span>3min</span>
        </div>
        <div className="nav-links">
          <a href="#features" className="nav-link">Features</a>
          <a href="https://github.com/3booon/3min-wallet" target="_blank" rel="noopener noreferrer" className="nav-link" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Github size={18} />
            GitHub
          </a>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-badge">
          <Zap /> 
          <span>v0.1.0 Beta is Now Available</span>
        </div>
        <h1 className="hero-title">
          The Best Way to<br />Monitor Your Bitcoin.
        </h1>
        <p className="hero-subtitle">
          3min wallet is a secure watch-only desktop wallet. Keep an eye on your cold wallet without ever exposing your private keys.
        </p>

        <div className="download-section">
          <button 
            className="btn btn-mac" 
            onClick={() => handleDownload('mac-arm')}
          >
            <Download size={20} />
            macOS (Apple Silicon)
          </button>
          <button 
            className="btn btn-mac" 
            onClick={() => handleDownload('mac-intel')}
          >
            <Download size={20} />
            macOS (Intel)
          </button>
          <button 
            className="btn btn-win"
            onClick={() => handleDownload('windows')}
          >
            <Monitor size={20} />
            Windows
          </button>
        </div>

        <div className="os-guides">
          {/* macOS Guide */}
          <div className="os-warning">
            <Terminal size={24} className="os-warning-icon" />
            <div className="os-warning-content">
              <div className="os-warning-header">
                <strong>{guideLang === 'kr' ? 'macOS 실행 안내' : 'macOS Installation Guide'}</strong>
                <div className="lang-tabs">
                  <button 
                    className={`lang-tab ${guideLang === 'kr' ? 'active' : ''}`}
                    onClick={() => setGuideLang('kr')}
                  >KR</button>
                  <button 
                    className={`lang-tab ${guideLang === 'en' ? 'active' : ''}`}
                    onClick={() => setGuideLang('en')}
                  >EN</button>
                </div>
              </div>
              
              {guideLang === 'kr' ? (
                <div className="os-warning-text">
                  <p>1. 다운로드 받은 <strong>.dmg 파일을 실행</strong>한 후, 앱 아이콘을 <strong>응용 프로그램(Applications)</strong> 폴더로 드래그하여 이동시켜주세요.</p>
                  <p>2. "앱이 손상되었기 때문에 열 수 없습니다" 오류 발생 시, 터미널(Terminal)에서 아래 명령어를 실행해주세요.</p>
                </div>
              ) : (
                <div className="os-warning-text">
                  <p>1. <strong>Open the downloaded .dmg file</strong> and drag the app icon to your <strong>Applications</strong> folder.</p>
                  <p>2. If you see an "App is damaged and can't be opened" error, please run the following command in your Terminal.</p>
                </div>
              )}
              <code>xattr -cr /Applications/3min-wallet.app</code>
            </div>
          </div>

          {/* Windows Guide */}
          <div className="os-warning">
            <Info size={24} className="os-warning-icon" />
            <div className="os-warning-content">
              <div className="os-warning-header">
                <strong>{guideLang === 'kr' ? 'Windows 실행 안내' : 'Windows Installation Guide'}</strong>
                <div className="lang-tabs">
                  <button 
                    className={`lang-tab ${guideLang === 'kr' ? 'active' : ''}`}
                    onClick={() => setGuideLang('kr')}
                  >KR</button>
                  <button 
                    className={`lang-tab ${guideLang === 'en' ? 'active' : ''}`}
                    onClick={() => setGuideLang('en')}
                  >EN</button>
                </div>
              </div>
              
              {guideLang === 'kr' ? (
                <div className="os-warning-text">
                  <p>Windows의 PC 보호 창이 나타날 경우, <strong>추가 정보</strong>를 클릭한 후 <strong>실행</strong> 버튼을 눌러주세요.</p>
                </div>
              ) : (
                <div className="os-warning-text">
                  <p>If Microsoft Defender SmartScreen prevents the app from starting, click <strong>More info</strong> and then <strong>Run anyway</strong>.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* App Preview Wrapper */}
        <div className="app-preview-wrapper" id="preview">
          <div className="app-preview">
            <img src={previewImage} alt="3min Wallet Preview" />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features" id="features">
        <h2 className="section-title">Why choose 3min Wallet?</h2>
        
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">
              <ShieldCheck size={24} />
            </div>
            <h3 className="feature-title">100% Watch-Only</h3>
            <p className="feature-desc">
              Your private keys never touch this app. Import your xPub/yPub/zPub securely and monitor your balances with complete peace of mind.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">
              <Bitcoin size={24} />
            </div>
            <h3 className="feature-title">100% Bitcoin Only</h3>
            <p className="feature-desc">
              Built by a passionate Bitcoiner from South Korea. No altcoin clutter, resulting in a significantly reduced attack surface and maximum security.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">
              <EyeOff size={24} />
            </div>
            <h3 className="feature-title">No Tracking</h3>
            <p className="feature-desc">
              Connect directly to your own Electrum server. No sign-ups, no data collection, and absolute privacy for your balances.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <p>© 2026 3min Wallet. Built with ❤️ for Bitcoiners.</p>
        <p style={{ marginTop: '8px' }}>
          Open Source on <a href="https://github.com/3booon/3min-wallet" target="_blank" rel="noopener noreferrer">GitHub</a>
        </p>
      </footer>
    </div>
  );
}

export default App;
