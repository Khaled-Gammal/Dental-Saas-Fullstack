import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  Appointment, AuditEntry, Branch, CatalogEntry, CheckInResponse, ClinicProfile, DayAppointments, Doctor, GalleryItem, GalleryPage, MedicalHistory, OnboardingStatus,
  PatientDetail, PatientPage, Service, StaffSlots, WebsiteStatus,
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
};

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
export const useAppointments = (clinicId: string, date: string, branchId?: string) =>
  useQuery({
    queryKey: [...keys.appointments(clinicId), date, branchId ?? 'all'] as const,
    queryFn: () => api<DayAppointments>(`/appointments?${new URLSearchParams({ date, ...(branchId && { branchId }) })}`),
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
export const useStaffSlots = (clinicId: string, q: { branchId: string; doctorId: string; serviceId?: string; date: string }) =>
  useQuery({
    queryKey: [...keys.appointments(clinicId), 'slots', q] as const,
    queryFn: () => api<StaffSlots>(`/appointments/availability?${new URLSearchParams({ branchId: q.branchId, doctorId: q.doctorId, date: q.date, ...(q.serviceId && { serviceId: q.serviceId }) })}`),
    enabled: !!(q.branchId && q.doctorId && q.date),
  });

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
