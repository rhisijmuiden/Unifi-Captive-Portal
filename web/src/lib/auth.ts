import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AuthState } from './api';

export function useAuth() {
  return useQuery({ queryKey: ['auth'], queryFn: () => api.get<AuthState>('/auth/state'), staleTime: 60_000 });
}

export function useRefreshAuth() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['auth'] });
}
