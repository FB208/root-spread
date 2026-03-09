## RootSpread API

### Run locally

```powershell
uv sync
uv run uvicorn rootspread_api.main:app --reload --host 0.0.0.0 --port 18000
```

### Test

```powershell
uv run pytest
```

### Env file

Copy `.env.example` to `.env` before local development.
