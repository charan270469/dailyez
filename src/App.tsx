// Top-level App component: renders the DashboardLayout that hosts every dashboard tab.
// Kept minimal on purpose — all UI wiring lives in DashboardLayout.
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import DashboardLayout from './DashboardLayout';

export default function App() {
  return <DashboardLayout />;
}
