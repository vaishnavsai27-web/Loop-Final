import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/hanken-grotesk';
import './styles/loop.css';
import App from './App';
import { AuthProvider } from './lib/auth';
import { RouterProvider } from './lib/router';
import { ToastProvider } from './lib/toast';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('LOOP render error:', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="page page-narrow" style={{ padding: 40 }}>
        <div className="notice notice-error" role="alert">
          <strong>LOOP hit a problem showing this page.</strong>
          <span>Reload to try again. If it keeps happening, the details below help us fix it.</span>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{String(this.state.error?.message || this.state.error)}</pre>
          <div><button type="button" className="btn" onClick={() => window.location.reload()}>Reload LOOP</button></div>
        </div>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RouterProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </RouterProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
