# qr-restaurant-ordering

A contactless ordering demo: a customer scans a table's QR code, browses the menu, builds a cart, and checks out — all from their own phone, no app install. Built with Angular 20 and Angular Material against a generic ordering API.

## How it works

- **Scan** — `QrScannerComponent` uses `html5-qrcode` to read a table's QR code and extract a table ID, then navigates to `/menu/:tableId`.
- **Browse** — `MenuComponent` fetches categories and products from the API service and lets the customer add items to the cart.
- **Cart** — `CartComponent` (`/cart/:tableId`) shows selected items, quantities, and running total, backed by an in-memory/localStorage cart store.
- **Checkout** — `CheckoutComponent` (`/checkout/:tableId`) collects customer details and submits the order; `OrderCompleteComponent` shows the confirmation.
- **API layer** — `ApiService` handles authentication (token fetch/refresh against the staging backend), product/category retrieval, and order submission against the URL configured in `environment.ts`.

## Requirements

- Node.js and npm
- Angular CLI 20.x
- Access to a compatible staging ordering API (see Setup)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure the API. `src/environments/environment.ts` holds the API base URL and staging login credentials:
   ```ts
   export const environment = {
     apiBaseUrl: 'https://your-api.example.com',
     stagingUsername: '',
     stagingPassword: ''
   };
   ```
   Point `apiBaseUrl` at your ordering API instance and fill in real credentials locally (or inject them at build time) — never commit real values to this file.

## Usage

Start a local dev server:
```bash
npm start
```
Then open `http://localhost:4200/` and navigate to `/menu/<tableId>` (or scan a QR code pointing at that URL) to walk through the menu → cart → checkout flow.

Run unit tests:
```bash
npm test
```

Build for production:
```bash
npm run build
```

A `Dockerfile` and `compose.yaml` are included for building/serving the production bundle via Nginx (`docker compose up --build`).
