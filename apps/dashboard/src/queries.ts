import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useMutation } from '@tanstack/react-query';
import type { Branch, ClinicProfile, OnboardingStatus, WebsiteStatus } from './types';

/**
 * One place for query keys and fetchers. Every key starts with the clinic id, so switching clinic
 * can never show the previous clinic's cached data (the cache is also cleared on session change).
 */
export const keys = {
  branches: (clinicId: string) => ['branches', clinicId] as const,
  profile: (clinicId: string) => ['profile', clinicId] as const,
  onboarding: (clinicId: string) => ['onboarding', clinicId] as const,
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

/** After a setup change: refresh the checklist (and whatever else the change touched). */
export function useInvalidate(clinicId: string) {
  const qc = useQueryClient();
  return (...which: (keyof typeof keys)[]) =>
    Promise.all(['onboarding' as const, ...which].map((k) => qc.invalidateQueries({ queryKey: keys[k](clinicId) })));
}
