import type { MedicalHistory } from '../types';
import { medicalAlerts } from '../patient-model';
import { Alert } from './components';

/**
 * The patient's safety alerts (PATIENT-005): allergies, pregnancy and conditions, with the current medications under
 * them. The same banner on the patient profile and the visit, so reception and the doctor see the same thing.
 * Renders nothing when there is nothing to warn about (or the role may not see clinical data: `history` is null).
 */
export function MedicalAlerts({ history }: { history: MedicalHistory | null | undefined }) {
  const { items, medications } = medicalAlerts(history ?? null);
  if (!items.length) return null;
  return (
    <Alert tone="danger">
      <strong>تنبيهات:</strong> <bdi>{items.join(' · ')}</bdi>
      {medications.length > 0 && <div className="small mt-sm">الأدوية الحالية: <bdi>{medications.join('، ')}</bdi></div>}
    </Alert>
  );
}
