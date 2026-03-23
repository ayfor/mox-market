# Mox Market

**[Live Demo](https://mox-market.vercel.app)**

MTG card price monitoring dashboard. Track Magic: The Gathering card prices, build watchlists, and import decklists to see how your cards are performing.

Built by **Twin Spruce Studio** (`@tss/mox-market`).

> **Note:** This project was created as a personal tool and as an exploration of what modern AI tooling can achieve when given a structured local information system as context. The codebase was generated through collaborative AI-assisted development using Claude Code, guided by a knowledge base of project history, design decisions, and technical constraints.

## Features

- **Card Search** — Fuzzy search powered by Scryfall autocomplete. Find any card instantly.
- **Watchlist** — Session-based card tracking with localStorage persistence. No account required.
- **Price Dashboard** — Live prices with aggregate stats, sorting, and expandable price history charts.
- **Multi-Currency** — View prices in USD, CAD, EUR, or MTGO tickets.
- **Decklist Import** — Paste MTGO, Arena, or plain text formats. Batch resolve via Scryfall.
- **Price History Charts** — Expandable per-card area charts with trend indicators and percentage change badges.
- **Export / Import** — Save your watchlist as JSON. Share it or restore it later.
- **Server-Side Price History** — Daily cron job snapshots prices to Supabase Postgres for persistent history across sessions.

## Stack

- **Next.js 16** + React 19 + TypeScript
- **Tailwind CSS 4** with custom Mox jewel color palette
- **Headless UI** for accessible component primitives
- **Zustand** for state management with localStorage persistence
- **Recharts** for sparklines and price history charts
- **Prisma** + Supabase Postgres for server-side price history
- **Scryfall API** for card data, images, and pricing
- **Vercel** for deployment with daily cron job

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Database Setup (Optional)

Server-side price history requires a Postgres database. The app works fully without it using client-side snapshots.

```bash
# Set POSTGRES_PRISMA_URL and POSTGRES_URL_NON_POOLING in .env
npx prisma db push
```

## License

MIT
