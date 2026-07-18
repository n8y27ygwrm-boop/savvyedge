#!/bin/bash
set -e

# 1. Create the full monorepo structure
mkdir -p apps/web apps/admin apps/dashboard
mkdir -p packages/database packages/api packages/types packages/ui packages/ai-agents packages/config
mkdir -p .github/workflows

# Create placeholder READMEs
echo "# Web App" > apps/web/README.md
echo "# Admin App" > apps/admin/README.md
echo "# Dashboard App" > apps/dashboard/README.md

# 2. Set up Turborepo + pnpm workspace at root
cat << 'JSON' > package.json
{
  "name": "savvyedge-monorepo",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "lint": "turbo lint",
    "format": "prettier --write \"**/*.{ts,tsx,md}\""
  },
  "devDependencies": {
    "turbo": "latest",
    "prettier": "latest"
  },
  "packageManager": "pnpm@9.0.0"
}
JSON

cat << 'YAML' > pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
YAML

cat << 'JSON' > turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    }
  }
}
JSON

# 3. Create schema.prisma in packages/database
mkdir -p packages/database/prisma

cat << 'JSON' > packages/database/package.json
{
  "name": "@savvyedge/database",
  "version": "0.0.0",
  "private": true,
  "main": "./index.ts",
  "scripts": {
    "generate": "prisma generate",
    "db:push": "prisma db push"
  },
  "dependencies": {
    "@prisma/client": "latest"
  },
  "devDependencies": {
    "prisma": "latest"
  }
}
JSON

cat << 'PRISMA' > packages/database/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Casino {
  id             String    @id @default(uuid())
  slug           String    @unique
  name           String
  license_info   String?
  status         String
  website_url    String?
  created_at     DateTime  @default(now())
  updated_at     DateTime  @updatedAt
  verified_at    DateTime?
  
  bonuses        Bonus[]
  reviews        Review[]
  history_events CasinoHistoryEvent[]

  @@index([slug])
}

model Provider {
  id          String @id @default(uuid())
  slug        String @unique
  name        String
  website_url String?
  
  slots       Slot[]

  @@index([slug])
}

model Slot {
  id           String   @id @default(uuid())
  slug         String   @unique
  name         String
  provider_id  String
  rtp_current  Float?
  volatility   String?
  max_win      Float?
  release_date DateTime?
  
  provider     Provider @relation(fields: [provider_id], references: [id])
  rtp_history  SlotRtpHistory[]

  @@index([slug])
  @@index([provider_id])
}

model SlotRtpHistory {
  id          String   @id @default(uuid())
  slot_id     String
  rtp_value   Float
  recorded_at DateTime @default(now())
  source_url  String?
  
  slot        Slot     @relation(fields: [slot_id], references: [id])

  @@index([slot_id])
  @@index([slot_id, recorded_at])
}

model Bonus {
  id                   String   @id @default(uuid())
  casino_id            String
  type                 String
  headline_value       String?
  wagering_requirement Float?
  max_conversion       Float?
  true_value_score     Float?
  valid_from           DateTime?
  valid_until          DateTime?
  status               String
  
  casino               Casino   @relation(fields: [casino_id], references: [id])
  history_events       BonusHistoryEvent[]

  @@index([casino_id])
}

model BonusHistoryEvent {
  id            String   @id @default(uuid())
  bonus_id      String
  field_changed String
  old_value     String?
  new_value     String?
  changed_at    DateTime @default(now())
  source_url    String?
  
  bonus         Bonus    @relation(fields: [bonus_id], references: [id])

  @@index([bonus_id])
  @@index([bonus_id, changed_at])
}

model CasinoHistoryEvent {
  id          String   @id @default(uuid())
  casino_id   String
  event_type  String
  description String
  occurred_at DateTime @default(now())
  source_url  String?
  
  casino      Casino   @relation(fields: [casino_id], references: [id])

  @@index([casino_id])
  @@index([casino_id, occurred_at])
}

model Review {
  id                  String   @id @default(uuid())
  casino_id           String
  author_type         String
  content             String   @db.Text
  rating              Float
  methodology_version String?
  published_at        DateTime?
  last_verified_at    DateTime?
  
  casino              Casino   @relation(fields: [casino_id], references: [id])

  @@index([casino_id])
}

model DataSource {
  id                String   @id @default(uuid())
  url               String
  source_type       String
  last_scraped_at   DateTime?
  reliability_score Float?
  
  scrape_jobs       ScrapeJob[]
}

model ScrapeJob {
  id             String   @id @default(uuid())
  data_source_id String
  status         String
  started_at     DateTime @default(now())
  completed_at   DateTime?
  error_log      String?  @db.Text
  
  data_source    DataSource @relation(fields: [data_source_id], references: [id])

  @@index([data_source_id])
}
PRISMA

# 4. Git init and commit
git init
git add .
git commit -m "feat: scaffold monorepo structure + initial Prisma schema"

echo "DONE"
