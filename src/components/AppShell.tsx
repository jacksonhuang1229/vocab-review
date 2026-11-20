import { Link, Outlet } from 'react-router-dom';

export function AppShell() {
  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        跳到內容
      </a>
      <header className="site-header">
        <div className="wrap header-inner">
          <Link className="brand" to="/">
            <span className="brand-mark" aria-hidden="true">
              字
            </span>
            <span className="brand-name">英文單字複習</span>
          </Link>
        </div>
      </header>
      <main id="content" className="main">
        <div className="wrap">
          <Outlet />
        </div>
      </main>
      <footer className="site-footer">
        <div className="wrap">
          單字組存在這個瀏覽器裡。用同一個瀏覽器、設定檔和網址重新整理後，仍可再選擇。清除網站資料可能會一併刪除。
        </div>
      </footer>
    </div>
  );
}
