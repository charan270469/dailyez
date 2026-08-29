// Top-level App component: shows a sign-in screen when the user has logged out,
// otherwise renders the DashboardLayout that hosts every dashboard tab.
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import DashboardLayout from "./DashboardLayout";
import { LoginScreen } from "./components/LoginScreen";
import { getAuthStatus } from "./lib/api";

export default function App() {
  const [signedOut, setSignedOut] = useState<boolean | null>(
    () => localStorage.getItem("signalstream-logged-out") === "1",
  );

  useEffect(() => {
    // Confirm against the backend. On a fresh load with no flag, the server decides.
    (async () => {
      try {
        const result = await getAuthStatus();
        const loggedOut =
          result.loggedOut === true || result.user?.signedOut === true;
        setSignedOut(loggedOut);
        if (!loggedOut) {
          localStorage.removeItem("signalstream-logged-out");
        }
      } catch {
        // Backend unreachable — fall back to the local logout flag if present.
      }
    })();
  }, []);

  // While the status is still loading, keep the previous decision (or show the
  // dashboard frame once confirmed).
  if (signedOut === true) {
    return <LoginScreen />;
  }

  return <DashboardLayout />;
}
