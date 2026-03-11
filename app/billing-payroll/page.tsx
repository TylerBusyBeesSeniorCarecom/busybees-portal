// app/billing-payroll/page.tsx
import React from "react";
import BillingPayrollClient from "./BillingPayrollClient";

export const dynamic = "force-dynamic";

// Server component wrapper (renders the client component)
export default function Page() {
  return <BillingPayrollClient />;
}
