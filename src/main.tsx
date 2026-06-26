import { createRoot } from "react-dom/client";
import "./index.css";
import { exposeOdaraBuildInfo } from "@/lib/build-info";
import {
  installOdaraEarlyBootRecorder,
  isOdaraRecoveryModeSearchEnabled,
  recordOdaraBootPhase,
  renderOdaraRecoveryScreen,
} from "@/lib/login-recovery-diagnostics";

// Suppress verbose debug logs in production to avoid leaking user IDs,
// RPC names, and internal payload structure to the browser console.
if (!import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const noop = () => {};
  console.log = noop;
  console.debug = noop;
  console.info = noop;
}

exposeOdaraBuildInfo();
installOdaraEarlyBootRecorder();
recordOdaraBootPhase('boot_before_react_render');

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Odara root element was not found");
}

if (isOdaraRecoveryModeSearchEnabled(window.location.search)) {
  renderOdaraRecoveryScreen(rootElement, {
    getSessionConfirmsSession: async () => {
      const { odaraSupabase } = await import("@/lib/odara-client");
      const { data: { session } } = await odaraSupabase.auth.getSession();
      return Boolean(session?.user);
    },
  });
  recordOdaraBootPhase('boot_after_react_render', 'safe_mode_rendered');
} else {
  void import("./App.tsx").then(({ default: App }) => {
    createRoot(rootElement).render(<App />);
    recordOdaraBootPhase('boot_after_react_render');
  });
}
