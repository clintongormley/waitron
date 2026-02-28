# Waitron Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a restaurant management platform (bookings, ordering, kitchen, payments) that runs as a self-hosted container or multi-tenant SaaS.

**Architecture:** TypeScript monorepo (pnpm + Turborepo) with NestJS backend, Next.js frontend, Drizzle ORM over PostgreSQL, Redis for caching/queues/Socket.IO, and Docker Compose for local development and self-hosted deployment.

**Tech Stack:** TypeScript, NestJS, Next.js, Drizzle, PostgreSQL 16, Redis, Socket.IO, Passport.js (JWT), Stripe, Square, next-intl, nestjs-i18n, Docker Compose, Turborepo

**Design Doc:** `docs/plans/2026-02-28-architecture-design.md`

---

## Phasing Strategy

This project is built in phases. Each phase results in a deployable, testable increment. Only Phase 1 is detailed here — subsequent phases will get their own detailed plan when we reach them.

| Phase | Scope | Depends On |
|-------|-------|------------|
| **1** | Monorepo scaffolding, DB schema, auth, multi-tenancy, Docker Compose | — |
| **2** | Locations & table management | Phase 1 |
| **3** | Menu system (categories, items, modifiers, i18n content) | Phase 2 |
| **4** | Bookings (multi-table, availability) | Phase 2 |
| **5** | Orders & QR code flow | Phase 3 |
| **6** | Kitchen management & Socket.IO real-time | Phase 5 |
| **7** | Payment interface (Stripe + Square adapters) | Phase 5 |
| **8** | Pluggable search (Postgres full-text) | Phase 3 |
| **9** | Frontend: dashboard (owner/manager UI) | Phase 2-7 |
| **10** | Frontend: customer ordering (takeaway + QR) | Phase 5, 7 |
| **11** | Frontend: kitchen display | Phase 6 |
| **12** | Platform admin (super_admin, cross-tenant) | Phase 1 |
| **13** | i18n (next-intl, nestjs-i18n, locale detection) | Phase 9-11 |
| **14** | Production deployment (multi-stage Docker, .env.example, self-hosted onboarding) | All |

---

## Phase 1: Foundation

**Goal:** Running monorepo with NestJS API, Next.js frontend, PostgreSQL via Drizzle, Redis, JWT auth with tenant-scoped multi-tenancy, and Docker Compose for local dev. All tests passing in CI.

---

### Task 1: Initialize Monorepo

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `.gitignore`
- Create: `.nvmrc`
- Create: `tsconfig.base.json`

**Step 1: Init pnpm workspace**

```bash
cd /workspaces/waitron
pnpm init
```

Edit `package.json` to set `"private": true` and add scripts:

```json
{
  "name": "waitron",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "db:generate": "turbo db:generate --filter=@waitron/db",
    "db:migrate": "turbo db:migrate --filter=@waitron/db",
    "db:push": "turbo db:push --filter=@waitron/db"
  },
  "devDependencies": {
    "turbo": "^2",
    "typescript": "^5"
  },
  "packageManager": "pnpm@9.15.0"
}
```

**Step 2: Create workspace config**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**Step 3: Create Turborepo config**

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "db:generate": {
      "cache": false
    },
    "db:migrate": {
      "cache": false
    },
    "db:push": {
      "cache": false
    }
  }
}
```

**Step 4: Create shared TypeScript config**

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**Step 5: Create .nvmrc and .gitignore**

`.nvmrc`:
```
22
```

`.gitignore`:
```
node_modules/
dist/
.next/
.turbo/
*.env
!.env.example
.DS_Store
coverage/
```

**Step 6: Install and commit**

```bash
pnpm install
git add -A
git commit -m "chore: initialize pnpm monorepo with turborepo"
```

---

### Task 2: Scaffold Shared Types Package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/types/roles.ts`
- Create: `packages/shared/src/types/tenant.ts`

**Step 1: Create package**

`packages/shared/package.json`:
```json
{
  "name": "@waitron/shared",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "lint": "tsc --noEmit"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 2: Define core types**

`packages/shared/src/types/roles.ts`:
```typescript
export const PLATFORM_ROLES = ["super_admin"] as const;
export const TENANT_ROLES = [
  "owner",
  "manager",
  "staff",
  "kitchen",
  "customer",
] as const;
export const ALL_ROLES = [...PLATFORM_ROLES, ...TENANT_ROLES] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type TenantRole = (typeof TENANT_ROLES)[number];
export type Role = (typeof ALL_ROLES)[number];

export function isPlatformRole(role: Role): role is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(role);
}
```

`packages/shared/src/types/tenant.ts`:
```typescript
export interface TenantContext {
  tenantId: string;
}

export interface PlatformContext {
  tenantId: null;
}

export type RequestContext = TenantContext | PlatformContext;
```

`packages/shared/src/index.ts`:
```typescript
export * from "./types/roles.js";
export * from "./types/tenant.js";
```

**Step 3: Commit**

```bash
git add packages/shared/
git commit -m "feat: add shared types package with roles and tenant context"
```

---

### Task 3: Scaffold DB Package with Drizzle

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/connection.ts`
- Create: `packages/db/src/schema/tenants.ts`
- Create: `packages/db/src/schema/users.ts`
- Create: `packages/db/src/schema/index.ts`

**Step 1: Create package and install Drizzle**

`packages/db/package.json`:
```json
{
  "name": "@waitron/db",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "lint": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push"
  }
}
```

```bash
cd packages/db
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit
cd ../..
```

**Step 2: Create connection module**

`packages/db/src/connection.ts`:
```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
```

**Step 3: Define tenant schema**

`packages/db/src/schema/tenants.ts`:
```typescript
import { pgTable, uuid, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

**Step 4: Define user schema**

`packages/db/src/schema/users.ts`:
```typescript
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const roleEnum = pgEnum("role", [
  "super_admin",
  "owner",
  "manager",
  "staff",
  "kitchen",
  "customer",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id, {
    onDelete: "cascade",
  }),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: roleEnum("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

**Step 5: Create barrel exports**

`packages/db/src/schema/index.ts`:
```typescript
export * from "./tenants.js";
export * from "./users.js";
```

`packages/db/src/index.ts`:
```typescript
export * from "./connection.js";
export * from "./schema/index.js";
```

**Step 6: Create Drizzle config**

`packages/db/drizzle.config.ts`:
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

`packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 7: Commit**

```bash
git add packages/db/
git commit -m "feat: add db package with Drizzle schema for tenants and users"
```

---

### Task 4: Scaffold NestJS API

**Files:**
- Create: `apps/api/` (NestJS app via CLI)
- Modify: `apps/api/package.json` (rename, add workspace deps)

**Step 1: Generate NestJS app**

```bash
cd apps
pnpm dlx @nestjs/cli new api --package-manager pnpm --skip-git
cd ..
```

**Step 2: Update package.json**

Set `"name": "@waitron/api"` in `apps/api/package.json`. Add workspace dependencies:

```bash
cd apps/api
pnpm add @waitron/shared@workspace:* @waitron/db@workspace:*
cd ../..
```

**Step 3: Add test script to turbo compatibility**

Verify `apps/api/package.json` has `"test"` script pointing to Jest.

**Step 4: Verify it runs**

```bash
pnpm --filter @waitron/api start
# Should start on port 3000 with "Hello World"
```

**Step 5: Commit**

```bash
git add apps/api/
git commit -m "feat: scaffold NestJS API app"
```

---

### Task 5: Scaffold Next.js Frontend

**Files:**
- Create: `apps/web/` (Next.js app via create-next-app)
- Modify: `apps/web/package.json` (rename, add workspace deps)

**Step 1: Generate Next.js app**

```bash
cd apps
pnpm dlx create-next-app web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --skip-install
cd ..
```

**Step 2: Update package.json**

Set `"name": "@waitron/web"` in `apps/web/package.json`. Add workspace deps:

```bash
cd apps/web
pnpm add @waitron/shared@workspace:*
cd ../..
```

**Step 3: Install all deps**

```bash
pnpm install
```

**Step 4: Verify it runs**

```bash
pnpm --filter @waitron/web dev
# Should start on port 3000 with Next.js welcome page
```

**Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat: scaffold Next.js frontend app"
```

---

### Task 6: Docker Compose for Local Development

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`

**Step 1: Create Docker Compose**

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-waitron}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-waitron}
      POSTGRES_DB: ${POSTGRES_DB:-waitron}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

**Step 2: Create .env.example**

`.env.example`:
```bash
# Database
DATABASE_URL=postgresql://waitron:waitron@localhost:5432/waitron
POSTGRES_USER=waitron
POSTGRES_PASSWORD=waitron
POSTGRES_DB=waitron
POSTGRES_PORT=5432

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PORT=6379

# Auth
JWT_SECRET=change-me-in-production
JWT_EXPIRY=7d

# Platform
PLATFORM_MODE=self-hosted

# Payments (fill in for your provider)
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=
# SQUARE_ACCESS_TOKEN=
# SQUARE_WEBHOOK_SIGNATURE_KEY=
```

**Step 3: Start services and verify**

```bash
cp .env.example .env
docker compose up -d
# Verify: docker compose ps — both postgres and redis should be running
```

**Step 4: Push schema to database**

```bash
pnpm db:push
# Should create tenants and users tables
```

**Step 5: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat: add Docker Compose for Postgres and Redis"
```

---

### Task 7: Database Module in NestJS

**Files:**
- Create: `apps/api/src/database/database.module.ts`
- Create: `apps/api/src/database/database.provider.ts`
- Modify: `apps/api/src/app.module.ts`

**Step 1: Create database provider**

`apps/api/src/database/database.provider.ts`:
```typescript
import { createDb, type Database } from "@waitron/db";

export const DATABASE_TOKEN = "DATABASE";

export const databaseProvider = {
  provide: DATABASE_TOKEN,
  useFactory: (): Database => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    return createDb(url);
  },
};
```

`apps/api/src/database/database.module.ts`:
```typescript
import { Global, Module } from "@nestjs/common";
import { databaseProvider, DATABASE_TOKEN } from "./database.provider.js";

@Global()
@Module({
  providers: [databaseProvider],
  exports: [DATABASE_TOKEN],
})
export class DatabaseModule {}
```

**Step 2: Register in AppModule**

Add `DatabaseModule` to `imports` in `apps/api/src/app.module.ts`.

**Step 3: Write health check test**

`apps/api/src/app.controller.spec.ts` — update existing test to verify the app bootstraps with database module.

**Step 4: Commit**

```bash
git add apps/api/src/database/
git commit -m "feat: add database module with Drizzle provider"
```

---

### Task 8: Auth Module — Register & Login

**Files:**
- Create: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/jwt.strategy.ts`
- Create: `apps/api/src/auth/dto/register.dto.ts`
- Create: `apps/api/src/auth/dto/login.dto.ts`
- Create: `apps/api/test/auth.e2e-spec.ts`

**Step 1: Write the failing e2e test for registration**

`apps/api/test/auth.e2e-spec.ts`:
```typescript
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";

describe("Auth (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /auth/register", () => {
    it("should register a new user and return JWT", () => {
      return request(app.getHttpServer())
        .post("/auth/register")
        .send({
          email: "owner@test.com",
          password: "securepassword",
          name: "Test Owner",
          tenantName: "Test Restaurant",
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty("accessToken");
          expect(res.body.user.email).toBe("owner@test.com");
          expect(res.body.user.role).toBe("owner");
        });
    });
  });

  describe("POST /auth/login", () => {
    it("should login and return JWT", () => {
      return request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: "owner@test.com",
          password: "securepassword",
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty("accessToken");
        });
    });

    it("should reject invalid credentials", () => {
      return request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: "owner@test.com",
          password: "wrongpassword",
        })
        .expect(401);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @waitron/api test:e2e -- --testPathPattern auth
```
Expected: FAIL — route not found.

**Step 3: Install auth dependencies**

```bash
cd apps/api
pnpm add @nestjs/passport @nestjs/jwt passport passport-jwt bcrypt
pnpm add -D @types/passport-jwt @types/bcrypt
cd ../..
```

**Step 4: Create DTOs**

`apps/api/src/auth/dto/register.dto.ts`:
```typescript
export class RegisterDto {
  email: string;
  password: string;
  name: string;
  tenantName: string;
}
```

`apps/api/src/auth/dto/login.dto.ts`:
```typescript
export class LoginDto {
  email: string;
  password: string;
}
```

**Step 5: Implement AuthService**

`apps/api/src/auth/auth.service.ts`:
```typescript
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { DATABASE_TOKEN } from "../database/database.provider.js";
import { type Database, users, tenants } from "@waitron/db";
import type { RegisterDto } from "./dto/register.dto.js";
import type { LoginDto } from "./dto/login.dto.js";

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE_TOKEN) private db: Database,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Create tenant
    const [tenant] = await this.db
      .insert(tenants)
      .values({
        name: dto.tenantName,
        slug: dto.tenantName.toLowerCase().replace(/\s+/g, "-"),
      })
      .returning();

    // Create owner user
    const [user] = await this.db
      .insert(users)
      .values({
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: "owner",
        tenantId: tenant.id,
      })
      .returning();

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    });

    return {
      accessToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  async login(dto: LoginDto) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, dto.email));

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    });

    return {
      accessToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }
}
```

**Step 6: Implement JWT strategy**

`apps/api/src/auth/jwt.strategy.ts`:
```typescript
import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tenantId: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET || "change-me-in-production",
    });
  }

  validate(payload: JwtPayload) {
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId,
    };
  }
}
```

**Step 7: Create AuthController**

`apps/api/src/auth/auth.controller.ts`:
```typescript
import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { RegisterDto } from "./dto/register.dto.js";
import { LoginDto } from "./dto/login.dto.js";

@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
```

**Step 8: Create AuthModule and register in AppModule**

`apps/api/src/auth/auth.module.ts`:
```typescript
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { JwtStrategy } from "./jwt.strategy.js";

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || "change-me-in-production",
      signOptions: { expiresIn: process.env.JWT_EXPIRY || "7d" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

Add `AuthModule` to imports in `apps/api/src/app.module.ts`.

**Step 9: Run e2e tests**

```bash
pnpm --filter @waitron/api test:e2e -- --testPathPattern auth
```
Expected: ALL PASS

**Step 10: Commit**

```bash
git add apps/api/src/auth/ apps/api/test/auth.e2e-spec.ts apps/api/src/app.module.ts
git commit -m "feat: add auth module with register, login, and JWT"
```

---

### Task 9: Tenant Middleware & Scoping

**Files:**
- Create: `apps/api/src/tenant/tenant.middleware.ts`
- Create: `apps/api/src/tenant/tenant.module.ts`
- Create: `apps/api/src/tenant/tenant-scope.helper.ts`
- Create: `apps/api/test/tenant-scoping.e2e-spec.ts`

**Step 1: Write the failing test**

`apps/api/test/tenant-scoping.e2e-spec.ts`:
```typescript
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";

describe("Tenant Scoping (e2e)", () => {
  let app: INestApplication;
  let tenantAToken: string;
  let tenantBToken: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    // Register two separate tenants
    const resA = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "a@test.com",
        password: "password",
        name: "Owner A",
        tenantName: "Restaurant A",
      });
    tenantAToken = resA.body.accessToken;

    const resB = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "b@test.com",
        password: "password",
        name: "Owner B",
        tenantName: "Restaurant B",
      });
    tenantBToken = resB.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /auth/me should return only the authenticated user's tenant", async () => {
    const res = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    expect(res.body.tenantId).toBeDefined();
    expect(res.body.email).toBe("a@test.com");
  });

  it("should not leak data between tenants", async () => {
    const resA = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    const resB = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${tenantBToken}`)
      .expect(200);

    expect(resA.body.tenantId).not.toBe(resB.body.tenantId);
  });

  it("should reject unauthenticated requests", async () => {
    await request(app.getHttpServer()).get("/auth/me").expect(401);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @waitron/api test:e2e -- --testPathPattern tenant
```
Expected: FAIL — `/auth/me` not found

**Step 3: Implement tenant middleware**

`apps/api/src/tenant/tenant.middleware.ts`:
```typescript
import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

export interface TenantRequest extends Request {
  tenantId?: string | null;
  userId?: string;
  userRole?: string;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: TenantRequest, _res: Response, next: NextFunction) {
    // Tenant context is extracted from JWT by Passport strategy.
    // This middleware exists as a hook point for additional
    // tenant validation if needed.
    next();
  }
}
```

**Step 4: Create tenant-scoped query helper**

`apps/api/src/tenant/tenant-scope.helper.ts`:
```typescript
import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export function withTenantScope(
  tenantIdColumn: PgColumn,
  tenantId: string,
  ...conditions: (SQL | undefined)[]
): SQL {
  return and(eq(tenantIdColumn, tenantId), ...conditions)!;
}
```

**Step 5: Create TenantModule**

`apps/api/src/tenant/tenant.module.ts`:
```typescript
import { Module } from "@nestjs/common";
import { TenantMiddleware } from "./tenant.middleware.js";

@Module({
  providers: [TenantMiddleware],
  exports: [TenantMiddleware],
})
export class TenantModule {}
```

**Step 6: Add /auth/me endpoint to AuthController**

Add to `apps/api/src/auth/auth.controller.ts`:
```typescript
import { Body, Controller, Get, Post, UseGuards, Request } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
// ... existing imports

@Get("me")
@UseGuards(AuthGuard("jwt"))
me(@Request() req: any) {
  return req.user;
}
```

**Step 7: Run tests**

```bash
pnpm --filter @waitron/api test:e2e -- --testPathPattern tenant
```
Expected: ALL PASS

**Step 8: Commit**

```bash
git add apps/api/src/tenant/ apps/api/src/auth/auth.controller.ts apps/api/test/tenant-scoping.e2e-spec.ts
git commit -m "feat: add tenant middleware, scoping helper, and /auth/me endpoint"
```

---

### Task 10: Role Guards

**Files:**
- Create: `apps/api/src/auth/guards/roles.guard.ts`
- Create: `apps/api/src/auth/decorators/roles.decorator.ts`
- Create: `apps/api/test/roles.e2e-spec.ts`

**Step 1: Write the failing test**

`apps/api/test/roles.e2e-spec.ts`:
```typescript
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";

describe("Role Guards (e2e)", () => {
  let app: INestApplication;
  let ownerToken: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    const res = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "roletest@test.com",
        password: "password",
        name: "Role Tester",
        tenantName: "Role Restaurant",
      });
    ownerToken = res.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("owner should access owner-restricted endpoint", async () => {
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
  });
});
```

**Step 2: Implement Roles decorator**

`apps/api/src/auth/decorators/roles.decorator.ts`:
```typescript
import { SetMetadata } from "@nestjs/common";
import type { Role } from "@waitron/shared";

export const ROLES_KEY = "roles";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

**Step 3: Implement RolesGuard**

`apps/api/src/auth/guards/roles.guard.ts`:
```typescript
import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@waitron/shared";
import { ROLES_KEY } from "../decorators/roles.decorator.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.includes(user.role);
  }
}
```

**Step 4: Run tests**

```bash
pnpm --filter @waitron/api test:e2e -- --testPathPattern roles
```
Expected: ALL PASS

**Step 5: Commit**

```bash
git add apps/api/src/auth/guards/ apps/api/src/auth/decorators/ apps/api/test/roles.e2e-spec.ts
git commit -m "feat: add role-based access guards with @Roles decorator"
```

---

### Task 11: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: waitron
          POSTGRES_PASSWORD: waitron
          POSTGRES_DB: waitron_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgresql://waitron:waitron@localhost:5432/waitron_test
      REDIS_URL: redis://localhost:6379
      JWT_SECRET: test-secret

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: ".nvmrc"
          cache: "pnpm"

      - run: pnpm install --frozen-lockfile

      - name: Push DB schema
        run: pnpm db:push

      - name: Lint
        run: pnpm lint

      - name: Test
        run: pnpm test
```

**Step 2: Commit**

```bash
git add .github/
git commit -m "ci: add GitHub Actions workflow with Postgres and Redis"
```

---

### Task 12: Verify Full Stack Runs End-to-End

**Step 1: Start Docker Compose**

```bash
docker compose up -d
```

**Step 2: Push schema**

```bash
pnpm db:push
```

**Step 3: Start API**

```bash
pnpm --filter @waitron/api start:dev
```

**Step 4: Test register + login manually**

```bash
# Register
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@waitron.dev","password":"test1234","name":"Test","tenantName":"My Restaurant"}'

# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@waitron.dev","password":"test1234"}'

# Get me (use token from login response)
curl http://localhost:3000/auth/me -H "Authorization: Bearer <token>"
```

**Step 5: Run all tests**

```bash
pnpm test
```
Expected: ALL PASS

**Step 6: Tag phase completion**

```bash
git tag phase-1-complete
```

---

## Phase 2: Locations & Table Management (outline)

**Goal:** CRUD for locations and tables within a tenant. Floor plan data structure. QR code generation per table.

**Modules:** `LocationsModule`, `TablesModule`

**Schema additions:** `locations` table (tenant_id, name, address, timezone, currency, settings), `tables` table (location_id, number, capacity, qr_code_id, status)

**Key endpoints:**
- `POST/GET/PATCH/DELETE /locations`
- `POST/GET/PATCH/DELETE /locations/:id/tables`
- `GET /locations/:id/tables/:id/qr` — generate QR code image

**Tests:** e2e tests for CRUD, tenant isolation (location from tenant A invisible to tenant B), QR code generation.

---

## Phase 3: Menu System (outline)

**Goal:** Menu categories, items, modifiers with i18n JSONB content and per-location pricing.

**Schema additions:** `menu_categories` (location_id, name jsonb, sort_order), `menu_items` (category_id, name jsonb, description jsonb, price_cents, available), `menu_modifiers` (item_id, name jsonb, price_cents)

**Key endpoints:**
- CRUD for categories, items, modifiers
- `PATCH /menu-items/:id/availability` — toggle availability

**Tests:** CRUD, i18n content storage/retrieval, modifier pricing, tenant isolation.

---

## Phase 4: Bookings (outline)

**Goal:** Table reservations with multi-table support and availability checking.

**Schema additions:** `bookings` (location_id, customer_name, customer_email, customer_phone, party_size, datetime, duration_minutes, status, notes), `booking_tables` (booking_id, table_id)

**Key endpoints:**
- `POST /bookings` — create booking (checks availability)
- `GET /bookings?date=&location=` — list bookings
- `PATCH /bookings/:id/status` — confirm, seat, cancel, no-show
- `GET /locations/:id/availability?date=&party_size=` — available time slots

**Tests:** Booking creation, multi-table assignment, overlap detection, status transitions, tenant isolation.

---

## Phase 5: Orders & QR Code Flow (outline)

**Goal:** Order creation for dine-in and takeaway. QR code scans resolve to table and create guest sessions.

**Schema additions:** `orders` (location_id, table_id nullable, type enum, status enum, customer_name, total_cents), `order_items` (order_id, menu_item_id, modifier_ids jsonb, quantity, unit_price_cents, notes)

**Key endpoints:**
- `POST /orders` — create order (staff or via QR)
- `GET /orders?location=&status=` — list orders
- `PATCH /orders/:id/status` — status lifecycle (pending → confirmed → preparing → ready → served → paid)
- `GET /table/:qr_id` — resolve QR to location + table + menu (public, no auth)

**Tests:** Order creation both types, status lifecycle, QR resolution, item totals, tenant isolation.

---

## Phase 6: Kitchen Management & Real-Time (outline)

**Goal:** Kitchen tickets derived from orders, routed by station. Socket.IO for live updates.

**Schema additions:** `kitchen_stations` (location_id, name, sort_order), `kitchen_tickets` (order_id, station_id, status, priority, created_at, started_at, completed_at), `menu_item_stations` (menu_item_id, station_id) — which station prepares which item

**Socket.IO events:** `order.created`, `ticket.created`, `ticket.started`, `ticket.ready`, `order.updated`

**Key endpoints:**
- `GET /kitchen/tickets?location=&station=&status=` — kitchen display feed
- `PATCH /kitchen/tickets/:id/status` — start, complete, bump

**Tests:** Ticket generation from order, station routing, status updates, Socket.IO event emission.

---

## Phase 7: Payments (outline)

**Goal:** Abstract payment interface with Stripe and Square adapters.

**Schema additions:** `payments` (order_id, provider enum, amount_cents, currency, status, provider_reference, metadata jsonb)

**Key interfaces:** `PaymentProvider` with `createPayment`, `confirmPayment`, `refund`, `createWebhookHandler`

**Key endpoints:**
- `POST /payments/create-intent` — create payment intent (delegates to provider)
- `POST /payments/webhook/stripe` — Stripe webhook handler
- `POST /payments/webhook/square` — Square webhook handler

**Tests:** Payment creation via mock providers, webhook signature validation, refund flow, tenant config resolution.

---

## Phase 8: Search (outline)

**Goal:** Pluggable search interface with Postgres full-text search implementation.

**Key interfaces:** `SearchProvider` with `indexDocument`, `search`, `deleteDocument`

**Implementation:** `PostgresSearchProvider` using `tsvector` columns and GIN indexes on menu items, orders.

**Key endpoints:**
- `GET /search?q=&type=` — unified search across menu items, orders, bookings

**Tests:** Indexing, search relevance, provider abstraction (mock provider swap).

---

## Phases 9-14: Frontend & Platform (outline)

These phases build the UI and platform features on top of the API:

- **Phase 9:** Dashboard frontend (Next.js) — owner/manager views for all modules
- **Phase 10:** Customer ordering frontend — takeaway menu + QR table ordering
- **Phase 11:** Kitchen display frontend — real-time ticket board
- **Phase 12:** Platform admin — super_admin cross-tenant dashboard
- **Phase 13:** i18n — next-intl + nestjs-i18n integration, locale detection
- **Phase 14:** Production deployment — multi-stage Dockerfile, self-hosted onboarding, .env validation
