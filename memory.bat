@echo off
rem Settings come from config.yaml (memoryModule section). Env vars override YAML.
cd /d "%~dp0"
npx pnpm@9.15.0 dev:memory:embed
