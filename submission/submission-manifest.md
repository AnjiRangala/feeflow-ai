# FeeFlow AI Submission Manifest

## Project overview

FeeFlow AI is a coaching-institute fee management platform with a React/Vite
frontend, Express/Mongoose backend, MongoDB persistence, and a local FastAPI
student-support risk service. The package includes source code, tests,
configuration examples, technical documentation, deployment guidance, and the
academic TDD material.

## Archive structure

```text
feeflow-ai-complete.zip
|-- ai-service/
|-- backend/
|-- frontend/
|-- docs/
|-- scripts/
|-- submission/
|   |-- TDD.pdf
|   |-- deployment.md
|   `-- submission-manifest.md
|-- .env.example
|-- frontend/.env.example
|-- .gitignore
|-- package.json
|-- package-lock.json
|-- README.md
|-- deployment.md
|-- deployment-guide.md
|-- application-testing-report.md
|-- production-readiness-report.md
`-- security-audit-report.md
```

## Included components

- Backend source, routes, services, models, middleware, manifests, and tests.
- Frontend React source, components, pages, styles, E2E tests, and manifests.
- FastAPI risk-service source, tests, and Python requirements.
- Root workspace configuration and lockfile.
- Safe environment templates containing placeholders only.
- Architecture, database, operations, integration, deployment, testing, and
  security documentation.
- MongoDB backup/restore scripts.
- TDD and existing submission deployment materials.

## Excluded content

The archive excludes the existing submission ZIP, `.env` files, credentials,
private keys/certificates, `node_modules`, Python environments, caches,
`dist`/build output, Playwright artifacts, logs, database dumps, and production
data. These exclusions keep the package reproducible and prevent accidental
secret or generated-artifact distribution.

## Installation and testing

1. Copy `.env.example` to `.env` and replace placeholders with local values.
2. Install JavaScript dependencies with `npm ci`.
3. Install AI dependencies from `ai-service/requirements.txt` in a Python
   virtual environment.
4. Start MongoDB with transaction support for payment workflows.
5. Run the backend with `npm run dev:backend`.
6. Run the frontend with `npm run dev:frontend`.
7. Run the AI service with `uvicorn app.main:app` from `ai-service`.

Validation commands:

```powershell
npm test
npm run build
npm run test:frontend
Set-Location ai-service
python -m pytest
```

## Environment configuration

Use only the supplied `.env.example` files as templates. Development mock
payments are synthetic and must remain disabled in production. Production
requires managed SMTP, Razorpay, HTTPS, TLS MongoDB, secret management,
monitoring, and private AI-service networking.

## Known limitations

- External Razorpay, SMTP, AWS, TLS, monitoring, backup/restore, and private AI
  networking are not verified in this package.
- Refund provider-outcome reconciliation remains an operational requirement.
- The AI service is an explainable rules baseline, not a validated clinical or
  predictive model.
- The application is **NOT READY FOR PRODUCTION**.

## Verification snapshot

Phase 30 packaging used the Phase 29 local evidence:

- Backend: 85 tests, 83 passed, 0 failed, 2 documented skips.
- AI service: 7 passed.
- Focused payment/refund/provider tests: 6 passed.
- Frontend build: passed.
- Playwright: 6 passed.
- JavaScript/Python syntax checks: passed.
- `git diff --check`: passed.
