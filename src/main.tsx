import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { ErrorBoundary } from './components/ErrorBoundary';
import "./index.css";

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// The boundary sits outside the providers, not inside them. A boundary only catches
// errors thrown *below* itself, so anything thrown while AuthContext restores a session
// or GoogleOAuthProvider initialises - exactly the code that runs before the first paint,
// where a throw is indistinguishable from a blank white page - would escape a boundary
// placed around <App /> alone.
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <GoogleOAuthProvider clientId={googleClientId}>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </GoogleOAuthProvider>
  </ErrorBoundary>
);
  