import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { ProfileForm } from '@/components/profile-form';
import { SectionHeading } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'اطلاعات حساب', robots: { index: false, follow: false } };

export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <>
      <SectionHeading title="اطلاعات حساب" as="h1" subtitle="نام، ایمیل و رمز عبور خود را مدیریت کنید." />
      <ProfileForm user={{ fullName: user.fullName, phone: user.phone, email: user.email }} />
    </>
  );
}
