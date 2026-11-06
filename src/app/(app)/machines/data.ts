import type { MachineService } from '@/lib/machines';
import type { createClient } from '@/lib/supabase/server';
import { allRows } from '../labour/data';

type Db = Awaited<ReturnType<typeof createClient>>;

export interface Machine {
  id: string;
  name: string;
  rented_to: string;
  service_every_hours: number;
  is_active: boolean;
}
export type MachineLine = Machine & { services: (MachineService & { machine_id: string })[] };

/** Every machine (or one) with its services, A to Z. */
export async function loadMachines(db: Db, machineId?: string): Promise<MachineLine[]> {
  const [machines, services] = await Promise.all([
    allRows<Machine>(db, 'machines', ['name', 'id'], machineId ? ['id', machineId] : undefined),
    allRows<MachineService & { machine_id: string }>(db, 'machine_services', ['service_date', 'created_at'], machineId ? ['machine_id', machineId] : undefined),
  ]);
  return machines.map((m) => ({ ...m, services: services.filter((s) => s.machine_id === m.id) }));
}
