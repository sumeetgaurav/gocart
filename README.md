<div align="center">
  <h1><img src="https://gocart-gs.vercel.app/favicon.ico" width="20" height="20" alt="GoCart Favicon">
   GoCart</h1>
  <p>
    An open-source multi-vendor e-commerce platform built with Next.js and Tailwind CSS.
  </p>
  <p>
    <a href="https://github.com/GreatStackDev/goCart/blob/main/LICENSE.md"><img src="https://img.shields.io/github/license/GreatStackDev/goCart?style=for-the-badge" alt="License"></a>
    <a href="https://github.com/GreatStackDev/goCart/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge" alt="PRs Welcome"></a>
    <a href="https://github.com/GreatStackDev/goCart/issues"><img src="https://img.shields.io/github/issues/GreatStackDev/goCart?style=for-the-badge" alt="GitHub issues"></a>
  </p>
</div>

---

## 📖 Table of Contents

- [✨ Features](#-features)
- [🛠️ Tech Stack](#-tech-stack)
- [🏗️ Architecture](#-architecture)
- [🚀 Getting Started (Local Dev)](#-getting-started-local-dev)
- [🐳 Running with Docker Compose](#-running-with-docker-compose)
- [☸️ Deploying to a `kind` Cluster on AWS EC2](#-deploying-to-a-kind-cluster-on-aws-ec2)
- [📦 Kubernetes Resources Reference](#-kubernetes-resources-reference)
- [💾 Why No PersistentVolume / PersistentVolumeClaim?](#-why-no-persistentvolume--persistentvolumeclaim)
- [🔐 Environment Variables](#-environment-variables)
- [🧰 Operating the Cluster](#-operating-the-cluster)
- [🤝 Contributing](#-contributing)
- [📜 License](#-license)

---

## Features

- **Multi-Vendor Architecture:** Allows multiple vendors to register, manage their own products, and sell on a single platform.
- **Customer-Facing Storefront:** A beautiful and responsive user interface for customers to browse and purchase products.
- **Vendor Dashboards:** Dedicated dashboards for vendors to manage products, view sales analytics, and track orders.
- **Admin Panel:** A comprehensive dashboard for platform administrators to oversee vendors, products, and commissions.

## 🛠️ Tech Stack <a name="-tech-stack"></a>

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 15](https://nextjs.org/) (App Router, standalone output, Turbopack for dev) |
| **UI Library** | React 19 |
| **Styling** | Tailwind CSS 4 |
| **Icons** | Lucide React |
| **State Management** | Redux Toolkit + React-Redux |
| **Charts** | Recharts (store/admin analytics) |
| **Notifications** | react-hot-toast |
| **Authentication** | [Clerk](https://clerk.com/) (`@clerk/nextjs`, `middleware.js`) |
| **ORM** | Prisma 7 (`@prisma/client`, `@prisma/adapter-pg` driver adapter) |
| **Database** | PostgreSQL — [Neon](https://neon.tech/) serverless Postgres in production, `postgres:16-alpine` for local Docker Compose |
| **Containerization** | Docker (multi-stage `Dockerfile`, non-root runtime user) |
| **Local orchestration (dev)** | Docker Compose |
| **Container Orchestration (prod demo)** | Kubernetes via [`kind`](https://kind.sigs.k8s.io/) (Kubernetes IN Docker) |
| **Ingress Controller** | ingress-nginx |
| **Cloud Host** | AWS EC2 (runs Docker + the `kind` cluster) |
| **Automation** | Bash scripts (`scripts/ec2-bootstrap.sh`, `scripts/deploy.sh`, `audit.sh`) |

---

## 🏗️ Architecture <a name="-architecture"></a>

GoCart is a single Next.js application that serves the storefront UI, the vendor/admin dashboards, and the JSON API (`app/api/*` route handlers) from one deployable image. It talks to two external managed services — **Neon Postgres** for persistence (via Prisma) and **Clerk** for authentication — so the application container itself is stateless and horizontally scalable.

For the Kubernetes demo, the whole stack (control-plane + worker nodes) runs as Docker containers **inside a single EC2 instance**, using `kind`. The EC2 instance's ports 80/443 are mapped straight through to the `kind` control-plane node, which is where the ingress controller lives.

```mermaid
flowchart TB
    U["Browser / User"]
    Clerk[("Clerk Auth\n(external SaaS)")]
    Neon[("Neon Postgres\n(external managed DB)")]

    subgraph EC2["AWS EC2 Instance (Ubuntu / Amazon Linux)"]
        subgraph DOCKER["Docker Engine"]
            subgraph KIND["kind cluster \"gocart\" (3 nodes, each a Docker container)"]
                CP["control-plane node\nhostPort 80/443 -> containerPort 80/443\nlabel ingress-ready=true"]
                W1["worker node 1"]
                W2["worker node 2"]

                subgraph INGNS["namespace: ingress-nginx"]
                    ICTRL["ingress-nginx-controller\n(pinned to control-plane via nodeSelector)"]
                end

                subgraph NS["namespace: gocart"]
                    ING["Ingress: gocart-ingress\n(class: nginx, path: /)"]
                    SVC["Service: gocart-svc\nClusterIP :80 -> :3000"]
                    CM["ConfigMap: gocart-config"]
                    SEC["Secret: gocart-secrets"]
                    P1["Pod: gocart-xxxxx\n(Next.js container :3000)"]
                    P2["Pod: gocart-yyyyy\n(Next.js container :3000)"]
                end
            end
        end
    end

    U -->|"HTTP(S) to EC2 public IP"| CP
    CP --> ICTRL
    ICTRL --> ING --> SVC
    SVC --> P1
    SVC --> P2
    CM -.envFrom.-> P1
    SEC -.envFrom.-> P1
    CM -.envFrom.-> P2
    SEC -.envFrom.-> P2
    P1 -->|"Prisma (pg adapter) over TLS"| Neon
    P2 -->|"Prisma (pg adapter) over TLS"| Neon
    P1 -->|"Auth verification"| Clerk
    P2 -->|"Auth verification"| Clerk
```

Key architectural points:

- **Stateless app tier** — the `gocart` Deployment starts at 2 replicas of the same image; either pod can serve any request because all persistent state lives in Neon Postgres, not in the pod.
- **Autoscaled, not fixed** — a `HorizontalPodAutoscaler` (`k8s/hpa.yaml`) keeps replicas between 2 and 5 based on CPU (70%) and memory (80%) utilization, backed by `metrics-server` (installed by `deploy.sh` since `kind` doesn't ship it out of the box).
- **Disruption-safe** — a `PodDisruptionBudget` (`k8s/pdb.yaml`, `minAvailable: 1`) guarantees a voluntary disruption (node drain, cluster upgrade) can never take every replica down at once.
- **Hardened pod security** — pods run as the Dockerfile's non-root `nextjs` user (`runAsNonRoot`, explicit UID/GID, `RuntimeDefault` seccomp profile) and the container drops all Linux capabilities with `allowPrivilegeEscalation: false`.
- **Spread across failure domains** — soft `topologySpreadConstraints` (zone, then node) ask the scheduler to avoid stacking replicas together; a no-op on a single-zone `kind` cluster today, but directly load-bearing once this moves to multi-AZ EKS (see `PLAN.md`).
- **Driver adapter, no connection pooler needed on the cluster side** — Prisma uses `@prisma/adapter-pg` over `pg`, talking directly to Neon's pooled (`DATABASE_URL`) and direct (`DIRECT_URL`) connection strings.
- **Config vs. Secret split** — non-sensitive, public runtime config (`NEXT_PUBLIC_CURRENCY_SYMBOL`) comes from a `ConfigMap`; sensitive values (`DATABASE_URL`, `DIRECT_URL`, `CLERK_SECRET_KEY`) come from a `Secret`, both injected via `envFrom`.
- **Health checks** — `/api/health` (a trivial `{ status: "ok" }` route) backs both the Docker Compose `healthcheck` and the Kubernetes `readinessProbe`/`livenessProbe`.
- **Single ingress point** — `ingress-nginx` is the only component bound to host ports 80/443 (via `kind-cluster.yaml`'s `extraPortMappings` on the control-plane node), so it must be scheduled on that node — `deploy.sh` patches its `nodeSelector` to guarantee that.
- **Build-time vs. runtime config** — `NEXT_PUBLIC_*` variables are inlined into the client JS bundle at **build** time (Docker `ARG`/`ENV`), so they're passed as `--build-arg` to `docker build`, not just injected at pod runtime.

> This `kind`/EC2 setup is the local/demo deployment target. `PLAN.md` lays out the path to a production-grade **Amazon EKS + ArgoCD GitOps** deployment — autoscaled nodes, real TLS, AWS Secrets Manager, CI/CD, and observability — building on the hardening above.

---

## 🚀 Getting Started (Local Dev) <a name="-getting-started-local-dev"></a>

First, install the dependencies. We recommend using `npm` for this project.

```bash
npm install
```

Then, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/(public)/page.jsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Outfit](https://vercel.com/font), a new font family for Vercel.

Other useful local scripts (from `package.json`):

| Command | Purpose |
|---|---|
| `npm run build` | Production build (`next build`, standalone output) |
| `npm run start` | Run the production build locally |
| `npm run lint` | Lint the codebase |
| `npm run db:seed` | Seed the database via `prisma/seed.js` |
| `npm run db:studio` | Open Prisma Studio against the configured database |

---

## 🐳 Running with Docker Compose <a name="-running-with-docker-compose"></a>

`docker-compose.yml` spins up a **fully self-contained** stack — the app plus its own local Postgres — useful for testing the production Docker image without touching Neon or Kubernetes.

```bash
# 1. Build the app image and start Postgres + GoCart together
docker compose up --build

# 2. (in another shell) tail logs / check health
docker compose ps
docker compose logs -f gocart
```

What happens, in order:

1. `postgres` (image `postgres:16-alpine`) starts and runs `pg_isready` until healthy.
2. `gocart` is **built** from the local `Dockerfile`, passing `NEXT_PUBLIC_CURRENCY_SYMBOL` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` as build args (read from your `.env`).
3. Once Postgres reports healthy, the `gocart` container starts, with `DATABASE_URL`/`DIRECT_URL` **overridden** to point at the `postgres` service (not Neon), so the whole stack is local.
4. `node -e "fetch('http://localhost:3000/api/health')..."` is polled as the container healthcheck.

Visit [http://localhost:3000](http://localhost:3000). Stop everything with:

```bash
docker compose down          # stop containers, keep the postgres volume
docker compose down -v       # stop containers and delete the postgres volume too
```

---

## ☸️ Deploying to a `kind` Cluster on AWS EC2 <a name="-deploying-to-a-kind-cluster-on-aws-ec2"></a>

This is the full, end-to-end sequence used to take GoCart from source code to a running Kubernetes deployment, reachable over the public internet, on a single EC2 instance. Every command below is taken directly from `scripts/ec2-bootstrap.sh` and `scripts/deploy.sh`.

### Prerequisites

- An AWS EC2 instance (Ubuntu/Debian **or** Amazon Linux 2023), e.g. `t3.medium` or larger (a 3-node `kind` cluster is memory-hungry).
- The instance's **Security Group** must allow inbound TCP on:
  - `22` (SSH, to administer the box)
  - `80` and `443` (HTTP/HTTPS — these are mapped straight through to the ingress controller)
- A Neon Postgres database already created (or any reachable Postgres), plus a Clerk application (publishable + secret key).

### Step 1 — Connect to the instance and get the code

```bash
ssh -i <your-key.pem> <user>@<ec2-public-ip>

git clone <this-repo-url> gocart
cd gocart
```

### Step 2 — Provide the environment configuration

Copy your local `.env` (or `.env.example`) onto the instance and fill in real values — `deploy.sh` refuses to run without it:

```bash
cp .env.example .env
# then edit .env and set:
#   NEXT_PUBLIC_CURRENCY_SYMBOL
#   DATABASE_URL                 (Neon pooled connection string)
#   DIRECT_URL                   (Neon direct connection string)
#   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
#   CLERK_SECRET_KEY
```

See [Environment Variables](#-environment-variables) below for what each key is for.

### Step 3 — Bootstrap the instance (`scripts/ec2-bootstrap.sh`)

One-time setup that installs everything the deploy step needs: Docker, `kubectl`, and `kind`.

```bash
chmod +x scripts/ec2-bootstrap.sh
./scripts/ec2-bootstrap.sh
```

What it does, command by command:

| # | Command | Why |
|---|---|---|
| 1 | `apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin` (Ubuntu/Debian) **or** `dnf install docker` (Amazon Linux) | Installs the Docker engine — `kind` runs Kubernetes nodes as Docker containers. |
| 2 | `systemctl enable --now docker` | Starts Docker and enables it on boot. |
| 3 | `usermod -aG docker "$USER"` | Lets your non-root SSH user run `docker`/`kind` without `sudo`. |
| 4 | `curl ... kubectl` → `chmod +x` → `mv /usr/local/bin/kubectl` | Installs `kubectl` (pinned to `v1.31.0`), the CLI used to talk to the cluster. |
| 5 | `curl ... kind-linux-amd64` → `chmod +x` → `mv /usr/local/bin/kind` | Installs `kind` (pinned to `v0.27.0`), which creates the Kubernetes cluster itself. |

After it finishes, log out and back in (or run `newgrp docker`) so your shell picks up the new `docker` group membership.

### Step 4 — Deploy (`scripts/deploy.sh`)

This single script is idempotent — safe to re-run after every code change to redeploy.

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

Full command sequence it runs, in order:

1. **Load environment variables**
   ```bash
   source .env
   ```
   Fails fast with an error if `.env` is missing.

2. **Create the `kind` cluster (if it doesn't already exist)**
   ```bash
   kind get clusters | grep -qx gocart || kind create cluster --config kind-cluster.yaml
   ```
   `kind-cluster.yaml` defines **3 nodes**: one `control-plane` (labeled `ingress-ready=true`, with host ports `80`/`443` mapped to container ports `80`/`443`) and two `worker` nodes. This is what gives the EC2 instance's public IP a path into the cluster.

3. **Build the application image**
   ```bash
   docker build \
     --build-arg NEXT_PUBLIC_CURRENCY_SYMBOL="$NEXT_PUBLIC_CURRENCY_SYMBOL" \
     --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" \
     -t gocart:local .
   ```
   Runs the multi-stage `Dockerfile`: installs deps → `npx prisma generate` → `npm run build` (standalone Next.js output) → copies the standalone server into a minimal `node:20-alpine` runtime image that runs as a non-root `nextjs` user on port `3000`.

4. **Load the image into the `kind` cluster**
   ```bash
   kind load docker-image gocart:local --name gocart
   ```
   `kind` nodes have their own containerd image store, separate from your host's Docker daemon — this step pushes the locally built image straight into every cluster node without needing a registry.

5. **Create the namespace**
   ```bash
   kubectl apply -f k8s/namespace.yaml
   ```
   Creates the `gocart` namespace that every other resource lives in.

6. **Create the ConfigMap**
   ```bash
   kubectl apply -f k8s/configmap.yaml
   ```
   Publishes the non-sensitive `NEXT_PUBLIC_CURRENCY_SYMBOL` value.

7. **Create the Secret**
   ```bash
   kubectl create secret generic gocart-secrets -n gocart \
     --from-literal=DATABASE_URL="$DATABASE_URL" \
     --from-literal=DIRECT_URL="$DIRECT_URL" \
     --from-literal=CLERK_SECRET_KEY="$CLERK_SECRET_KEY" \
     --dry-run=client -o yaml | kubectl apply -f -
   ```
   The `--dry-run=client -o yaml | kubectl apply -f -` pattern makes secret creation idempotent (`kubectl create` alone would fail on re-run because the secret already exists).

8. **Deploy the application + expose it internally**
   ```bash
   sed "s|image: gocart:local|image: gocart:local|" k8s/deployment.yaml | kubectl apply -f -
   kubectl apply -f k8s/service.yaml
   ```
   (The `sed` substitutes in `$IMAGE_TAG` when you deploy a new version — see [Rolling updates](#-operating-the-cluster).) This creates the `Deployment` (2 replicas, CPU/memory requests+limits, hardened `securityContext`, `topologySpreadConstraints`, liveness/readiness probes on `/api/health`) and the `ClusterIP` `Service` (`gocart-svc`, port `80` → container port `3000`).

9. **Install metrics-server (if not already present)**
   ```bash
   kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
   kubectl patch deployment metrics-server -n kube-system --type=json \
     -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
   kubectl wait --namespace kube-system --for=condition=available deployment/metrics-server --timeout=120s
   ```
   The HPA (next step) needs CPU/memory metrics to act on. `kind` doesn't bundle `metrics-server`, and its kubelet certs aren't signed by a CA it trusts by default — `--kubelet-insecure-tls` is the standard `kind` workaround (not needed on a real cluster like EKS).

10. **Apply the HorizontalPodAutoscaler + PodDisruptionBudget**
    ```bash
    kubectl apply -f k8s/hpa.yaml
    kubectl apply -f k8s/pdb.yaml
    ```
    Lets the Deployment scale itself (2–5 replicas, CPU/memory-driven) and protects against a voluntary disruption removing every replica at once.

11. **Install the ingress controller (if not already present)**
   ```bash
   kubectl get ns ingress-nginx >/dev/null 2>&1 || \
     kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
   ```
   Installs the `kind`-flavored ingress-nginx controller manifest.

12. **Pin the controller to the control-plane node**
    ```bash
    kubectl patch deployment ingress-nginx-controller -n ingress-nginx \
      -p '{"spec":{"template":{"spec":{"nodeSelector":{"kubernetes.io/os":"linux","ingress-ready":"true"}}}}}'
    ```
    Only the control-plane node has the EC2 host-port mapping (step 2 above), so the controller **must** land there or port 80/443 would have nothing behind them.

13. **Wait for the controller to be ready**
    ```bash
    kubectl wait --namespace ingress-nginx \
      --for=condition=ready pod \
      --selector=app.kubernetes.io/component=controller \
      --timeout=180s
    ```

14. **Apply the Ingress**
    ```bash
    kubectl apply -f k8s/ingress.yaml
    ```
    Routes `/` on the `nginx` ingress class to `gocart-svc:80`.

15. **Wait for the rollout to finish**
    ```bash
    kubectl rollout status deployment/gocart -n gocart
    ```
    Blocks until both replicas are up and passing their readiness probe.

### Step 5 — Open the app

```
http://<ec2-instance-public-ip>/
```

(assuming the Security Group allows inbound `80`/`443`, as set up in the Prerequisites).

---

## 📦 Kubernetes Resources Reference <a name="-kubernetes-resources-reference"></a>

All manifests live under `k8s/` and are applied into the `gocart` namespace.

| File | Kind | Purpose |
|---|---|---|
| `k8s/namespace.yaml` | `Namespace` | Isolates all GoCart resources under `gocart`. |
| `k8s/configmap.yaml` | `ConfigMap` (`gocart-config`) | Public, non-sensitive runtime config (`NEXT_PUBLIC_CURRENCY_SYMBOL`). |
| `k8s/secret.example.yaml` | `Secret` (template, **not applied directly**) | Documents the shape of `gocart-secrets`; the real secret is created imperatively by `deploy.sh` from `.env` so values never get committed to git. |
| `k8s/deployment.yaml` | `Deployment` (`gocart`) | 2 replicas of the app container; wires in the ConfigMap/Secret via `envFrom`; defines `resources.requests/limits`, a hardened `securityContext` (non-root, no capabilities), `topologySpreadConstraints`, and `readinessProbe`/`livenessProbe` against `GET /api/health`. |
| `k8s/hpa.yaml` | `HorizontalPodAutoscaler` (`gocart-hpa`) | Scales the `gocart` Deployment between 2 and 5 replicas on 70% CPU / 80% memory utilization; requires `metrics-server` in-cluster. |
| `k8s/pdb.yaml` | `PodDisruptionBudget` (`gocart-pdb`) | Keeps at least 1 replica available during voluntary disruptions (node drains, upgrades). |
| `k8s/service.yaml` | `Service` (`gocart-svc`) | `ClusterIP` service, port `80` → container port `3000`, selecting pods labeled `app: gocart`. |
| `k8s/ingress.yaml` | `Ingress` (`gocart-ingress`) | Routes all paths (`/`) on the `nginx` ingress class to `gocart-svc`; SSL redirect disabled (plain HTTP demo setup). |
| `kind-cluster.yaml` | `kind` cluster config | 1 control-plane (+ `ingress-ready=true` label, host ports `80`/`443` mapped) + 2 workers. |

---

## 💾 Why No PersistentVolume / PersistentVolumeClaim? <a name="-why-no-persistentvolume--persistentvolumeclaim"></a>

Looking at `k8s/`, you'll notice there's no `PersistentVolume` (PV) or `PersistentVolumeClaim` (PVC) anywhere. That's a deliberate consequence of where this app keeps its state, not an oversight.

### The reasoning

- **The `gocart` pods are 100% stateless.** The container is a Next.js server — it holds no data on local disk between requests. Kill a pod, start a new one, and nothing is lost, which is exactly why the `Deployment` can run 2 interchangeable replicas behind a single `Service`.
- **All durable state lives outside the cluster, in Neon Postgres.** `DATABASE_URL`/`DIRECT_URL` (injected from the `gocart-secrets` Secret) point at a managed, externally-hosted Postgres instance. Neon owns the disks, backups, and durability for that data — the `kind` cluster never touches it, so there's no in-cluster volume to provision.
- **A PV/PVC only becomes necessary when a pod needs disk that must survive a restart/reschedule** (a database, a message broker, uploaded files written to local disk, etc.). GoCart has no such component running *inside* Kubernetes: the one piece of real state (Postgres) was intentionally kept external instead of being run as an in-cluster `StatefulSet`.
- **The one place a volume does appear — `docker-compose.yml`'s `gocart-db-data`** — is a plain **Docker volume**, used only for local dev convenience when you don't want to point at Neon. It has nothing to do with Kubernetes and isn't carried into the `kind`/EC2 deployment at all.

In short: no stateful workload runs inside the cluster, so there's nothing for a PV/PVC to back.

### Practical demo: what it would look like if you *did* need one

If you wanted to run Postgres **inside** the `kind` cluster instead of using Neon (e.g. for a fully offline demo), here's the concept in practice. `kind` ships a default `StorageClass` backed by the `rancher.io/local-path` provisioner, which dynamically creates a PV (as a directory on the node) the moment a matching PVC is created:

```bash
# 1. Confirm kind's default StorageClass exists
kubectl get storageclass
# NAME                 PROVISIONER             RECLAIMPOLICY   ...
# standard (default)   rancher.io/local-path   Delete          ...
```

Define a claim asking that StorageClass for 1Gi of storage:

```yaml
# k8s/postgres-pvc.yaml (illustrative — not part of this repo's deployment)
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: gocart
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: standard
  resources:
    requests:
      storage: 1Gi
```

```bash
# 2. Apply it and watch the PV get dynamically provisioned to satisfy it
kubectl apply -f k8s/postgres-pvc.yaml
kubectl get pvc -n gocart        # STATUS should flip to "Bound"
kubectl get pv                   # a new PV now exists, bound to the claim above
```

Then mount that claim into a Postgres pod so its data directory survives pod restarts/rescheduling:

```yaml
containers:
  - name: postgres
    image: postgres:16-alpine
    volumeMounts:
      - name: pgdata
        mountPath: /var/lib/postgresql/data
volumes:
  - name: pgdata
    persistentVolumeClaim:
      claimName: postgres-pvc
```

With this in place, `kubectl delete pod <postgres-pod>` would let Kubernetes reschedule a fresh pod that re-attaches the **same** PVC — and therefore the same data — proving the PV/PVC survives the pod's lifecycle, unlike the stateless `gocart` pods which intentionally don't need that guarantee.

---

## 🔐 Environment Variables <a name="-environment-variables"></a>

Defined in `.env` (see `.env.example` for the template). **Never commit a real `.env` or a filled-in `k8s/secret.example.yaml`.**

| Variable | Where it's used | Description |
|---|---|---|
| `NEXT_PUBLIC_CURRENCY_SYMBOL` | Docker build arg + `ConfigMap` | Currency symbol shown throughout the UI. `NEXT_PUBLIC_*` vars are inlined at **build time**, so they must be passed as `--build-arg`, not just a runtime env var. |
| `DATABASE_URL` | `Secret` → pod env | Pooled Postgres (Neon) connection string used by the Prisma `pg` adapter at runtime. |
| `DIRECT_URL` | `Secret` → pod env; also used by `prisma.config.js` | Direct (non-pooled) Postgres connection string, required for Prisma CLI operations (`migrate`, `generate` schema resolution). |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Docker build arg | Clerk's public key, inlined into the client bundle. |
| `CLERK_SECRET_KEY` | `Secret` → pod env | Clerk's server-side secret key, used by `clerkMiddleware()` in `middleware.js`. |

---

## 🧰 Operating the Cluster <a name="-operating-the-cluster"></a>

Common day-2 commands once the cluster is up:

```bash
# Check pod / rollout status
kubectl get pods -n gocart
kubectl get deployment gocart -n gocart
kubectl get svc,ingress -n gocart

# Check autoscaling status (current replicas vs. target CPU/memory)
kubectl get hpa -n gocart
kubectl get pdb -n gocart

# Tail application logs
kubectl logs -n gocart -l app=gocart -f

# Redeploy after a code change (rebuild + rolling update)
IMAGE_TAG=v2 ./scripts/deploy.sh

# Roll back to the previous ReplicaSet
kubectl rollout undo deployment/gocart -n gocart

# Run the 16-point cluster audit (sanity check against common K8s concepts)
./audit.sh gocart

# Tear down the whole cluster (containers, networks, volumes for it)
kind delete cluster --name gocart
```

Setting `IMAGE_TAG` (e.g. `IMAGE_TAG=v2 ./scripts/deploy.sh`) builds `gocart:v2`, loads it into `kind`, and substitutes it into the Deployment, triggering a visible rolling update across the 2 replicas.

---

## 🤝 Contributing <a name="-contributing"></a>

We welcome contributions! Please see our [CONTRIBUTING.md](./CONTRIBUTING.md) for more details on how to get started.

---

## 📜 License <a name="-license"></a>

This project is licensed under the MIT License. See the [LICENSE.md](./LICENSE.md) file for details.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!
