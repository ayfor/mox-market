# Mox Market

MTG card price monitoring dashboard. Track Magic: The Gathering card prices, build watchlists, and import decklists.

Built by **Twin Spruce Studio** (`@tss/mox-market`).

## Stack

- Next.js 16 + React 19 + TypeScript
- Tailwind CSS 4 + Compass template design system
- Headless UI + Zustand + Recharts
- Scryfall API (card data, images, pricing)
- Vercel (deployment)

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Features (MVP)

- **Card search** — fuzzy search via Scryfall API
- **Watchlist** — session-based card tracking (localStorage)
- **Price dashboard** — current prices, sparklines, aggregate stats
- **Decklist import** — paste MTGO/Arena/plain text formats
- **Multi-currency** — USD, CAD, EUR, TIX

## License

MIT
