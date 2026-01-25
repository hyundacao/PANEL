'use client';

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useUiStore } from '@/lib/store/ui';
import { canSeeTab, isReadOnly } from '@/lib/auth/access';

export default function SparePartsHomePage() {
  const router = useRouter();
  const { user } = useUiStore();
  const canPick = canSeeTab(user, 'CZESCI', 'pobierz');
  const canRefill = canSeeTab(user, 'CZESCI', 'uzupelnij');
  const readOnly = isReadOnly(user, 'CZESCI');

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        {canPick && (
          <Card className="flex flex-col items-center gap-4 text-center">
            <h2 className="text-xl font-semibold text-title">POBIERZ CZĘŚCI</h2>
            <Button
              onClick={() => router.push('/czesci/pobierz')}
              className="w-full"
              disabled={readOnly}
            >
              Przejdź do pobrań
            </Button>
          </Card>
        )}
        {canRefill && (
          <Card className="flex flex-col items-center gap-4 text-center">
            <h2 className="text-xl font-semibold text-title">UZUPEŁNIJ MAGAZYN</h2>
            <Button
              onClick={() => router.push('/czesci/uzupelnij')}
              className="w-full hover:border-[rgba(255,106,0,0.85)]"
              disabled={readOnly}
            >
              Przejdź do uzupełnień
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
