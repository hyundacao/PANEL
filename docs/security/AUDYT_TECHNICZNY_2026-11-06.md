# Audyt bezpieczenstwa aplikacji magazynowej i produkcyjnej

Data: 6 listopada 2026. Projekt: `C:/APKA DLA KAMILA`.
Wersja kodu: `02ab2972ce2306d9a556fb8eceea113fdd671c73`. Istniejace zmiany mapy agenta nie zmieniaja logiki aplikacji.

## Wniosek

Najwazniejsze ryzyka to przejecie konta po resecie, brak MFA administratora i slabe parametry haszowania hasel. Nie potwierdzono publicznego odczytu danych, obejscia podpisu sesji ani backdoora w przejrzanym kodzie. Jest to wynik opisanych kontroli, nie gwarancja braku wszystkich podatnosci.

Zakres: kod, testy lokalne i izolowane oraz odczyt bazy wskazanej przez lokalna konfiguracje Supabase. To nie jest ustawowy audyt KSC, certyfikat zgodnosci z NIS2 ani pentest calej infrastruktury. Status prawny firmy pozostaje do ustalenia.

Nie zmieniano dzialania aplikacji, hasel, uprawnien ani danych biznesowych. Nie uruchamiano migracji na produkcji ani mutujacych RPC. Lokalny kod nie potwierdza wersji wdrozonej w internecie.

## Ustalenia

Priorytety sa ocena ryzyka dla tej aplikacji, nie wyliczeniem CVSS. P1 oznacza pierwszenstwo, P2 zaplanowana naprawe, P3 dodatkowe utwardzenie lub ograniczona ekspozycje. Rozrozniono rzeczywiste wyniki, testy izolowane i ryzyka warunkowe.

### A01 P1 Wspolne haslo po resecie

Dowod: [reset-password](<C:/APKA DLA KAMILA/src/app/api/users/[id]/reset-password/route.ts:15>) i [stala hasla](<C:/APKA DLA KAMILA/src/lib/auth/password.ts:1>).

Reset ustawia te sama stala dla kolejnych kont i pozostawia 24 godziny na zmiane. Osoba znajaca domyslny sekret i nazwe konta moze zalogowac sie pierwsza po resecie, a nastepnie ustawic wlasne haslo. Wymuszenie zmiany nie dowodzi tozsamosci zmieniajacego.

Poprawne ograniczenia istnieja: reset wykonuje tylko HEAD_ADMIN, stare sesje sa uniewazniane, zwykle API blokowane do zmiany hasla. Nie usuwaja one powyzszego scenariusza. Wspolne haslo pozostalo zgodnie z wczesniejsza decyzja wlasciciela; audyt tej decyzji nie zmienia.

Naprawa: indywidualny jednorazowy sekret/token aktywacji. Przy zachowaniu wspolnego hasla potrzebna jest niezalezna weryfikacja wlasciciela konta przed ustawieniem nowego hasla. Sam krotszy termin nie wystarczy. Podstawa: [OWASP odzyskiwanie konta](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

### A02 P1 Brak MFA administratora

Dowod: [wydanie sesji](<C:/APKA DLA KAMILA/src/app/api/auth/login/route.ts:108>), [czas sesji](<C:/APKA DLA KAMILA/src/lib/auth/session.ts:9>) i administracyjne API kont/grup.

Po poprawnym hasle aplikacja od razu wydaje sesje. Nie znaleziono TOTP, WebAuthn, passkey ani innego wymaganego drugiego czynnika. Zapamietana sesja moze trwac 30 dni, bez osobnego skrocenia dla HEAD_ADMIN. Zmiany uprawnien i resety kont nie wymagaja swiezej ponownej weryfikacji.

Kradziez hasla administratora wystarcza do uzyskania jego uprawnien. Kradziez aktywnego cookie pozwala dzialac do odwolania lub wygasniecia sesji; nie jest to obejscie podpisu. MFA tylko przy logowaniu nie chroni automatycznie pozniej skradzionej sesji.

Naprawa: obowiazkowe MFA administratorow, bezpieczne odzyskiwanie, krotsze sesje uprzywilejowane i ponowna weryfikacja operacji krytycznych. Preferowac mechanizmy odporne na phishing. MFA GitHuba/Vercel nie zabezpiecza osobnego logowania tej aplikacji. Podstawa: [OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).

### A03 P2 Za niski koszt bcrypt na wszystkich kontach

Dowod: [tworzenie hasha](<C:/APKA DLA KAMILA/supabase/01_konta_i_uprawnienia.sql:149>) i [zmiana hasha](<C:/APKA DLA KAMILA/supabase/01_konta_i_uprawnienia.sql:207>).

Definicje uzywaja `gen_salt('bf')` bez jawnego kosztu. Domyslny koszt PostgreSQL to 6. HEAD z filtrami prefiksow bcrypt potwierdzil w rzeczywistej bazie 22 konta z kosztem 6 i zero z kosztami 4-5 oraz 7-14. Byly to wszystkie konta w chwili badania. Nie pobierano hasel ani ich skrotow.

Po kradziezy bazy lub backupu zgadywanie hasel offline jest za tanie. Nie oznacza to przechowywania hasel jawnym tekstem ani potwierdzonego wycieku. OWASP podaje minimum 10 dla bcrypt. Zrodla: [PostgreSQL pgcrypto](https://www.postgresql.org/docs/current/pgcrypto.html), [OWASP haszowanie](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Naprawa: jawny koszt dobrany pomiarem, co najmniej 10 dla bcrypt, oraz stopniowe ponowne haszowanie po poprawnym logowaniu/zmianie hasla. Nie wymaga to zmiany znanych hasel. Zmiana samej funkcji nie podniesie kosztu juz zapisanych 22 skrotow.

### A04 P2 Niepelny dziennik bezpieczenstwa

Dowod: [writeAuditLog](<C:/APKA DLA KAMILA/src/app/api/app/route.ts:1716>), [obsluga bledu dziennika](<C:/APKA DLA KAMILA/src/app/api/app/route.ts:1746>) oraz trasy `api/auth`, `api/users`, `api/permission-groups`.

Aplikacja ma dziennik wielu operacji biznesowych. W przejrzanych trasach nie ma analogicznego trwalego dziennika nieudanych logowan, resetow, usuwania kont i zmian rol/grup. `last_login` nie odtwarza historii incydentu. Operacja biznesowa i jej wpis audytowy sa osobne; blad wpisu powoduje tylko `console.error`, wiec zmiana moze pozostac bez trwalego sladu w tabeli audytu.

Skutek: utrudnione wykrycie przejecia i odtworzenie zdarzen. Nie stwierdzono skasowania obecnych logow. Eksport i alerty hostingu pozostaja niezweryfikowane.

Naprawa: centralny dziennik zmian kont/uprawnien i prob dostepu, bez tokenow/hasel; niezawodny zapis audytu krytycznych operacji przez transakcje lub outbox. Oddzielny eksport i alarmowanie. Podstawa: [OWASP logowanie zdarzen](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

### A05 P2 Instalatory SQL nie naprawiaja starych ACL i RLS

Dowod: [warunek tabeli](<C:/APKA DLA KAMILA/supabase/01_konta_i_uprawnienia.sql:19>) i [warunek funkcji](<C:/APKA DLA KAMILA/supabase/01_konta_i_uprawnienia.sql:118>).

W wielu sekcjach wlaczenie RLS oraz REVOKE/GRANT znajduje sie wewnatrz warunku tworzenia obiektu. Istniejace obiekty zachowuja starsze ustawienia. Jest to celowa zgodnosc wsteczna, ale instalator nie jest przez to pelna migracja utwardzajaca. Migracja 10 zabezpiecza wybrane funkcje, nie wszystkie starsze obiekty.

Reprodukcja na izolowanym PGlite: po instalacji modulow nadano syntetyczne prawo anon do `create_app_user` i wylaczono RLS `app_users`. Ponowne wykonanie modulow i migracji 10 pozostawilo oba niebezpieczne ustawienia. Nie zmieniano ich na rzeczywistej bazie.

Rzeczywisty anonimowy odczyt `app_users` byl pusty, a HEAD `list_app_users` zwrocil 401. Nie potwierdzono obecnej mozliwosci anonimowego utworzenia konta; produkcyjnych zapisow nie probowano.

Naprawa: inwentaryzacja aktualnych grantow, polityk i przeciazen RPC, nastepnie osobna migracja z testami. Nie wklejac ponownie 01-09 jako zamiennika tej kontroli. Historycznych publicznych polityk nie uruchamiac ponownie.

### A06 P2 Tworzenie kont omija polityke hasel

Dowod: [POST users](<C:/APKA DLA KAMILA/src/app/api/users/route.ts:68>) i definicja SQL `create_app_user`.

Samodzielna zmiana hasla ma walidator, lecz tworzenie konta wymaga jedynie niepustego hasla. Izolowany test rzeczywistej trasy z atrapa HEAD_ADMIN przekazal do RPC jednoznakowe haslo i otrzymal 200, bez wymuszenia zmiany. Atrapa potwierdza zachowanie API, nie zapis w aktualnej produkcyjnej funkcji.

Wymagany jest HEAD_ADMIN; nie jest to publiczna rejestracja. Ryzykiem jest zalozenie trwalego slabego konta przez panel/API.

Naprawa: ta sama serwerowa polityka przy tworzeniu i zmianie hasla oraz bezpieczna aktywacja kont z haslem tymczasowym.

### A07 P2 Zmiana hasla nie limituje sprawdzania obecnego hasla

Dowod: [POST auth/password](<C:/APKA DLA KAMILA/src/app/api/auth/password/route.ts:16>) i [limiter logowania](<C:/APKA DLA KAMILA/src/lib/auth/shared-rate-limit.ts>).

Trasa bezposrednio wywoluje `authenticate_user`, bez limiterow formularza logowania. Izolowany test: 80 kolejnych blednych prob dotarlo do atrapy RPC, wszystkie zwrocily 400, zadna 429.

Potrzebna jest prawidlowa sesja tego konta, wiec nie jest to anonimowe zgadywanie dowolnych uzytkownikow. Osoba ze skradziona sesja moze jednak probowac poznac obecne haslo i utrwalic przejecie. Zewnetrznego WAF nie zweryfikowano.

Naprawa: wspolny limiter weryfikacji hasel i limiter konto/sesja, z ponowna weryfikacja po progu. Unikac zablokowania calej firmy zbyt niskim wspolnym limitem IP.

### A08 P3 Wspolny klucz sesji i bazy

Dowod: [getSecret](<C:/APKA DLA KAMILA/src/lib/auth/session.ts:17>).

Bez `APP_SESSION_SECRET` podpis sesji korzysta z `SUPABASE_SERVICE_ROLE_KEY`. Lokalna konfiguracja nie zawiera osobnego sekretu sesji. Nie ustalono ustawien produkcyjnego Vercel. Nie znaleziono wycieku tej wartosci w skanowanych plikach.

To brak rozdzielenia kluczy, nie dowod slabego HMAC-SHA256. Rotacja laczy jednak sesje z dostepem do bazy. Klucz service role ma znacznie szersze skutki kompromitacji.

Naprawa: osobny losowy sekret sesji, wymagany w produkcji; zaplanowana rotacja moze wylogowac uzytkownikow. Docelowo ograniczac tez konto backendu w bazie. `server-only` w module administracyjnym moze dodatkowo zapobiec przypadkowemu importowi do klienta.

### A09 P3 CSP nie ogranicza skryptow

Dowod: [securityHeaders](<C:/APKA DLA KAMILA/next.config.ts:4>) i lokalny naglowek HTTP.

Naglowek blokuje obiekty, ramki i obce formularze, ale nie ma `script-src` ani `default-src`. Nie ogranicza skryptow po ewentualnym wstrzyknieciu HTML. Nie znaleziono potwierdzonego XSS w sprawdzonych miejscach: skrypt motywu jest staly, a dane w przejrzanych wydrukach escapowane.

Naprawa: CSP z nonce/hashami zgodna z Next, najpierw Report-Only, potem wymuszanie po testach ekranow, wydrukow i zasobow. Podstawa: [OWASP CSP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html).

### A10 P3 Podatnosc narzedzi deweloperskich

Dowod: [pakiety](<C:/APKA DLA KAMILA/package.json>) i `package-lock.json`.

`npm audit --omit=dev --json`: zero zgloszonych znanych podatnosci produkcyjnych. Pelne `npm audit --json`: 8 pozycji moderate, wynikajacych z jednego advisora minimatch i propagacji w lancuchu ESLint/TypeScript. Podatna kopia: `@typescript-eslint/typescript-estree/node_modules/minimatch` 10.2.6.

Autor opisuje nadmierne zuzycie CPU/pamieci przy kontrolowanym wzorcu glob i odpowiedniej optymalizacji. Nie znaleziono przeplywu publicznych danych aplikacji do tej deweloperskiej kopii; nie jest to potwierdzone zdalne przejecie aplikacji. Zrodlo: [komunikat autora GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249).

Naprawa: zgodna aktualizacja narzedzi lub sprawdzony override po testach. npm sugerowal tez zmiane glownej wersji konfiguracji Next; nie wykonywano `audit fix --force` ani aktualizacji. Zero wynikow npm nie dowodzi braku wszystkich podatnosci, zwlaszcza pakietow spoza standardowego rejestru.

## Kontrole zakonczone poprawnie

| Kontrola | Wynik i ograniczenie |
| --- | --- |
| Testy | 984/984 poprawne, zero pominietych. Nie pokrywaja wszystkich kombinacji uprawnien. |
| Anonimowe HTTP lokalnie | 31 chronionych kombinacji trasy/metody: 401. Bez prob logowania/wylogowania kont. |
| Falszywe cookie | `/api/users`: 401. |
| Obcy Origin | Lokalny cross-site POST: 403. |
| Router centralny | 149 akcji ma odpowiednik w `ensureActionAccess`; brak obecnie nieoslonietej akcji. Domyslna odmowa bylaby lepsza dla przyszlych akcji. Nie jest to dowod izolacji kazdego rekordu. |
| Konta i grupy | Zarzadzanie wymaga HEAD_ADMIN na serwerze. |
| Sesje | HMAC, stale czasowo porownanie, HttpOnly, SameSite=Lax, Secure w produkcji; kontrola aktywnego konta i persisted session ID. Testy odwolania sesji i obowiazkowej zmiany hasla przeszly. |
| Odczyt bazy | HEAD dla 50 tabel jako anon i service role. 48 bylo niepustych dla service role; zadna nie ujawnila rekordow anon. Puste tabele nie dowodza same w sobie skutecznosci RLS. |
| RPC listy kont | Anonimowy HEAD `list_app_users`: 401. Bez testu mutujacych RPC. |
| Sekrety w repo | 1425 sledzonych plikow: bez skonfigurowanych prywatnych sekretow i trafien badanych wzorcow service role/PEM/GitHub/AWS. `.env` i `.runtime` nie sa sledzone. Nie skanowano historii Git. |
| Zasoby klienta | 148 lokalnych JS/JSON/map/HTML: bez wartosci skonfigurowanych prywatnych kluczy. Nie skanowano produkcyjnych zasobow. |
| Importy | Autoryzacja przed parsowaniem; limit pliku 20 MB; ochrona ZIP przed przekroczeniem rozpakowanych rozmiarow, liczby wpisow i czasu; limity arkuszy. Bez produkcyjnego testu obciazenia. |
| Push/SSRF | HTTPS i lista dostawcow, bez dowolnego hosta/portu/loginu; kontrola takze przed wysylka. Odbiorcy filtrowani wedlug aktywnych kont i uprawnien. |
| Polecenia systemowe | W przeszukanym runtime API/lib nie znaleziono `child_process`, `exec`, `spawn`, `eval` ani `new Function`. Nie analizowano kazdego pliku zaleznosci. |

## Granice audytu

- Nie potwierdzono wersji wdrozenia, sekretow Vercel, WAF, limitow ruchu i zaufania do naglowkow proxy.
- Nie odczytano pelnego katalogu polityk INSERT/UPDATE/DELETE ani praw EXECUTE wszystkich funkcji produkcji. Poprawny anonimowy odczyt nie dowodzi blokady zapisu. Zapisow nie probowano.
- Nie zweryfikowano osobno Supabase Auth `authenticated`, Storage i Realtime.
- Nie sprawdzono MFA i rol organizacyjnych kont GitHub/Vercel/Supabase/domeny/poczty ani calej historii Git.
- Nie wykonano testu odtworzenia kopii do osobnego projektu, nie potwierdzono niezaleznosci backupow i retencji.
- Nie badano sieci firmowej, stacji Windows, EDR, kont ERP i serwera integracji.
- Nie wykonywano DDoS, testow obciazeniowych ani destrukcyjnego pentestu.
- Nie oceniono organizacyjnego SZBI ani prawnej kwalifikacji firmy do KSC. Nie wykonywano pelnego lint/typecheck ani nowego buildu produkcyjnego.

Brak HSTS na lokalnym HTTP nie jest dowodem braku HSTS na produkcyjnym HTTPS.

## Ryzyko dla systemow firmy

W przejrzanym kodzie nie znaleziono funkcji pozwalajacej uzytkownikowi wykonywac dowolne polecenia lub przegladac dyski firmowych komputerow. Samo wejscie do aplikacji nie oznacza automatycznie dostepu do calej sieci firmy.

Przejecie backendu lub klucza service role grozi jednak danym projektu Supabase, poniewaz klucz omija RLS. Dalszy zasieg zalezy od rzeczywistych polaczen do ERP i innych sekretow. Ograniczone konta integracyjne, segmentacja i niezalezne kopie zmniejszaja skutki; nie zostaly tu zweryfikowane operacyjnie.

## Kolejnosc napraw

1. MFA administratorow i bezpieczna aktywacja po resecie. Swiadoma decyzja o utrzymaniu/wycofaniu wspolnego hasla tymczasowego.
2. Jednolita polityka hasel, mocniejsze haszowanie z migracja skrotow bez zmiany znanych hasel oraz limiter zmiany hasla.
3. Trwaly dziennik bezpieczenstwa i alarmy; niezawodny audyt krytycznych zmian.
4. Osobne utwardzenie rzeczywistych ACL/RLS po inwentaryzacji, kopii i testach na kopii bazy. Nie podmieniac calej instalacji SQL w ciemno.
5. Rozdzielenie sekretow, dopracowanie sesji/CSP i zgodna aktualizacja narzedzi.
6. Weryfikacja kont dostawcow, WAF, sieci integracyjnej i odtworzenia backupu. Nastepnie zewnetrzny pentest i odpowiednia ocena organizacyjna KSC.

Naprawy wymagaja testow regresji. Raport nie autoryzuje automatycznej zmiany hasel, uruchomienia migracji ani czyszczenia danych.
