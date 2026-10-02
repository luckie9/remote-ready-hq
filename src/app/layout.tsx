import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { AnalyticsProvider } from '@/components/AnalyticsProvider';
import { AuthProvider } from '@/components/AuthProvider';
import { AuthModal } from '@/components/AuthModal';
import { JobAlertFloatButton } from '@/components/JobAlertFloatButton';
import { JobAlertModal } from '@/components/JobAlertModal';
import { UnlockModal } from '@/components/UnlockModal';
import { UnlockProvider } from '@/components/UnlockProvider';
import './globals.css';

const sans = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

const mono = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'RemoteReady HQ',
  description:
    'Hand-picked, active remote roles from top global companies. Updated daily.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-slate-950 font-sans text-slate-100">
        <AnalyticsProvider>
          <AuthProvider>
            <UnlockProvider>
              {children}
              <AuthModal />
              <JobAlertModal />
              <JobAlertFloatButton />
              <UnlockModal />
            </UnlockProvider>
          </AuthProvider>
        </AnalyticsProvider>
      </body>
    </html>
  );
}
