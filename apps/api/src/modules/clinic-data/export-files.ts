import { PrivateFileSigner } from '../../shared/storage/private-files';

/** A data export's signed download link (H8): its own scope, so a clinical or expense link never opens an export. */
export class ExportFileSigner extends PrivateFileSigner {
  constructor(secret: string, baseUrl: string) {
    super(secret, baseUrl, 'export', 'data-exports');
  }
}
export const EXPORT_FILE_SIGNER = Symbol('EXPORT_FILE_SIGNER');
