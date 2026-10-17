import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  Appointment, AuditEntry, Branch, CashBranch, CashDay, CashSession, CatalogEntry, Expense, ExpenseCategory, ExpensesPage, CheckInResponse, ClinicProfile, DayAppointments, Doctor, GalleryItem, GalleryPage, MedicalHistory, OnboardingStatus,
  BookingSettings, HistoryVersion, Holiday, InvoiceDetail, InvoiceRow, OverdueInstallment, RoleLimit, PatientBilling, PatientChart, PaymentReceipt, PatientDetail, PatientFile, PatientPage, PatientRow, PlanDetail, PlanRow, PrescriptionPrint, Recall, Room, Service,
  StaffInvitation, StaffMember, StaffRole, StaffSlots, TimeOff, Visit, VisitSummary, WebsiteStatus,
} from './types';

/**
 * One place for query keys and fetchers. Every key starts with the clinic id, so switching clinic
 * can never show the previous clinic's cached data (the cache is also cleared on session change).
 */
export const keys = {
  branches: (clinicId: string) => ['branches', clinicId] as const,
  profile: (clinicId: string) => ['profile', clinicId] as const,
  onboarding: (clinicId: string) => ['onboarding', clinicId] as const,
  doctors: (clinicId: string) => ['doctors', clinicId] as const,
  services: (clinicId: string) => ['services', clinicId] as const,
  catalog: (clinicId: string) => ['catalog', clinicId] as const,
  appointments: (clinicId: string) => ['appointments', clinicId] as const,
  staff: (clinicId: string) => ['staff', clinicId] as const,
};

/** Members, open invitations and roles (owner only: `staff:manage`). One key, so one invalidation refreshes all three. */
export const useMembers = (clinicId: string) =>
  useQuery({ queryKey: [...keys.staff(clinicId), 'members'] as const, queryFn: () => api<StaffMember[]>('/staff/members') });
export const useInvitations = (clinicId: string) =>
  useQuery({ queryKey: [...keys.staff(clinicId), 'invitations'] as const, queryFn: () => api<StaffInvitation[]>('/staff/invitations') });
export const useRoles = (clinicId: string) =>
  useQuery({ queryKey: [...keys.staff(clinicId), 'roles'] as const, queryFn: () => api<StaffRole[]>('/staff/roles'), staleTime: 5 * 60_000 });

/** Publishes the draft website; refreshes the checklist (pendingChanges) afterwards. */
export function usePublish(clinicId: string) {
  const invalidate = useInvalidate(clinicId);
  return useMutation({
    mutationFn: () => api<WebsiteStatus>('/clinic/website/publish', { method: 'POST' }),
    onSuccess: () => void invalidate(),
  });
}

export const useBranches = (clinicId: string) =>
  useQuery({ queryKey: keys.branches(clinicId), queryFn: () => api<Branch[]>('/branches') });

export const useProfile = (clinicId: string) =>
  useQuery({ queryKey: keys.profile(clinicId), queryFn: () => api<ClinicProfile>('/clinic/profile') });

export const useOnboarding = (clinicId: string) =>
  useQuery({ queryKey: keys.onboarding(clinicId), queryFn: () => api<OnboardingStatus>('/clinic/onboarding') });

export const useDoctors = (clinicId: string) =>
  useQuery({ queryKey: keys.doctors(clinicId), queryFn: () => api<Doctor[]>('/doctors') });

export const useServices = (clinicId: string) =>
  useQuery({ queryKey: keys.services(clinicId), queryFn: () => api<Service[]>('/services') });

/** The platform's dental catalogue: the same for every clinic, so it is cached for the whole session. */
export const useCatalog = (clinicId: string) =>
  useQuery({ queryKey: keys.catalog(clinicId), queryFn: () => api<CatalogEntry[]>('/services/catalog'), staleTime: Infinity });

/** One item of a cached list, for an edit page: the list is small and already needed by the list screen. */
export function useOne<T extends { id: string }>(list: ReturnType<typeof useQuery<T[]>>, id: string | undefined) {
  const data = id ? list.data?.find((x) => x.id === id) : undefined;
  return { data, isLoading: list.isPending, isError: list.isError, error: list.error, notFound: list.isSuccess && !data, refetch: () => void list.refetch() };
}

/** After a setup change: refresh the checklist (and whatever else the change touched). */
export function useInvalidate(clinicId: string) {
  const qc = useQueryClient();
  return (...which: (keyof typeof keys)[]) =>
    Promise.all(['onboarding' as const, ...which].map((k) => qc.invalidateQueries({ queryKey: keys[k](clinicId) })));
}

/** One day of appointments; the key extends the clinic key so one invalidation refreshes every day and branch. */
/** `mine`: only the signed-in doctor's own appointments (SRS APPT-004). */
export const useAppointments = (clinicId: string, date: string, branchId?: string, mine = false) =>
  useQuery({
    queryKey: [...keys.appointments(clinicId), date, branchId ?? 'all', mine ? 'mine' : 'clinic'] as const,
    queryFn: () => api<DayAppointments>(`/appointments?${new URLSearchParams({ date, ...(branchId && { branchId }), ...(mine && { mine: 'true' }) })}`),
    refetchInterval: 30_000, // reception keeps the day open; website bookings appear without a reload
  });

export function useCheckIn(clinicId: string) {
  const invalidate = useInvalidate(clinicId);
  return useMutation({
    mutationFn: (body: { code: string; branchId: string }) => api<CheckInResponse>('/appointments/check-in', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => void invalidate('appointments'),
  });
}

export type AppointmentAction = 'arrive' | 'confirm' | 'start' | 'complete' | 'cancel' | 'noShow';
const ACTION_PATH: Record<AppointmentAction, string> = { arrive: 'arrive', confirm: 'confirm', start: 'start', complete: 'complete', cancel: 'cancel', noShow: 'no-show' };

export function useAppointmentAction(clinicId: string) {
  const invalidate = useInvalidate(clinicId);
  return useMutation({
    /** `reason` goes with a cancellation, `note` with a check-in without the code */
    mutationFn: ({ id, action, reason, note }: { id: string; action: AppointmentAction; reason?: string; note?: string }) =>
      api<Appointment>(`/appointments/${id}/${ACTION_PATH[action]}`, { method: 'POST', body: JSON.stringify({ ...(reason && { reason }), ...(note && { note }) }) }),
    onSuccess: () => void invalidate('appointments'),
  });
}

// ---------- patients ----------
export const patientKeys = {
  all: (clinicId: string) => ['patients', clinicId] as const,
  list: (clinicId: string, q: string) => ['patients', clinicId, 'list', q] as const,
  one: (clinicId: string, id: string) => ['patients', clinicId, 'one', id] as const,
  activity: (clinicId: string, id: string) => ['patients', clinicId, 'activity', id] as const,
};

/** Search (q) or the newest-first list with "load more"; a search returns one page of best matches. */
export const usePatients = (clinicId: string, q: string) =>
  useInfiniteQuery({
    queryKey: patientKeys.list(clinicId, q),
    queryFn: ({ pageParam }) => api<PatientPage>(`/patients?${new URLSearchParams({ ...(q && { q }), ...(pageParam && { cursor: pageParam }) })}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev, // typing in the search box keeps the old results on screen until new ones arrive
  });

export const usePatient = (clinicId: string, id: string | undefined) =>
  useQuery({ queryKey: patientKeys.one(clinicId, id ?? ''), queryFn: () => api<PatientDetail>(`/patients/${id}`), enabled: !!id });

/** Possible duplicates while registering someone new (SRS PATIENT-002): same phone, same or close name + birth date. */
export const usePossibleDuplicates = (clinicId: string, q: { phone: string; fullName: string; dateOfBirth: string }) =>
  useQuery({
    queryKey: [...patientKeys.all(clinicId), 'duplicates', q] as const,
    queryFn: () => api<PatientRow[]>(`/patients/duplicates?${new URLSearchParams({
      ...(q.phone && { phone: q.phone }), ...(q.fullName && { fullName: q.fullName }), ...(q.dateOfBirth && { dateOfBirth: q.dateOfBirth }),
    })}`),
    enabled: !!(q.phone || q.fullName),
  });

/** Earlier versions of the medical history (SRS PATIENT-005); loaded when the user opens them. */
export const useHistoryVersions = (clinicId: string, id: string, enabled: boolean) =>
  useQuery({ queryKey: [...patientKeys.one(clinicId, id), 'history-versions'] as const, queryFn: () => api<HistoryVersion[]>(`/patients/${id}/medical-history/versions`), enabled });

/** X-rays, clinical photos and documents (SRS PATIENT-004). Links inside expire after 5 minutes, so the list refreshes. */
export const usePatientFiles = (clinicId: string, id: string, archived: boolean, enabled: boolean) =>
  useQuery({
    queryKey: [...patientKeys.one(clinicId, id), 'files', archived] as const,
    queryFn: () => api<PatientFile[]>(`/patients/${id}/files${archived ? '?archived=true' : ''}`),
    enabled, staleTime: 4 * 60_000, refetchInterval: 4 * 60_000,
  });

export const usePatientActivity = (clinicId: string, id: string, enabled: boolean) =>
  useQuery({ queryKey: patientKeys.activity(clinicId, id), queryFn: () => api<AuditEntry[]>(`/patients/${id}/activity`), enabled });

/** Create (no id) or update; refreshes every cached patient view of this clinic. */
export function useSavePatient(clinicId: string, id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<PatientDetail>(id ? `/patients/${id}` : '/patients', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: patientKeys.all(clinicId) }),
  });
}

export function useSaveMedicalHistory(clinicId: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api<MedicalHistory>(`/patients/${id}/medical-history`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: patientKeys.all(clinicId) }),
  });
}

/** Free times for a staff booking (doctor + day). */
/** Free times for a staff booking or a move (`excludeAppointmentId`: the moved booking's own time counts as free). */
export const useStaffSlots = (clinicId: string, q: { branchId: string; doctorId: string; serviceId?: string; date: string; durationMinutes?: number; excludeAppointmentId?: string }) =>
  useQuery({
    queryKey: [...keys.appointments(clinicId), 'slots', q] as const,
    queryFn: () => api<StaffSlots>(`/appointments/availability?${new URLSearchParams({
      branchId: q.branchId, doctorId: q.doctorId, date: q.date, ...(q.serviceId && { serviceId: q.serviceId }),
      ...(q.durationMinutes && { durationMinutes: String(q.durationMinutes) }), ...(q.excludeAppointmentId && { excludeAppointmentId: q.excludeAppointmentId }),
    })}`),
    enabled: !!(q.branchId && q.doctorId && q.date),
  });

export const useAppointment = (clinicId: string, id: string | undefined) =>
  useQuery({ queryKey: [...keys.appointments(clinicId), 'one', id] as const, queryFn: () => api<Appointment>(`/appointments/${id}`), enabled: !!id });

/** Reschedule and/or set the room (POST /appointments/:id/move); only changed fields are sent. */
export function useMoveAppointment(clinicId: string) {
  const invalidate = useInvalidate(clinicId);
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api<Appointment>(`/appointments/${id}/move`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => void invalidate('appointments'),
  });
}

// ---------- calendar: holidays, time off, rooms, booking rules ----------
export const calendarKeys = {
  holidays: (clinicId: string) => ['holidays', clinicId] as const,
  timeOff: (clinicId: string, doctorId: string) => ['time-off', clinicId, doctorId] as const,
  rooms: (clinicId: string, branchId: string) => ['rooms', clinicId, branchId] as const,
  booking: (clinicId: string) => ['booking-settings', clinicId] as const,
};
export const useHolidays = (clinicId: string) =>
  useQuery({ queryKey: calendarKeys.holidays(clinicId), queryFn: () => api<Holiday[]>('/holidays') });
export const useTimeOff = (clinicId: string, doctorId: string | undefined) =>
  useQuery({ queryKey: calendarKeys.timeOff(clinicId, doctorId ?? ''), queryFn: () => api<TimeOff[]>(`/doctors/${doctorId}/time-off`), enabled: !!doctorId });
export const useRooms = (clinicId: string, branchId: string | undefined) =>
  useQuery({ queryKey: calendarKeys.rooms(clinicId, branchId ?? ''), queryFn: () => api<Room[]>(`/branches/${branchId}/rooms`), enabled: !!branchId });
export const useBookingSettings = (clinicId: string) =>
  useQuery({ queryKey: calendarKeys.booking(clinicId), queryFn: () => api<BookingSettings>('/clinic/booking-settings') });

export function useBookAppointment(clinicId: string) {
  const invalidate = useInvalidate(clinicId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Appointment>('/appointments', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => Promise.all([invalidate('appointments'), qc.invalidateQueries({ queryKey: patientKeys.all(clinicId) })]),
  });
}

// ---------- gallery ----------
export const galleryKeys = {
  all: (clinicId: string) => ['gallery', clinicId] as const,
  list: (clinicId: string, f: { scope: string; status: string; q: string }) => ['gallery', clinicId, 'list', f] as const,
  one: (clinicId: string, id: string) => ['gallery', clinicId, 'one', id] as const,
};

/** Signed image links last 15 minutes: lists are refetched well before that, so thumbnails never break. */
const SIGNED_STALE_MS = 5 * 60_000;

export const useGallery = (clinicId: string, f: { scope: string; status: string; q: string }) =>
  useInfiniteQuery({
    queryKey: galleryKeys.list(clinicId, f),
    queryFn: ({ pageParam }) => api<GalleryPage>(`/gallery?${new URLSearchParams({ scope: f.scope, status: f.status, ...(f.q && { q: f.q }), ...(pageParam && { cursor: pageParam }) })}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev,
    staleTime: SIGNED_STALE_MS,
    refetchInterval: 10 * 60_000,
  });

export const useGalleryItem = (clinicId: string, id: string | undefined) =>
  useQuery({ queryKey: galleryKeys.one(clinicId, id ?? ''), queryFn: () => api<GalleryItem>(`/gallery/${id}`), enabled: !!id, staleTime: SIGNED_STALE_MS });

/** Every gallery mutation refreshes all gallery views of the clinic (lists, filters, the edited item). */
export function useGalleryMutation<V, R = unknown>(clinicId: string, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: galleryKeys.all(clinicId) }) });
}
export const galleryApi = {
  create: (body: Record<string, unknown>) => api<GalleryItem>('/gallery', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Record<string, unknown>) => api<GalleryItem>(`/gallery/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) => api<void>(`/gallery/${id}`, { method: 'DELETE' }),
  reorder: (branchId: string | null, ids: string[]) => api<{ ok: true }>('/gallery/order', { method: 'PUT', body: JSON.stringify({ branchId, ids }) }),
};

// ---------- clinical (Phase D4: visits, chart, plans, prescriptions, follow-ups) ----------
export const clinicalKeys = {
  all: (clinicId: string) => ['clinical', clinicId] as const,
  visit: (clinicId: string, id: string) => ['clinical', clinicId, 'visit', id] as const,
  patient: (clinicId: string, patientId: string) => ['clinical', clinicId, 'patient', patientId] as const,
  plan: (clinicId: string, id: string) => ['clinical', clinicId, 'plan', id] as const,
  prescription: (clinicId: string, id: string) => ['clinical', clinicId, 'prescription', id] as const,
  recalls: (clinicId: string, view: string) => ['clinical', clinicId, 'recalls', view] as const,
};
export const useVisit = (clinicId: string, id: string | undefined) =>
  useQuery({ queryKey: clinicalKeys.visit(clinicId, id ?? ''), queryFn: () => api<Visit>(`/visits/${id}`), enabled: !!id });
export const usePatientVisits = (clinicId: string, patientId: string, enabled: boolean) =>
  useQuery({ queryKey: [...clinicalKeys.patient(clinicId, patientId), 'visits'] as const, queryFn: () => api<VisitSummary[]>(`/patients/${patientId}/visits`), enabled });
export const usePatientChart = (clinicId: string, patientId: string, enabled: boolean) =>
  useQuery({ queryKey: [...clinicalKeys.patient(clinicId, patientId), 'chart'] as const, queryFn: () => api<PatientChart>(`/patients/${patientId}/chart`), enabled });
export const usePatientPlans = (clinicId: string, patientId: string) =>
  useQuery({ queryKey: [...clinicalKeys.patient(clinicId, patientId), 'plans'] as const, queryFn: () => api<PlanRow[]>(`/patients/${patientId}/plans`) });
export const usePatientRecalls = (clinicId: string, patientId: string) =>
  useQuery({ queryKey: [...clinicalKeys.patient(clinicId, patientId), 'recalls'] as const, queryFn: () => api<Recall[]>(`/patients/${patientId}/recalls`) });
export const usePlan = (clinicId: string, id: string | undefined) =>
  useQuery({ queryKey: clinicalKeys.plan(clinicId, id ?? ''), queryFn: () => api<PlanDetail>(`/plans/${id}`), enabled: !!id });
export const usePrescription = (clinicId: string, id: string | undefined) =>
  useQuery({ queryKey: clinicalKeys.prescription(clinicId, id ?? ''), queryFn: () => api<PrescriptionPrint>(`/prescriptions/${id}`), enabled: !!id });
export const useRecalls = (clinicId: string, view: 'due' | 'upcoming' | 'closed') =>
  useQuery({ queryKey: clinicalKeys.recalls(clinicId, view), queryFn: () => api<{ today: string; items: Recall[] }>(`/recalls?view=${view}`) });

/** JSON write to the API. */
export const send = <R>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) =>
  api<R>(path, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });

/**
 * Every clinical write refreshes the clinical cache, and the appointments too: opening a visit starts the appointment,
 * and a cancelled booking puts its plan item or follow-up back on the list (database triggers).
 */
export function useClinicalMutation<V, R = unknown>(clinicId: string, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: clinicalKeys.all(clinicId) }), qc.invalidateQueries({ queryKey: keys.appointments(clinicId) })]),
  });
}

// ---------- billing (Phase E1) ----------
export const billingKeys = {
  all: (clinicId: string) => ['billing', clinicId] as const,
  list: (clinicId: string, status: string) => ['billing', clinicId, 'list', status] as const,
  invoice: (clinicId: string, id: string) => ['billing', clinicId, 'invoice', id] as const,
  patient: (clinicId: string, patientId: string) => ['billing', clinicId, 'patient', patientId] as const,
  payment: (clinicId: string, id: string) => ['billing', clinicId, 'payment', id] as const,
};
export const useInvoices = (clinicId: string, status: string) =>
  useQuery({ queryKey: billingKeys.list(clinicId, status), queryFn: () => api<InvoiceRow[]>(`/invoices${status === 'all' ? '' : `?status=${status}`}`) });
export const useInvoice = (clinicId: string, id: string | undefined) =>
  useQuery({ queryKey: billingKeys.invoice(clinicId, id ?? ''), queryFn: () => api<InvoiceDetail>(`/invoices/${id}`), enabled: !!id });
export const usePatientBilling = (clinicId: string, patientId: string | undefined, enabled = true) =>
  useQuery({ queryKey: billingKeys.patient(clinicId, patientId ?? ''), queryFn: () => api<PatientBilling>(`/patients/${patientId}/billing`), enabled: enabled && !!patientId });
export const usePaymentReceipt = (clinicId: string, id: string | undefined) =>
  useQuery({ queryKey: billingKeys.payment(clinicId, id ?? ''), queryFn: () => api<PaymentReceipt>(`/payments/${id}`), enabled: !!id });

/** Every billing write refreshes invoices, balances and the clinical cache (unbilled procedures). */
export function useBillingMutation<V, R = unknown>(clinicId: string, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: billingKeys.all(clinicId) }), qc.invalidateQueries({ queryKey: clinicalKeys.all(clinicId) }),
      qc.invalidateQueries({ queryKey: financeKeys.all(clinicId) })]),
  });
}

export const usePendingDiscounts = (clinicId: string) =>
  useQuery({ queryKey: [...billingKeys.all(clinicId), 'discounts', 'pending'] as const, queryFn: () => api<InvoiceRow[]>('/discounts/pending') });
export const useDiscountLimits = (clinicId: string) =>
  useQuery({ queryKey: [...billingKeys.all(clinicId), 'discounts', 'limits'] as const, queryFn: () => api<RoleLimit[]>('/discounts/limits') });
export const useOverdueInstallments = (clinicId: string, enabled = true) =>
  useQuery({ queryKey: [...billingKeys.all(clinicId), 'overdue'] as const, queryFn: () => api<{ today: string; items: OverdueInstallment[] }>('/installments/overdue'), enabled });

// ---------- expenses and the daily cash box (Phase E3) ----------
export const financeKeys = { all: (clinicId: string) => ['finance', clinicId] as const };
const qs = (q: Record<string, string | undefined>) => {
  const p = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1]));
  return p.size ? `?${p}` : '';
};
/** Every expense or cash write refreshes expenses and the cash day (an expense paid in cash moves expected cash). */
export function useFinanceMutation<V, R = unknown>(clinicId: string, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: financeKeys.all(clinicId) }) });
}
export const useExpenses = (clinicId: string, q: { status?: string; from?: string; to?: string; branchId?: string; categoryId?: string }) =>
  useQuery({ queryKey: [...financeKeys.all(clinicId), 'expenses', q] as const, queryFn: () => api<ExpensesPage>(`/expenses${qs(q)}`) });
export const usePendingExpenses = (clinicId: string, enabled = true) =>
  useQuery({ queryKey: [...financeKeys.all(clinicId), 'expenses', 'pending'] as const, queryFn: () => api<Expense[]>('/expenses/pending'), enabled });
export const useExpenseCategories = (clinicId: string) =>
  useQuery({ queryKey: [...financeKeys.all(clinicId), 'categories'] as const, queryFn: () => api<ExpenseCategory[]>('/expenses/categories') });
export const useExpenseSettings = (clinicId: string, enabled = true) =>
  useQuery({ queryKey: [...financeKeys.all(clinicId), 'settings'] as const, queryFn: () => api<{ receptionLimitMinor: number }>('/expenses/settings'), enabled });
export const useCashBranches = (clinicId: string) =>
  useQuery({ queryKey: [...financeKeys.all(clinicId), 'cash-branches'] as const, queryFn: () => api<CashBranch[]>('/cash/branches') });
export const useCashDay = (clinicId: string, branchId: string) =>
  useQuery({ queryKey: [...financeKeys.all(clinicId), 'cash-day', branchId] as const, queryFn: () => api<CashDay>(`/cash/today?branchId=${branchId}`), enabled: !!branchId });
export const useCashHistory = (clinicId: string, branchId: string) =>
  useQuery({ queryKey: [...financeKeys.all(clinicId), 'cash-history', branchId] as const, queryFn: () => api<CashSession[]>(`/cash/sessions?branchId=${branchId}`), enabled: !!branchId });
export const useCashSession = (clinicId: string, id: string | null) =>
  useQuery({ queryKey: [...financeKeys.all(clinicId), 'cash-session', id] as const, queryFn: () => api<CashSession>(`/cash/sessions/${id}`), enabled: !!id });
