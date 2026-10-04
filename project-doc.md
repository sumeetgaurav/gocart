# GoCart — Project & Deployment Documentation

> A multi-vendor e-commerce platform built with Next.js, deployed on Kubernetes (`kind`) running on a single AWS EC2 instance, with a GitHub Actions CI/CD pipeline publishing images to Docker Hub.
>
> Repository: https://github.com/sumeetgaurav/gocart

---

## 1. What GoCart Is

GoCart is a multi-vendor storefront: multiple independent vendors register, create a store, and list products; customers browse, cart, and check out; vendors manage their own orders and products from a dashboard; platform admins approve new stores and manage coupons across the whole marketplace.

It is a **single application** (one Next.js codebase, one container image) that serves three distinct experiences based on the URL and the signed-in user's role:

| Area | Route prefix | Who uses it |
|---|---|---|
| Storefront | `/`, `/shop`, `/product`, `/cart`, `/orders`, `/create-store`, `/about`, `/contact`, `/pricing` | Shoppers (and anonymous visitors) |
| Vendor dashboard | `/store`, `/store/add-product`, `/store/manage-product`, `/store/orders` | Vendors managing their own store |
| Admin panel | `/admin`, `/admin/approve`, `/admin/stores`, `/admin/coupons` | Platform administrators |

There is no separate backend service — API routes under `app/api/*` (Next.js Route Handlers) are the backend, running in the same process/container as the frontend.

---

## 2. End-to-End Application Flow

### 2.1 A shopper's journey

```mermaid
sequenceDiagram
    actor Shopper
    participant Browser
    participant App as Next.js (gocart pod)
    participant Clerk
    participant DB as Neon Postgres

    Shopper->>Browser: Opens the site
    Browser->>App: GET /
    App->>DB: Fetch products (Prisma)
    DB-->>App: Product rows
    App-->>Browser: Rendered storefront

    Shopper->>Browser: Clicks "Sign in"
    Browser->>Clerk: Auth flow (hosted by Clerk)
    Clerk-->>Browser: Session/JWT

    Shopper->>Browser: Adds items to cart, checks out
    Browser->>App: POST /api/orders (with Clerk session)
    App->>Clerk: Verify session (clerkMiddleware)
    App->>DB: Create Order + OrderItems (Prisma)
    DB-->>App: OK
    App-->>Browser: Order confirmation
```

### 2.2 A vendor's journey

1. A signed-in user visits `/create-store` and submits a store application.
2. The application is written to the `Store` table with a pending status.
3. A platform admin visits `/admin/approve` and approves it.
4. Once approved, the vendor gets access to `/store/*`: adding products (`/store/add-product`), editing/removing them (`/store/manage-product`), and viewing/fulfilling their own orders (`/store/orders`).

### 2.3 Data model (Prisma, `prisma/schema.prisma`)

Eight models capture the whole domain: `User`, `Store`, `Product`, `Order`, `OrderItem`, `Rating`, `Address`, `Coupon`. All persistent state lives here — the application container itself holds no state (see §5.4, "why no PVC").

### 2.4 Request flow through the infrastructure (production)

```mermaid
flowchart LR
    U[User's Browser] -->|HTTP 80/443| EC2[EC2 instance\npublic IP]
    EC2 --> KindLB[kind control-plane\nhostPort 80/443]
    KindLB --> Ingress[ingress-nginx controller pod]
    Ingress -->|routes /| Svc[Service: gocart-svc\nClusterIP :80]
    Svc --> Pod1[gocart Pod 1\n:3000]
    Svc --> Pod2[gocart Pod 2\n:3000]
    Pod1 & Pod2 -->|Prisma over TLS| Neon[(Neon Postgres\nexternal, managed)]
    Pod1 & Pod2 -->|Auth API| Clerk[(Clerk\nexternal SaaS)]
```

Everything inside the dashed boundary below runs **inside the single EC2 instance**, inside a 3-node `kind` (Kubernetes-in-Docker) cluster. Postgres (Neon) and auth (Clerk) are both external, managed SaaS — GoCart itself holds no database and no user-credential store.

---

## 3. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router) | `output: 'standalone'`, Turbopack for local dev |
| UI | React 19, Tailwind CSS 4, Lucide icons | |
| State | Redux Toolkit + React-Redux | Client-side cart/UI state |
| Charts | Recharts | Store/admin analytics dashboards |
| Auth | Clerk (`@clerk/nextjs`) | Hosted auth; session verified in `middleware.js` via `clerkMiddleware()` |
| ORM / DB access | Prisma 7 (`@prisma/client`, `@prisma/adapter-pg`) | |
| Database | PostgreSQL — Neon (serverless Postgres), external | No DB runs inside the cluster |
| Containerization | Docker (multi-stage `Dockerfile`) | Non-root runtime user |
| Local orchestration | Docker Compose | App + local Postgres, for development |
| Production orchestration | Kubernetes via `kind` | 1 control-plane + 2 worker nodes, on one EC2 host |
| Ingress | ingress-nginx | Single HTTP(S) entrypoint |
| Autoscaling | Horizontal Pod Autoscaler + `metrics-server` | CPU/memory based |
| Cloud host | AWS EC2 | Runs Docker + the entire `kind` cluster |
| CI/CD | GitHub Actions | Lint/build/test on every PR; build & publish image on merge to `main` |
| Image registry | Docker Hub (`sumeetgaurav/gocart`) | Public repository |
| Dependency hygiene | Dependabot | Weekly PRs for npm, Docker base image, GitHub Actions |

---

## 4. How It Gets Deployed to EC2 — Step by Step

This is the full path from nothing to a publicly reachable app on one EC2 instance.

### 4.1 Prerequisites

- An AWS EC2 instance — Ubuntu/Debian **or** Amazon Linux 2023 — sized `t3.medium` or larger (a 3-node `kind` cluster needs real memory).
- The instance's **Security Group** allows inbound TCP on:
  - `22` (SSH)
  - `80` and `443` (HTTP/HTTPS — mapped straight through to the in-cluster ingress controller)
- A Neon Postgres database already created (connection strings in hand).
- A Clerk application already created (publishable key + secret key in hand).

### 4.2 Step 1 — Connect and get the code

```bash
ssh -i <your-key.pem> <user>@<ec2-public-ip>
git clone https://github.com/sumeetgaurav/gocart.git gocart
cd gocart
```

### 4.3 Step 2 — Provide environment configuration

```bash
cp .env.example .env
# edit .env and fill in:
#   NEXT_PUBLIC_CURRENCY_SYMBOL
#   DATABASE_URL                 (Neon pooled connection string)
#   DIRECT_URL                   (Neon direct connection string)
#   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
#   CLERK_SECRET_KEY
```

`deploy.sh` (next step) refuses to run if `.env` is missing.

### 4.4 Step 3 — Bootstrap the instance (`scripts/ec2-bootstrap.sh`)

One-time setup, run once per fresh instance:

```bash
chmod +x scripts/ec2-bootstrap.sh
./scripts/ec2-bootstrap.sh
newgrp docker   # pick up docker group membership without re-logging in
```

What it installs:

| Step | What | Why |
|---|---|---|
| 1 | Docker Engine (`apt-get`/`dnf`) | `kind` runs each Kubernetes "node" as a Docker container |
| 2 | `systemctl enable --now docker` | Starts Docker, enables on boot |
| 3 | `usermod -aG docker $USER` | Run `docker`/`kind` without `sudo` |
| 4 | `kubectl` (pinned `v1.31.0`) | CLI to talk to the cluster |
| 5 | `kind` (pinned `v0.27.0`) | Creates the Kubernetes cluster itself |

### 4.5 Step 4 — Deploy (`scripts/deploy.sh`)

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

This single, idempotent script (safe to re-run after every code change) does, in order:

1. Creates the 3-node `kind` cluster from `kind-cluster.yaml` if it doesn't already exist.
2. Builds the Docker image from source (`docker build`, with the `NEXT_PUBLIC_*` build args from `.env`).
3. Loads that image into the `kind` cluster (`kind load docker-image`) — `kind` nodes can't otherwise see images on the host.
4. Applies, in order: `namespace.yaml` → `configmap.yaml` → an imperatively-created `Secret` (from `.env`, never committed) → `deployment.yaml` → `service.yaml`.
5. Installs `metrics-server` (with the `kind`-specific `--kubelet-insecure-tls` patch) and waits for it, then applies `hpa.yaml` + `pdb.yaml`.
6. Installs the `ingress-nginx` controller, patches it onto the control-plane node (the only node with host ports 80/443 mapped), waits for it, then applies `ingress.yaml`.
7. Waits for the Deployment rollout to finish.

### 4.6 Step 5 — Open the app

```
http://<ec2-instance-public-ip>/
```

### 4.7 Redeploying after a code change

```bash
git pull origin main
IMAGE_TAG=v2 ./scripts/deploy.sh   # any new tag forces a visible rolling update
```

Note: `git pull` only updates source files on disk — it does **not** rebuild the running container. `deploy.sh` must be re-run to actually rebuild the image and roll it out. (`deploy.sh` always builds fresh from local source; it does not currently pull the image GitHub Actions publishes to Docker Hub.)

### 4.8 Day-2 operations

```bash
kubectl get pods -n gocart                              # pod status
kubectl get hpa -n gocart                                # autoscaling status
kubectl logs -n gocart -l app=gocart -f                  # tail app logs
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller -f   # see visitor IPs/requests
kubectl rollout undo deployment/gocart -n gocart          # roll back
./audit.sh gocart                                         # 16-point cluster sanity check
kind delete cluster --name gocart                         # tear everything down
```

---

## 5. The Dockerfile — What It Does

`Dockerfile` is a **3-stage multi-stage build**, designed to produce a small, non-root, production-only image.

```mermaid
flowchart TB
    subgraph Stage1["Stage: deps"]
        A1[npm ci] --> A2[node_modules]
    end
    subgraph Stage2["Stage: builder"]
        B1[Copy node_modules from deps] --> B2[Copy full source]
        B2 --> B3[prisma generate]
        B3 --> B4[next build\n → .next/standalone]
    end
    subgraph Stage3["Stage: runner — final image"]
        C1[Copy .next/standalone] --> C2[Copy .next/static]
        C2 --> C3[Copy node_modules/.prisma]
        C3 --> C4[Run as non-root user 'nextjs']
    end
    Stage1 --> Stage2 --> Stage3
```

| Stage | Purpose |
|---|---|
| `base` | `node:20-alpine` — the shared starting point for every stage. |
| `deps` | Runs `npm ci` against `package.json`/`package-lock.json` only, so dependency installation is cached independently of source-code changes. |
| `builder` | Copies `node_modules` from `deps`, copies the full source, runs `npx prisma generate` (generates the Prisma client against `schema.prisma`), then `npm run build` (Next.js production build, emitting the standalone server at `.next/standalone`). |
| `runner` (final) | Starts from clean `node:20-alpine` again — only copies the three things actually needed at runtime: the standalone server, the static assets, and the generated Prisma client. Nothing from `deps`/`builder` (source code, dev tooling, full `node_modules`) ends up in the final image. |

Other notable details:

- **Build args vs. runtime env**: `NEXT_PUBLIC_CURRENCY_SYMBOL` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` are declared as `ARG`s and passed with `--build-arg`. This is required because `NEXT_PUBLIC_*` variables are inlined into the **client-side JS bundle at build time** — setting them as a runtime environment variable on the container would have no effect; the browser would never see the value.
- **`DIRECT_URL` placeholder at build time**: `prisma.config.js` requires `DIRECT_URL` to be resolvable just to load, even though `prisma generate` never actually connects to the database. The Dockerfile sets a harmless placeholder (`postgresql://user:pass@localhost:5432/db`) purely so the build step doesn't fail — the real value is injected later, at runtime, via the Kubernetes `Secret`.
- **Non-root runtime**: a dedicated `nextjs` user/group (UID/GID 1001) is created, file ownership is set to it, and the container runs as that user (`USER nextjs`) — never as root.
- **Final `CMD`**: `node server.js`, Next.js's standalone server, listening on `0.0.0.0:3000`.

---

## 6. docker-compose.yml — What It Does

`docker-compose.yml` is the **local development stack** — not what runs in production. It brings up two services:

| Service | Image | Purpose |
|---|---|---|
| `postgres` | `postgres:16-alpine` | A local, throwaway Postgres instance (so local dev doesn't require a real Neon database), with a `pg_isready` healthcheck and a named volume (`gocart-db-data`) for persistence across restarts. |
| `gocart` | Built from the repo's `Dockerfile` | The app itself. `depends_on: postgres: condition: service_healthy` means it won't start until Postgres is actually accepting connections, not just "container started." |

Key details:

- `gocart`'s `environment:` **overrides** `.env`'s `DATABASE_URL`/`DIRECT_URL` to point at the local `postgres` service (`postgresql://gocart:gocart@postgres:5432/gocart`) instead of a real Neon connection string — so the whole stack (frontend + backend + database) is self-contained and runnable with one command, no external account needed.
- `gocart`'s own healthcheck calls `/api/health` from inside the container (via Node's `fetch`), so `docker compose ps` accurately reflects whether the app is actually serving traffic, not just running.
- Usage: `docker compose up --build` to build the app image and start both services together.

This is intentionally a simpler, single-container setup — there's no Kubernetes, no Ingress, no autoscaling here. It exists purely so a developer can run the full stack locally in one command.

---

## 7. The Kubernetes Manifests (`k8s/`) — What Each One Does

```mermaid
flowchart TD
    NS[namespace.yaml\nNamespace: gocart] --> CM[configmap.yaml\ngocart-config]
    NS --> SEC[Secret: gocart-secrets\ncreated imperatively, not committed]
    CM --> DEP[deployment.yaml\nDeployment: gocart]
    SEC --> DEP
    DEP --> SVC[service.yaml\nService: gocart-svc]
    SVC --> ING[ingress.yaml\nIngress: gocart-ingress]
    DEP --> HPA[hpa.yaml\nHPA: gocart-hpa]
    DEP --> PDB[pdb.yaml\nPDB: gocart-pdb]
```

| File | Kind | What it does |
|---|---|---|
| `namespace.yaml` | `Namespace` | Isolates every GoCart object (`gocart` namespace) from `kube-system`/`ingress-nginx`, so tooling and audits can scope to just this app. |
| `configmap.yaml` | `ConfigMap` (`gocart-config`) | Holds non-secret, environment-specific config — currently just `NEXT_PUBLIC_CURRENCY_SYMBOL` — consumed by the Deployment via `envFrom.configMapRef`. |
| `secret.example.yaml` | `Secret` (template only) | **Documents the shape** of the real Secret (`DATABASE_URL`, `DIRECT_URL`, `CLERK_SECRET_KEY`) but is never applied as-is. The real, `Opaque` Secret is created imperatively by `scripts/deploy.sh` from the instance's local `.env` file, so credentials never touch git. |
| `deployment.yaml` | `Deployment` (`gocart`) | The core workload. `replicas: 2`; pulls config via `envFrom` from both the `ConfigMap` and `Secret`; runs as non-root (`runAsUser: 1001`, dropped Linux capabilities); defines `resources.requests`/`limits` (100m/192Mi → 500m/512Mi) so the scheduler places pods sensibly and a runaway pod can't starve its node; defines **liveness + readiness probes** against `GET /api/health:3000` (readiness keeps a not-yet-ready or DB-less pod out of the Service's endpoints; liveness restarts a pod that's hung); and sets `topologySpreadConstraints` so the 2 replicas prefer different nodes/zones (meaningful on the 3-node cluster). |
| `service.yaml` | `Service` (`gocart-svc`, `ClusterIP`) | Gives the Deployment's pods one stable in-cluster DNS name/IP, routing port `80` → container port `3000`. Without the label selector matching the Deployment's pod labels, this would have zero endpoints and silently drop all traffic. |
| `ingress.yaml` | `Ingress` (`gocart-ingress`) | The single public HTTP entrypoint: routes `/` → `gocart-svc:80` via the `nginx` ingress class. `ssl-redirect: "false"` is a demo-only setting (no TLS termination configured here). |
| `hpa.yaml` | `HorizontalPodAutoscaler` (`gocart-hpa`) | Scales the Deployment between `minReplicas: 2` and `maxReplicas: 5`, triggered at 70% average CPU or 80% average memory utilization. A 5-minute stabilization window on scale-down avoids thrashing replica count during a brief traffic dip. Requires `metrics-server` to be installed in the cluster (handled by `deploy.sh`). |
| `pdb.yaml` | `PodDisruptionBudget` (`gocart-pdb`) | Guarantees at least 1 pod (`minAvailable: 1`) stays up during *voluntary* disruptions (node drains, cluster upgrades) — combined with `minReplicas: 2`, the app is never taken fully offline by routine cluster maintenance. |

Deliberately **not present**: a `PersistentVolumeClaim`. All real persistent state (products, orders, users, cart) lives in the external, managed Neon Postgres — the app container itself is fully stateless, so a PVC would have nothing real to hold.

---

## 8. GitHub Actions — What Runs, Why, and When

Two workflows live in `.github/workflows/`, plus a Dependabot config. Together they form the CI/CD pipeline:

```mermaid
flowchart TD
    subgraph Trigger1["Push or PR → main"]
        direction TB
        L[Lint\nnpm run lint]
        B[Build\nprisma generate + next build]
        D[Docker Build Test\ndocker build, no push]
        K["Kind Smoke Test\nthrowaway kind cluster,\napply k8s manifests,\ncurl /api/health"]
    end
    subgraph Trigger2["Push/merge → main only"]
        direction TB
        P1[Login to Docker Hub] --> P2[Build image] --> P3["Push tags:\nlatest, sha-<commit>"]
    end
    Trigger1 -->|if PR passes & is merged| Trigger2
    P3 --> Hub[(Docker Hub\nsumeetgaurav/gocart)]
```

### 8.1 `ci.yml` — runs on every push to `main` **and** every pull request into `main`

This is the quality gate. Four independent jobs:

1. **Lint** — `npm run lint` (ESLint via `next lint`). Catches style issues and common mistakes before a human reviews the PR.
2. **Build** — `npx prisma generate` then `npm run build`. Proves the app actually compiles and the Prisma schema is valid — the same production build Next.js uses.
3. **Docker Build Test** — runs `docker build` against the real `Dockerfile`, with `push: false`. Proves the image *can* be built, without publishing anything. Catches a broken `Dockerfile` at PR time instead of at merge time.
4. **Kind Smoke Test** — builds the image, spins up a **throwaway** `kind` cluster directly on the CI runner (separate from the long-lived one on the EC2 box) via `helm/kind-action`, loads the image, applies the core manifests (`namespace`, `configmap`, a dummy `Secret`, `deployment`, `service`), waits for the rollout, and curls `/api/health` through a port-forward. This catches a broken manifest (bad selector, wrong port, bad probe path) on every PR — before it ever reaches the real EC2 cluster.

Dummy, non-secret placeholder values are used for `NEXT_PUBLIC_CURRENCY_SYMBOL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `DIRECT_URL` so these jobs can run without any real credentials configured — real values (added as repo secrets) are used automatically if present.

**When it fires**: every `git push` to `main`, and every pull request targeting `main`. With branch protection configured, a PR can't be merged while any of these four jobs are red.

### 8.2 `docker-publish.yml` — runs only on a push/merge **directly to `main`** (never on a PR)

The release step. It:

1. Logs into Docker Hub using repository secrets `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` (an access token, never the account password).
2. Builds the production image from the same `Dockerfile`.
3. Pushes it to **`sumeetgaurav/gocart`** on Docker Hub with two tags: `latest` (always the most recent `main` build) and `sha-<short-commit-sha>` (an immutable tag pinned to the exact commit, for reproducible rollbacks).

**Why separate from `ci.yml`**: `ci.yml` only *checks* things — nothing leaves the runner, so it's safe to run on a PR from anyone, with no Docker Hub credentials exposed to it. `docker-publish.yml` *publishes* an artifact to the outside world, so it only runs after code has actually landed on `main` (i.e., been reviewed and passed CI).

**When it fires**: every push to `main` — in practice, every merged pull request (plus any direct push, if that's ever used).

### 8.3 `dependabot.yml` — not event-triggered, runs on a weekly schedule

Opens pull requests automatically for outdated dependencies across three ecosystems: `npm` (app dependencies — Next.js, React, Prisma, Clerk, etc.; minor/patch bumps are grouped into one PR), `docker` (the `node:20-alpine` base image), and `github-actions` (the actions used inside the workflows themselves, e.g. `actions/checkout`). Every Dependabot PR runs through `ci.yml` exactly like a human-authored PR.

### 8.4 Required secrets

| Secret | Required by | Purpose |
|---|---|---|
| `DOCKERHUB_USERNAME` | `docker-publish.yml` | Docker Hub login |
| `DOCKERHUB_TOKEN` | `docker-publish.yml` | Docker Hub access token (not the account password) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` *(optional)* | `ci.yml`, `docker-publish.yml` | If set, the real Clerk key gets baked into the built image instead of a CI placeholder |
| `NEXT_PUBLIC_CURRENCY_SYMBOL` *(optional)* | same | Same reasoning, for the currency symbol |

---

## 9. Overall Architecture Diagram

```mermaid
flowchart TB
    Dev[Developer] -->|git push / PR| GH[GitHub Repo]
    GH -->|on push/PR to main| CI[ci.yml\nLint · Build · Docker Build Test · Kind Smoke Test]
    GH -->|on merge to main| CD[docker-publish.yml\nBuild & Push]
    CD --> Hub[(Docker Hub\nsumeetgaurav/gocart)]
    GH -.->|weekly| DB[dependabot.yml]

    subgraph EC2["AWS EC2 instance"]
        subgraph Kind["kind cluster (3 nodes)"]
            Ingress[ingress-nginx] --> Svc[Service: gocart-svc]
            Svc --> Pod1[gocart Pod]
            Svc --> Pod2[gocart Pod]
            HPA[HPA] -.scales.-> Pod1
            HPA -.scales.-> Pod2
        end
    end

    Admin["Admin/SRE"] -->|"manual: scripts/deploy.sh (builds image from source)"| Kind
    User[End User] -->|HTTP/HTTPS :80/:443| EC2
    Pod1 & Pod2 --> Neon[(Neon Postgres)]
    Pod1 & Pod2 --> Clerk[(Clerk Auth)]
```

**Note on the two deployment paths**: `docker-publish.yml` publishes images to Docker Hub on every merge, but `scripts/deploy.sh` (run manually on the EC2 box) currently **builds its own image from source** rather than pulling the published one — these are two independent paths today, not yet wired together into a single automated CD flow.

---

## 10. Summary for a Non-Technical Audience

- GoCart is one web application that serves shoppers, vendors, and admins from the same codebase.
- It's packaged as a Docker container and run on Kubernetes, which keeps 2+ copies of the app alive at all times and automatically restarts/replaces any copy that crashes or becomes unresponsive.
- That Kubernetes cluster runs on a single AWS server (EC2) for this demo deployment — large enough to host 3 Kubernetes nodes.
- The database (Neon Postgres) and user login (Clerk) are both handled by external, specialized services — GoCart doesn't reinvent either.
- Every code change is automatically linted, built, and deployment-tested before it's allowed to merge; every merge automatically produces a new, versioned container image published to Docker Hub.
- Dependency updates (security patches, version bumps) are proposed automatically every week rather than discovered manually.
