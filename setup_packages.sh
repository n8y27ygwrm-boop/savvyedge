#!/bin/bash
set -e

# 1. packages/config
mkdir -p packages/config
cat << 'JSON' > packages/config/package.json
{
  "name": "@savvyedge/config",
  "version": "0.0.0",
  "private": true,
  "main": "index.js"
}
JSON

cat << 'JSON' > packages/config/tsconfig.base.json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Base",
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2022", "dom", "dom.iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true
  }
}
JSON

# 2. packages/types
mkdir -p packages/types/src
cat << 'JSON' > packages/types/package.json
{
  "name": "@savvyedge/types",
  "version": "0.0.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@savvyedge/config": "workspace:*"
  }
}
JSON

cat << 'JSON' > packages/types/tsconfig.json
{
  "extends": "@savvyedge/config/tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
JSON

cat << 'TS' > packages/types/src/index.ts
import { z } from "zod";

export const CasinoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  license_info: z.string().nullable(),
  status: z.string(),
  website_url: z.string().nullable()
});

export type Casino = z.infer<typeof CasinoSchema>;
TS

# 3. packages/api
mkdir -p packages/api/src
cat << 'JSON' > packages/api/package.json
{
  "name": "@savvyedge/api",
  "version": "0.0.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@savvyedge/database": "workspace:*",
    "@savvyedge/types": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@savvyedge/config": "workspace:*"
  }
}
JSON

cat << 'JSON' > packages/api/tsconfig.json
{
  "extends": "@savvyedge/config/tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
JSON

cat << 'TS' > packages/api/src/index.ts
export const getApiVersion = () => "v1";
TS

echo "Packages scaffolded."
