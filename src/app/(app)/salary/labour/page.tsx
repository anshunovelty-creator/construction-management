import { SalarySheet } from '../sheet';

/** Salary → Labour: days marked on the daily reports with OT, no PF unless switched on, less advances and deductions. */
export default function LabourSalaryPage({ searchParams }: { searchParams: Promise<{ month?: string; from?: string; to?: string; error?: string }> }) {
  return <SalarySheet kind="worker" searchParams={searchParams} />;
}
