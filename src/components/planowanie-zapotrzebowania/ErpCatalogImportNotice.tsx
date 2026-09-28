import type { OriginalInventoryCatalogSyncResult } from '@/lib/api/types';

export function ErpCatalogImportNotice({ result, date }: { result: OriginalInventoryCatalogSyncResult; date: string }) {
  return (
    <div className="text-xs text-dim" role="status">
      <p>Stany ERP wgrane ({date}). Nowe kartoteki zapisane na stałe: {result.added}.</p>
      {result.warningCount > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-brandHover">
            Uwagi do kartotek: {result.warningCount} — import stanów zakończony
          </summary>
          <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto pl-4">
            {result.warnings.map((warning, index) => (
              <li key={index}>
                {warning.name && <span className="font-semibold">{warning.name} </span>}
                {warning.indexCode && <span>({warning.indexCode}) </span>}
                {warning.reason}
              </li>
            ))}
          </ul>
          {result.warningCount > result.warnings.length && <p className="mt-1">Pokazano pierwsze {result.warnings.length} uwag z {result.warningCount}.</p>}
        </details>
      )}
    </div>
  );
}
