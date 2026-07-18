#!/bin/bash
set -e

# packages/ui
mkdir -p packages/ui/src/components
cat << 'JSON' > packages/ui/package.json
{
  "name": "@savvyedge/ui",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "react": "^18",
    "react-dom": "^18"
  },
  "devDependencies": {
    "@savvyedge/config": "workspace:*",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "typescript": "^5.0.0"
  }
}
JSON

cat << 'JSON' > packages/ui/tsconfig.json
{
  "extends": "@savvyedge/config/tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
JSON

cat << 'TS' > packages/ui/src/index.ts
export * from "./components/Button";
TS

cat << 'TSX' > packages/ui/src/components/Button.tsx
import * as React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export function Button({ children, ...props }: ButtonProps) {
  return <button className="px-4 py-2 bg-blue-500 text-white rounded" {...props}>{children}</button>;
}
TSX

# .github/workflows/ci.yml
mkdir -p .github/workflows
cat << 'YAML' > .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Generate Prisma Types
        run: pnpm --filter @savvyedge/database generate
      - name: Build
        run: pnpm turbo build
      - name: Lint
        run: pnpm turbo lint
YAML

echo "Done UI and CI."
