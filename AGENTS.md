# Zasady pracy w tym projekcie

- Gdy użytkownik zleca zmianę, wykonaj ją samodzielnie od analizy do wdrożenia i weryfikacji.
- Traktuj jednoznaczne polecenie użytkownika jako zgodę na wszystkie bezpieczne, odwracalne kroki mieszczące się w zakresie zadania.
- Przy brakujących drobnych szczegółach korzystaj z kontekstu projektu i przyjmuj rozsądne założenia zamiast zatrzymywać pracę pytaniem.
- Pytaj tylko wtedy, gdy brak decyzji użytkownika istotnie zmieni wynik, rozszerzy zakres albo wymaga nieodwracalnej lub destrukcyjnej operacji.
- Nie proś o zatwierdzanie odczytów, diagnostyki, edycji w katalogu projektu, testów ani innych standardowych kroków realizacji zadania.
- Jeśli środowisko technicznie wymaga zatwierdzenia operacji zewnętrznej, przygotuj wcześniej całą zmianę i zgrupuj zapis oraz weryfikację w jednym poleceniu, aby pojawiło się najwyżej jedno wymagane zatwierdzenie.
- Nie uruchamiaj zbędnych poleceń z podwyższonymi uprawnieniami.
- Po zakończeniu podaj zwięźle rezultat, zakres zmian i wynik weryfikacji.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
