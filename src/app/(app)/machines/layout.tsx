import { OtherFirm } from '@/components/other-firm';
import { labourFirmElsewhere } from '@/lib/auth';

/** The AJAX machines belong to the firm that runs Labour payment; in any other firm they are not shown. */
export default async function MachinesLayout({ children }: { children: React.ReactNode }) {
  const elsewhere = await labourFirmElsewhere();
  return elsewhere === null ? children : <OtherFirm firm={elsewhere} />;
}
