'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from './ui';

export function ProfileForm({
  user,
}: { user: { fullName: string; phone: string; email: string | null } }) {
  const router = useRouter();

  const [profile, setProfile] = useState({ fullName: user.fullName, email: user.email ?? '' });
  const [profileState, setProfileState] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  const [password, setPassword] = useState({ currentPassword: '', newPassword: '' });
  const [passwordState, setPasswordState] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileBusy(true);
    setProfileState(null);
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: profile.fullName, email: profile.email || undefined }),
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      setProfileState(
        res.ok && body.ok
          ? { tone: 'success', text: 'اطلاعات حساب به‌روزرسانی شد.' }
          : { tone: 'error', text: body.message ?? 'به‌روزرسانی انجام نشد.' },
      );
      if (res.ok && body.ok) router.refresh();
    } catch {
      setProfileState({ tone: 'error', text: 'ارتباط با سرور برقرار نشد.' });
    } finally {
      setProfileBusy(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordBusy(true);
    setPasswordState(null);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(password),
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      if (res.ok && body.ok) {
        // Every session was revoked, so send the customer back to sign in.
        router.push('/login');
        router.refresh();
        return;
      }
      setPasswordState({ tone: 'error', text: body.message ?? 'تغییر رمز عبور انجام نشد.' });
    } catch {
      setPasswordState({ tone: 'error', text: 'ارتباط با سرور برقرار نشد.' });
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={saveProfile} className="card space-y-4 p-5" noValidate>
        <h2 className="text-base font-extrabold text-steel-900">اطلاعات شخصی</h2>
        {profileState && <Alert tone={profileState.tone}>{profileState.text}</Alert>}

        <div>
          <label htmlFor="p-fullName" className="label">نام و نام خانوادگی</label>
          <input id="p-fullName" className="field" value={profile.fullName}
            onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="p-email" className="label">ایمیل</label>
          <input id="p-email" type="email" dir="ltr" className="field latin-id" value={profile.email}
            onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} placeholder="name@example.com" />
        </div>
        <div>
          <label htmlFor="p-phone" className="label">شمارهٔ موبایل</label>
          <input id="p-phone" className="field latin-id" dir="ltr" value={user.phone} disabled readOnly />
          <p className="hint">شمارهٔ موبایل شناسهٔ ورود شماست و قابل تغییر نیست.</p>
        </div>

        <Button type="submit" variant="primary" disabled={profileBusy}>
          {profileBusy ? 'در حال ذخیره…' : 'ذخیرهٔ تغییرات'}
        </Button>
      </form>

      <form onSubmit={changePassword} className="card space-y-4 p-5" noValidate>
        <h2 className="text-base font-extrabold text-steel-900">تغییر رمز عبور</h2>
        {passwordState && <Alert tone={passwordState.tone}>{passwordState.text}</Alert>}

        <div>
          <label htmlFor="p-current" className="label">رمز عبور فعلی</label>
          <input id="p-current" type="password" autoComplete="current-password" className="field"
            value={password.currentPassword}
            onChange={(e) => setPassword((p) => ({ ...p, currentPassword: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="p-new" className="label">رمز عبور جدید</label>
          <input id="p-new" type="password" autoComplete="new-password" className="field"
            value={password.newPassword}
            onChange={(e) => setPassword((p) => ({ ...p, newPassword: e.target.value }))} />
          <p className="hint">حداقل ۸ کاراکتر، شامل حرف و رقم.</p>
        </div>

        <Alert tone="info">پس از تغییر رمز عبور، از همهٔ دستگاه‌ها خارج می‌شوید.</Alert>

        <Button type="submit" variant="primary" disabled={passwordBusy}>
          {passwordBusy ? 'در حال تغییر…' : 'تغییر رمز عبور'}
        </Button>
      </form>
    </div>
  );
}
