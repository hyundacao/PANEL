'use client';

import { useRef, useState } from 'react';
import { FileDown, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { ExportTechnology } from '@/lib/planowanie-zapotrzebowania/technologyLibraryExport';

export function TechnologyLibraryExportButton({ technologies, editorDirty, onMessage }: {
  technologies: readonly ExportTechnology[];
  editorDirty: boolean;
  onMessage: (message: string) => void;
}) {
  const [exporting, setExporting] = useState(false);
  const busy = useRef(false);
  const exportLibrary = async () => {
    if (busy.current || !technologies.length) return;
    if (editorDirty && !window.confirm('Edytor zawiera niezapisane zmiany. Wyeksportować bibliotekę bez tych zmian?')) return;
    busy.current = true;
    setExporting(true);
    try {
      // Load the spreadsheet engine only when the user requests an export.
      const { createTechnologyLibraryWorkbook } = await import('@/lib/planowanie-zapotrzebowania/technologyLibraryWorkbook');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const { workbook, data } = await createTechnologyLibraryWorkbook(technologies);
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const date = new Date();
      const dateKey = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
      anchor.href = url;
      anchor.download = `biblioteka-technologii-${dateKey}.xlsx`;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      onMessage(`Wyeksportowano ${data.entries.length} technologii. Uwagi do danych: ${data.issues.length}.`);
    } catch (error) {
      onMessage(error instanceof Error && error.message.startsWith('Drzewo przekracza')
        ? error.message : 'Nie udało się wyeksportować technologii. Spróbuj ponownie.');
    } finally {
      busy.current = false;
      setExporting(false);
    }
  };
  return <div className="flex justify-end border-t border-borderStrong pt-4">
    <Button variant="outline" className="min-h-11 w-full sm:w-auto" disabled={exporting || !technologies.length}
      aria-busy={exporting} onClick={() => void exportLibrary()}>
      {exporting ? <LoaderCircle aria-hidden="true" className="mr-2 h-4 w-4 shrink-0 animate-spin" /> : <FileDown aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" />}
      {exporting ? 'Eksportowanie technologii...' : 'Eksportuj technologie'}
    </Button>
  </div>;
}
