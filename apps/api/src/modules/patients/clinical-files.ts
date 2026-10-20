/** Clinical documents: their storage key and their signed links (the "clinical:" scope). Unit-tested. */
import { PrivateFileSigner } from '../../shared/storage/private-files';

export { sniff, type Sniffed } from '../../shared/storage/private-files';

/** Storage key of a clinical file (server-generated only). */
export const clinicalKey = (tenantId: string, fileId: string) => `t/${tenantId}/clinical/${fileId}`;

/** A 5-minute link to one clinical file for one signed-in user; the download is audited as that user's view. */
export class ClinicalFileSigner extends PrivateFileSigner {
  constructor(secret: string, baseUrl: string) {
    super(secret, baseUrl, 'clinical', 'clinical-files');
  }
}
export const CLINICAL_FILE_SIGNER = Symbol('CLINICAL_FILE_SIGNER');
