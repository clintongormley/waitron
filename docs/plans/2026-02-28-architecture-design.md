# Waitron — Architecture Design

Restaurant management platform supporting table bookings, online ordering, QR code table ordering, kitchen management, and payment processing.

## Deployment Modes

- **Self-hosted**: Single Docker Compose command spins up the full stack. Single tenant auto-created on first boot.
- **SaaS**: Same codebase, multiple tenants. Platform admin dashboard for cross-tenant management.
- Controlled via `PLATFORM_MODE=self-hosted | saas` environment variable. Self-hosted mode hides platform admin routes and multi-tenant onboarding.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript (full-stack) |
| Frontend | Next.js (React) |
| Backend | NestJS |
| Database | PostgreSQL |
| ORM | Drizzle |
| Real-time | Socket.IO |
| Auth | Passport.js (JWT) |
| Payments | Stripe + Square (behind abstract interface) |
| Search | Pluggable — Postgres full-text search initially, Elasticsearch later |
| i18n | next-intl (frontend) + nestjs-i18n (backend) |
| Containerization | Docker Compose (Kubernetes later) |
| Cache/Queues | Redis (Socket.IO adapter, BullMQ job queues, caching) |

## Project Structure

Monorepo using pnpm workspaces:

```
waitron/
├── apps/
│   ├── web/                  # Next.js frontend
│   └── api/                  # NestJS backend
├── packages/
│   ├── shared/               # Shared types, constants, validation schemas
│   └── db/                   # Drizzle schema, migrations, seed data
├── docker-compose.yml        # Postgres + Redis + app services
├── Dockerfile                # Multi-stage build
├── turbo.json                # Turborepo config
└── package.json
```

Shared TypeScript types between frontend and backend eliminate type drift. One repo to clone, one `docker compose up` for self-hosted users.

## Multi-Tenancy

- Row-level isolation: every table includes a `tenant_id` column.
- NestJS middleware extracts tenant context from JWT on every request.
- Drizzle queries wrapped in a tenant-scoped helper that injects `WHERE tenant_id = ?`.
- PostgreSQL Row-Level Security (RLS) policies as a safety net — even if the app layer has a bug, the DB won't leak data.
- Self-hosted mode: single tenant auto-created, same code path.

### User Roles

Two tiers of roles:

- **Platform roles**: `super_admin` (more can be added later) — `tenant_id = null`, bypass tenant scoping.
- **Tenant roles**: `owner | manager | staff | kitchen | customer` — `tenant_id` required.

Guard logic checks platform vs tenant based on whether `tenant_id` is null.

## Data Model

### Core Entities

```
Tenant          → restaurant account (name, settings, subscription tier)
User            → belongs to tenant (nullable for platform roles), has role
Location        → physical restaurant (a tenant can have multiple locations)
Table           → belongs to location (number, capacity, QR code identifier)
Menu            → belongs to location (categories, items, modifiers, prices)
Order           → belongs to location + optional table (status, type: dine-in/takeaway)
OrderItem       → belongs to order (menu item, modifiers, quantity, notes)
Booking         → belongs to location (datetime, party size, customer, status)
BookingTable    → join table (booking_id, table_id) — bookings can span multiple tables
Payment         → belongs to order (amount, gateway, status, reference)
KitchenTicket   → belongs to order (station routing, priority, timestamps)
```

### Key Relationships

- An order can be dine-in (linked to a table) or takeaway (no table).
- A booking may or may not convert to an order when the party arrives.
- A booking can span multiple tables (many-to-many via BookingTable).
- Kitchen tickets are derived from order items, grouped by kitchen station (grill, cold, drinks, etc.).

## Backend Modules

| Module | Responsibility |
|--------|---------------|
| Auth | Passport.js, JWT, login/register, role guards, tenant resolution |
| Tenants | Tenant CRUD, settings, onboarding |
| Users | User management, role assignment, invitations |
| Locations | Restaurant locations, floor plans, table management |
| Menus | Menu categories, items, modifiers, pricing, availability |
| Bookings | Table reservations, availability checks, multi-table support |
| Orders | Order creation (dine-in, takeaway, QR), status lifecycle |
| Kitchen | Ticket routing by station, priority, status updates, display feed |
| Payments | Payment interface, Stripe adapter, Square adapter, refunds |
| Notifications | Real-time events via Socket.IO |
| Search | Pluggable search interface (Postgres initially, Elasticsearch later) |
| Platform | Super admin dashboard, cross-tenant queries, billing |

## Frontend Routes

```
apps/web/
├── app/
│   ├── (platform)/          # Super admin dashboard
│   ├── (dashboard)/         # Restaurant owner/manager UI
│   │   ├── bookings/
│   │   ├── orders/
│   │   ├── menu/
│   │   ├── kitchen/
│   │   ├── tables/
│   │   └── settings/
│   ├── (customer)/          # Public-facing ordering
│   │   ├── [location]/      # Takeaway ordering page
│   │   └── table/[qr-id]/  # QR code → table ordering
│   └── (auth)/              # Login, register
```

### QR Code Flow

Each table has a unique QR code encoding a URL like `/table/abc123`. Customer scans, sees the menu, orders, and pays — no app download. The order is linked to that table automatically.

## Real-Time Architecture

### Socket.IO Rooms

```
tenant:{id}                      # All events for a restaurant
location:{id}:kitchen            # Kitchen display for a location
location:{id}:kitchen:{station}  # Per-station (grill, cold, bar)
location:{id}:floor              # Floor plan / table status
order:{id}                       # Order status (customer tracks their order)
table:{id}                       # Active table session (waiter + customer)
```

### Key Event Flows

1. **Customer places order (QR)** → `order.created` emits to kitchen room → kitchen display shows new ticket → kitchen marks item ready → `order.updated` emits to table and order rooms → customer sees status change.
2. **Booking arrives** → staff marks booking as seated → `table.occupied` emits to floor room → floor plan updates in real-time.
3. **Kitchen completes ticket** → `ticket.ready` emits to floor room → waiter sees notification to deliver food.

### Socket Authentication

Socket.IO connection sends JWT in handshake. Server validates and joins the socket to appropriate rooms based on user role and tenant.

Redis adapter enables horizontal scaling across multiple API instances.

## Payment Interface

```typescript
interface PaymentProvider {
  createPayment(amount, currency, metadata): Promise<PaymentIntent>
  confirmPayment(intentId): Promise<PaymentResult>
  refund(paymentId, amount?): Promise<RefundResult>
  createWebhookHandler(): WebhookHandler
}
```

Implementations: `StripeProvider`, `SquareProvider`. Each tenant configures which provider they use (and their API keys) in settings. The Payments module resolves the correct adapter at runtime. More providers can be added by implementing the interface.

## Search Interface

```typescript
interface SearchProvider {
  indexDocument(index, id, doc): Promise<void>
  search(index, query, filters, pagination): Promise<SearchResult>
  deleteDocument(index, id): Promise<void>
}
```

Implementations: `PostgresSearchProvider` (tsvector, GIN indexes) initially. `ElasticsearchProvider` added later. Configured per deployment via environment variable. Self-hosted users get Postgres search by default.

## Internationalization

| Layer | Approach |
|-------|----------|
| Frontend UI | `next-intl` — translated strings, locale detection, date/number formatting |
| Backend messages | `nestjs-i18n` — API error messages, email templates, notifications |
| Menu content | JSONB per locale: `{ "en": "Caesar Salad", "es": "Ensalada César" }` |
| Currency | Per-location setting. Prices stored as integers in smallest unit (cents/pence). Formatted with `Intl.NumberFormat` |
| Date/time | Per-location timezone. Stored as UTC, displayed in local timezone |
| Locale detection | Customer-facing pages detect browser locale. Dashboard uses user preference |

Restaurant owners manage translations for menu items in the dashboard. System enums (order status, booking status) are translated in the frontend, not the database.

## Deployment

### Docker Compose (default)

```yaml
services:
  api:          # NestJS backend
  web:          # Next.js frontend
  postgres:     # PostgreSQL 16
  redis:        # Socket.IO adapter, BullMQ queues, caching
```

### Hosted Services

The app connects via standard connection strings. To use hosted Postgres/Redis (RDS, Supabase, Upstash, etc.), set `DATABASE_URL` and `REDIS_URL` in `.env` and remove local containers. No code changes needed.

### Self-Hosted Setup

Clone repo → copy `.env.example` to `.env` → fill in payment keys → `docker compose up`. Single tenant auto-created on first boot.

### SaaS

Same containers deployed to cloud (AWS ECS, Fly.io, Railway, etc.). Tenant created via onboarding flow. Kubernetes manifests added when scaling demands it.

## Deferred

- Elasticsearch (use Postgres full-text search initially)
- Kubernetes (Docker Compose first)
- Mobile apps (web-first, React Native possible later)
- Additional platform roles (super_admin only initially)
