import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { Toaster, ToastProvider } from "./components/ui/toast";
import { AuthProvider } from "./hooks/useAuth";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <App />
        <Toaster />
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
