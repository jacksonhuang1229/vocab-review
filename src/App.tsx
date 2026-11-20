import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ImportPage } from './pages/ImportPage';
import { SetDetailPage } from './pages/SetDetailPage';
import { SetListPage } from './pages/SetListPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<SetListPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="sets/:id" element={<SetDetailPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <section className="stack">
      <h1>找不到這個頁面</h1>
      <Link className="button button-ghost" to="/">
        回到單字組
      </Link>
    </section>
  );
}
