import { Suspense } from "react";

import { TransactionHistoryScreen } from "@/components/transactions/transaction-history-screen";

export default function TransactionsPage() {
  return (
    <Suspense>
      <TransactionHistoryScreen />
    </Suspense>
  );
}
