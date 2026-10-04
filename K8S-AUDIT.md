# K8S Audit

Fill this in after you run `./audit.sh`. The script is only a hint. Your evidence below is what gets scored.

## My app

- Name: GoCart
- Repo link: https://github.com/sumeetgaurav/gocart
- Tiers (frontend / API / database or cache, and what each one is built with): Single-tier app container serves both the frontend (Next.js 15 App Router, React 19, Tailwind) and the API (Next.js Route Handlers) from one Deployment; Database is [Neon](https://neon.tech/) serverless Postgres (external, managed, accessed via Prisma 7 + `@prisma/adapter-pg`); Auth is [Clerk](https://clerk.com/) (external, SaaS). No in-cluster cache/database tier — see the PVC row below for why.
- Kubernetes manifests are in (folder): [`k8s/`](k8s/)
- How to run it from a fresh machine (every command, in order, starting from `kind create cluster`):
  ```bash
  # 0. Bootstrap the EC2 host (installs Docker, kubectl v1.31.0, kind v0.27.0)
  chmod +x scripts/ec2-bootstrap.sh && ./scripts/ec2-bootstrap.sh
  newgrp docker   # pick up the new docker group membership

  # 1. Everything below is run for you by scripts/deploy.sh, in order:
  source .env                                                   # DATABASE_URL, DIRECT_URL, CLERK_SECRET_KEY, etc.
  kind get clusters | grep -qx gocart || kind create cluster --config kind-cluster.yaml
  docker build --build-arg NEXT_PUBLIC_CURRENCY_SYMBOL="$NEXT_PUBLIC_CURRENCY_SYMBOL" \
                --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" \
                -t gocart:local .
  kind load docker-image gocart:local --name gocart
  kubectl apply -f k8s/namespace.yaml
  kubectl apply -f k8s/configmap.yaml
  kubectl create secret generic gocart-secrets -n gocart \
    --from-literal=DATABASE_URL="$DATABASE_URL" \
    --from-literal=DIRECT_URL="$DIRECT_URL" \
    --from-literal=CLERK_SECRET_KEY="$CLERK_SECRET_KEY" \
    --dry-run=client -o yaml | kubectl apply -f -
  kubectl apply -f k8s/deployment.yaml
  kubectl apply -f k8s/service.yaml
  kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
  kubectl patch deployment metrics-server -n kube-system --type=json \
    -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
  kubectl apply -f k8s/hpa.yaml
  kubectl apply -f k8s/pdb.yaml
  kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
  kubectl patch deployment ingress-nginx-controller -n ingress-nginx \
    -p '{"spec":{"template":{"spec":{"nodeSelector":{"kubernetes.io/os":"linux","ingress-ready":"true"}}}}}'
  kubectl apply -f k8s/ingress.yaml
  kubectl rollout status deployment/gocart -n gocart

  # Shortcut: all of the above (steps 1 onward) is just:
  ./scripts/deploy.sh
  ```
- How to open it (URL, or port-forward command): `http://<ec2-instance-public-ip>/` (Security Group must allow inbound 80/443), or locally: `kubectl port-forward svc/gocart-svc -n gocart 8080:80` then open `http://localhost:8080`.

## Before you submit

- [x] "My app" is filled in and the run steps work on a fresh cluster
- [x] Every row has a status; every ✅ has evidence and a one-line reason
- [x] I ran `./audit.sh` and I can explain every ❌ and ⚠️
- [x] Manifests are in the repo and the links in the table work

## How to fill the table

- **Status**: ✅ used and working. ⚠️ tried, or only partly used (say what is missing). ❌ not used.
- **Evidence**: a link to the file in your repo (with line numbers if the file is long), or pasted command output in a code block. Not a screenshot.
- **Why I used it in my app**: one line. What would break or get worse without it?
- A tick without evidence does not count. A concept that does nothing for your app does not count either.
- Leave the last column as it is. It is there to help you.

## Audit

| Concept | Status (✅ / ⚠️ / ❌) | Evidence | Why I used it in my app | Where to look |
|---|---|---|---|---|
| Deployment + ReplicaSet | ✅ | [`k8s/deployment.yaml`](k8s/deployment.yaml) (whole file; `replicas: 2` at [L14](k8s/deployment.yaml#L14), pod template [L18-L81](k8s/deployment.yaml#L18-L81)). `kubectl get deploy,rs -n gocart` confirms the Deployment owns a ReplicaSet which owns 2 pods. | A Deployment keeps 2 replicas of the stateless Next.js container running and recreates any pod that dies, so the app survives a single pod crash without anyone intervening. | [nginx Deployment](https://github.com/LondheShubham153/kubestarter/blob/main/examples/nginx/deployment.yml), [ReplicaSet](https://github.com/LondheShubham153/kubernetes-in-one-shot/blob/master/nginx/replicasets.yml) <!-- TODO: add video timestamp --> |
| Service | ✅ | [`k8s/service.yaml`](k8s/service.yaml) (whole file; `ClusterIP`, port `80`→`3000` at [L9-L12](k8s/service.yaml#L9-L12)). `audit.sh` confirms: "1 service(s) have endpoints". | Gives the Deployment's 2 pods one stable DNS name/IP (`gocart-svc`) so the Ingress (and anything else in-cluster) doesn't need to track individual pod IPs that change on every rollout. | [nginx Service](https://github.com/LondheShubham153/kubestarter/blob/main/examples/nginx/service.yml) <!-- TODO: add video timestamp --> |
| Namespace | ✅ | [`k8s/namespace.yaml`](k8s/namespace.yaml) (whole file, 5 lines). | Isolates every GoCart object (`Deployment`, `Service`, `ConfigMap`, `Secret`, `HPA`, `PDB`, `Ingress`) under `gocart`, separate from `kube-system`/`ingress-nginx`, so `audit.sh`/RBAC/resource views can scope to just this app. | [namespace manifest](https://github.com/LondheShubham153/kubernetes-in-one-shot/blob/master/nginx/namespace.yml), [k8s docs](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/) <!-- TODO: add video timestamp --> |
| Labels and selectors | ✅ | `app: gocart` label set on the Deployment/pod template ([`k8s/deployment.yaml` L6-L7, L20-L21](k8s/deployment.yaml#L6-L7)) and matched by the Service selector ([`k8s/service.yaml` L7-L8](k8s/service.yaml#L7-L8)) and the PDB selector ([`k8s/pdb.yaml` L10-L12](k8s/pdb.yaml#L10-L12)). `audit.sh` confirms this live: "1 service(s) have endpoints, so selectors match pod labels". | Without a matching label/selector pair, `gocart-svc` would have zero endpoints and silently drop every request — labels are the only thing that wires Service → Pod and PDB → Pod together. | [commands: namespaces, labels, selectors](https://github.com/LondheShubham153/kubernetes-in-one-shot/blob/master/README.md), [k8s docs](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) <!-- TODO: add video timestamp --> |
| Rolling update + rollback | ✅ | Rolling update: `IMAGE_TAG=v2 ./scripts/deploy.sh` ([`README.md` L499-L500](README.md#L499-L500)) re-applies `k8s/deployment.yaml` with a new tag, which `audit.sh` detects as "1 deployment(s) rolled to a new image". Rollback: `kubectl rollout undo deployment/gocart -n gocart` ([`README.md` L503](README.md#L503)). | Deploys a new image version with zero downtime (old pods stay up until new ones pass their readiness probe), and gives a one-command way back to the last-known-good ReplicaSet if the new version is broken. | [rolling update](https://github.com/LondheShubham153/kubestarter/blob/main/Deployment_Strategies/Rolling-Update-Deployment/) (rollback is not covered there, see [k8s docs](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)) <!-- TODO: add video timestamp --> |
| ConfigMap | ✅ | [`k8s/configmap.yaml`](k8s/configmap.yaml) (whole file, 7 lines), consumed via `envFrom.configMapRef` in [`k8s/deployment.yaml` L58-L60](k8s/deployment.yaml#L58-L60). | Lets `NEXT_PUBLIC_CURRENCY_SYMBOL` change per-environment without rebuilding the Docker image or baking the value into it. | [MySQL ConfigMap](https://github.com/LondheShubham153/kubestarter/blob/main/examples/mysql/configMap.yml) <!-- TODO: add video timestamp --> |
| Secret | ✅ | [`k8s/secret.example.yaml`](k8s/secret.example.yaml) documents the shape (never applied as-is); the real `Opaque` secret is created imperatively by `scripts/deploy.sh` from `.env` ([`README.md` L305-L313](README.md#L305-L313)) and consumed via `envFrom.secretRef` in [`k8s/deployment.yaml` L61-L62](k8s/deployment.yaml#L61-L62). `audit.sh` confirms: "1 Opaque secret(s)". | `DATABASE_URL`, `DIRECT_URL`, and `CLERK_SECRET_KEY` are real credentials — a Secret keeps them out of the image, out of `ConfigMap`/plain YAML, and out of git entirely. | [MySQL Secret](https://github.com/LondheShubham153/kubestarter/blob/main/examples/mysql/secrets.yml) <!-- TODO: add video timestamp --> |
| Requests and limits | ✅ | [`k8s/deployment.yaml` L63-L69](k8s/deployment.yaml#L63-L69): `requests` 100m CPU/192Mi memory, `limits` 500m CPU/512Mi memory. `audit.sh` confirms: "2 of 2 containers have cpu+memory requests and limits". | Requests let the scheduler place pods where resources actually fit; limits stop one runaway pod (e.g. a memory leak) from starving/OOM-killing its node-mates. | [Deployment with resources](https://github.com/LondheShubham153/kubestarter/blob/main/HPA_VPA/apache-deployment.yml), [k8s docs](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) <!-- TODO: add video timestamp --> |
| Probes (liveness + readiness) | ✅ | [`k8s/deployment.yaml` L70-L81](k8s/deployment.yaml#L70-L81): both probes hit `GET /api/health:3000`. `audit.sh` confirms: "2 of 2 containers have both probes". | Readiness keeps a pod that's still starting (or lost its DB connection) out of `gocart-svc`'s endpoints so it gets no traffic; liveness restarts a pod that's hung without crashing, which the kubelet otherwise can't detect. | [k8s docs](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/), [liveness example](https://github.com/LondheShubham153/kubernetes-in-one-shot/blob/master/django-notes-app/k8s/deployment.yml) <!-- TODO: add video timestamp --> |
| PVC | ❌ | N/A — deliberately not used. Rationale written up in [`README.md` "Why No PersistentVolume / PersistentVolumeClaim?"](README.md#-why-no-persistentvolume--persistentvolumeclaim) (starts [L400](README.md#L400)), including a worked illustrative example of what it would look like. | All persistent state (products, orders, users, cart) lives in Neon Postgres, an external managed database — the app container itself is fully stateless, so a PVC would have nothing real to hold and would just add an unused object to the audit. | [PVC](https://github.com/LondheShubham153/kubestarter/blob/main/PersistentVolumes/PersistentVolumeClaim.yaml), [MySQL volumes](https://github.com/LondheShubham153/kubestarter/blob/main/examples/mysql/persistentVols.yml) (kind creates the volume for you, see [kind/README.md](kind/README.md)) <!-- TODO: add video timestamp --> |
| Ingress | ✅ | [`k8s/ingress.yaml`](k8s/ingress.yaml) (whole file, 20 lines) routes `/` → `gocart-svc:80` on the `nginx` ingress class. Controller install/pinning steps: [`README.md` L338-L358](README.md#L338-L358). `audit.sh` confirms: "1 ingress resource(s), 1 running controller pod(s)". | Gives the app a single HTTP(S) entrypoint on the EC2 instance's port 80/443 (mapped to the `kind` control-plane node) without needing a cloud load balancer, which `kind` doesn't provide. | [Ingress examples](https://github.com/LondheShubham153/kubestarter/blob/main/Ingress/) (written for minikube, use [kind/README.md](kind/README.md) for the controller), [Ingress manifest](https://github.com/LondheShubham153/kubernetes-in-one-shot/blob/master/nginx/ingress.yml) <!-- TODO: add video timestamp --> |
| Multi-node kind cluster | ✅ | [`kind-cluster.yaml`](kind-cluster.yaml) (whole file): 1 `control-plane` (labeled `ingress-ready=true`, host ports 80/443 mapped) + 2 `worker` nodes. `audit.sh` confirms: "3 node(s)". | A 3-node cluster lets `topologySpreadConstraints` ([`k8s/deployment.yaml` L35-L47](k8s/deployment.yaml#L35-L47)) actually spread the 2 replicas across different nodes instead of being a no-op on a single-node cluster. | [kubestarter kind config](https://github.com/LondheShubham153/kubestarter/blob/main/kind-cluster/kind-config.yml), [our config](kind/kind-config.yaml) <!-- TODO: add video timestamp --> |
| HPA (stretch) | ✅ | [`k8s/hpa.yaml`](k8s/hpa.yaml) (whole file): targets the `gocart` Deployment, `minReplicas: 2`/`maxReplicas: 5`, scales on 70% CPU / 80% memory utilization. `metrics-server` install: [`README.md` L322-L329](README.md#L322-L329). `audit.sh` confirms: "1 HPA(s)". | Lets replica count grow automatically under real traffic (e.g. a flash sale) instead of being stuck at a fixed `replicas: 2` that's either wasteful at idle or insufficient under load. | [HPA manifest](https://github.com/LondheShubham153/kubestarter/blob/main/HPA_VPA/apache-hpa.yml), [metrics-server steps](https://github.com/LondheShubham153/kubestarter/blob/main/HPA_VPA/README.md) <!-- TODO: add video timestamp --> |
| RBAC + ServiceAccount (stretch) | ❌ | Not implemented yet. | Not used yet — the app's own pods don't call the Kubernetes API, so there's been no concrete need for a scoped `ServiceAccount`/`Role`/`RoleBinding` so far. Tracked as a follow-up (see "What I would change" below). | [RBAC examples](https://github.com/LondheShubham153/kubestarter/blob/main/RBAC/) <!-- TODO: add video timestamp --> |
| CronJob (stretch) | ❌ | Not implemented yet. | Not used yet — there's no recurring in-cluster job (e.g. cleanup, report) in this app today; Neon handles its own backups externally. Tracked as a follow-up. | [CronJob manifest](https://github.com/LondheShubham153/kubernetes-in-one-shot/blob/master/nginx/cron-job.yml), [k8s docs](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) <!-- TODO: add video timestamp --> |
| GitHub Actions deploying to kind (stretch) | ✅ | [`.github/workflows/ci.yml`](.github/workflows/ci.yml), `kind-smoke-test` job: builds the image, creates a cluster via [`helm/kind-action`](https://github.com/helm/kind-action), `kind load docker-image`, applies `namespace.yaml`/`configmap.yaml`/a dummy `Secret`/`deployment.yaml`/`service.yaml`, waits for rollout, then curls `/api/health` through `kubectl port-forward`. `audit.sh`'s check (`grep -rEqs 'kind create cluster|helm/kind-action|setup-kind' .github/workflows`) now finds this. Runs on every push/PR to `main`, separate from the long-lived EC2 cluster. | Catches a broken manifest (bad selector, wrong port, bad probe path) on every PR, on a throwaway cluster, before it ever reaches the EC2 box — deploys to the real EC2 cluster are still triggered by hand via `scripts/deploy.sh`. | [helm/kind-action](https://github.com/helm/kind-action), [example workflow](examples/sample-app-k8s/.github/workflows/kind-deploy.yml) <!-- TODO: add video timestamp --> |

## Score

- Must-have concepts with ✅ and evidence (12 max): 11
- Stretch concepts with ✅ and evidence (4 max): 2
- Total (pass at 10 or more): 13

## What was hard / what I would change

Getting the HPA to show a real ✅ took an extra step beyond just applying the manifest — `kind` doesn't ship `metrics-server`, and its kubelet serving certs aren't trusted by default, so the HPA sat at `<unknown>` targets until `--kubelet-insecure-tls` was patched in. The other snag was entirely environmental, not app-related: after the EC2 instance restarted, `kind`'s remapped host port for the API server (`6443` → a new ephemeral port) left `~/.kube/config` pointing at a stale port, so `kubectl` (and `audit.sh`) failed with "cannot reach a cluster" even though the containers were healthy — fixed with `kind export kubeconfig --name gocart`. If I kept going, I'd add a `ServiceAccount`/`Role`/`RoleBinding` scoped to something the app's own pod could plausibly need (e.g. read-only access to its own `ConfigMap`) — called out in `PLAN.md` as a later phase rather than done today. (The other follow-up noted in earlier drafts of this doc — a GitHub Actions workflow smoke-testing the manifests against a throwaway `kind` cluster on every PR — is now done: see the `kind-smoke-test` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).)
