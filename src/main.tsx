import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { exposeOdaraBuildInfo } from "@/lib/build-info";

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

createRoot(document.getElementById("root")!).render(<App />);
