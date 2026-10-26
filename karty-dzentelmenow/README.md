# Karty Dżentelmenów 18+

Webowa gra imprezowa w stylu „Cards Against Humanity". 3–6 graczy, pokoje z 4-literowym kodem, 50 czarnych i 250 białych kart po polsku.

## Uruchomienie lokalnie

```
npm install
npm start
```

Otwórz http://localhost:3000.

## Wystawienie w internecie (Render, za darmo)

1. Wrzuć repozytorium na GitHuba.
2. Wejdź na https://render.com i zaloguj się kontem GitHub.
3. New → Web Service → wybierz to repozytorium. Render sam odczyta `render.yaml`
   (Build: `npm install`, Start: `npm start`, plan Free).
4. Po kilku minutach dostaniesz adres typu `https://karty-dzentelmenow.onrender.com`.
   Wyślij go znajomym — działa z dowolnej sieci, także z telefonu.

Uwagi do darmowego planu Render:
- Po ok. 15 minutach bez ruchu serwer zasypia, a pierwsze wejście trwa wtedy ~30–60 s.
  Wejdź na stronę chwilę przed grą.
- Stan gry jest w pamięci, więc restart/uśpienie serwera kończy trwające partie.
- WebSockety działają bez dodatkowej konfiguracji (strona przez https używa `wss://`).

Alternatywy: Railway, Fly.io, własny VPS (`npm start` + reverse proxy z obsługą WebSocketów).

## Zasady

1. Każdy po kolei jest sędzią i losuje czarną kartę z luką.
2. Pozostali wybierają z ręki (5 kart) jedną białą, która najlepiej pasuje.
3. Sędzia widzi karty w losowej kolejności i wybiera najśmieszniejszą.
4. Autor zwycięskiej karty dostaje punkt. Gra trwa do 5, 7 lub 10 punktów (wybiera host).

## Własne karty

Edytuj `cards.js`. Luka w czarnej karcie to `___`. Białe karty pisz w mianowniku, a lukę w czarnych stawiaj na końcu zdania lub po dwukropku, wtedy wszystko pasuje gramatycznie.
