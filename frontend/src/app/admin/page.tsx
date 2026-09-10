'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@/types';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import AppShell from '@/components/layout/AppShell';

export default function AdminPage() {
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser && currentUser.role !== 'admin') {
      router.push('/dashboard');
      return;
    }
    const fetchUsers = async () => {
      try {
        const data = await api.getUsers();
        setUsers(data.users);
      } catch (err: any) {
        setError(err.message || 'Failed to load users');
      } finally {
        setIsLoading(false);
      }
    };
    if (currentUser) fetchUsers();
  }, [currentUser, router]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdatingId(userId);
    try {
      await api.updateUserRole(userId, newRole);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
    } catch (err: any) {
      alert(err.message || 'Failed to update role');
    } finally {
      setUpdatingId(null);
    }
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-screen">
          <div className="w-8 h-8 border-2 border-omnii-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Admin Panel</h1>
          <p className="text-surface-500">Manage users and platform access</p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="bg-dark-2 rounded-xl border border-dark-4">
          <div className="p-5 border-b border-dark-4">
            <h2 className="text-lg font-semibold text-white">Users</h2>
            <p className="text-xs text-surface-500 mt-1">{users.length} registered user{users.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="divide-y divide-dark-4">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between p-5 hover:bg-dark-3/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-omnii-600/20 flex items-center justify-center text-omnii-400 text-sm font-medium">
                    {u.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-surface-200">{u.name}</p>
                    <p className="text-xs text-surface-500">{u.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {u.id === currentUser?.id ? (
                    <span className="text-xs text-omnii-400 bg-omnii-600/15 px-3 py-1.5 rounded-lg border border-omnii-600/20 font-medium">
                      Admin (you)
                    </span>
                  ) : (
                    <select
                      value={u.role || 'user'}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      disabled={updatingId === u.id}
                      className="input-field text-sm py-1.5 px-3 w-28"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  )}
                  {updatingId === u.id && (
                    <div className="w-4 h-4 border-2 border-omnii-500 border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 bg-dark-2 rounded-xl border border-dark-4 p-5">
          <h2 className="text-lg font-semibold text-white mb-3">External Services</h2>
          <p className="text-xs text-surface-500 mb-4">
            Admin access for external platforms must be granted directly in each service.
          </p>
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-dark-3">
              <span className="text-lg mt-0.5">
                <svg className="w-5 h-5 text-surface-300" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              </span>
              <div>
                <p className="text-sm font-medium text-surface-200">GitHub</p>
                <p className="text-xs text-surface-500">
                  Go to github.com/orgs/Omnii-Command-Centre/people &rarr; Invite member &rarr; enter the email and set role to Owner
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-dark-3">
              <span className="text-lg mt-0.5">
                <svg className="w-5 h-5 text-surface-300" viewBox="0 0 76 65" fill="currentColor"><path d="M37.5896 0.25L68.4147 64.75H6.76465L37.5896 0.25Z"/></svg>
              </span>
              <div>
                <p className="text-sm font-medium text-surface-200">Vercel</p>
                <p className="text-xs text-surface-500">
                  Go to vercel.com/teams &rarr; Settings &rarr; Members &rarr; Invite Member &rarr; enter the email and set role to Owner
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-dark-3">
              <span className="text-lg mt-0.5">
                <svg className="w-5 h-5 text-surface-300" viewBox="0 0 24 24" fill="currentColor"><path d="M18.72 3.99997H5.37C5.19793 3.99191 5.02595 4.01786 4.86392 4.07635C4.70189 4.13484 4.55299 4.22471 4.42573 4.34081C4.29848 4.45692 4.19537 4.59699 4.12232 4.75299C4.04927 4.909 4.0077 5.07788 4 5.24997V18.63C4.01008 18.9943 4.15766 19.3429 4.41243 19.6062C4.6672 19.8694 5.01026 20.0283 5.37 20.05H18.72C19.0793 20.0292 19.4223 19.871 19.6773 19.6083C19.9322 19.3455 20.0803 18.9975 20.091 18.633V5.24997C20.0801 4.88544 19.9318 4.5378 19.6764 4.27534C19.421 4.01289 19.0728 3.86526 18.709 3.84497L18.72 3.99997ZM9 17.34H6.67V10.21H9V17.34ZM7.89 9.12997C7.72741 9.13564 7.5654 9.10762 7.41416 9.04768C7.26291 8.98774 7.12569 8.89717 7.01113 8.78166C6.89657 8.66616 6.80544 8.52813 6.74666 8.37647C6.68789 8.22481 6.66119 8.06274 6.668 7.89997C6.66119 7.73721 6.68789 7.57514 6.74666 7.42348C6.80544 7.27182 6.89657 7.13379 7.01113 7.01829C7.12569 6.90278 7.26291 6.81221 7.41416 6.75227C7.5654 6.69233 7.72741 6.66431 7.89 6.66997C8.05259 6.66431 8.2146 6.69233 8.36584 6.75227C8.51709 6.81221 8.65431 6.90278 8.76887 7.01829C8.88343 7.13379 8.97456 7.27182 9.03334 7.42348C9.09211 7.57514 9.11881 7.73721 9.112 7.89997C9.11881 8.06274 9.09211 8.22481 9.03334 8.37647C8.97456 8.52813 8.88343 8.66616 8.76887 8.78166C8.65431 8.89717 8.51709 8.98774 8.36584 9.04768C8.2146 9.10762 8.05259 9.13564 7.89 9.12997ZM17.34 17.34H15V13.44C15 12.51 14.67 11.87 13.84 11.87C13.5822 11.8722 13.3313 11.9541 13.1219 12.1045C12.9125 12.2549 12.7616 12.4664 12.64 12.71C12.5641 12.8926 12.5275 13.0898 12.5325 13.288V17.34H10.21V10.21H12.5325V11.21C12.7588 10.8286 13.0832 10.5138 13.4726 10.2975C13.862 10.0813 14.3023 9.97132 14.75 9.97997C16.25 9.97997 17.34 10.95 17.34 13.18V17.34Z"/></svg>
              </span>
              <div>
                <p className="text-sm font-medium text-surface-200">AWS</p>
                <p className="text-xs text-surface-500">
                  Go to AWS IAM &rarr; Users &rarr; Create user &rarr; enter the email, attach AdministratorAccess policy, and enable console access
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
