import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { trackPointer } from "./fx/pointer";
import "./styles.css";

// Feeds the cursor position to CSS (the backdrop flashlight and the card
// spotlights). Outside React on purpose: nothing should re-render on a mouse move.
trackPointer();

// Gold is rebuilt every six hours, so nothing here goes stale in a session.
// The long staleTime is what makes flipping between filters feel instant.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
