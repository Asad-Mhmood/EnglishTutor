import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/login-form';
import { Brand } from '@/components/layout/brand';
import { Card } from '@/components/ui/card';
import { currentLearnerId } from '@/lib/session';

/**
 * /login — the only door into the app.
 *
 * Every other page redirects here when there is no session, and this one redirects away when
 * there is, so "signed in" and "looking at the login form" can never be true at once.
 */

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentLearnerId()) {
    redirect('/home');
  }

  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Brand size="lg" />
          <h1 className="text-foreground mt-6 text-2xl font-semibold tracking-tight">
            Welcome back
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6 text-balance">
            Sign in to talk with Ahmad and pick up your progress where you left it.
          </p>
        </div>

        <Card className="p-6 shadow-sm sm:p-7">
          <LoginForm />
        </Card>

        <p className="text-muted-foreground mt-6 text-center text-xs leading-5 text-balance">
          New here? Just choose a username — an account is created the first time you sign in.
        </p>
      </div>
    </main>
  );
}
