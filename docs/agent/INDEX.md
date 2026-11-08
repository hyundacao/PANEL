# Indeks Dla Agenta

Repo: panel magazynowy i produkcyjny. Lokalnie `C:/APKA DLA KAMILA`, nie MOVIS.
Stan mapy sprawdzono z kodem 2026-11-06; stan bazy i wdrozenia sprawdzaj osobno.

## Wybierz Karte

| Polecenie / objaw | Czytaj tylko te karte |
| --- | --- |
| Plan, technologia, skladnik, norma, przelicznik, bazowa/awaryjna, ilosc do wypisania, dokument, stan strefy, Excel technologii | [Planowanie](<planning.md>) |
| Indeks 1/2, kartoteka, import Excel/PDF ERP, podpowiedzi, spis rzeczywisty, silos, zestaw paletowy, urzadzenie | [Kartoteki i spis](<inventory.md>) |
| Przemial, stan magazynu, zwykly transfer, anulowanie, suszarka, mieszanka, raport magazynowy, do zmielenia | [Przemialy](<regrind.md>) |
| Farby, rozcienczalniki, rozliczanie zlecen, spis farb/tasm, archiwum, komentarz, Excel historii | [Farby](<paint.md>) |
| Zadania na dzien, mechanik, narzedziownia, cykliczne/osobiste, raport prac, podglad technologii zadania | [Przygotowanie produkcji](<preparation.md>) |
| Przesuniecia magazynowe ERP, dokument wydania/odbioru, paczki, lokalizacja docelowa | [Dokumenty ERP](<erp-transfers.md>) |
| Czesci zamienne, raport zmianowy, brakowosc, bilans przezbrojen | [Pozostale moduly](<other-modules.md>) |
| Logowanie, rola, dostep, admin, powiadomienia, RLS, SQL, wspolny layout/komponent | [Bezpieczenstwo i infrastruktura](<security-data.md>) |

## Sposob Pracy

1. Wybierz karte po funkcji biznesowej, nie po podobienstwie nazwy pliku.
2. Znajdz wskazana kotwice przez `rg -n` w jednym pliku. Odczytaj jej otoczenie, nie caly wielotysieczny plik.
3. Sprawdz sekcje "Wplyw". Przy zmianie kontraktu doczytaj odpowiedni fragment [kontraktow](<contracts.md>).
4. Edytuj najmniejszy potrzebny zakres. Zweryfikuj odbiorcow i testy wskazane na karcie.
5. Przy nowym przeplywie dopisz krotki wpis do karty; nie rozbudowuj calej mapy dla jednego parametru.

Nie czytaj starego przegladu, plikow tymczasowych, backupow ani wszystkich kart "na wszelki wypadek".
Brak informacji lub sprzecznosc z kodem to powod do rozszerzenia sprawdzenia, nie do zgadywania.

## Szybkie Testy

- Jeden zestaw: `node --experimental-strip-types --test sciezka/do/pliku.test.mjs`.
- Kilka powiazanych zestawow: podaj kilka sciezek temu samemu poleceniu.
- `npm test` wykrywa wszystkie testy; `npm run test:planning` obejmuje caly katalog domeny planowania.
- Nie przekazuj sciezki testu do `npm test` w oczekiwaniu na pojedynczy zestaw: runner i tak dopisuje wszystkie znalezione testy.
- Typy: `npm run typecheck`. Lint: `npx eslint zmieniony/plik.ts`. Build uruchamiaj wg [TESTOWANIE](<../../TESTOWANIE.md>), nie rownoczesnie z dev w tym samym katalogu.
- Sprawdzenie samej mapy: `node scripts/check-agent-map.mjs` (pliki, kotwice, trasy, rozmiar kart; bez bazy i sieci).
- Ten sam check wykonuje [agentMap.test.mjs](<../../src/lib/utils/agentMap.test.mjs>), automatycznie wykrywany przez `npm test`. Zaleznosci biznesowe nadal wymagaja aktualizacji karty przy zmianie kontraktu.

## Granice

- Mapa opisuje punkty wejscia i ryzyko zmian, nie implementuje logiki i nie zastepuje testow.
- Liczby rekordow, rewizje, hasla, tokeny, zawartosc `.env` i dane firmy nie naleza do mapy.
- Nie wpisuj numerow linii: zmieniaja sie czesciej niz nazwy funkcji.
- Nie zakladaj, ze migracja jest wykonana, bo plik SQL istnieje. Nie uruchamiaj SQL przy zmianie samego UI.
- Nie obiecuj konkretnego procentu oszczednosci tokenow; utrzymuj maly koszt wejscia i odczyt na zadanie.
