/** Shapes shared by the identity services and controllers. */

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface SignupInput {
  acceptedDocuments: string[];
  fullName: string;
  email: string;
  phone: string;
  password: string;
  clinicNameAr: string;
  clinicNameEn?: string;
  slug: string;
  locale?: 'ar' | 'en';
  /** H7 «اشترك الآن» */
  subscribe?: { planCode: string; cycle: 'monthly' | 'yearly' };
}

export type OtpPurpose = 'verify_email' | 'verify_phone' | 'login' | 'reset_password' | 'booking';

export type AuthEventType = 'login_ok' | 'login_failed' | 'logout' | 'password_reset' | 'otp_sent' | 'otp_failed' | 'locked' | 'token_reuse';

export interface Session {
  accessToken: string;
  expiresIn: number;
  refreshToken: string; // goes into the httpOnly cookie, never into the JSON body
  user: { id: string; name: string; email: string | null; phone: string | null };
  clinic: { id: string; slug: string; nameAr: string | null; nameEn: string | null; role: string; roleName: string; status: string; permissions: string[] };
  clinics: { slug: string; nameAr: string | null; nameEn: string | null }[];
  /** H6: legal documents to accept before using the clinic (the token opens only the accept route until then) */
  legalPending: { id: string; kind: string; version: number; title_ar: string }[];
}

/** Row of memberships_for_user() (SECURITY DEFINER: works before a clinic is chosen). */
export interface Membership {
  tenant_id: string;
  slug: string;
  name_en: string | null;
  name_ar: string | null;
  tenant_status: string;
  role_key: string;
  member_status: string;
}

/** Present when a session is started by rotating a refresh token (same family, same absolute limit). */
export interface Rotation {
  familyId: string;
  familyStartedAt: Date;
}
