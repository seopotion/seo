'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Badge, Button, Input, Label, StatusPanel } from '@/components/ui';
import { api } from '@/lib/api';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import type { ProductOrganization } from '@/lib/organizations';

type Member = { email: string; role: 'owner' | 'member'; created_at: string };

/**
 * Settings → Team (#333). Everyone on the org sees the roster; only the owner
 * gets the add form and the remove buttons. No invite mail is sent: the owner
 * adds an email and the teammate signs in with Google using it.
 */
export function TeamPanel({
  onUnauthorized,
  organization,
}: {
  onUnauthorized: () => void;
  organization: ProductOrganization | null;
}) {
  const t = useTranslations('SettingsPage.team');
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [addError, setAddError] = useState<'already_member' | 'failed' | null>(null);
  const isOwner = organization?.role === 'owner';

  const membersQuery = useQuery({
    queryKey: dashboardQueryKeys.members(organization?.id ?? ''),
    queryFn: async (): Promise<Member[]> => {
      if (!organization) return [];
      const response = await api.api.v0.core.members.$get({ query: { org_id: organization.id } });
      if ((response.status as number) === 401) {
        onUnauthorized();
        throw new Error('unauthorized');
      }
      if (!response.ok) throw new Error('members_failed');
      return (await response.json()).members;
    },
    enabled: Boolean(organization),
  });

  const invalidate = () => {
    if (!organization) return;
    void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.members(organization.id) });
  };

  const addMutation = useMutation({
    mutationFn: async (value: string) => {
      if (!organization) throw new Error('organization_required');
      const response = await api.api.v0.core.members.$post({
        json: { org_id: organization.id, email: value },
      });
      if ((response.status as number) === 401) {
        onUnauthorized();
        throw new Error('unauthorized');
      }
      if ((response.status as number) === 409) throw new Error('already_member');
      if (!response.ok) throw new Error('add_failed');
      return response.json();
    },
    onSuccess: () => {
      setEmail('');
      setAddError(null);
      invalidate();
    },
    onError: (error: Error) => {
      if (error.message === 'unauthorized') return;
      setAddError(error.message === 'already_member' ? 'already_member' : 'failed');
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (value: string) => {
      if (!organization) throw new Error('organization_required');
      const response = await api.api.v0.core.members.$delete({
        json: { org_id: organization.id, email: value },
      });
      if ((response.status as number) === 401) {
        onUnauthorized();
        throw new Error('unauthorized');
      }
      if (!response.ok) throw new Error('remove_failed');
      return response.json();
    },
    onSuccess: invalidate,
  });

  function submitAdd(event: FormEvent<HTMLFormElement>) {
    // The panel lives inside the settings <form>; stop this submit from
    // reaching it and from reloading the page.
    event.preventDefault();
    event.stopPropagation();
    const value = email.trim();
    if (!value || addMutation.isPending) return;
    setAddError(null);
    addMutation.mutate(value);
  }

  const removeFailed =
    removeMutation.isError && (removeMutation.error as Error | null)?.message !== 'unauthorized';

  return (
    <div className="grid gap-4 rounded-md border border-border bg-card p-4">
      <p className="text-muted-foreground text-sm">{t('description')}</p>

      {isOwner ? (
        <form className="grid gap-2 sm:flex sm:items-end" onSubmit={submitAdd}>
          <div className="grid flex-1 gap-2">
            <Label htmlFor="team-email">{t('emailLabel')}</Label>
            <Input
              id="team-email"
              type="email"
              autoComplete="off"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={!organization || !email.trim() || addMutation.isPending}>
            {addMutation.isPending ? t('adding') : t('add')}
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground text-sm">{t('ownerOnly')}</p>
      )}

      {addError === 'already_member' ? (
        <StatusPanel tone="warning">{t('alreadyMember')}</StatusPanel>
      ) : addError === 'failed' || removeFailed ? (
        <StatusPanel tone="error">{t('error')}</StatusPanel>
      ) : null}

      {membersQuery.isPending ? (
        <p className="text-muted-foreground text-sm">{t('loading')}</p>
      ) : membersQuery.isError ? (
        <StatusPanel tone="error">{t('listError')}</StatusPanel>
      ) : (
        <ul className="grid gap-2">
          {membersQuery.data.map((member) => (
            <li
              key={member.email}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="truncate">{member.email}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
                  {member.role === 'owner' ? t('owner') : t('member')}
                </Badge>
                {isOwner && member.role === 'member' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-error hover:text-error"
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(member.email)}
                  >
                    {t('remove')}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
