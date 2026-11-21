import { SalarySheet } from './sheet';

/** Salary → Staff: their fixed monthly salary, with PF cut unless switched off, and advances and deductions taken off. */
export default function StaffSalaryPage({ searchParams }: { searchParams: Promise<{ month?: string; from?: string; to?: string; error?: string }> }) {
  return <SalarySheet kind="staff" searchParams={searchParams} />;
}
